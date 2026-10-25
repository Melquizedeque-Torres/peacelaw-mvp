import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.models import Case, CaseArea, LawyerArea, UserRole
from main import app


def test_areas_round_trip_and_reject_bad_input(login):
    lawyer, _ = login(UserRole.LAWYER)
    assert lawyer.get("/api/lawyer/areas").json() == {"areas": []}
    res = lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL", "ALUGUEL", "CIVIL"]})
    assert res.json() == {"areas": ["ALUGUEL", "CIVIL"]}
    assert lawyer.get("/api/lawyer/areas").json() == {"areas": ["ALUGUEL", "CIVIL"]}
    assert lawyer.put("/api/lawyer/areas", json={"areas": ["PENAL"]}).status_code == 422
    # a rejected PUT leaves the stored set untouched
    assert lawyer.get("/api/lawyer/areas").json() == {"areas": ["ALUGUEL", "CIVIL"]}
    assert lawyer.put("/api/lawyer/areas", json={"areas": []}).json() == {"areas": []}


def test_areas_accept_all_seven_and_reject_more(login):
    lawyer, _ = login(UserRole.LAWYER)
    everything = [a.value for a in CaseArea]
    assert len(everything) == 7
    assert len(lawyer.put("/api/lawyer/areas", json={"areas": everything}).json()["areas"]) == 7
    assert lawyer.put("/api/lawyer/areas", json={"areas": everything + ["CIVIL"]}).status_code == 422
    assert lawyer.put("/api/lawyer/areas", json={}).status_code == 422


def test_areas_are_per_lawyer(login):
    a, _ = login(UserRole.LAWYER)
    b, _ = login(UserRole.LAWYER)
    a.put("/api/lawyer/areas", json={"areas": ["CIVIL"]})
    assert b.get("/api/lawyer/areas").json() == {"areas": []}


def test_only_lawyers_manage_areas(login):
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.ADMIN):
        c, _ = login(role)
        assert c.get("/api/lawyer/areas").status_code == 403
        assert c.put("/api/lawyer/areas", json={"areas": []}).status_code == 403


def test_anonymous_cannot_manage_areas(client_factory):
    anon = client_factory()
    assert anon.get("/api/lawyer/areas").status_code == 401
    assert anon.put("/api/lawyer/areas", json={"areas": []}).status_code == 401


def test_board_puts_suggested_opportunities_first(login, evaluated_case, session):
    low = evaluated_case(3, 3)
    high = evaluated_case(9, 9)
    session.execute(update(Case).where(Case.id == uuid.UUID(low)).values(area=CaseArea.ALUGUEL))
    session.execute(update(Case).where(Case.id == uuid.UUID(high)).values(area=CaseArea.CIVIL))
    session.commit()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["ALUGUEL"]})
    board = lawyer.get("/api/lawyer/board").json()
    assert [(c["id"], c["suggested"]) for c in board] == [(low, True), (high, False)]
    lawyer.put("/api/lawyer/areas", json={"areas": []})
    board = lawyer.get("/api/lawyer/board").json()
    assert [(c["id"], c["suggested"]) for c in board] == [(high, False), (low, False)]


def test_own_mediations_and_resolved_are_never_suggested(login, evaluated_case, session):
    mine = evaluated_case(5, 5)
    done = evaluated_case(6, 6)
    for cid in (mine, done):
        session.execute(update(Case).where(Case.id == uuid.UUID(cid)).values(area=CaseArea.CIVIL))
    session.commit()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL"]})
    assert lawyer.post(f"/api/cases/{mine}/match").status_code == 200
    assert lawyer.post(f"/api/cases/{done}/match").status_code == 200
    assert lawyer.post(f"/api/cases/{done}/resolve").status_code == 200
    board = lawyer.get("/api/lawyer/board").json()
    assert {c["id"] for c in board} == {mine, done}
    assert all(c["suggested"] is False for c in board)


def test_pagination_applies_to_suggested_first_order(login, evaluated_case, session):
    other = evaluated_case(9, 9)
    suggested = evaluated_case(2, 2)
    session.execute(update(Case).where(Case.id == uuid.UUID(other)).values(area=CaseArea.CIVIL))
    session.execute(update(Case).where(Case.id == uuid.UUID(suggested)).values(area=CaseArea.FAMILIA))
    session.commit()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["FAMILIA"]})
    page1 = lawyer.get("/api/lawyer/board", params={"limit": 1}).json()
    page2 = lawyer.get("/api/lawyer/board", params={"limit": 1, "offset": 1}).json()
    assert [c["id"] for c in page1] == [suggested]
    assert [c["id"] for c in page2] == [other]


def test_match_is_not_restricted_by_area(login, evaluated_case):
    cid = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["TRABALHISTA"]})
    assert lawyer.post(f"/api/cases/{cid}/match").status_code == 200


def test_deleting_a_lawyer_cascades_to_their_areas(login, session):
    lawyer, user = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL", "ALUGUEL"]})
    assert session.scalars(select(LawyerArea).where(LawyerArea.user_id == user.id)).all()
    session.delete(user)
    session.commit()
    assert session.scalars(select(LawyerArea)).all() == []


def test_cors_allows_put_preflight():
    res = TestClient(app).options(
        "/api/lawyer/areas",
        headers={"Origin": "http://127.0.0.1:3000", "Access-Control-Request-Method": "PUT"},
    )
    assert res.status_code == 200
    assert "PUT" in res.headers["access-control-allow-methods"]


def _fail_commits(monkeypatch, session, times):
    real = session.commit
    state = {"left": times}

    def commit():
        if state["left"] > 0:
            state["left"] -= 1
            raise IntegrityError("INSERT", {}, Exception("duplicate"))
        real()

    monkeypatch.setattr(session, "commit", commit)


def test_put_areas_retries_once_on_integrity_error(login, session, monkeypatch):
    lawyer, user = login(UserRole.LAWYER)
    _fail_commits(monkeypatch, session, 1)
    res = lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL", "ALUGUEL"]})
    assert res.status_code == 200 and res.json() == {"areas": ["ALUGUEL", "CIVIL"]}
    stored = session.scalars(select(LawyerArea.area).where(LawyerArea.user_id == user.id)).all()
    assert sorted(a.value for a in stored) == ["ALUGUEL", "CIVIL"]


def test_put_areas_returns_409_when_conflict_persists(login, session, monkeypatch):
    lawyer, _ = login(UserRole.LAWYER)
    _fail_commits(monkeypatch, session, 2)
    res = lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL"]})
    assert res.status_code == 409
    assert res.json()["detail"] == "Atualização simultânea. Tente novamente."
