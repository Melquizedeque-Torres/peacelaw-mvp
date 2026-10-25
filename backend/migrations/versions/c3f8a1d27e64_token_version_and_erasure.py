"""Session revocation (users.token_version) and LGPD erasure (cases.raw_text_erased_at)

Revision ID: c3f8a1d27e64
Revises: b7e41f0c9a25
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a1d27e64"
down_revision: str | None = "b7e41f0c9a25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "cases", sa.Column("raw_text_erased_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("cases", "raw_text_erased_at")
    op.drop_column("users", "token_version")
