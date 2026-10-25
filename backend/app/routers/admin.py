from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated
import uuid

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app import audit, errors
from app.deps import AdminUser, SessionDep
from app.models import AuditEvent, Case, CaseStatus, RateLimitHit, RecoveryCode, User, UserRole
from app.schemas import (
    ActiveToggleIn,
    StepUpIn,
    AdminActivity,
    AdminStats,
    AdminUserCreate,
    AdminUserOut,
    ResetPasswordIn,
    UserOut,
)
from app.security import ratelimit
from app.security.passwords import hash_password, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin"])

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


@lru_cache
def pitch_html() -> str:
    """Static, repository-owned markup (no user input): scoped styles + the Portuguese pitch page."""
    return (CONTENT_DIR / "pitch_pt.html").read_text(encoding="utf-8")


@router.get("/pitch")
def get_pitch(_admin: AdminUser) -> dict[str, str]:
    """Admin-only: the content never ships in the public frontend bundle."""
    return {"html": pitch_html()}


@router.get("/stats", response_model=AdminStats)
def stats(_admin: AdminUser, db: SessionDep) -> AdminStats:
    """Aggregate counts only: no case content, titles or e-mails."""
    cases = {s.value: 0 for s in CaseStatus}
    for status_, n in db.execute(select(Case.status, func.count()).group_by(Case.status)):
        cases[status_.value] = n
    users = {r.value: 0 for r in UserRole}
    for role, n in db.execute(select(User.role, func.count()).group_by(User.role)):
        users[role.value] = n
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    audit_count = db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.created_at >= since))
    stepup = db.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.created_at >= since, AuditEvent.action == audit.STEPUP_FAILED)
    )
    hits = db.scalar(
        select(func.count()).select_from(RateLimitHit).where(RateLimitHit.hit_at >= since.timestamp())
    )
    return AdminStats(
        cases_by_status=cases,
        users_by_role=users,
        last_24h=AdminActivity(audit_events=audit_count or 0, stepup_failures=stepup or 0, rate_limit_hits=hits or 0),
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    _admin: AdminUser,
    db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    role: UserRole | None = None,
) -> list[User]:
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    return list(
        db.scalars(query.order_by(User.created_at.desc(), User.id).limit(limit).offset(offset))
    )


def verify_stepup(db: SessionDep, admin: User, password: str) -> None:
    """Re-authenticate the acting admin before a sensitive action. Every attempt counts
    against the step-up bucket; a mismatch is a 400 WRONG_PASSWORD."""
    ratelimit.check_stepup(admin.id)
    if not verify_password(password, admin.password_hash):
        # A wrong step-up on a live admin session is a possible stolen-cookie signal.
        audit.record(db, admin.id, audit.STEPUP_FAILED)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.WRONG_PASSWORD)


