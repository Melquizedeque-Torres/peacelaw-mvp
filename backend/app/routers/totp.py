from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, func, select, update

from app import audit, errors
from app.deps import CurrentUser, SessionDep
from app.models import RecoveryCode, User
from app.routers.auth import _start_session
from app.schemas import (
    TotpCodeIn,
    TotpDisableIn,
    TotpEnabledOut,
    TotpSetupIn,
    TotpSetupOut,
    TotpStatusOut,
    ValidationErrorOut,
)
from app.security import ratelimit, totp
from app.security.passwords import verify_password
from app.totp_service import consume_second_factor

router = APIRouter(
    prefix="/api/auth/totp", tags=["totp"], responses={422: {"model": ValidationErrorOut}}
)


@router.get("", response_model=TotpStatusOut)
def totp_status(user: CurrentUser, db: SessionDep) -> TotpStatusOut:
    left = db.scalar(
        select(func.count())
        .select_from(RecoveryCode)
        .where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    )
    return TotpStatusOut(enabled=user.totp_enabled, recovery_codes_left=left or 0)


@router.post("/setup", response_model=TotpSetupOut)
def setup(payload: TotpSetupIn, user: CurrentUser, db: SessionDep) -> TotpSetupOut:
    ratelimit.check_totp_manage(user.id)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.TOTP_ALREADY_ENABLED)
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.WRONG_PASSWORD)
    secret = totp.new_secret()
    user.totp_secret = secret  # pending until /enable proves the app has it
    user.totp_last_step = None
    db.commit()
    return TotpSetupOut(secret=secret, uri=totp.provisioning_uri(user.email, secret))


@router.post("/enable", response_model=TotpEnabledOut)
def enable(
    payload: TotpCodeIn, user: CurrentUser, response: Response, db: SessionDep
) -> TotpEnabledOut:
    ratelimit.check_totp_manage(user.id)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.TOTP_ALREADY_ENABLED)
    if not user.totp_secret:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.TOTP_NOT_STARTED)
    if totp.looks_like_recovery(payload.code) or not consume_second_factor(db, user, payload.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.TOTP_INVALID)
    codes = totp.new_recovery_codes()
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=totp.hash_recovery(code)))
    # Enabling also ends every other session: the factor protects from now on.
    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(totp_enabled=True, token_version=User.token_version + 1)
    )
    audit.record(db, user.id, audit.TOTP_ENABLE, user.id)
    db.commit()
    db.refresh(user)
    _start_session(response, user)  # this browser stays signed in; every other session ended
    return TotpEnabledOut(recovery_codes=codes)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
def disable(payload: TotpDisableIn, user: CurrentUser, db: SessionDep) -> None:
    ratelimit.check_totp_manage(user.id)
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.TOTP_NOT_ENABLED)
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.WRONG_PASSWORD)
    if not consume_second_factor(db, user, payload.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.TOTP_INVALID)
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(totp_enabled=False, totp_secret=None, totp_last_step=None)
    )
    audit.record(db, user.id, audit.TOTP_DISABLE, user.id)
    db.commit()
