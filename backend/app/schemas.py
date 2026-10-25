import unicodedata
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic_core import PydanticCustomError
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from app.models import CaseArea, CaseStatus, UserRole
from app.security.password_policy import validate_strong

_ALLOWED_CONTROL = frozenset(chr(c) for c in (9, 10, 13))


def _reject_control_chars(value: str) -> str:
    # NUL and friends crash Postgres inserts, and the resulting driver error
    # would carry the raw text; reject them at the boundary instead.
    if any(unicodedata.category(ch) == "Cc" and ch not in _ALLOWED_CONTROL for ch in value):
        raise ValueError("O texto contém caracteres de controle não permitidos.")
    return value


CaseText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=40, max_length=20_000),
    AfterValidator(_reject_control_chars),
]
CaseTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=200),
    AfterValidator(_reject_control_chars),
]
ReviewNotes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=2_000),
    AfterValidator(_reject_control_chars),
]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]
StrongPassword = Annotated[
    str, StringConstraints(min_length=12, max_length=128), AfterValidator(validate_strong)
]
Score = Annotated[int, Field(ge=0, le=10)]


class RegisterIn(BaseModel):
    email: Email
    password: StrongPassword


class AdminUserCreate(BaseModel):
    email: Email
    role: Literal["JUDGE", "LAWYER", "ADMIN"]
    password: StrongPassword
    # Step-up: the acting admin's own password, required only when creating an ADMIN.
    admin_password: Annotated[str, StringConstraints(max_length=128)] | None = None


class ResetPasswordIn(BaseModel):
    new_password: StrongPassword
    admin_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class ActiveToggleIn(BaseModel):
    admin_password: Annotated[str, StringConstraints(max_length=128)] | None = None


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole
    created_at: datetime
    is_active: bool
    totp_enabled: bool = False


class AdminActivity(BaseModel):
    """Counts only, over the last 24 hours."""

    audit_events: int
    stepup_failures: int
    rate_limit_hits: int


class AdminStats(BaseModel):
    cases_by_status: dict[str, int]
    users_by_role: dict[str, int]
    last_24h: AdminActivity


class ChangePasswordIn(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    new_password: StrongPassword


class LoginIn(BaseModel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    # Authenticator code or one-time recovery code; only needed when 2FA is enabled.
    totp_code: Annotated[str, StringConstraints(max_length=32)] | None = None


class TotpSetupIn(BaseModel):
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class TotpCodeIn(BaseModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class TotpDisableIn(BaseModel):
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    code: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class TotpStatusOut(BaseModel):
    enabled: bool
    recovery_codes_left: int


class TotpSetupOut(BaseModel):
    secret: str
    uri: str


class TotpEnabledOut(BaseModel):
    recovery_codes: list[str]


class StepUpIn(BaseModel):
    admin_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole


class CaseCreate(BaseModel):
    title: CaseTitle
    text: CaseText
    lgpd_consent: bool = Field(default=False, validate_default=True)
    # The consent version the client actually displayed; checked against the current one.
    consent_version: str = Field(max_length=20)
    area: CaseArea = CaseArea.OUTROS

    @field_validator("lgpd_consent", mode="before")
    @classmethod
    def _require_consent(cls, value: object) -> bool:
        # Strict: only the JSON literal true counts ("true", 1, "yes" do not).
        if value is not True:
            raise PydanticCustomError(
                "consent_required",
                "É necessário consentir com o tratamento dos dados (LGPD).",
            )
        return True


class RedactionCount(BaseModel):
    label: str
    count: int


class CaseSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    ai_probability_score: float | None
    created_at: datetime


class ConsentOut(BaseModel):
    version: str
    text: str


class CaseOwnerView(CaseSummary):
    """The ONLY schema allowed to carry raw_text — returned to the case owner alone."""

    raw_text: str
    anonymized_text: str
    area: CaseArea
    consent_at: datetime | None
    consent_version: str | None
    raw_text_erased_at: datetime | None
    evidence_count: int = 0


class CaseCreated(CaseOwnerView):
    redactions: list[RedactionCount]


class CaseForJudge(BaseModel):
    """Judges see neither raw_text nor other judges' scores (no anchoring)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    anonymized_text: str
    area: CaseArea
    created_at: datetime
    evidence_count: int = 0


class CaseForLawyer(BaseModel):
    """Lawyers never see raw_text."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    anonymized_text: str
    area: CaseArea
    status: CaseStatus
    ai_probability_score: float | None
    created_at: datetime
    evidence_count: int = 0
    suggested: bool = False


class LawyerAreasIn(BaseModel):
    areas: Annotated[list[CaseArea], Field(max_length=7)]

    @field_validator("areas")
    @classmethod
    def _unique(cls, v: list[CaseArea]) -> list[CaseArea]:
        return sorted(set(v), key=lambda a: a.value)


class LawyerAreasOut(BaseModel):
    areas: list[CaseArea]


class ReviewCreate(BaseModel):
    score_evidence: Score
    score_jurisprudence: Score
    notes: ReviewNotes | None = None


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    score_evidence: int
    score_jurisprudence: int
    notes: str | None
    created_at: datetime


class ValidationErrorItem(BaseModel):
    field: str
    message: str


class ValidationErrorOut(BaseModel):
    detail: str
    errors: list[ValidationErrorItem]


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
