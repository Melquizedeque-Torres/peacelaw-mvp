import uuid

import pytest
from sqlalchemy import select

from app.models import AuditEvent, User, UserRole
from app.security import ratelimit
from tests.conftest import PASSWORD

NEW_PASSWORD = "nova-senha-forte-456"
SELF_MSG = 'Use "Alterar senha" para a própria conta.'
ADMIN_REQUIRED_MSG = "Informe sua senha para criar um administrador."
NEW_ADMIN = {"email": "novo.admin@exemplo.com", "role": "ADMIN", "password": "senha-forte-123"}


def _url(user_id) -> str:
    return f"/api/admin/users/{user_id}/reset-password"


def _body(admin_password: str = PASSWORD, new_password: str = NEW_PASSWORD) -> dict:
    return {"new_password": new_password, "admin_password": admin_password}


def _audit(session):
    session.expire_all()
    return list(session.scalars(select(AuditEvent)))


def _hash(session, user_id) -> str:
    session.expire_all()
    return session.scalar(select(User.password_hash).where(User.id == user_id))


# ---- reset password ----------------------------------------------------------------------


def test_reset_succeeds_kills_old_sessions_and_new_password_works(
    login, session, client_factory
):
    admin, admin_user = login(UserRole.ADMIN)
    judge_client, judge = login(UserRole.JUDGE)
    assert judge_client.get("/api/auth/me").status_code == 200
    before = _hash(session, judge.id)

    res = admin.post(_url(judge.id), json=_body())
    assert res.status_code == 204 and res.content == b""

    assert _hash(session, judge.id) != before
    assert judge_client.get("/api/auth/me").status_code == 401
    assert admin.get("/api/auth/me").status_code == 200
    fresh = client_factory()
    assert (
        fresh.post(
            "/api/auth/login", json={"email": judge.email, "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        fresh.post(
            "/api/auth/login", json={"email": judge.email, "password": NEW_PASSWORD}
        ).status_code
        == 200
    )
    rows = [r for r in _audit(session) if r.action == "user.reset_password"]
    assert len(rows) == 1
    assert rows[0].actor_id == admin_user.id and rows[0].target_id == judge.id


def test_reset_works_on_an_inactive_account_without_reactivating_it(login, session):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    assert admin.post(_url(judge.id), json=_body()).status_code == 204
    session.expire_all()
    assert session.scalar(select(User.is_active).where(User.id == judge.id)) is False


def test_reset_with_wrong_admin_password_is_400_and_changes_nothing(login, session):
    admin, _ = login(UserRole.ADMIN)
    judge_client, judge = login(UserRole.JUDGE)
    before = _hash(session, judge.id)
    res = admin.post(_url(judge.id), json=_body(admin_password="senha-errada-999"))
    assert res.status_code == 400 and res.json()["detail"] == "Senha atual incorreta."
    assert _hash(session, judge.id) == before
    assert judge_client.get("/api/auth/me").status_code == 200
    assert [r for r in _audit(session) if r.action == "user.reset_password"] == []


def test_reset_without_admin_password_is_422_and_does_not_echo(login, session):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    before = _hash(session, judge.id)
    res = admin.post(_url(judge.id), json={"new_password": NEW_PASSWORD})
    assert res.status_code == 422
    assert NEW_PASSWORD not in res.text
    assert _hash(session, judge.id) == before


def test_reset_short_new_password_is_422_and_does_not_echo(login, session):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    before = _hash(session, judge.id)
    res = admin.post(_url(judge.id), json=_body(new_password="curta-demais"[:11]))
    assert res.status_code == 422
    assert "curta-demai" not in res.text and PASSWORD not in res.text
    assert _hash(session, judge.id) == before
    assert admin.post(_url(judge.id), json=_body(new_password="x" * 129)).status_code == 422


def test_reset_never_echoes_passwords(login):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    res = admin.post(_url(judge.id), json=_body())
    assert NEW_PASSWORD not in res.text and PASSWORD not in res.text


def test_reset_self_is_409(login, session):
    admin, me = login(UserRole.ADMIN)
    before = _hash(session, me.id)
    res = admin.post(_url(me.id), json=_body())
    assert res.status_code == 409 and res.json()["detail"] == SELF_MSG
    assert _hash(session, me.id) == before
    assert admin.get("/api/auth/me").status_code == 200


def test_reset_unknown_id_is_404_without_audit(login, session):
    admin, _ = login(UserRole.ADMIN)
    res = admin.post(_url(uuid.uuid4()), json=_body())
    assert res.status_code == 404
    assert [r for r in _audit(session) if r.action == "user.reset_password"] == []


def test_reset_rbac(login, client_factory, session):
    _, target = login(UserRole.JUDGE)
    assert client_factory().post(_url(target.id), json=_body()).status_code == 401
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.LAWYER):
        client, _ = login(role)
        assert client.post(_url(target.id), json=_body()).status_code == 403
    assert _audit(session) == []


