from fastapi import APIRouter

from app.consent import CONSENT_TEXT, CONSENT_VERSION
from app.schemas import ConsentOut

router = APIRouter(prefix="/api", tags=["consent"])


@router.get("/consent", response_model=ConsentOut)
def get_consent() -> ConsentOut:
    """Public: the consent wording currently shown to (and recorded for) new cases."""
    return ConsentOut(version=CONSENT_VERSION, text=CONSENT_TEXT)
