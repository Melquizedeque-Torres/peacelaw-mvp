from datetime import datetime, timezone
import uuid

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, update

from app import errors
from app.consent import CONSENT_VERSION
from app.evidence import with_evidence_count
from app.lifecycle import DELETABLE, OPEN_STATUSES
from app.deps import ClientUser, SessionDep
from app.models import Case, CaseStatus, EvidenceFile, User
from app.privacy.redaction import redact_pii
from app.schemas import (
    CaseCreate,
    CaseCreated,
    CaseOwnerView,
    CaseSummary,
    RedactionCount,
    ValidationErrorOut,
)

router = APIRouter(
    prefix="/api/cases", tags=["cases"], responses={422: {"model": ValidationErrorOut}}
)


TITLE_MAX = 200  # mirrors Case.title String(200)
MAX_OPEN_CASES = 20


def _owned_case(db: SessionDep, case_id: uuid.UUID, client: User) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.client_id != client.id:
        # 404 rather than 403: never confirm that someone else's case exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    return case


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CaseCreated)
def create_case(payload: CaseCreate, client: ClientUser, db: SessionDep) -> CaseCreated:
    if payload.consent_version != CONSENT_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CONSENT_OUTDATED)
    open_cases = db.scalar(
        select(func.count()).select_from(Case).where(
            Case.client_id == client.id, Case.status.in_(OPEN_STATUSES)
        )
    )
    if open_cases >= MAX_OPEN_CASES:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, errors.OPEN_CASES_LIMIT
        )
    title = redact_pii(payload.title)
    text = redact_pii(payload.text)
    if len(title.text) > TITLE_MAX:
        # Redaction can lengthen text ("R$1" -> "[VALOR]"); keep the sanitized 422 shape.
        return JSONResponse(  # type: ignore[return-value]
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": "Dados inválidos.",
                "errors": [
                    {"field": "title", "message": "Título longo demais após a anonimização."}
                ],
            },
        )
    case = Case(
        client_id=client.id,
        title=title.text,
        raw_text=payload.text,
        anonymized_text=text.text,
        status=CaseStatus.AWAITING_APPROVAL,
        area=payload.area,
        consent_at=datetime.now(timezone.utc),
        consent_version=CONSENT_VERSION,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    counts: dict[str, int] = {}
    for source in (title.counts, text.counts):
        for label, count in source.items():
            counts[label] = counts.get(label, 0) + count
    return CaseCreated(
        **CaseOwnerView.model_validate(case).model_dump(),
        redactions=[RedactionCount(label=k, count=v) for k, v in counts.items()],
    )


@router.get("/mine", response_model=list[CaseSummary])
def my_cases(
    client: ClientUser,
    db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Case]:
    stmt = (
        select(Case)
        .where(Case.client_id == client.id)
        .order_by(Case.created_at.desc(), Case.id)
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt))


@router.get("/{case_id}", response_model=CaseOwnerView)
def get_my_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Case:
    return with_evidence_count(db, [_owned_case(db, case_id, client)])[0]


@router.post("/{case_id}/approve", response_model=CaseOwnerView)
def approve_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Case:
    # Atomic conditional UPDATE: no check-then-act window.
    result = db.execute(
        update(Case)
        .where(
            Case.id == case_id,
            Case.client_id == client.id,
            Case.status == CaseStatus.AWAITING_APPROVAL,
        )
        .values(status=CaseStatus.READY_FOR_JUDGE)
    )
    if result.rowcount == 0:
        db.rollback()
        _owned_case(db, case_id, client)
        raise HTTPException(status.HTTP_409_CONFLICT, errors.INVALID_TRANSITION)
    db.commit()
    case = _owned_case(db, case_id, client)
    db.refresh(case)
    return with_evidence_count(db, [case])[0]


@router.post("/{case_id}/erase-original", response_model=CaseOwnerView)
def erase_original(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Case:
    # LGPD erasure on request: only the original report goes; the anonymized text
    # and the workflow stay. Conditional UPDATE keeps it idempotent and atomic
    # (a repeat call leaves the first erased_at untouched).
    case = _owned_case(db, case_id, client)
    if case.raw_text_erased_at is None:
        now = datetime.now(timezone.utc)
        db.execute(
            update(Case)
            .where(
                Case.id == case_id,
                Case.client_id == client.id,
                Case.raw_text_erased_at.is_(None),
            )
            .values(raw_text="", raw_text_erased_at=now)
        )
        db.execute(
            update(EvidenceFile)
            .where(EvidenceFile.case_id == case_id, EvidenceFile.erased_at.is_(None))
            .values(data=b"", size_bytes=0, filename="anexo", erased_at=now)
        )
        db.commit()
        db.expire_all()
    return with_evidence_count(db, [_owned_case(db, case_id, client)])[0]


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> None:
    # Core DELETE skips ORM cascades; case_reviews relies on FK ondelete=CASCADE.
    result = db.execute(
        delete(Case).where(
            Case.id == case_id,
            Case.client_id == client.id,
            Case.status.in_(DELETABLE),
        )
    )
    if result.rowcount == 0:
        db.rollback()
        _owned_case(db, case_id, client)
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CASE_NOT_DELETABLE)
    db.commit()
    db.expire_all()
