from app.consent import CONSENT_VERSION
from fastapi.testclient import TestClient

from main import app


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_cors_preflight_allows_configured_origin_only():
    client = TestClient(app)
    allowed = client.options(
        "/health",
        headers={"Origin": "http://127.0.0.1:3000", "Access-Control-Request-Method": "GET"},
    )
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert allowed.headers["access-control-allow-credentials"] == "true"

    denied = client.options(
        "/health",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in denied.headers


def test_engine_hides_statement_parameters():
    from app.db import get_engine

    assert get_engine().hide_parameters is True


def test_api_responses_are_never_cached(login):
    from tests.conftest import CASE_TEXT, CASE_TITLE

    client, _ = login()
    created = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"
    assert client.get("/api/cases/mine").headers["cache-control"] == "no-store"
    unauth = TestClient(app).get("/api/auth/me")
    assert unauth.status_code == 401
    assert unauth.headers["cache-control"] == "no-store"
    assert "cache-control" not in TestClient(app).get("/health").headers


def test_cross_site_state_changing_requests_are_rejected(login):
    from tests.conftest import CASE_TEXT, CASE_TITLE

    client, _ = login()
    body = {"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}
    for origin in ("http://evil.example", "null", "https://testserver"):
        res = client.post("/api/cases", json=body, headers={"Origin": origin})
        assert res.status_code == 403, origin
        assert res.json() == {"detail": "Origem não permitida."}
        assert res.headers["cache-control"] == "no-store"
    assert client.delete(
        "/api/cases/00000000-0000-0000-0000-000000000000",
        headers={"Origin": "http://evil.example"},
    ).status_code == 403

    allowed = client.post("/api/cases", json=body, headers={"Origin": "http://localhost:3000"})
    assert allowed.status_code == 201
    same_origin = client.post("/api/cases", json=body, headers={"Origin": "http://testserver"})
    assert same_origin.status_code == 201
    assert client.post("/api/cases", json=body).status_code == 201  # no Origin header
    # Safe methods are never blocked.
    assert client.get("/api/auth/me", headers={"Origin": "http://evil.example"}).status_code == 200
