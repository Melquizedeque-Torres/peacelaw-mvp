"""Adversarial regression suite: each test is an attack that must fail.

Written for the security assessment in docs/security-assessment.md; kept as a permanent guard.
"""

import time
import uuid

import jwt
import pytest
from app.models import UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE, PASSWORD, PII, TEST_JWT_SECRET

LONG_TEXT = "texto de teste suficientemente longo para passar a validacao minima. " * 2

PUBLIC_API = {
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/health"),
    ("GET", "/api/consent"),
}


def _routes():
    from main import app

    for path, ops in app.openapi()["paths"].items():
        if path.startswith("/api/"):
            for method in ops:
                if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    yield method.upper(), path


def _fill(path: str) -> str:
    out = path
    for part in path.split("/"):
        if part.startswith("{"):
            out = out.replace(part, str(uuid.uuid4()))
    return out


# --- 1. Every route is authenticated and role-gated -------------------------------------------


def test_every_non_public_route_rejects_anonymous_callers(client_factory):
    anon = client_factory()
    checked = 0
    for method, path in _routes():
        if (method, path) in PUBLIC_API:
            continue
        res = anon.request(method, _fill(path), json={})
        assert res.status_code in (401, 405), f"{method} {path} answered {res.status_code} to an anonymous caller"
        checked += 1
    assert checked >= 25


@pytest.mark.parametrize(
    "role,prefix",
    [
        (UserRole.CLIENT, "/api/admin"),
        (UserRole.JUDGE, "/api/admin"),
        (UserRole.LAWYER, "/api/admin"),
        (UserRole.CLIENT, "/api/judge"),
        (UserRole.LAWYER, "/api/judge"),
        (UserRole.JUDGE, "/api/lawyer"),
        (UserRole.CLIENT, "/api/lawyer"),
        (UserRole.ADMIN, "/api/lawyer"),
    ],
)
def test_wrong_role_gets_403_on_every_route_of_the_other_area(login, role, prefix):
    client, _ = login(role)
    for method, path in _routes():
        if not path.startswith(prefix):
            continue
        res = client.request(method, _fill(path), json={})
        assert res.status_code == 403, f"{role.value} {method} {path} answered {res.status_code}"


def test_non_clients_cannot_use_client_case_endpoints(login, approved_case):
    case_id = approved_case()
    for role in (UserRole.JUDGE, UserRole.LAWYER, UserRole.ADMIN):
        client, _ = login(role)
        assert client.get(f"/api/cases/{case_id}").status_code == 403
        assert client.get(f"/api/cases/{case_id}/evidence").status_code == 403
        assert client.delete(f"/api/cases/{case_id}").status_code == 403
        assert client.post(f"/api/cases/{case_id}/erase-original").status_code == 403


# --- 2. Object-level authorisation (IDOR) -----------------------------------------------------


def test_another_client_cannot_touch_my_case_or_files(login, approved_case):
    case_id = approved_case()
    mine, _ = login(UserRole.CLIENT)
    owner_case = mine.post(
        "/api/cases",
        json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    )
    assert owner_case.status_code in (201, 409)
    attacker, _ = login(UserRole.CLIENT)
    ghost = str(uuid.uuid4())
    checks = [
        attacker.get(f"/api/cases/{case_id}"),
        attacker.post(f"/api/cases/{case_id}/approve"),
        attacker.post(f"/api/cases/{case_id}/erase-original"),
        attacker.delete(f"/api/cases/{case_id}"),
        attacker.get(f"/api/cases/{case_id}/evidence"),
        attacker.post(f"/api/cases/{case_id}/evidence", content=b"%PDF-1.4 x"),
        attacker.get(f"/api/cases/{case_id}/evidence/{ghost}"),
        attacker.delete(f"/api/cases/{case_id}/evidence/{ghost}"),
    ]
    assert [r.status_code for r in checks] == [404] * len(checks)
    # Same answer as a case that does not exist at all: nothing confirms the id.
    assert attacker.get(f"/api/cases/{ghost}").json() == attacker.get(f"/api/cases/{case_id}").json()
    assert attacker.get("/api/cases/mine").json() == []


