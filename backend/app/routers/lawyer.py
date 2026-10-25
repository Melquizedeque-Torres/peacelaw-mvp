import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import case as sql_case, delete, select, update
from sqlalchemy.exc import IntegrityError

from app import errors
from app.evidence import with_evidence_count
from app.lifecycle import NOT_YET_EVALUATED
from app.deps import LawyerUser, SessionDep
from app.models import Case, CaseArea, CaseStatus, LawyerArea, User
from app.schemas import CaseForLawyer, LawyerAreasIn, LawyerAreasOut

router = APIRouter(prefix="/api", tags=["lawyer"])

RESOLVED_ON_BOARD = 20


def _areas_of(db, lawyer_id: uuid.UUID) -> list[CaseArea]:
    rows = db.scalars(select(LawyerArea.area).where(LawyerArea.user_id == lawyer_id)).all()
    return sorted(rows, key=lambda a: a.value)


@router.get("/lawyer/areas", response_model=LawyerAreasOut)
def get_areas(lawyer: LawyerUser, db: SessionDep) -> LawyerAreasOut:
    return LawyerAreasOut(areas=_areas_of(db, lawyer.id))


@router.put("/lawyer/areas", response_model=LawyerAreasOut)
def put_areas(body: LawyerAreasIn, lawyer: LawyerUser, db: SessionDep) -> LawyerAreasOut:
    # Replace the whole set in one transaction. Locking the user row serializes
    # concurrent PUTs from the same lawyer (last write wins); the retry covers
    # databases/races where the composite PK still collides.
    for attempt in range(2):
        db.execute(select(User.id).where(User.id == lawyer.id).with_for_update())
        db.execute(delete(LawyerArea).where(LawyerArea.user_id == lawyer.id))
        db.add_all(LawyerArea(user_id=lawyer.id, area=a) for a in body.areas)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise HTTPException(status.HTTP_409_CONFLICT, errors.CONCURRENT_UPDATE)
    return LawyerAreasOut(areas=body.areas)


@router.get("/lawyer/board", response_model=list[CaseForLawyer])
def board(
    lawyer: LawyerUser,
    db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Case]:
    # Own mediations are always returned in full (they are few); only the
    # opportunities are paginated, so a busy board never hides a lawyer's own case.
    mine = select(Case).where(Case.lawyer_id == lawyer.id)
    # Only the first page carries them: later pages (offset > 0) are opportunities only.
    mediations: list[Case] = []
    if offset == 0:
        mediations = list(
            db.scalars(
                mine.where(Case.status == CaseStatus.IN_MEDIATION).order_by(
                    Case.ai_probability_score.desc().nulls_last(), Case.created_at, Case.id
                )
            )
        )
    areas = _areas_of(db, lawyer.id)
    order = [Case.ai_probability_score.desc().nulls_last(), Case.created_at, Case.id]
    if areas:
        order.insert(0, sql_case((Case.area.in_(areas), 0), else_=1))
    opportunities = list(
        db.scalars(
            select(Case)
            .where(
                Case.status == CaseStatus.EVALUATED,
                # A deactivated client's case is not offered to lawyers.
                Case.client_id.in_(select(User.id).where(User.is_active.is_(True))),
            )
            .order_by(*order)
            .limit(limit)
            .offset(offset)
        )
    )
    resolved: list[Case] = []
    if offset == 0:
        resolved = list(
            db.scalars(
                mine.where(Case.status == CaseStatus.RESOLVED)
                .order_by(Case.updated_at.desc(), Case.id)
                .limit(RESOLVED_ON_BOARD)
            )
        )
    for c in (*mediations, *resolved):
        c.suggested = False
    for c in opportunities:
        c.suggested = c.area in areas
    return with_evidence_count(db, [*mediations, *opportunities, *resolved])


@router.post("/cases/{case_id}/match", response_model=CaseForLawyer)
def match(case_id: uuid.UUID, lawyer: LawyerUser, db: SessionDep) -> Case:
    # Conditional UPDATE: two lawyers clicking at once cannot both win.
    result = db.execute(
        update(Case)
        .where(Case.id == case_id, Case.status == CaseStatus.EVALUATED, Case.lawyer_id.is_(None))
        .values(status=CaseStatus.IN_MEDIATION, lawyer_id=lawyer.id)
    )
    if result.rowcount == 0:
        db.rollback()
        case = db.get(Case, case_id)
        if case is None or case.status in NOT_YET_EVALUATED:
            raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
        raise HTTPException(status.HTTP_409_CONFLICT, errors.ALREADY_IN_MEDIATION)
    db.commit()
    case = db.get(Case, case_id)
    db.refresh(case)
    with_evidence_count(db, [case])
    return case


@router.post("/cases/{case_id}/resolve", response_model=CaseForLawyer)
def resolve(case_id: uuid.UUID, lawyer: LawyerUser, db: SessionDep) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.lawyer_id != lawyer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    if case.status is not CaseStatus.IN_MEDIATION:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.INVALID_TRANSITION)
    case.status = CaseStatus.RESOLVED
    db.commit()
    db.refresh(case)
    with_evidence_count(db, [case])
    return case