def test_sixth_wrong_stepup_is_429_with_retry_after_and_login_is_unaffected(
    login, client_factory
):
    admin, admin_user = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    codes = []
    last = None
    for _ in range(6):
        last = admin.post(_url(judge.id), json=_body(admin_password="errada-errada-1"))
        codes.append(last.status_code)
    assert codes == [400] * 5 + [429]
    assert int(last.headers["Retry-After"]) > 0
    # Even the correct password is now refused (every attempt counts).
    assert admin.post(_url(judge.id), json=_body()).status_code == 429
    # Own bucket: login and change-password are independent.
    res = client_factory().post(
        "/api/auth/login", json={"email": admin_user.email, "password": PASSWORD}
    )
    assert res.status_code == 200
    ch = admin.post(
        "/api/auth/change-password",
        json={"current_password": "x" * 12, "new_password": NEW_PASSWORD},
    )
    assert ch.status_code == 400


def test_stepup_bucket_is_per_admin(login):
    a1, _ = login(UserRole.ADMIN)
    a2, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    for _ in range(6):
        a1.post(_url(judge.id), json=_body(admin_password="errada-errada-1"))
    assert a1.post(_url(judge.id), json=_body()).status_code == 429
    assert a2.post(_url(judge.id), json=_body()).status_code == 204


def test_successful_attempts_count_towards_stepup_limit(login):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    for i in range(5):
        assert admin.post(_url(judge.id), json=_body(new_password=f"{NEW_PASSWORD}-{i}")).status_code == 204
    assert admin.post(_url(judge.id), json=_body()).status_code == 429


