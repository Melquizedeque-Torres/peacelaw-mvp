from app.consent import CONSENT_VERSION
import threading

import pytest

import app.security.passwords as passwords
from app.models import Case, CaseStatus, UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE

LIMIT_MSG = "Limite de casos em andamento atingido."


class CountingSemaphore:
    def __init__(self):
        self.acquired = 0
        self.inner = threading.BoundedSemaphore(4)

    def __enter__(self):
        self.acquired += 1
        return self.inner.__enter__()

    def __exit__(self, *exc):
        return self.inner.__exit__(*exc)


def test_hash_concurrency_is_bounded_by_a_semaphore():
    assert isinstance(passwords._argon_slots, type(threading.BoundedSemaphore(1)))
    assert passwords._argon_slots._initial_value == 4


def test_hash_and_verify_acquire_the_semaphore(monkeypatch):
    counter = CountingSemaphore()
    monkeypatch.setattr(passwords, "_argon_slots", counter)
    hashed = passwords.hash_password("senha-forte-123")
    assert counter.acquired == 1
    assert passwords.verify_password("senha-forte-123", hashed) is True
    assert counter.acquired == 2
    assert passwords.verify_password("x", None) is False  # dummy verify
    assert counter.acquired == 3
    assert passwords.verify_password("x", "not-a-hash") is False  # dummy after failure
    assert counter.acquired >= 4


def _seed(session, client_id, n, status=CaseStatus.AWAITING_APPROVAL):
    for i in range(n):
        session.add(
            Case(client_id=client_id, title=f"t{i}", raw_text="r", anonymized_text="a", status=status)
        )
    session.commit()


def _create(client):
    return client.post(
        "/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}
    )


def test_open_case_cap_returns_429(login, session):
    client, user = login()
    _seed(session, user.id, 20)
    res = _create(client)
    assert res.status_code == 429
    assert res.json() == {"detail": LIMIT_MSG}


def test_cap_counts_only_open_statuses(login, session):
    client, user = login()
    _seed(session, user.id, 19)
    _seed(session, user.id, 5, CaseStatus.RESOLVED)
    assert _create(client).status_code == 201  # 19 open -> 20th allowed
    assert _create(client).status_code == 429


@pytest.mark.parametrize("status", [
    CaseStatus.READY_FOR_JUDGE, CaseStatus.EVALUATED, CaseStatus.IN_MEDIATION,
])
def test_cap_counts_each_open_status(login, session, status):
    client, user = login()
    _seed(session, user.id, 20, status)
    assert _create(client).status_code == 429


def test_cap_is_per_client(login, session, make_user):
    client, _ = login()
    other = make_user(UserRole.CLIENT)
    _seed(session, other.id, 20)
    assert _create(client).status_code == 201




def test_evidence_path_gets_a_larger_body_limit(login):
    client, _ = login()
    cid = _create(client).json()["id"]
    big = b"%PDF-" + b"0" * 2_623_000
    res = client.post(f"/api/cases/{cid}/evidence?filename=a.pdf", content=big,
                      headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 413
    assert res.json() == {"detail": "Arquivo acima de 2,5 MB."}  # from the endpoint, not the middleware
    other = client.post("/api/cases", content=big, headers={"Content-Type": "application/octet-stream"})
    assert other.status_code == 413
    assert other.json() == {"detail": "Requisição grande demais."}
    # A body above the evidence ceiling is still rejected by the middleware.
    huge = b"0" * 2_800_000
    res = client.post(f"/api/cases/{cid}/evidence?filename=a.pdf", content=huge,
                      headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 413
    assert res.json() == {"detail": "Requisição grande demais."}


def _seed_pool(session, make_user, n, status):
    owner = make_user(UserRole.CLIENT)
    _seed(session, owner.id, n, status)


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1", "limit=abc"])
@pytest.mark.parametrize("role,url", [
    (UserRole.CLIENT, "/api/cases/mine"),
    (UserRole.JUDGE, "/api/judge/queue"),
    (UserRole.LAWYER, "/api/lawyer/board"),
])
def test_pagination_validation(login, role, url, query):
    client, _ = login(role)
    assert client.get(f"{url}?{query}").status_code == 422


def test_my_cases_pagination(login, session):
    client, user = login()
    _seed(session, user.id, 5, CaseStatus.RESOLVED)
    full = [c["id"] for c in client.get("/api/cases/mine").json()]
    assert len(full) == 5
    page = [c["id"] for c in client.get("/api/cases/mine?limit=2&offset=1").json()]
    assert page == full[1:3]
    assert client.get("/api/cases/mine?offset=10").json() == []


def test_judge_queue_pagination(login, session, make_user):
    _seed_pool(session, make_user, 5, CaseStatus.READY_FOR_JUDGE)
    client, _ = login(UserRole.JUDGE)
    full = [c["id"] for c in client.get("/api/judge/queue").json()]
    assert len(full) == 5
    page = [c["id"] for c in client.get("/api/judge/queue?limit=2&offset=3").json()]
    assert page == full[3:5]


def test_lawyer_board_pagination(login, session, make_user):
    _seed_pool(session, make_user, 5, CaseStatus.EVALUATED)
    client, _ = login(UserRole.LAWYER)
    full = [c["id"] for c in client.get("/api/lawyer/board").json()]
    assert len(full) == 5
    page = [c["id"] for c in client.get("/api/lawyer/board?limit=3&offset=1").json()]
    assert page == full[1:4]


def test_override_is_exact_path_and_post_only(login):
    client, _ = login()
    cid = _create(client).json()["id"]
    big = b"%PDF-" + b"0" * 2_623_000
    hdr = {"Content-Type": "application/octet-stream"}
    # trailing slash is not the override path
    r = client.post(f"/api/cases/{cid}/evidence/", content=big, headers=hdr)
    assert r.status_code == 413 and r.json() == {"detail": "Requisição grande demais."}
    # non-POST methods keep the default limit
    r = client.request("DELETE", f"/api/cases/{cid}/evidence", content=big, headers=hdr)
    assert r.status_code == 413 and r.json() == {"detail": "Requisição grande demais."}


def test_chunked_body_without_content_length_is_still_capped(login):
    client, _ = login()
    cid = _create(client).json()["id"]

    def chunks():
        for _ in range(30):
            yield b"0" * 100_000  # 3 MB streamed, no Content-Length

    r = client.post(f"/api/cases/{cid}/evidence", content=chunks(),
                    headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 413
    assert r.json() == {"detail": "Requisição grande demais."}


def test_evidence_limit_override_accepts_an_uppercase_uuid(login):
    client, _ = login()
    cid = _create(client).json()["id"]
    big = b"%PDF-" + b"0" * 2_623_000
    res = client.post(f"/api/cases/{cid.upper()}/evidence", content=big,
                      headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 413
    assert res.json() == {"detail": "Arquivo acima de 2,5 MB."}  # endpoint, not the middleware
