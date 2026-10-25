"""m3: auth, case lifecycle, judge scores, raw_text encryption

Revision ID: 5d2a9c41e7b3
Revises: 903ef165a4e2
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.security.crypto import decrypt_text, encrypt_text

revision: str = "5d2a9c41e7b3"
down_revision: str | None = "903ef165a4e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_STATUSES = (
    "DRAFT", "AWAITING_APPROVAL", "READY_FOR_JUDGE", "EVALUATED", "IN_MEDIATION", "RESOLVED",
)
OLD_STATUSES = ("AWAITING_JUDGE", "READY_FOR_AGREEMENT", "CLOSED")


def _reencode_raw_text(transform) -> None:
    bind = op.get_bind()
    for case_id, value in bind.execute(sa.text("SELECT id, raw_text FROM cases")).all():
        bind.execute(
            sa.text("UPDATE cases SET raw_text = :value WHERE id = :id"),
            {"value": transform(value), "id": case_id},
        )


def upgrade() -> None:
    bind = op.get_bind()

    # users.password_hash — pre-existing users get an unusable hash and must be re-provisioned.
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    op.alter_column("users", "password_hash", nullable=False)

    # cases: title, score, assigned lawyer
    op.add_column(
        "cases",
        sa.Column("title", sa.String(length=200), nullable=False, server_default="Caso sem título"),
    )
    op.alter_column("cases", "title", server_default=None)
    op.add_column("cases", sa.Column("ai_probability_score", sa.Float(), nullable=True))
    op.add_column("cases", sa.Column("lawyer_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_cases_lawyer_id"), "cases", ["lawyer_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_cases_lawyer_id_users"), "cases", "users", ["lawyer_id"], ["id"],
        ondelete="RESTRICT",
    )

    # cases.status — new lifecycle enum, old values mapped forward
    op.execute("ALTER TYPE case_status RENAME TO case_status_old")
    postgresql.ENUM(*NEW_STATUSES, name="case_status").create(bind)
    op.execute(
        """
        ALTER TABLE cases ALTER COLUMN status TYPE case_status USING (
            CASE status::text
                WHEN 'AWAITING_JUDGE' THEN 'READY_FOR_JUDGE'
                WHEN 'READY_FOR_AGREEMENT' THEN 'EVALUATED'
                WHEN 'CLOSED' THEN 'RESOLVED'
            END
        )::case_status
        """
    )
    op.execute("DROP TYPE case_status_old")

    # cases.raw_text — encrypt existing plaintext rows in place
    _reencode_raw_text(encrypt_text)

    # case_reviews — two 0–10 criteria instead of one 0–100 score; one review per judge
    op.add_column("case_reviews", sa.Column("score_evidence", sa.Integer(), nullable=True))
    op.add_column("case_reviews", sa.Column("score_jurisprudence", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE case_reviews SET score_evidence = ROUND(score / 10.0), "
        "score_jurisprudence = ROUND(score / 10.0)"
    )
    op.alter_column("case_reviews", "score_evidence", nullable=False)
    op.alter_column("case_reviews", "score_jurisprudence", nullable=False)
    op.drop_constraint(op.f("ck_case_reviews_score_range"), "case_reviews", type_="check")
    op.drop_column("case_reviews", "score")
    op.create_check_constraint(
        op.f("ck_case_reviews_evidence_range"), "case_reviews", "score_evidence BETWEEN 0 AND 10"
    )
    op.create_check_constraint(
        op.f("ck_case_reviews_jurisprudence_range"),
        "case_reviews",
        "score_jurisprudence BETWEEN 0 AND 10",
    )
    op.create_unique_constraint(
        op.f("uq_case_reviews_case_id"), "case_reviews", ["case_id", "judge_id"]
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_constraint(op.f("uq_case_reviews_case_id"), "case_reviews", type_="unique")
    op.drop_constraint(op.f("ck_case_reviews_jurisprudence_range"), "case_reviews", type_="check")
    op.drop_constraint(op.f("ck_case_reviews_evidence_range"), "case_reviews", type_="check")
    op.add_column("case_reviews", sa.Column("score", sa.Integer(), nullable=True))
    op.execute("UPDATE case_reviews SET score = (score_evidence + score_jurisprudence) * 5")
    op.alter_column("case_reviews", "score", nullable=False)
    op.drop_column("case_reviews", "score_jurisprudence")
    op.drop_column("case_reviews", "score_evidence")
    op.create_check_constraint(
        op.f("ck_case_reviews_score_range"), "case_reviews", "score BETWEEN 0 AND 100"
    )

    _reencode_raw_text(decrypt_text)

    op.execute("ALTER TYPE case_status RENAME TO case_status_new")
    postgresql.ENUM(*OLD_STATUSES, name="case_status").create(bind)
    op.execute(
        """
        ALTER TABLE cases ALTER COLUMN status TYPE case_status USING (
            CASE status::text
                WHEN 'EVALUATED' THEN 'READY_FOR_AGREEMENT'
                WHEN 'IN_MEDIATION' THEN 'READY_FOR_AGREEMENT'
                WHEN 'RESOLVED' THEN 'CLOSED'
                ELSE 'AWAITING_JUDGE'
            END
        )::case_status
        """
    )
    op.execute("DROP TYPE case_status_new")

    op.drop_constraint(op.f("fk_cases_lawyer_id_users"), "cases", type_="foreignkey")
    op.drop_index(op.f("ix_cases_lawyer_id"), table_name="cases")
    op.drop_column("cases", "lawyer_id")
    op.drop_column("cases", "ai_probability_score")
    op.drop_column("cases", "title")
    op.drop_column("users", "password_hash")
