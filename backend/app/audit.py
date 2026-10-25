"""Audit trail for privileged actions (ids and action codes only; never PII)."""

import uuid

from sqlalchemy.orm import Session

from app.models import AuditEvent

USER_CREATE = "user.create"
USER_REVOKE_SESSIONS = "user.revoke_sessions"
USER_DEACTIVATE = "user.deactivate"
USER_REACTIVATE = "user.reactivate"
USER_CHANGE_PASSWORD = "user.change_password"
USER_RESET_PASSWORD = "user.reset_password"
STEPUP_FAILED = "admin.stepup_failed"
TOTP_ENABLE = "user.totp_enable"
TOTP_DISABLE = "user.totp_disable"
TOTP_RESET = "user.totp_reset"
TOTP_FAILED = "user.totp_failed"


def record(
    db: Session, actor_id: uuid.UUID, action: str, target_id: uuid.UUID | None = None
) -> None:
    """Add an audit row to the session without committing, so it shares the caller's transaction."""
    db.add(AuditEvent(actor_id=actor_id, action=action, target_id=target_id))
