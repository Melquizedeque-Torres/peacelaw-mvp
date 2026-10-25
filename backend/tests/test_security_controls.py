from app.consent import CONSENT_VERSION
import pytest
from fastapi.testclient import TestClient

from app.models import UserRole
from main import create_app
from tests.conftest import CASE_TITLE, TEST_JWT_SECRET

TOO_BIG = {"detail": "Requisição grande demais."}


def _small_limit(monkeypatch):
    monkeypatch.setenv("MAX_BODY_BYTES", "1000")
    return TestClient(create_app())


def test_content_length_too_big_is_413(monkeypatch):
    client = _small_limit(monkeypatch)
    res = client.post(
        "/api/auth/login", content=b"x" * 2000, headers={"content-type": "application/json"}
    )
    assert res.status_code == 413
    assert res.json() == TOO_BIG
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cache-control"] == "no-store"


def test_streamed_body_too_big_is_413(monkeypatch):
    client = _small_limit(monkeypatch)

    def chunks():
        for _ in range(10):
            yield b"x" * 300

    res = client.post(
        "/api/auth/login", content=chunks(), headers={"content-type": "application/json"}
    )
    assert res.status_code == 413
    assert res.json() == TOO_BIG
    assert res.headers["x-frame-options"] == "DENY"


def test_non_api_paths_not_limited(monkeypatch):
    client = _small_limit(monkeypatch)
    res = client.post("/health", content=b"x" * 2000)
    assert res.status_code != 413


def test_large_accented_case_still_created(login):
    client, _ = login(UserRole.CLIENT)
    text = ("ação é áspera. " * 1400)[:20000]
    res = client.post("/api/cases", json={"title": CASE_TITLE, "text": text, "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert res.status_code == 201, res.text


def _prod(monkeypatch, cookie, secret):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.exemplo.com")
    monkeypatch.setenv("COOKIE_SECURE", cookie)
    monkeypatch.setenv("JWT_SECRET", secret)


def test_production_refuses_insecure_cookie(monkeypatch):
    _prod(monkeypatch, "false", "s" * 64)
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        create_app()


def test_production_refuses_short_jwt_secret(monkeypatch):
    _prod(monkeypatch, "true", "s" * 47)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_app()


def test_production_ok_with_strong_settings(monkeypatch):
    _prod(monkeypatch, "true", "s" * 48)
    create_app()


def test_development_allows_insecure_cookie(monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    create_app()
