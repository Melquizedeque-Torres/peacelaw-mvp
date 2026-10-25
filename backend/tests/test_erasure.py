from app.consent import CONSENT_VERSION
import uuid

from sqlalchemy import text

from app.security.crypto import decrypt_text
from app.models import Case, CaseStatus, UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE, assert_no_pii


def _create(client) -> str:
    res = client.post(
        "/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_erase_original_clears_raw_text_and_keeps_workflow(login, session):
    client, _ = login()
    case_id = _create(client)
    before = client.get(f"/api/cases/{case_id}").json()
    assert before["raw_text"] == CASE_TEXT and before["raw_text_erased_at"] is None

    res = client.post(f"/api/cases/{case_id}/erase-original")
    assert res.status_code == 200
    body = res.json()
    assert body["raw_text"] == ""
    assert body["raw_text_erased_at"] is not None
    assert body["anonymized_text"] == before["anonymized_text"]
    assert body["status"] == before["status"]
    assert_no_pii(body["anonymized_text"])

    again = client.get(f"/api/cases/{case_id}").json()
    assert again["raw_text"] == ""
    assert again["raw_text_erased_at"] == body["raw_text_erased_at"]


def test_erased_raw_text_is_gone_from_storage(login, session):
    client, _ = login()
    case_id = _create(client)
    client.post(f"/api/cases/{case_id}/erase-original")
    session.expire_all()
    stored = session.execute(
        text("SELECT raw_text FROM cases WHERE id = :id"),
        {"id": uuid.UUID(case_id).hex},
    ).scalar_one()
    assert "Carlos" not in stored and "123.456" not in stored
    # Not NULL/empty: a real ciphertext of the empty string.
    assert stored
    assert decrypt_text(stored) == ""


def test_erase_is_idempotent_and_keeps_first_timestamp(login):
    client, _ = login()
    case_id = _create(client)
    first = client.post(f"/api/cases/{case_id}/erase-original")
    second = client.post(f"/api/cases/{case_id}/erase-original")
    assert first.status_code == second.status_code == 200
    assert second.json()["raw_text_erased_at"] == first.json()["raw_text_erased_at"]
    assert second.json()["raw_text"] == ""


def test_erase_works_in_any_status(login, session):
    client, _ = login()
    case_id = _create(client)
    case = session.get(Case, uuid.UUID(case_id))
    case.status = CaseStatus.IN_MEDIATION
    session.commit()
    res = client.post(f"/api/cases/{case_id}/erase-original")
    assert res.status_code == 200 and res.json()["status"] == "IN_MEDIATION"


def test_erase_is_owner_only(login):
    owner, _ = login()
    case_id = _create(owner)
    other, _ = login()
    assert other.post(f"/api/cases/{case_id}/erase-original").status_code == 404
    assert owner.get(f"/api/cases/{case_id}").json()["raw_text"] == CASE_TEXT
    assert other.post(f"/api/cases/{uuid.uuid4()}/erase-original").status_code == 404


def test_erase_rejects_non_clients_and_anonymous(login, client_factory):
    owner, _ = login()
    case_id = _create(owner)
    judge, _ = login(UserRole.JUDGE)
    assert judge.post(f"/api/cases/{case_id}/erase-original").status_code == 403
    assert client_factory().post(f"/api/cases/{case_id}/erase-original").status_code == 401
