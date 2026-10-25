from app.consent import CONSENT_VERSION
import logging
import uuid

import pytest
from sqlalchemy.exc import DBAPIError

from app.models import Case, CaseStatus, UserRole
from main import app
from tests.conftest import CASE_TEXT, CASE_TITLE, PASSWORD, assert_no_pii

SUMMARY_KEYS = {"id", "title", "status", "ai_probability_score", "created_at"}


def _create(client):
    return client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION})


def test_creating_a_case_requires_a_session(client_factory):
    assert _create(client_factory()).status_code == 401


def test_only_clients_create_cases(login):
    for role in (UserRole.JUDGE, UserRole.LAWYER, UserRole.ADMIN):
        client, _ = login(role)
        res = _create(client)
        assert res.status_code == 403
        assert res.json() == {"detail": "Acesso negado."}


def test_create_redacts_title_and_text_and_awaits_approval(login, session):
    client, user = login()
    res = _create(client)
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "AWAITING_APPROVAL"
    assert body["title"] == "Obra abandonada por [NOME]"
    assert body["anonymized_text"] == (
        "O responsável, [NOME], abandonou a obra. Paguei [VALOR]. "
        "Meu CPF é [CPF] e meu telefone é [TELEFONE]."
    )
    assert body["raw_text"] == CASE_TEXT  # owner view
    assert body["ai_probability_score"] is None
    assert body["redactions"] == [
        {"label": "NOME", "count": 2},
        {"label": "VALOR", "count": 1},
        {"label": "CPF", "count": 1},
        {"label": "TELEFONE", "count": 1},
    ]
    assert session.get(Case, uuid.UUID(body["id"])).client_id == user.id


def test_mine_lists_only_own_cases_without_texts(login):
    alice, _ = login()
    bob, _ = login()
    mine = _create(alice).json()["id"]
    _create(bob)
    res = alice.get("/api/cases/mine")
    assert [c["id"] for c in res.json()] == [mine]
    assert set(res.json()[0]) == SUMMARY_KEYS