@router.post("/users", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def create_user(payload: AdminUserCreate, admin: AdminUser, db: SessionDep) -> User:
    if payload.role == "ADMIN":
        if not payload.admin_password:
            # Same sanitized 422 shape as schema errors, tied to the field (no input echoed).
            raise RequestValidationError(
                [
                    {
                        "type": "admin_password_required",
                        "loc": ("body", "admin_password"),
                        "msg": errors.ADMIN_PASSWORD_REQUIRED,
                        "input": None,
                    }
                ]
            )
        # Before hashing or creating anything.
        verify_stepup(db, admin, payload.admin_password)
    if db.scalar(select(User.id).where(User.email == payload.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EMAIL_TAKEN)
    user = User(
        email=payload.email,
        role=UserRole(payload.role),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.flush()  # assigns the id and surfaces a duplicate e-mail before auditing
        audit.record(db, admin.id, audit.USER_CREATE, user.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EMAIL_TAKEN) from None
    db.refresh(user)
    return user


@router.post(
    "/users/{user_id}/revoke-sessions", status_code=status.HTTP_204_NO_CONTENT
)
def revoke_sessions(user_id: uuid.UUID, admin: AdminUser, db: SessionDep) -> Response:
    # Atomic increment: every token minted with the old version stops working.
    result = db.execute(
        update(User).where(User.id == user_id).values(token_version=User.token_version + 1)
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.USER_NOT_FOUND)
    audit.record(db, admin.id, audit.USER_REVOKE_SESSIONS, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _set_active(
    user_id: uuid.UUID,
    admin: User,
    db: SessionDep,
    payload: ActiveToggleIn | None,
    *,
    active: bool,
    action: str,
) -> Response:
    target_role = db.scalar(select(User.role).where(User.id == user_id))
    if target_role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.USER_NOT_FOUND)
    if not active and user_id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CANNOT_DEACTIVATE_SELF)
    if target_role == UserRole.ADMIN:
        # Changing an admin account's standing is as sensitive as creating one.
        password = payload.admin_password if payload else None
        if not password:
            raise RequestValidationError(
                [
                    {
                        "type": "admin_password_required",
                        "loc": ("body", "admin_password"),
                        "msg": errors.ADMIN_PASSWORD_REQUIRED_FOR_ADMIN_TARGET,
                        "input": None,
                    }
                ]
            )
        verify_stepup(db, admin, password)
    values: dict[str, object] = {"is_active": active}
    if not active:
        values["token_version"] = User.token_version + 1  # kills every existing session
    # Conditional UPDATE: a repeat call changes nothing and writes no second audit row.
    result = db.execute(
        update(User).where(User.id == user_id, User.is_active == (not active)).values(**values)
    )
    if result.rowcount:
        if not active and target_role == UserRole.LAWYER:
            # A gone lawyer must not strand cases: give their open mediations back to the board.
            db.execute(
                update(Case)
                .where(Case.lawyer_id == user_id, Case.status == CaseStatus.IN_MEDIATION)
                .values(status=CaseStatus.EVALUATED, lawyer_id=None)
            )
        audit.record(db, admin.id, action, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: uuid.UUID,
    admin: AdminUser,
    db: SessionDep,
    payload: ActiveToggleIn | None = None,
) -> Response:
    return _set_active(user_id, admin, db, payload, active=False, action=audit.USER_DEACTIVATE)


@router.post("/users/{user_id}/reactivate", status_code=status.HTTP_204_NO_CONTENT)
def reactivate_user(
    user_id: uuid.UUID,
    admin: AdminUser,
    db: SessionDep,
    payload: ActiveToggleIn | None = None,
) -> Response:
    return _set_active(user_id, admin, db, payload, active=True, action=audit.USER_REACTIVATE)


@router.post("/users/{user_id}/reset-totp", status_code=status.HTTP_204_NO_CONTENT)
def reset_totp(user_id: uuid.UUID, payload: StepUpIn, admin: AdminUser, db: SessionDep) -> Response:
    """Recover a locked-out account: clears its second factor and ends its sessions."""
    if user_id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CANNOT_RESET_SELF)
    verify_stepup(db, admin, payload.admin_password)
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))
    result = db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            totp_enabled=False,
            totp_secret=None,
            totp_last_step=None,
            token_version=User.token_version + 1,
        )
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.USER_NOT_FOUND)
    audit.record(db, admin.id, audit.TOTP_RESET, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: uuid.UUID, payload: ResetPasswordIn, admin: AdminUser, db: SessionDep
) -> Response:
    if user_id == admin.id:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.CANNOT_RESET_SELF)
    verify_stepup(db, admin, payload.admin_password)
    new_hash = hash_password(payload.new_password)  # the costly step, before the UPDATE
    # One atomic UPDATE: the new hash and the session kill land together.
    result = db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            password_hash=new_hash,
            token_version=User.token_version + 1,
        )
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.USER_NOT_FOUND)
    audit.record(db, admin.id, audit.USER_RESET_PASSWORD, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
