"""Second-factor checks shared by login, 2FA management and the admin reset."""

from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import RecoveryCode, User
from app.security import totp


def consume_second_factor(db: Session, user: User, code: str) -> bool:
    """True if `code` is a valid authenticator code (not replayed) or an unused recovery code.

    Commits on success so a code can never be accepted twice, even by concurrent requests.
    """
    if totp.looks_like_recovery(code):
        result = db.execute(
            update(RecoveryCode)
            .where(
                RecoveryCode.user_id == user.id,
                RecoveryCode.code_hash == totp.hash_recovery(code),
                RecoveryCode.used_at.is_(None),
            )
            .values(used_at=datetime.now(timezone.utc))
        )
        db.commit()
        return result.rowcount == 1
    secret = user.totp_secret
    step = totp.match_step(secret, code) if secret else None
    if step is None:
        return False
    # Atomic: only a strictly newer step wins, so a sniffed code cannot be replayed.
    result = db.execute(
        update(User)
        .where(User.id == user.id, (User.totp_last_step.is_(None)) | (User.totp_last_step < step))
        .values(totp_last_step=step)
    )
    db.commit()
    return result.rowcount == 1