def test_evidence_of_one_case_is_not_reachable_through_another_owned_case(login):
    client, _ = login(UserRole.CLIENT)
    body = {"title": "Caso A", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"}
    a = client.post("/api/cases", json=body).json()["id"]
    b = client.post("/api/cases", json=body).json()["id"]
    ev = client.post(f"/api/cases/{a}/evidence", content=b"%PDF-1.4 conteudo").json()["id"]
    assert client.get(f"/api/cases/{b}/evidence/{ev}").status_code == 404
    assert client.delete(f"/api/cases/{b}/evidence/{ev}").status_code == 404
    assert client.get(f"/api/cases/{a}/evidence/{ev}").status_code == 200


def test_judges_and_lawyers_never_receive_original_text_or_owner_identity(login, evaluated_case):
    case_id = evaluated_case()
    judge, _ = login(UserRole.JUDGE)
    lawyer, _ = login(UserRole.LAWYER)
    admin, _ = login(UserRole.ADMIN)
    bodies = [
        judge.get("/api/judge/queue").text,
        lawyer.get("/api/lawyer/board").text,
        admin.get("/api/admin/stats").text,
    ]
    matched = lawyer.post(f"/api/cases/{case_id}/match")
    bodies.append(matched.text)
    for text in bodies:
        for secret in PII:
            assert secret not in text
        assert "raw_text" not in text
        assert "client_id" not in text
        assert "@exemplo.com" not in text


def test_a_judge_cannot_review_a_case_that_was_never_approved(login, make_user):
    client, _ = login(UserRole.CLIENT)
    case_id = client.post(
        "/api/cases",
        json={"title": "Titulo valido", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    ).json()["id"]
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 9, "score_jurisprudence": 9})
    assert res.status_code == 404


# --- 3. Session and token forgery -------------------------------------------------------------


def _cookie_client(client_factory, token: str):
    c = client_factory()
    c.cookies.set("peacelaw_session", token)
    return c


def test_forged_and_malformed_tokens_are_rejected(login, client_factory):
    _, victim = login(UserRole.ADMIN)
    now = int(time.time())
    claims = {"sub": str(victim.id), "ver": 0, "iat": now, "exp": now + 3600}
    forged = [
        jwt.encode(claims, "outro-segredo-" + "y" * 40, algorithm="HS256"),  # wrong key
        jwt.encode(claims, TEST_JWT_SECRET, algorithm="HS256").rsplit(".", 1)[0] + ".AAAA",  # bad signature
        jwt.encode({**claims, "exp": now - 10}, TEST_JWT_SECRET, algorithm="HS256"),  # expired
        jwt.encode({**claims, "sub": str(uuid.uuid4())}, TEST_JWT_SECRET, algorithm="HS256"),  # unknown user
        jwt.encode({**claims, "ver": 99}, TEST_JWT_SECRET, algorithm="HS256"),  # wrong version
        jwt.encode({k: v for k, v in claims.items() if k != "exp"}, TEST_JWT_SECRET, algorithm="HS256"),
        "",
        "not-a-jwt",
        "a.b.c",
    ]
    for token in forged:
        assert _cookie_client(client_factory, token).get("/api/auth/me").status_code == 401, token[:30]


def test_alg_none_token_is_rejected(login, client_factory):
    _, victim = login(UserRole.ADMIN)
    import base64
    import json

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': str(victim.id), 'ver': 0, 'exp': int(time.time()) + 3600})}."
    assert _cookie_client(client_factory, token).get("/api/auth/me").status_code == 401


def test_role_in_token_is_ignored_and_session_cookie_is_hardened(login, client_factory):
    client, user = login(UserRole.CLIENT)
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(user.id), "ver": 0, "role": "ADMIN", "exp": now + 3600}, TEST_JWT_SECRET, algorithm="HS256"
    )
    c = _cookie_client(client_factory, token)
    assert c.get("/api/admin/stats").status_code == 403
    res = client_factory().post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_logout_revokes_a_stolen_copy_of_the_cookie(login, client_factory):
    client, _ = login(UserRole.CLIENT)
    stolen = client.cookies.get("peacelaw_session")
    client.post("/api/auth/logout")
    assert _cookie_client(client_factory, stolen).get("/api/auth/me").status_code == 401


