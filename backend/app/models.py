import enum
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.security.crypto import EncryptedBytes, EncryptedText


class UserRole(str, enum.Enum):
    CLIENT = "CLIENT"
    JUDGE = "JUDGE"
    LAWYER = "LAWYER"
    ADMIN = "ADMIN"


class CaseStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    READY_FOR_JUDGE = "READY_FOR_JUDGE"
    EVALUATED = "EVALUATED"
    IN_MEDIATION = "IN_MEDIATION"
    RESOLVED = "RESOLVED"


class CaseArea(str, enum.Enum):
    CONSUMIDOR = "CONSUMIDOR"
    CIVIL = "CIVIL"
    TRABALHISTA = "TRABALHISTA"
    FAMILIA = "FAMILIA"
    ALUGUEL = "ALUGUEL"
    EMPRESARIAL = "EMPRESARIAL"
    OUTROS = "OUTROS"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    # Bumped on logout: tokens carry the version they were minted with.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa.true())
    # TOTP second factor: the secret is encrypted at rest; last_step blocks code replay.
    totp_secret: Mapped[str | None] = mapped_column(EncryptedText, deferred=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    totp_last_step: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    cases: Mapped[list["Case"]] = relationship(
        back_populates="client", foreign_keys="Case.client_id"
    )


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    lawyer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    # Stored already redacted: the title is visible to judges and lawyers.
    title: Mapped[str] = mapped_column(String(200))
    # Privacy by Design: owner-only, encrypted at rest, never in a third-party schema.
    # deferred: never loaded (hence never decrypted) unless an owner path touches it.
    raw_text: Mapped[str] = mapped_column(EncryptedText, deferred=True)
    anonymized_text: Mapped[str] = mapped_column(Text)
    status: Mapped[CaseStatus] = mapped_column(
        Enum(CaseStatus, name="case_status"), default=CaseStatus.AWAITING_APPROVAL
    )
    ai_probability_score: Mapped[float | None] = mapped_column(Float)
    area: Mapped[CaseArea] = mapped_column(
        Enum(CaseArea, name="case_area"), default=CaseArea.OUTROS, server_default="OUTROS"
    )
    # LGPD: when the owner explicitly consented to processing at submission.
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # LGPD: which consent wording (app.consent.CONSENT_VERSION) the owner agreed to.
    consent_version: Mapped[str | None] = mapped_column(String(20))
    # LGPD: when the owner had the original report (raw_text) erased on request.
    raw_text_erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped[User] = relationship(back_populates="cases", foreign_keys=[client_id])
    lawyer: Mapped[User | None] = relationship(foreign_keys=[lawyer_id])
    reviews: Mapped[list["CaseReview"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    evidence: Mapped[list["EvidenceFile"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class LawyerArea(Base):
    """Practice areas a lawyer opted into (used to suggest cases)."""

    __tablename__ = "lawyer_areas"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    area: Mapped[CaseArea] = mapped_column(Enum(CaseArea, name="case_area"), primary_key=True)


class CaseReview(Base):
    __tablename__ = "case_reviews"
    __table_args__ = (
        CheckConstraint("score_evidence BETWEEN 0 AND 10", name="evidence_range"),
        CheckConstraint("score_jurisprudence BETWEEN 0 AND 10", name="jurisprudence_range"),
        UniqueConstraint("case_id", "judge_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True
    )
    judge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    score_evidence: Mapped[int]
    score_jurisprudence: Mapped[int]
    # Stored redacted (judges write free text).
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case: Mapped[Case] = relationship(back_populates="reviews")
    judge: Mapped[User] = relationship()


class EvidenceFile(Base):
    __tablename__ = "evidence_files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(120))
    content_type: Mapped[str] = mapped_column(String(40))
    size_bytes: Mapped[int] = mapped_column(Integer)
    # Owner-only, encrypted at rest; deferred so metadata queries never decrypt.
    data: Mapped[bytes] = mapped_column(EncryptedBytes, deferred=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RateLimitHit(Base):
    """One attempt in a sliding window. Keys (IP + e-mail) are stored only as a SHA-256 digest."""

    __tablename__ = "rate_limit_hits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_hash: Mapped[str] = mapped_column(String(64), index=True)
    hit_at: Mapped[float] = mapped_column(Float, index=True)  # epoch seconds
    window: Mapped[float] = mapped_column(Float)


class AuditEvent(Base):
    """Who did what to whom. Ids and an action code only: no e-mail, IP or free text."""

    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(40))
    # No FK: the trail must outlive the target account.
    target_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RecoveryCode(Base):
    """One-time TOTP recovery code, stored only as a keyed hash."""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