def test_stepup_env_override(login, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_STEPUP_PER_15MIN", "2")
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    codes = [
        admin.post(_url(judge.id), json=_body(admin_password="errada-errada-1")).status_code
        for _ in range(3)
    ]
    assert codes == [400, 400, 429]


# ---- step-up on ADMIN creation -----------------------------------------------------------


def _users(session):
    session.expire_all()
    return list(session.scalars(select(User.email)))


def test_create_admin_without_admin_password_is_422(login, session):
    admin, _ = login(UserRole.ADMIN)
    before = _users(session)
    res = admin.post("/api/admin/users", json=NEW_ADMIN)
    assert res.status_code == 422
    assert res.json()["errors"] == [{"field": "admin_password", "message": ADMIN_REQUIRED_MSG}]
    assert NEW_ADMIN["password"] not in res.text
    assert _users(session) == before
    for blank in ("", None):
        res = admin.post("/api/admin/users", json={**NEW_ADMIN, "admin_password": blank})
        assert res.status_code == 422, blank
    assert _users(session) == before
    lower = admin.post("/api/admin/users", json={**NEW_ADMIN, "role": "admin"})
    assert lower.status_code == 422
    assert _users(session) == before


def test_create_admin_with_wrong_admin_password_is_400_and_creates_nothing(login, session):
    admin, _ = login(UserRole.ADMIN)
    before = _users(session)
    res = admin.post(
        "/api/admin/users", json={**NEW_ADMIN, "admin_password": "errada-errada-1"}
    )
    assert res.status_code == 400 and res.json()["detail"] == "Senha atual incorreta."
    assert _users(session) == before
    assert [r for r in _audit(session) if r.action == "user.create"] == []


def test_create_admin_with_correct_admin_password_is_201(login, session, client_factory):
    admin, admin_user = login(UserRole.ADMIN)
    res = admin.post("/api/admin/users", json={**NEW_ADMIN, "admin_password": PASSWORD})
    assert res.status_code == 201, res.text
    assert res.json()["role"] == "ADMIN"
    assert "password" not in res.text
    created = client_factory().post(
        "/api/auth/login",
        json={"email": NEW_ADMIN["email"], "password": NEW_ADMIN["password"]},
    )
    assert created.status_code == 200
    rows = [r for r in _audit(session) if r.action == "user.create"]
    assert len(rows) == 1 and rows[0].actor_id == admin_user.id


def test_create_admin_stepup_is_rate_limited(login):
    admin, _ = login(UserRole.ADMIN)
    codes = [
        admin.post(
            "/api/admin/users", json={**NEW_ADMIN, "admin_password": "errada-errada-1"}
        ).status_code
        for _ in range(6)
    ]
    assert codes == [400] * 5 + [429]


@pytest.mark.parametrize("role", ["JUDGE", "LAWYER"])
def test_create_judge_or_lawyer_does_not_need_or_use_admin_password(login, session, role):
    admin, _ = login(UserRole.ADMIN)
    payload = {"email": f"{role.lower()}@exemplo.com", "role": role, "password": "senha-forte-123"}
    assert admin.post("/api/admin/users", json=payload).status_code == 201
    # A wrong admin_password sent for these roles is ignored: never verified, never counted.
    for i in range(6):
        other = {**payload, "email": f"outro{i}-{role.lower()}@exemplo.com", "admin_password": "errada"}
        assert admin.post("/api/admin/users", json=other).status_code == 201
    adm = {**NEW_ADMIN, "admin_password": PASSWORD}
    assert admin.post("/api/admin/users", json=adm).status_code == 201


# ---- Task 1 deferred hardening ------------------------------------------------------------


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_deactivate_and_reactivate_rbac(login, client_factory, session, action):
    _, target = login(UserRole.JUDGE)
    url = f"/api/admin/users/{target.id}/{action}"
    assert client_factory().post(url).status_code == 401
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.LAWYER):
        client, _ = login(role)
        assert client.post(url).status_code == 403
    assert _audit(session) == []


def test_login_of_inactive_user_with_correct_password_does_not_reset_the_bucket(
    login, client_factory, monkeypatch
):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    calls: list[tuple] = []
    monkeypatch.setattr(ratelimit, "reset_login", lambda *a, **k: calls.append(a))
    res = client_factory().post(
        "/api/auth/login", json={"email": judge.email, "password": PASSWORD}
    )
    assert res.status_code == 401
    assert calls == []


# ---- step-up on deactivating / reactivating ADMIN accounts -------------------------------

ADMIN_TARGET_MSG = "Informe sua senha para alterar um administrador."


def _toggle_url(user_id, action: str) -> str:
    return f"/api/admin/users/{user_id}/{action}"


