import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import errors
from app.evidence import with_evidence_count
from app.lifecycle import NOT_YET_APPROVED, REVIEWABLE
from app.deps import JudgeUser, SessionDep
from app.models import Case, CaseReview, CaseStatus
from app.privacy.redaction import redact_pii
from app.schemas import CaseForJudge, ReviewCreate, ReviewOut, ValidationErrorOut
from app.scoring import probability_score

router = APIRouter(prefix="/api", tags=["judge"], responses={422: {"model": ValidationErrorOut}})



@router.get("/judge/queue", response_model=list[CaseForJudge])
def queue(
    judge: JudgeUser,
    db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Case]:
    reviewed_by_me = select(CaseReview.case_id).where(CaseReview.judge_id == judge.id)
    stmt = (
        select(Case)
        .where(Case.status.in_(REVIEWABLE), Case.id.not_in(reviewed_by_me))
        .order_by(Case.created_at, Case.id)
        .limit(limit)
        .offset(offset)
    )
    return with_evidence_count(db, db.scalars(stmt))


@router.post(
    "/cases/{case_id}/reviews", status_code=status.HTTP_201_CREATED, response_model=ReviewOut
)
def submit_review(
    case_id: uuid.UUID, payload: ReviewCreate, judge: JudgeUser, db: SessionDep
) -> CaseReview:
    # Row lock (Postgres; SQLite ignores it): serialises concurrent reviews and
    # lawyer matches, and populate_existing discards any stale identity-map state.
    case = db.execute(
        select(Case)
        .where(Case.id == case_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if case is None or case.status in NOT_YET_APPROVED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    if case.status not in REVIEWABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CASE_NOT_REVIEWABLE)
    already = db.scalar(
        select(CaseReview.id).where(CaseReview.case_id == case.id, CaseReview.judge_id == judge.id)
    )
    if already is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.ALREADY_REVIEWED)

    review = CaseReview(
        case_id=case.id,
        judge_id=judge.id,
        score_evidence=payload.score_evidence,
        score_jurisprudence=payload.score_jurisprudence,
        notes=redact_pii(payload.notes).text if payload.notes else None,
    )
    try:
        db.add(review)
        db.flush()
        # Fresh query, not case.reviews, which may predate concurrent reviews.
        reviews = list(db.scalars(select(CaseReview).where(CaseReview.case_id == case.id)))
        case.ai_probability_score = probability_score(reviews)
        case.status = CaseStatus.EVALUATED
        db.commit()
    except IntegrityError:  # concurrent double submit hits UNIQUE(case_id, judge_id)
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, errors.ALREADY_REVIEWED) from None
    db.refresh(review)
    return review
