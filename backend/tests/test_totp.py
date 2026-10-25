import time

import pytest
from sqlalchemy import select

from app.models import AuditEvent, RecoveryCode, User, UserRole
from app.security import totp
from tests.conftest import PASSWORD


def _enroll(client, user_email_client_factory=None):
    secret = client.post("/api/auth/totp/setup", json={"password": PASSWORD}).json()["secret"]
    step = totp.current_step()
    res = client.post("/api/auth/totp/enable", json={"code": totp.code_at(secret, step)})
    assert res.status_code == 200, res.text
    return secret, step, res.json()["recovery_codes"]


def test_rfc6238_reference_vector():
    # RFC 6238 appendix B, SHA-1 secret "12345678901234567890", T=59 -> 94287082 (8 digits); last 6 digits match.
    import base64

    secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
    assert totp.code_at(secret, 59 // 30) == "287082"


def test_match_step_window_and_malformed_codes():
    secret = totp.new_secret()
    now = 1_700_000_000
    step = totp.current_step(now)
    assert totp.match_step(secret, totp.code_at(secret, step), now) == step
    assert totp.match_step(secret, totp.code_at(secret, step - 1), now) == step - 1
    assert totp.match_step(secret, totp.code_at(secret, step + 2), now) is None
    for bad in ("", "12345", "1234567", "abcdef", "12 34 5x"):
        assert totp.match_step(secret, bad, now) is None


def test_setup_needs_the_password_and_enable_needs_a_valid_code(login):
    client, _ = login(UserRole.ADMIN)
    assert client.post("/api/auth/totp/setup", json={"password": "errada-errada-12"}).status_code == 400
    secret = client.post("/api/auth/totp/setup", json={"password": PASSWORD}).json()["secret"]
    assert client.post("/api/auth/totp/enable", json={"code": "000000"}).status_code == 400
    assert client.get("/api/auth/totp").json() == {"enabled": False, "recovery_codes_left": 0}
    ok = client.post("/api/auth/totp/enable", json={"code": totp.code_at(secret, totp.current_step())})
    assert ok.status_code == 200 and len(ok.json()["recovery_codes"]) == 8
    assert client.get("/api/auth/totp").json() == {"enabled": True, "recovery_codes_left": 8}


def test_secret_is_encrypted_at_rest_and_recovery_codes_are_hashed(login, session):
    client, user = login(UserRole.ADMIN)
    secret, _, codes = _enroll(client)
    raw = session.execute(
        __import__("sqlalchemy").text("select totp_secret from users where id = :i"), {"i": user.id.hex}
    ).scalar()
    assert raw and secret not in raw
    hashes = [r.code_hash for r in session.scalars(select(RecoveryCode))]
    assert len(hashes) == 8 and not set(codes) & set(hashes)


def test_login_requires_the_second_factor_once_enabled(login, client_factory):
    client, user = login(UserRole.ADMIN)
    secret, used_step, _ = _enroll(client)
    fresh = client_factory()
    res = fresh.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 401 and res.json()["totp_required"] is True
    assert fresh.get("/api/auth/me").status_code == 401  # no session was started
    wrong = fresh.post("/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": "000000"})
    assert wrong.status_code == 401 and wrong.json()["totp_required"] is True
    # The code used to enable is already burnt: replay is refused, a newer step passes.
    replay = fresh.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": totp.code_at(secret, used_step)}
    )
    assert replay.status_code == 401
    newer = totp.current_step() + 1
    ok = fresh.post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": totp.code_at(secret, newer)}
    )
    assert ok.status_code == 200
    assert fresh.get("/api/auth/me").status_code == 200


def test_wrong_password_never_reaches_the_second_factor_prompt(login, client_factory):
    client, user = login(UserRole.ADMIN)
    _enroll(client)
    res = client_factory().post("/api/auth/login", json={"email": user.email, "password": "errada-errada-123"})
    assert res.status_code == 401 and "totp_required" not in res.json()


