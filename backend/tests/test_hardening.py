import pytest
from fastapi.testclient import TestClient

from app.models import User
from main import create_app

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
}


def _prod(monkeypatch, cors="https://app.exemplo.com"):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("JWT_SECRET", "p" * 48)
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    if cors is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", cors)


def test_development_keeps_docs(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    client = TestClient(create_app())
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_production_hides_docs(monkeypatch):
    _prod(monkeypatch)
    client = TestClient(create_app())
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    assert client.get("/health").status_code == 200


def test_production_docs_can_be_reenabled(monkeypatch):
    _prod(monkeypatch)
    monkeypatch.setenv("ENABLE_API_DOCS", "true")
    assert TestClient(create_app()).get("/openapi.json").status_code == 200


def test_production_requires_cors_origins(monkeypatch):
    _prod(monkeypatch, cors=None)
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        create_app()
    _prod(monkeypatch, cors="  ")
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        create_app()


def test_security_headers_on_every_response(login, client_factory):
    client, _ = login()
    for res in (
        client.get("/health"),
        client.get("/api/auth/me"),
        client.get("/api/cases/nao-existe"),
        client_factory().get("/api/auth/me"),  # 401 (session override, no real DB)
    ):
        for name, value in SECURITY_HEADERS.items():
            assert res.headers[name] == value, (res.url, name)
    forbidden = client.post("/api/cases", json={}, headers={"Origin": "http://evil.example"})
    assert forbidden.status_code == 403
    assert forbidden.headers["x-frame-options"] == "DENY"


def test_token_minted_before_logout_is_rejected_after(login, session, client_factory):
    client, user = login()
    stale = client.cookies.get("peacelaw_session")
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    session.expire_all()
    assert session.get(User, user.id).token_version == 1

    replay = client_factory()
    replay.cookies.set("peacelaw_session", stale)
    assert replay.get("/api/auth/me").status_code == 401


def test_logout_ends_all_sessions_of_the_user(login, client_factory, session):
    first, user = login()
    second = client_factory()
    assert second.post(
        "/api/auth/login", json={"email": user.email, "password": "senha-forte-123"}
    ).status_code == 200
    assert second.get("/api/auth/me").status_code == 200
    first.post("/api/auth/logout")
    assert second.get("/api/auth/me").status_code == 401
    # A fresh login after logout gets the new version and works.
    assert second.post(
        "/api/auth/login", json={"email": user.email, "password": "senha-forte-123"}
    ).status_code == 200
    assert second.get("/api/auth/me").status_code == 200


def test_logout_without_session_still_clears_cookie(client_factory):
    res = client_factory().post("/api/auth/logout")
    assert res.status_code == 204
    assert "peacelaw_session" in res.headers["set-cookie"]


def test_logout_with_garbage_cookie_is_204(client_factory):
    client = client_factory()
    client.cookies.set("peacelaw_session", "lixo")
    assert client.post("/api/auth/logout").status_code == 204


def test_token_carries_version_claim():
    import uuid

    import jwt

    from app.config import get_jwt_secret
    from app.security.tokens import create_access_token

    token = create_access_token(uuid.uuid4(), 3)
    assert jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])["ver"] == 3


def test_security_headers_on_unhandled_500(client_factory):
    from main import app

    def boom():
        raise RuntimeError("segredo interno")

    app.add_api_route("/__boom", boom)
    try:
        res = client_factory(raise_server_exceptions=False).get("/__boom")
    finally:
        app.router.routes.pop()
    assert res.status_code == 500
    assert res.json() == {"detail": "Erro interno."}
    assert "segredo" not in res.text
    for name, value in SECURITY_HEADERS.items():
        assert res.headers[name] == value, name
    assert res.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("value", ["staging", "prod", "test"])
def test_unknown_app_env_is_rejected(monkeypatch, value):
    monkeypatch.setenv("APP_ENV", value)
    with pytest.raises(RuntimeError, match="APP_ENV"):
        create_app()
