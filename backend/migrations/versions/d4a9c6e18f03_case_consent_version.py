"""Record which consent wording each case was submitted under (cases.consent_version)

Revision ID: d4a9c6e18f03
Revises: c3f8a1d27e64
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4a9c6e18f03"
down_revision: str | None = "c3f8a1d27e64"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("consent_version", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("cases", "consent_version")
