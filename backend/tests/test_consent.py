from app.consent import CONSENT_TEXT, CONSENT_VERSION
from app.models import Case
from tests.conftest import CASE_TEXT, CASE_TITLE


def test_consent_endpoint_is_public(client_factory):
    res = client_factory().get("/api/consent")
    assert res.status_code == 200
    assert res.json() == {"version": CONSENT_VERSION, "text": CONSENT_TEXT}
    assert CONSENT_VERSION == "2026-10-20"
    assert CONSENT_TEXT.startswith("Autorizo o tratamento dos dados pessoais")


def test_case_records_consent_version_for_owner_only(login, session):
    client, _ = login()
    res = client.post(
        "/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}
    )
    assert res.status_code == 201
    assert res.json()["consent_version"] == CONSENT_VERSION
    case_id = res.json()["id"]
    assert client.get(f"/api/cases/{case_id}").json()["consent_version"] == CONSENT_VERSION
    assert session.get(Case, __import__("uuid").UUID(case_id)).consent_version == CONSENT_VERSION
    mine = client.get("/api/cases/mine").json()
    assert all("consent_version" not in c for c in mine)


def test_outdated_consent_version_is_a_409_and_creates_nothing(login, session):
    client, _ = login()
    res = client.post(
        "/api/cases",
        json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": "1999-01-01"},
    )
    assert res.status_code == 409
    assert res.json() == {"detail": "O termo de consentimento foi atualizado. Revise e aceite novamente."}
    assert session.query(Case).count() == 0


def test_missing_or_oversized_consent_version_is_422(login):
    client, _ = login()
    base = {"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True}
    assert client.post("/api/cases", json=base).status_code == 422
    assert client.post("/api/cases", json={**base, "consent_version": "x" * 21}).status_code == 422


def test_consent_router_is_mounted_once_on_the_app():
    from main import app
    from app.routers import cases

    assert "/api/consent" in app.openapi()["paths"]
    assert not any("consent" in getattr(r, "path", "") for r in cases.router.routes)


def test_frontend_fallback_matches_backend_byte_for_byte():
    import json
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "consent.ts"
    if not src.exists():
        import pytest
        pytest.skip("frontend not checked out")
    code = src.read_text(encoding="utf-8")
    version = re.search(r'CONSENT_FALLBACK_VERSION = ("[^"]*")', code).group(1)
    text = re.search(r'CONSENT_FALLBACK_TEXT =\s*("(?:[^"\\]|\\.)*")', code).group(1)
    assert json.loads(version) == CONSENT_VERSION
    assert json.loads(text) == CONSENT_TEXT