def test_owner_view_is_private(login):
    alice, _ = login()
    bob, _ = login()
    case_id = _create(alice).json()["id"]
    assert alice.get(f"/api/cases/{case_id}").json()["raw_text"] == CASE_TEXT
    res = bob.get(f"/api/cases/{case_id}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_approve_sends_case_to_judges_once(login):
    client, _ = login()
    case_id = _create(client).json()["id"]
    res = client.post(f"/api/cases/{case_id}/approve")
    assert res.status_code == 200
    assert res.json()["status"] == "READY_FOR_JUDGE"
    again = client.post(f"/api/cases/{case_id}/approve")
    assert again.status_code == 409
    assert again.json() == {"detail": "Transição de status inválida."}


def test_other_clients_cannot_approve(login):
    alice, _ = login()
    bob, _ = login()
    case_id = _create(alice).json()["id"]
    assert bob.post(f"/api/cases/{case_id}/approve").status_code == 404


def test_delete_before_evaluation(login, session):
    client, _ = login()
    case_id = _create(client).json()["id"]
    assert client.delete(f"/api/cases/{case_id}").status_code == 204
    assert client.get(f"/api/cases/{case_id}").status_code == 404
    assert session.get(Case, uuid.UUID(case_id)) is None


@pytest.mark.parametrize(
    "late_status", [CaseStatus.EVALUATED, CaseStatus.IN_MEDIATION, CaseStatus.RESOLVED]
)
def test_delete_is_refused_after_evaluation(login, session, late_status):
    client, _ = login()
    case_id = _create(client).json()["id"]
    case = session.get(Case, uuid.UUID(case_id))
    case.status = late_status
    session.commit()
    res = client.delete(f"/api/cases/{case_id}")
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso não pode mais ser excluído."}
    session.expire_all()
    assert session.get(Case, uuid.UUID(case_id)) is not None


def test_validation_errors_never_echo_the_report(login):
    client, _ = login()
    oversized = "Meu CPF é 123.456.789-00. " * 1_000
    for payload in ({"title": "ok", "text": "curto 123.456.789-00", "lgpd_consent": True, "consent_version": CONSENT_VERSION}, {"title": CASE_TITLE, "text": oversized, "lgpd_consent": True}):
        res = client.post("/api/cases", json=payload)
        assert res.status_code == 422
        assert "123.456.789-00" not in res.text
        assert all(set(item) == {"field", "message"} for item in res.json()["errors"])


def test_control_characters_are_rejected(login):
    client, _ = login()
    res = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT + "\0000", "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert res.status_code == 422
    assert "123.456.789-00" not in res.text


def test_commit_failure_never_leaks_the_report(make_user, client_factory, session, caplog):
    user = make_user()
    client = client_factory(raise_server_exceptions=False)
    assert client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 200

    def failing_commit():
        raise DBAPIError("INSERT INTO cases ...", (CASE_TEXT,), Exception("boom"), hide_parameters=True)

    session.commit = failing_commit
    with caplog.at_level(logging.DEBUG):
        res = _create(client)
    assert res.status_code == 500
    assert_no_pii(res.text)
    assert_no_pii(caplog.text)


def test_openapi_documents_the_sanitized_422_shape():
    spec = app.openapi()
    schema = spec["paths"]["/api/cases"]["post"]["responses"]["422"]["content"]["application/json"]["schema"]
    assert schema["$ref"].endswith("/ValidationErrorOut")


def test_title_that_grows_past_200_chars_after_redaction_is_a_sanitized_422(login):
    client, _ = login()
    title = "R$1 " * 49 + "R$1"
    assert len(title) == 199
    res = client.post("/api/cases", json={"title": title, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert res.status_code == 422
    assert res.json() == {
        "detail": "Dados inválidos.",
        "errors": [
            {"field": "title", "message": "Título longo demais após a anonimização."}
        ],
    }


def test_raw_text_is_decrypted_only_on_owner_paths(login, session, monkeypatch):
    import app.security.crypto as crypto

    calls = []
    real = crypto.decrypt_text
    monkeypatch.setattr(crypto, "decrypt_text", lambda t: calls.append(1) or real(t))

    owner, _ = login()
    case_id = _create(owner).json()["id"]
    assert owner.post(f"/api/cases/{case_id}/approve").status_code == 200
    judge, _ = login(UserRole.JUDGE)
    lawyer, _ = login(UserRole.LAWYER)

    def third_party(step):
        session.expunge_all()  # force fresh loads from the database
        calls.clear()
        res = step()
        assert res.status_code in (200, 201), res.text
        assert calls == [], "raw_text was decrypted on a third-party path"

    third_party(lambda: judge.get("/api/judge/queue"))
    third_party(
        lambda: judge.post(
            f"/api/cases/{case_id}/reviews",
            json={"score_evidence": 7, "score_jurisprudence": 5},
        )
    )
    third_party(lambda: lawyer.get("/api/lawyer/board"))
    third_party(lambda: lawyer.post(f"/api/cases/{case_id}/match"))

    session.expunge_all()
    calls.clear()
    res = owner.get(f"/api/cases/{case_id}")
    assert res.json()["raw_text"] == CASE_TEXT
    assert calls, "owner path must decrypt raw_text"


LGPD_MESSAGE = "É necessário consentir com o tratamento dos dados (LGPD)."


def test_missing_consent_is_a_sanitized_422(login):
    client, _ = login()
    res = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "consent_version": CONSENT_VERSION})
    assert res.status_code == 422
    errors = res.json()["errors"]
    assert [e["field"] for e in errors] == ["lgpd_consent"]
    assert errors[0]["message"] == LGPD_MESSAGE
    assert "123.456.789-00" not in res.text


def test_false_consent_is_rejected(login):
    client, _ = login()
    res = client.post(
        "/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": False, "consent_version": CONSENT_VERSION}
    )
    assert res.status_code == 422
    assert res.json()["errors"] == [{"field": "lgpd_consent", "message": LGPD_MESSAGE}]


@pytest.mark.parametrize("value", ["true", 1, "1", "yes", "on", None, False])
def test_consent_must_be_the_literal_true(login, value):
    client, _ = login()
    res = client.post(
        "/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": value, "consent_version": CONSENT_VERSION}
    )
    assert res.status_code == 422
    assert res.json()["errors"] == [{"field": "lgpd_consent", "message": LGPD_MESSAGE}]


def test_consent_is_recorded_and_visible_to_the_owner_only(login):
    client, _ = login()
    created = _create(client)
    assert created.status_code == 201
    assert created.json()["consent_at"] is not None
    assert client.get(f"/api/cases/{created.json()['id']}").json()["consent_at"] is not None
    assert "consent_at" not in client.get("/api/cases/mine").json()[0]