def _is_active(session, user_id) -> bool:
    session.expire_all()
    return session.scalar(select(User.is_active).where(User.id == user_id))


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_admin_target_without_password_is_422_and_changes_nothing(
    action, login, make_user, session
):
    admin, _ = login(UserRole.ADMIN)
    target = make_user(UserRole.ADMIN)
    if action == "reactivate":
        assert admin.post(
            _toggle_url(target.id, "deactivate"), json={"admin_password": PASSWORD}
        ).status_code == 204
    before_active = _is_active(session, target.id)
    before_audit = len(_audit(session))
    for kwargs in ({}, {"json": {}}, {"json": {"admin_password": ""}}, {"json": {"admin_password": None}}):
        res = admin.post(_toggle_url(target.id, action), **kwargs)
        assert res.status_code == 422, kwargs
        assert res.json()["errors"] == [
            {"field": "admin_password", "message": ADMIN_TARGET_MSG}
        ]
    assert _is_active(session, target.id) == before_active
    assert len(_audit(session)) == before_audit


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_admin_target_with_wrong_password_is_400_and_changes_nothing(
    action, login, make_user, session
):
    admin, _ = login(UserRole.ADMIN)
    target = make_user(UserRole.ADMIN)
    if action == "reactivate":
        admin.post(_toggle_url(target.id, "deactivate"), json={"admin_password": PASSWORD})
    before_active = _is_active(session, target.id)
    before_audit = len(_audit(session))
    res = admin.post(
        _toggle_url(target.id, action), json={"admin_password": "errada-errada-1"}
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Senha atual incorreta."
    assert _is_active(session, target.id) == before_active
    # Only the failed-attempt signal is recorded; the toggle itself leaves no row.
    new_rows = _audit(session)[before_audit:]
    assert [r.action for r in new_rows] == ["admin.stepup_failed"]


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_admin_target_with_right_password_works_and_audits_once(
    action, login, make_user, session
):
    admin, admin_user = login(UserRole.ADMIN)
    target = make_user(UserRole.ADMIN)
    if action == "reactivate":
        admin.post(_toggle_url(target.id, "deactivate"), json={"admin_password": PASSWORD})
    res = admin.post(_toggle_url(target.id, action), json={"admin_password": PASSWORD})
    assert res.status_code == 204
    assert _is_active(session, target.id) is (action == "reactivate")
    rows = [r for r in _audit(session) if r.action == f"user.{action}"]
    assert len(rows) == 1 and rows[0].actor_id == admin_user.id


@pytest.mark.parametrize("action", ["deactivate", "reactivate"])
def test_admin_target_wrong_passwords_hit_the_stepup_limit(action, login, make_user):
    admin, _ = login(UserRole.ADMIN)
    target = make_user(UserRole.ADMIN)
    codes = [
        admin.post(
            _toggle_url(target.id, action), json={"admin_password": "errada-errada-1"}
        ).status_code
        for _ in range(6)
    ]
    assert codes == [400] * 5 + [429]
    res = admin.post(_toggle_url(target.id, action), json={"admin_password": PASSWORD})
    assert res.status_code == 429


def test_non_admin_target_stays_bodyless_and_ignores_a_wrong_password(
    login, make_user, session
):
    admin, _ = login(UserRole.ADMIN)
    judge = make_user(UserRole.JUDGE)
    assert admin.post(_toggle_url(judge.id, "deactivate")).status_code == 204
    assert admin.post(_toggle_url(judge.id, "reactivate")).status_code == 204
    # No step-up for non-admin targets: a wrong value is not even checked.
    res = admin.post(_toggle_url(judge.id, "deactivate"), json={"admin_password": "x"})
    assert res.status_code == 204


def test_self_deactivate_is_409_even_without_a_password(login, session):
    admin, me = login(UserRole.ADMIN)
    res = admin.post(_toggle_url(me.id, "deactivate"))
    assert res.status_code == 409
    assert _is_active(session, me.id) is True


def test_unknown_target_is_404_before_any_stepup(login):
    admin, _ = login(UserRole.ADMIN)
    missing = uuid.uuid4()
    assert admin.post(_toggle_url(missing, "deactivate")).status_code == 404
    assert admin.post(_toggle_url(missing, "reactivate")).status_code == 404
