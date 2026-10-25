from app.consent import CONSENT_VERSION
import uuid

from app.models import Case, CaseReview, CaseStatus, UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE, assert_no_pii

JUDGE_KEYS = {"id", "title", "anonymized_text", "created_at", "evidence_count", "area"}
REVIEW = {"score_evidence": 8, "score_jurisprudence": 6, "notes": "Prova documental robusta."}


def test_queue_is_for_judges_only(login):
    for role in (UserRole.CLIENT, UserRole.LAWYER):
        client, _ = login(role)
        assert client.get("/api/judge/queue").status_code == 403


def test_queue_shows_approved_cases_only_and_never_raw_text(login, approved_case):
    approved = approved_case()
    client, _ = login()
    client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION})  # not approved
    judge, _ = login(UserRole.JUDGE)
    res = judge.get("/api/judge/queue")
    assert [c["id"] for c in res.json()] == [approved]
    assert set(res.json()[0]) == JUDGE_KEYS
    assert "consent_at" not in res.json()[0]
    assert_no_pii(res.text)


def test_review_scores_the_case_and_leaves_the_queue(login, approved_case, session):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 201
    assert {k: res.json()[k] for k in REVIEW} == REVIEW
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.status is CaseStatus.EVALUATED
    assert case.ai_probability_score == 70.0
    assert judge.get("/api/judge/queue").json() == []


def test_more_judges_refine_the_average(login, approved_case, session):
    case_id = approved_case()
    first, _ = login(UserRole.JUDGE)
    second, _ = login(UserRole.JUDGE)
    first.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 8, "score_jurisprudence": 6})
    assert [c["id"] for c in second.get("/api/judge/queue").json()] == [case_id]
    second.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 10, "score_jurisprudence": 8})
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.ai_probability_score == 80.0


def test_a_judge_reviews_a_case_once(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 409
    assert res.json() == {"detail": "Você já avaliou este caso."}


def test_scores_must_be_between_0_and_10(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 11, "score_jurisprudence": 5})
    assert res.status_code == 422


def test_unapproved_cases_are_invisible_to_judges(login):
    client, _ = login()
    case_id = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}).json()["id"]
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_cases_in_mediation_accept_no_more_reviews(login, approved_case, session):
    case_id = approved_case()
    case = session.get(Case, uuid.UUID(case_id))
    case.status = CaseStatus.IN_MEDIATION
    session.commit()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso não aceita mais avaliações."}


def test_review_notes_are_redacted(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(
        f"/api/cases/{case_id}/reviews",
        json={"score_evidence": 5, "score_jurisprudence": 5, "notes": "Falei com Carlos Menezes, CPF 123.456.789-00."},
    )
    assert res.json()["notes"] == "Falei com [NOME], CPF [CPF]."


def test_resolved_cases_accept_no_more_reviews(login, approved_case, session):
    case_id = approved_case()
    case = session.get(Case, uuid.UUID(case_id))
    case.status = CaseStatus.RESOLVED
    session.commit()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso não aceita mais avaliações."}


def test_score_is_recomputed_from_stored_reviews_not_a_stale_relationship(
    login, approved_case, session
):
    case_id = approved_case()
    judge_a, a_user = login(UserRole.JUDGE)
    judge_b, _ = login(UserRole.JUDGE)
    case = session.get(Case, uuid.UUID(case_id))
    assert case.reviews == []  # relationship loaded and now stale
    session.add(
        CaseReview(case_id=case.id, judge_id=a_user.id, score_evidence=8, score_jurisprudence=6)
    )
    session.commit()
    res = judge_b.post(
        f"/api/cases/{case_id}/reviews", json={"score_evidence": 10, "score_jurisprudence": 8}
    )
    assert res.status_code == 201
    session.refresh(case)
    assert case.ai_probability_score == 80.0
