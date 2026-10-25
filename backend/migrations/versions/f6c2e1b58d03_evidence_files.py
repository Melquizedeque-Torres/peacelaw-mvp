"""Encrypted evidence files (evidence_files)

Revision ID: f6c2e1b58d03
Revises: e5b1d0a47c92
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6c2e1b58d03"
down_revision: str | None = "e5b1d0a47c92"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "evidence_files",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "case_id",
            sa.Uuid(),
            sa.ForeignKey("cases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(120), nullable=False),
        sa.Column("content_type", sa.String(40), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("erased_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_evidence_files_case_id", "evidence_files", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_evidence_files_case_id", table_name="evidence_files")
    op.drop_table("evidence_files")
