import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Case, CaseReview, CaseStatus, User, UserRole

PLAIN = "Meu CPF é 123.456.789-00 e a obra parou."


def _user(session, role=UserRole.CLIENT, email=None):
    user = User(email=email or f"{role.value.lower()}@exemplo.com", role=role, password_hash="!")
    session.add(user)
    session.commit()
    return user


def _case(session, client, **extra):
    case = Case(
        client_id=client.id,
        title="Obra abandonada",
        raw_text=PLAIN,
        anonymized_text="Meu CPF é [CPF] e a obra parou.",
        **extra,
    )
    session.add(case)
    session.commit()
    return case


def test_case_defaults(session):
    case = _case(session, _user(session))
    session.refresh(case)
    assert case.status is CaseStatus.AWAITING_APPROVAL
    assert case.ai_probability_score is None
    assert case.lawyer_id is None
    assert case.client.email == "client@exemplo.com"


def test_raw_text_is_encrypted_at_rest(session):
    case = _case(session, _user(session))
    stored = session.execute(text("SELECT raw_text FROM cases")).scalar_one()
    assert "123.456.789-00" not in stored
    assert stored.startswith("gAAAA")
    session.expire_all()
    assert session.get(Case, case.id).raw_text == PLAIN


def test_lawyer_assignment(session):
    lawyer = _user(session, UserRole.LAWYER)
    case = _case(session, _user(session), lawyer_id=lawyer.id, status=CaseStatus.IN_MEDIATION)
    session.refresh(case)
    assert case.lawyer.role is UserRole.LAWYER
    assert lawyer.cases == []  # `User.cases` lists cases the user OWNS, not mediates


@pytest.mark.parametrize("field", ["score_evidence", "score_jurisprudence"])
@pytest.mark.parametrize("value", [-1, 11])
def test_review_scores_are_between_0_and_10(session, field, value):
    case = _case(session, _user(session))
    judge = _user(session, UserRole.JUDGE)
    scores = {"score_evidence": 5, "score_jurisprudence": 5, field: value}
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, **scores))
    with pytest.raises(IntegrityError):
        session.commit()


def test_one_review_per_judge_per_case(session):
    case = _case(session, _user(session))
    judge = _user(session, UserRole.JUDGE)
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, score_evidence=5, score_jurisprudence=5))
    session.commit()
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, score_evidence=6, score_jurisprudence=6))
    with pytest.raises(IntegrityError):
        session.commit()


def test_user_email_is_unique(session):
    _user(session, email="dup@exemplo.com")
    session.add(User(email="dup@exemplo.com", role=UserRole.LAWYER, password_hash="!"))
    with pytest.raises(IntegrityError):
        session.commit()
