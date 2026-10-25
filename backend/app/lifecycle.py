"""Single source of truth for which case statuses allow which operations."""

from app.models import CaseStatus

DELETABLE = frozenset({CaseStatus.AWAITING_APPROVAL, CaseStatus.READY_FOR_JUDGE})
REVIEWABLE = frozenset({CaseStatus.READY_FOR_JUDGE, CaseStatus.EVALUATED})
NOT_YET_APPROVED = frozenset({CaseStatus.DRAFT, CaseStatus.AWAITING_APPROVAL})
NOT_YET_EVALUATED = frozenset(
    {CaseStatus.DRAFT, CaseStatus.AWAITING_APPROVAL, CaseStatus.READY_FOR_JUDGE}
)
OPEN_STATUSES = frozenset(
    {
        CaseStatus.AWAITING_APPROVAL,
        CaseStatus.READY_FOR_JUDGE,
        CaseStatus.EVALUATED,
        CaseStatus.IN_MEDIATION,
    }
)