def test_recovery_code_works_once(login, client_factory):
    client, user = login(UserRole.ADMIN)
    _, _, codes = _enroll(client)
    body = {"email": user.email, "password": PASSWORD, "totp_code": codes[0]}
    assert client_factory().post("/api/auth/login", json=body).status_code == 200
    assert client_factory().post("/api/auth/login", json=body).status_code == 401
    other = {**body, "totp_code": codes[1].upper()}
    assert client_factory().post("/api/auth/login", json=other).status_code == 200


def test_second_factor_guessing_is_throttled_per_account(login, client_factory):
    client, user = login(UserRole.ADMIN)
    _enroll(client)
    codes = []
    for i in range(8):
        res = client_factory().post(
            "/api/auth/login",
            json={"email": user.email, "password": PASSWORD, "totp_code": f"{i:06d}"},
            headers={"x-forwarded-for": f"10.1.1.{i}"},
        )
        codes.append(res.status_code)
    assert 429 in codes


def test_enabling_ends_other_sessions_and_disabling_needs_password_and_code(login, client_factory):
    client, user = login(UserRole.ADMIN)
    other = client_factory()
    other.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    secret, _, codes = _enroll(client)
    assert other.get("/api/auth/me").status_code == 401  # other sessions ended
    assert client.get("/api/auth/me").status_code == 200  # this browser stays signed in
    bad_pw = client.post("/api/auth/totp/disable", json={"password": "errada-errada-123", "code": codes[0]})
    assert bad_pw.status_code == 400
    bad_code = client.post("/api/auth/totp/disable", json={"password": PASSWORD, "code": "000000"})
    assert bad_code.status_code == 400
    ok = client.post("/api/auth/totp/disable", json={"password": PASSWORD, "code": codes[0]})
    assert ok.status_code == 204
    assert client_factory().post("/api/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 200
    assert client.get("/api/auth/totp").json() == {"enabled": False, "recovery_codes_left": 0}


def test_admin_can_reset_a_locked_out_users_factor_with_step_up(login, make_user, client_factory, session):
    admin, _ = login(UserRole.ADMIN)
    target = make_user(UserRole.JUDGE)
    judge = client_factory()
    judge.post("/api/auth/login", json={"email": target.email, "password": PASSWORD})
    _enroll(judge)
    assert admin.post(f"/api/admin/users/{target.id}/reset-totp", json={"admin_password": "errada-errada-123"}).status_code == 400
    assert admin.post(f"/api/admin/users/{target.id}/reset-totp", json={}).status_code == 422
    assert admin.post(f"/api/admin/users/{target.id}/reset-totp", json={"admin_password": PASSWORD}).status_code == 204
    assert client_factory().post("/api/auth/login", json={"email": target.email, "password": PASSWORD}).status_code == 200
    session.expire_all()
    actions = [e.action for e in session.scalars(select(AuditEvent))]
    assert "user.totp_reset" in actions and "user.totp_enable" in actions


def test_only_admins_can_reset_a_factor(login, make_user):
    judge, _ = login(UserRole.JUDGE)
    victim = make_user(UserRole.LAWYER)
    assert judge.post(f"/api/admin/users/{victim.id}/reset-totp", json={"admin_password": PASSWORD}).status_code == 403


def test_setup_and_several_logins_do_not_exhaust_the_login_bucket(login, client_factory):
    client, user = login(UserRole.ADMIN)
    secret, step, codes = _enroll(client)
    for i in range(6):
        res = client_factory().post(
            "/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": codes[i]}
        )
        assert res.status_code == 200, (i, res.status_code)


def test_a_successful_login_clears_earlier_second_factor_failures(login, client_factory):
    client, user = login(UserRole.ADMIN)
    _, _, codes = _enroll(client)
    for i in range(4):
        client_factory().post("/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": f"{i:06d}"})
    assert client_factory().post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": codes[0]}
    ).status_code == 200
    for i in range(4):
        res = client_factory().post(
            "/api/auth/login", json={"email": user.email, "password": PASSWORD, "totp_code": f"{i + 10:06d}"}
        )
        assert res.status_code == 401
