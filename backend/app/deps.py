from collections.abc import Callable
from typing import Annotated

from app import errors
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User, UserRole
from app.security.tokens import decode_session

SESSION_COOKIE = "peacelaw_session"

SessionDep = Annotated[Session, Depends(get_session)]


def user_from_token(db: Session, session_token: str | None) -> User | None:
    session = decode_session(session_token) if session_token else None
    user = db.get(User, session[0]) if session else None
    # A bumped token_version (logout) revokes every token minted before it.
    if (
        user is None
        or session is None
        or user.token_version != session[1]
        or not user.is_active
    ):
        return None
    return user


def get_current_user(
    db: SessionDep,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    user = user_from_token(db, session_token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, errors.NOT_AUTHENTICATED)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(role: UserRole) -> Callable[[User], User]:
    def _dependency(user: CurrentUser) -> User:
        if user.role is not role:
            raise HTTPException(status.HTTP_403_FORBIDDEN, errors.FORBIDDEN)
        return user

    return _dependency


ClientUser = Annotated[User, Depends(require_role(UserRole.CLIENT))]
JudgeUser = Annotated[User, Depends(require_role(UserRole.JUDGE))]
LawyerUser = Annotated[User, Depends(require_role(UserRole.LAWYER))]
AdminUser = Annotated[User, Depends(require_role(UserRole.ADMIN))]