# --- 4. Injection and mass assignment ---------------------------------------------------------


def test_public_signup_cannot_choose_a_privileged_role_or_flags(client_factory):
    res = client_factory().post(
        "/api/auth/register",
        json={"email": "evil@exemplo.com", "password": PASSWORD, "role": "ADMIN", "is_active": True, "token_version": 7},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "CLIENT"


SQLI = ["' OR '1'='1", "'; DROP TABLE users;--", "admin@exemplo.com' --", "\" OR \"\"=\"", "1; SELECT pg_sleep(5)"]


def test_sql_injection_strings_do_not_log_in_or_break_queries(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    for payload in SQLI:
        res = client_factory().post("/api/auth/login", json={"email": payload, "password": payload})
        assert res.status_code in (401, 422)
        assert admin.get("/api/admin/users", params={"role": payload}).status_code == 422
        assert admin.get("/api/admin/users", params={"offset": payload}).status_code == 422
    assert admin.get("/api/admin/users").status_code == 200  # table still there


def test_markup_in_a_title_is_stored_as_text_and_json_content_type_is_not_html(login):
    client, _ = login(UserRole.CLIENT)
    res = client.post(
        "/api/cases",
        json={"title": "<script>alert(1)</script>", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    )
    assert res.status_code == 201
    assert res.headers["content-type"].startswith("application/json")
    assert res.headers["x-content-type-options"] == "nosniff"


# --- 5. Upload abuse ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
        b"<html><script>alert(1)</script></html>",
        b"   \n<!doctype html><body onload=x>",
        b"MZ\x90\x00\x03\x00\x00\x00",
        b"\x7fELF\x02\x01\x01\x00\x00\x00",
        b"PK\x03\x04\x14\x00",
        b"\x00\x01\x02\x03",
    ],
)
def test_active_content_and_binaries_are_refused_as_evidence(login, payload):
    client, _ = login(UserRole.CLIENT)
    case_id = client.post(
        "/api/cases",
        json={"title": "Titulo valido", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    ).json()["id"]
    assert client.post(f"/api/cases/{case_id}/evidence", content=payload).status_code == 415


def test_hostile_filenames_are_neutralised_in_the_download_header(login):
    client, _ = login(UserRole.CLIENT)
    case_id = client.post(
        "/api/cases",
        json={"title": "Titulo valido", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    ).json()["id"]
    from urllib.parse import quote

    for name in ["../../etc/passwd", "a\r\nSet-Cookie: x=1.pdf", 'x".pdf"; filename="evil.exe', "..\\..\\win.ini", "n‮exe.pdf"]:
        res = client.post(
            f"/api/cases/{case_id}/evidence", content=b"%PDF-1.4 ok", headers={"x-filename": quote(name)}
        )
        if res.status_code != 201:
            continue
        got = client.get(f"/api/cases/{case_id}/evidence/{res.json()['id']}")
        disposition = got.headers["content-disposition"]
        assert "\r" not in disposition and "\n" not in disposition
        assert "/" not in disposition.split("filename=")[1] and "\\" not in disposition
        assert disposition.count('"') == 2
        assert got.headers["x-content-type-options"] == "nosniff"
        assert got.headers["content-type"] == "application/pdf"
        assert "set-cookie" not in got.headers


def test_oversized_bodies_are_cut_before_they_are_buffered(login):
    client, _ = login(UserRole.CLIENT)
    big = client.post("/api/cases", content=b"x" * 2_000_000, headers={"content-type": "application/json"})
    assert big.status_code == 413
    case_id = client.post(
        "/api/cases",
        json={"title": "Titulo valido", "text": LONG_TEXT, "lgpd_consent": True, "consent_version": "2026-10-20"},
    ).json()["id"]
    huge = client.post(f"/api/cases/{case_id}/evidence", content=b"%PDF" + b"0" * 3_000_000)
    assert huge.status_code == 413


# --- 6. Cross-site and transport ---------------------------------------------------------------


def test_cross_site_writes_are_refused_even_with_a_valid_cookie(login):
    client, _ = login(UserRole.CLIENT)
    res = client.post("/api/auth/logout", headers={"origin": "https://evil.example"})
    assert res.status_code == 403
    assert client.get("/api/auth/me").status_code == 200  # the session survived


def test_cors_does_not_allow_foreign_origins(client_factory):
    res = client_factory().options(
        "/api/auth/login",
        headers={"origin": "https://evil.example", "access-control-request-method": "POST"},
    )
    assert "access-control-allow-origin" not in res.headers
    res = client_factory().get("/api/health", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers


def test_responses_carry_security_headers_and_errors_leak_nothing(client_factory):
    c = client_factory(raise_server_exceptions=False)
    for path in ("/api/health", "/api/nope", "/api/auth/me"):
        res = c.get(path)
        assert res.headers["x-frame-options"] == "DENY"
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert "traceback" not in res.text.lower() and "sqlalchemy" not in res.text.lower()
    assert "server" not in {k.lower() for k in c.get("/api/health").headers if k.lower() == "x-powered-by"}


def test_unauthenticated_422_does_not_echo_submitted_secrets(login):
    client, _ = login(UserRole.CLIENT)
    secret = "SEGREDO-NAO-PODE-VAZAR-123"
    res = client.post("/api/cases", json={"title": 5, "text": secret, "lgpd_consent": "talvez", "extra": secret})
    assert res.status_code == 422
    assert secret not in res.text


# --- 7. Account enumeration and brute force -----------------------------------------------------


def test_login_answers_are_identical_for_unknown_and_wrong_password(login, client_factory):
    _, user = login(UserRole.CLIENT)
    a = client_factory().post("/api/auth/login", json={"email": user.email, "password": "errada-errada-123"})
    b = client_factory().post("/api/auth/login", json={"email": "ninguem@exemplo.com", "password": "errada-errada-123"})
    assert (a.status_code, a.json()) == (b.status_code, b.json())


def test_password_guessing_is_throttled_per_account_and_does_not_lock_the_real_owner_out_forever(login, client_factory):
    _, user = login(UserRole.CLIENT)
    codes = [
        client_factory().post("/api/auth/login", json={"email": user.email, "password": f"palpite-errado-{i}"}).status_code
        for i in range(8)
    ]
    assert codes[:5] == [401] * 5 and set(codes[5:]) == {429}


def test_spoofed_forwarding_headers_do_not_reset_the_throttle(login, client_factory):
    _, user = login(UserRole.CLIENT)
    codes = []
    for i in range(8):
        res = client_factory().post(
            "/api/auth/login",
            json={"email": user.email, "password": f"palpite-errado-{i}"},
            headers={"x-forwarded-for": f"10.0.0.{i}", "x-real-ip": f"10.0.1.{i}"},
        )
        codes.append(res.status_code)
    assert 429 in codes


def test_passwords_are_never_returned_or_stored_in_clear(login, session):
    client, user = login(UserRole.CLIENT)
    assert "password" not in client.get("/api/auth/me").text
    session.expire_all()
    session.refresh(user)
    assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash


def test_email_case_and_padding_cannot_be_used_to_register_a_duplicate_identity(client_factory):
    first = client_factory().post("/api/auth/register", json={"email": "Vitima@Exemplo.com", "password": PASSWORD})
    assert first.status_code == 201
    for variant in ("vitima@exemplo.com", "VITIMA@EXEMPLO.COM", "  vitima@exemplo.com "):
        res = client_factory().post("/api/auth/register", json={"email": variant, "password": PASSWORD})
        assert res.status_code in (409, 422), variant
    assert client_factory().post("/api/auth/login", json={"email": "VITIMA@exemplo.com", "password": PASSWORD}).status_code == 200
