import uuid
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app import errors
from app.deps import ClientUser, SessionDep
from app.evidence import MAX_BYTES, MAX_FILES, safe_filename, sniff
from app.lifecycle import DELETABLE
from app.models import Case, EvidenceFile
from app.schemas import EvidenceOut

router = APIRouter(prefix="/api/cases/{case_id}/evidence", tags=["evidence"])


def _owned(db: SessionDep, case_id: uuid.UUID, client) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    return case


def _locked_case_for_upload(db, case_id: uuid.UUID, client) -> Case:
    # Row lock (no-op on SQLite): concurrent uploads for one case serialize, and the
    # status/count checks hold until the insert is committed.
    case = db.get(Case, case_id, with_for_update=True)
    if case is None or case.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    if case.status not in DELETABLE or case.raw_text_erased_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EVIDENCE_LOCKED)
    count = db.scalar(select(func.count()).select_from(EvidenceFile).where(EvidenceFile.case_id == case.id))
    if count >= MAX_FILES:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EVIDENCE_LIMIT)
    return case


def _store(db, case: Case, data: bytes, raw_name: str) -> EvidenceFile:
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, errors.EVIDENCE_TOO_BIG)
    kind = sniff(data)
    if kind is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, errors.EVIDENCE_TYPE)
    item = EvidenceFile(case_id=case.id, filename=safe_filename(raw_name), content_type=kind,
                        size_bytes=len(data), data=data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("", status_code=status.HTTP_201_CREATED, response_model=EvidenceOut)
async def upload(case_id: uuid.UUID, request: Request, client: ClientUser, db: SessionDep,
                 x_filename: Annotated[str | None, Header(max_length=1200)] = None) -> EvidenceFile:
    # The filename travels in a header (not the URL, which ends up in access logs).
    raw_name = unquote(x_filename, errors="replace") if x_filename else "anexo"
    if len(raw_name) > 300:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, errors.EVIDENCE_FILENAME_TOO_LONG)
    try:
        # Checks (and the lock) come before buffering the body; the lock is kept until commit.
        case = await run_in_threadpool(_locked_case_for_upload, db, case_id, client)
        data = await request.body()
        return await run_in_threadpool(_store, db, case, data, raw_name)
    except BaseException:
        await run_in_threadpool(db.rollback)  # release the row lock on any failure
        raise


@router.get("", response_model=list[EvidenceOut])
def list_evidence(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> list[EvidenceFile]:
    case = _owned(db, case_id, client)
    return list(db.scalars(select(EvidenceFile).where(EvidenceFile.case_id == case.id, EvidenceFile.erased_at.is_(None))
                           .order_by(EvidenceFile.created_at, EvidenceFile.id)))


def _item(db, case_id, evidence_id, client) -> EvidenceFile:
    case = _owned(db, case_id, client)
    item = db.get(EvidenceFile, evidence_id)
    if item is None or item.case_id != case.id or item.erased_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.EVIDENCE_NOT_FOUND)
    return item


@router.get("/{evidence_id}")
def download(case_id: uuid.UUID, evidence_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Response:
    item = _item(db, case_id, evidence_id, client)
    return Response(
        content=item.data,
        media_type=item.content_type,
        headers={"Content-Disposition": f'attachment; filename="{item.filename}"',
                 "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
    )


@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
# Intentionally allowed in any case status: the owner may always delete their own data.
def delete(case_id: uuid.UUID, evidence_id: uuid.UUID, client: ClientUser, db: SessionDep) -> None:
    db.delete(_item(db, case_id, evidence_id, client))
    db.commit()
