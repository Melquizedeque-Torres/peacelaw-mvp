"""LGPD: record consent timestamp on cases

Revision ID: b7e41f0c9a25
Revises: 5d2a9c41e7b3
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e41f0c9a25"
down_revision: str | None = "5d2a9c41e7b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("consent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("cases", "consent_at")
