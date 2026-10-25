import uuid
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_jwt_secret

ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60


def create_access_token(user_id: uuid.UUID, version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(user_id),
        "ver": version,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(claims, get_jwt_secret(), algorithm=ALGORITHM)


def decode_session(token: str) -> tuple[uuid.UUID, int] | None:
    """Return (user id, token version) of a valid, unexpired token signed by us; else None.

    The role is deliberately not trusted from the token: callers load the user from
    the database so role changes and deletions take effect immediately.
    """
    try:
        claims = jwt.decode(
            token, get_jwt_secret(), algorithms=[ALGORITHM], options={"require": ["sub", "exp"]}
        )
        version = claims.get("ver", 0)
        if not isinstance(version, int) or isinstance(version, bool):
            return None
        return uuid.UUID(claims["sub"]), version
    except (jwt.InvalidTokenError, ValueError):
        return None
