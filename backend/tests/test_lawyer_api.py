import uuid

from app.models import Case, CaseStatus, UserRole
from tests.conftest import assert_no_pii

LAWYER_KEYS = {"id", "title", "anonymized_text", "status", "ai_probability_score", "created_at", "evidence_count", "area", "suggested"}


def test_board_is_for_lawyers_only(login):
    for role in (UserRole.CLIENT, UserRole.JUDGE):
        client, _ = login(role)
        assert client.get("/api/lawyer/board").status_code == 403


def test_board_lists_evaluated_cases_without_raw_text(login, approved_case, evaluated_case):
    approved_case()  # not evaluated yet → not on the board
    evaluated = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    res = lawyer.get("/api/lawyer/board")
    assert [c["id"] for c in res.json()] == [evaluated]
    assert set(res.json()[0]) == LAWYER_KEYS
    assert "consent_at" not in res.json()[0]
    assert res.json()[0]["ai_probability_score"] == 70.0
    assert_no_pii(res.text)


def test_board_orders_by_score(login, evaluated_case):
    low = evaluated_case(3, 3)
    high = evaluated_case(9, 9)
    lawyer, _ = login(UserRole.LAWYER)
    assert [c["id"] for c in lawyer.get("/api/lawyer/board").json()] == [high, low]


def test_match_moves_case_to_mediation(login, evaluated_case, session):
    case_id = evaluated_case()
    lawyer, me = login(UserRole.LAWYER)
    res = lawyer.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 200
    assert res.json()["status"] == "IN_MEDIATION"
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.lawyer_id == me.id


def test_a_case_is_matched_once(login, evaluated_case):
    case_id = evaluated_case()
    first, _ = login(UserRole.LAWYER)
    second, _ = login(UserRole.LAWYER)
    first.post(f"/api/cases/{case_id}/match")
    res = second.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso já está em mediação."}
    assert second.get("/api/lawyer/board").json() == []


def test_unevaluated_cases_cannot_be_matched(login, approved_case):
    case_id = approved_case()
    lawyer, _ = login(UserRole.LAWYER)
    res = lawyer.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 404


def test_resolve_by_the_assigned_lawyer(login, evaluated_case):
    case_id = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.post(f"/api/cases/{case_id}/match")
    res = lawyer.post(f"/api/cases/{case_id}/resolve")
    assert res.status_code == 200
    assert res.json()["status"] == "RESOLVED"
    assert [c["status"] for c in lawyer.get("/api/lawyer/board").json()] == ["RESOLVED"]
    again = lawyer.post(f"/api/cases/{case_id}/resolve")
    assert again.status_code == 409
    assert again.json() == {"detail": "Transição de status inválida."}


def test_other_lawyers_cannot_resolve(login, evaluated_case):
    case_id = evaluated_case()
    owner, _ = login(UserRole.LAWYER)
    intruder, _ = login(UserRole.LAWYER)
    owner.post(f"/api/cases/{case_id}/match")
    res = intruder.post(f"/api/cases/{case_id}/resolve")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_resolve_unknown_case_is_404(login):
    lawyer, _ = login(UserRole.LAWYER)
    res = lawyer.post(f"/api/cases/{uuid.uuid4()}/resolve")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_resolved_cases_are_private_to_their_lawyer(login, evaluated_case):
    case_id = evaluated_case()
    owner, _ = login(UserRole.LAWYER)
    other, _ = login(UserRole.LAWYER)
    owner.post(f"/api/cases/{case_id}/match")
    owner.post(f"/api/cases/{case_id}/resolve")
    assert other.get("/api/lawyer/board").json() == []


def _seed(session, client_id, status, score, lawyer_id=None, n=1, minute0=0):
    from datetime import datetime, timedelta, timezone

    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ids = []
    for i in range(n):
        case = Case(
            client_id=client_id,
            lawyer_id=lawyer_id,
            title="Caso",
            raw_text="texto",
            anonymized_text="texto anonimizado",
            status=status,
            ai_probability_score=score,
            updated_at=base + timedelta(minutes=minute0 + i),
        )
        session.add(case)
        session.flush()
        ids.append(str(case.id))
    session.commit()
    return ids


def test_board_keeps_own_mediations_beyond_the_opportunity_page(login, make_user, session):
    lawyer, me = login(UserRole.LAWYER)
    other = make_user(UserRole.LAWYER)
    owner = make_user(UserRole.CLIENT)
    _seed(session, owner.id, CaseStatus.EVALUATED, 90.0, n=60)
    mine = _seed(session, owner.id, CaseStatus.IN_MEDIATION, 1.0, lawyer_id=me.id)[0]
    theirs = _seed(session, owner.id, CaseStatus.IN_MEDIATION, 99.0, lawyer_id=other.id)[0]

    body = lawyer.get("/api/lawyer/board").json()
    ids = [c["id"] for c in body]
    assert ids[0] == mine
    assert theirs not in ids
    assert len(ids) == 1 + 50

    page2 = [c["id"] for c in lawyer.get("/api/lawyer/board?limit=50&offset=50").json()]
    assert mine not in page2  # offset > 0 returns only opportunities
    assert len(page2) == 10
    assert not set(ids[1:]) & set(page2)


def test_board_caps_resolved_at_twenty_most_recent(login, make_user, session):
    lawyer, me = login(UserRole.LAWYER)
    other = make_user(UserRole.LAWYER)
    owner = make_user(UserRole.CLIENT)
    resolved = _seed(session, owner.id, CaseStatus.RESOLVED, 50.0, lawyer_id=me.id, n=25)
    _seed(session, owner.id, CaseStatus.RESOLVED, 50.0, lawyer_id=other.id, n=3, minute0=500)

    ids = [c["id"] for c in lawyer.get("/api/lawyer/board").json()]
    assert ids == list(reversed(resolved))[:20]
