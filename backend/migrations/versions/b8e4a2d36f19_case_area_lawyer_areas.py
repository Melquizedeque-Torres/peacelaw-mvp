"""Case area and lawyer areas

Revision ID: b8e4a2d36f19
Revises: a7d3f9c15e48
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8e4a2d36f19"
down_revision: str | None = "a7d3f9c15e48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AREAS = (
    "CONSUMIDOR", "CIVIL", "TRABALHISTA", "FAMILIA", "ALUGUEL", "EMPRESARIAL", "OUTROS",
)


def _area_enum() -> postgresql.ENUM:
    # The type is created once, explicitly; column definitions must not re-create it.
    return postgresql.ENUM(*AREAS, name="case_area", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(*AREAS, name="case_area").create(bind)

    op.add_column(
        "cases",
        sa.Column("area", _area_enum(), nullable=False, server_default="OUTROS"),
    )
    op.create_table(
        "lawyer_areas",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("area", _area_enum(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "area", name="pk_lawyer_areas"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_table("lawyer_areas")
    op.drop_column("cases", "area")
    postgresql.ENUM(name="case_area").drop(bind)
