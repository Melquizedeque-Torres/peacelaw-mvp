"""Shared rate-limit store (rate_limit_hits) for serverless deployments

Revision ID: e5b1d0a47c92
Revises: d4a9c6e18f03
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5b1d0a47c92"
down_revision: str | None = "d4a9c6e18f03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_hits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("hit_at", sa.Float(), nullable=False),
        sa.Column("window", sa.Float(), nullable=False),
    )
    op.create_index("ix_rate_limit_hits_key_hash", "rate_limit_hits", ["key_hash"])
    op.create_index("ix_rate_limit_hits_hit_at", "rate_limit_hits", ["hit_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_hits_hit_at", table_name="rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_key_hash", table_name="rate_limit_hits")
    op.drop_table("rate_limit_hits")
