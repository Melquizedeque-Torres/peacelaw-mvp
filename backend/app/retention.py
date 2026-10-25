"""LGPD retention: erase the original report of long-resolved cases."""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Case, CaseStatus, EvidenceFile

DEFAULT_RETENTION_DAYS = 180
logger = logging.getLogger(__name__)


def retention_days() -> int:
    raw = os.environ.get("RAW_TEXT_RETENTION_DAYS", "").strip()
    if not raw:
        return DEFAULT_RETENTION_DAYS
    try:
        days = int(raw)
    except ValueError:
        raise ValueError("RAW_TEXT_RETENTION_DAYS deve ser um inteiro positivo.") from None
    if days < 1:
        raise ValueError("RAW_TEXT_RETENTION_DAYS deve ser um inteiro positivo.")
    return days


def purge_raw_text(
    db: Session,
    *,
    days: int | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> int:
    """Count of cases erased (matched if dry-run); see purge_raw_text_ids."""
    return len(purge_raw_text_ids(db, days=days, dry_run=dry_run, now=now))


def purge_raw_text_ids(
    db: Session,
    *,
    days: int | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> list[uuid.UUID]:
    """Erase raw_text of RESOLVED cases untouched for `days`; return their ids (matched if dry-run).

    Same semantics as POST /api/cases/{id}/erase-original: raw_text becomes "" and
    raw_text_erased_at is stamped. Cases already erased are never selected, so reruns are no-ops.
    Erased ids (never any text) are logged as an audit trail.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days() if days is None else days)
    due = (
        Case.status == CaseStatus.RESOLVED,
        Case.raw_text_erased_at.is_(None),
        Case.updated_at < cutoff,
    )
    if dry_run:
        return list(db.scalars(select(Case.id).where(*due).order_by(Case.id)))
    ids = list(
        db.scalars(
            update(Case)
            .where(*due)
            # Keep updated_at: erasing must not restart the clock of anything else.
            .values(raw_text="", raw_text_erased_at=now, updated_at=Case.updated_at)
            .returning(Case.id)
            .execution_options(synchronize_session=False)
        )
    )
    if ids:
        db.execute(
            update(EvidenceFile)
            .where(EvidenceFile.case_id.in_(ids), EvidenceFile.erased_at.is_(None))
            .values(data=b"", size_bytes=0, filename="anexo", erased_at=now)
            .execution_options(synchronize_session=False)
        )
    db.commit()
    ids.sort()
    for case_id in ids:
        logger.info("retention: raw_text erased for case %s", case_id)
    return ids
