from typing import Annotated

from app import audit, errors
from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.config import cookie_secure
from app.deps import SESSION_COOKIE, CurrentUser, SessionDep, user_from_token
from app.models import User, UserRole
from app.schemas import ChangePasswordIn, LoginIn, RegisterIn, UserOut, ValidationErrorOut
from app.security import ratelimit
from app.security.passwords import hash_password, verify_password
from app.totp_service import consume_second_factor
from app.security.tokens import ACCESS_TOKEN_MINUTES, create_access_token

router = APIRouter(
    prefix="/api/auth", tags=["auth"], responses={422: {"model": ValidationErrorOut}}
)


def _start_session(response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_access_token(user.id, user.token_version),
        max_age=ACCESS_TOKEN_MINUTES * 60,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        path="/",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def register(
    payload: RegisterIn, request: Request, response: Response, db: SessionDep
) -> User:
    ratelimit.check_register(request)
    # Public sign-up always creates a CLIENT; other roles are provisioned server-side.
    if db.scalar(select(User.id).where(User.email == payload.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EMAIL_TAKEN)
    user = User(
        email=payload.email, role=UserRole.CLIENT, password_hash=hash_password(payload.password)
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EMAIL_TAKEN) from None
    db.refresh(user)
    _start_session(response, user)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, request: Request, response: Response, db: SessionDep) -> User:
    ratelimit.check_login(request, payload.email)
    user = db.scalar(select(User).where(User.email == payload.email))
    verified = verify_password(payload.password, user.password_hash if user else None)
    if user is None or not verified or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, errors.INVALID_CREDENTIALS)
    if user.totp_enabled:
        if not payload.totp_code:
            return JSONResponse(  # type: ignore[return-value]
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": errors.TOTP_REQUIRED, "totp_required": True},
            )
        ratelimit.check_totp_login(user.id)
        if not consume_second_factor(db, user, payload.totp_code):
            audit.record(db, user.id, audit.TOTP_FAILED, user.id)
            db.commit()
            return JSONResponse(  # type: ignore[return-value]
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": errors.TOTP_INVALID, "totp_required": True},
            )
    if user.totp_enabled:
        ratelimit.reset_totp_login(user.id)
    ratelimit.reset_login(request, payload.email)
    _start_session(response, user)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: SessionDep,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> None:
    user = user_from_token(db, session_token)
    if user is not None:
        # Atomic increment: ends every session of this user, not just this browser.
        db.execute(
            update(User).where(User.id == user.id).values(token_version=User.token_version + 1)
        )
        db.commit()
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=cookie_secure()
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordIn, user: CurrentUser, response: Response, db: SessionDep
) -> None:
    ratelimit.check_change_password(user.id)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, errors.WRONG_PASSWORD)
    # Guarded atomic bump: ends every other session, and loses cleanly to a concurrent
    # revoke or password change instead of overwriting it.
    result = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.token_version == user.token_version,
            User.password_hash == user.password_hash,
        )
        .values(
            password_hash=hash_password(payload.new_password),
            token_version=User.token_version + 1,
        )
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, errors.NOT_AUTHENTICATED)
    audit.record(db, user.id, audit.USER_CHANGE_PASSWORD, user.id)
    db.commit()
    db.refresh(user)
    _start_session(response, user)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
