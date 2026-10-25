from sqlalchemy import select, update

from app.models import AuditEvent, User, UserRole
from app.security.passwords import verify_password
from tests.conftest import PASSWORD

NEW = "uma-senha-nova-bem-longa-1"
URL = "/api/auth/change-password"


def _audit(session):
    session.expire_all()
    return list(session.scalars(select(AuditEvent)))


def test_changes_password_revokes_other_sessions_and_keeps_this_one(
    login, client_factory, session
):
    client, user = login(UserRole.JUDGE)
    other = client_factory()
    res = other.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 200
    assert other.get("/api/auth/me").status_code == 200
    res = client.post(URL, json={"current_password": PASSWORD, "new_password": NEW})
    assert res.status_code == 204
    assert res.content == b""
    assert "peacelaw_session=" in res.headers["set-cookie"]
    session.refresh(user)
    assert verify_password(NEW, user.password_hash)
    assert not verify_password(PASSWORD, user.password_hash)
    assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200  # a fresh cookie was issued


def test_wrong_current_password_is_rejected(login, session):
    client, user = login(UserRole.CLIENT)
    res = client.post(URL, json={"current_password": "errada-errada-1", "new_password": NEW})
    assert res.status_code == 400 and res.json()["detail"] == "Senha atual incorreta."
    session.refresh(user)
    assert verify_password(PASSWORD, user.password_hash)


def test_requires_login_and_validates_length(login, client_factory):
    anon = client_factory()
    assert anon.post(URL, json={"current_password": "a", "new_password": NEW}).status_code == 401
    client, _ = login(UserRole.CLIENT)
    short = client.post(URL, json={"current_password": PASSWORD, "new_password": "curta"})
    assert short.status_code == 422
    assert "curta" not in short.text


def test_is_rate_limited(login):
    client, _ = login(UserRole.CLIENT)
    codes = [
        client.post(URL, json={"current_password": "x" * 12, "new_password": NEW}).status_code
        for _ in range(7)
    ]
    assert codes[:5] == [400] * 5 and codes[-1] == 429


def test_sixth_call_is_429_and_login_bucket_is_separate(login, client_factory):
    client, user = login(UserRole.CLIENT)
    codes = [
        client.post(URL, json={"current_password": "x" * 12, "new_password": NEW}).status_code
        for _ in range(6)
    ]
    assert codes == [400] * 5 + [429]
    other = client_factory()
    res = other.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 200


def test_successful_attempts_count_towards_the_limit(login):
    client, _ = login(UserRole.CLIENT)
    current = PASSWORD
    for i in range(5):
        new = f"{NEW}-{i}"
        res = client.post(URL, json={"current_password": current, "new_password": new})
        assert res.status_code == 204
        current = new
    res = client.post(URL, json={"current_password": current, "new_password": NEW})
    assert res.status_code == 429


def test_audits_exactly_once_on_success_and_not_on_wrong_password(login, session):
    client, user = login(UserRole.LAWYER)
    bad = client.post(URL, json={"current_password": "errada-errada-1", "new_password": NEW})
    assert bad.status_code == 400
    assert _audit(session) == []
    assert client.post(URL, json={"current_password": PASSWORD, "new_password": NEW}).status_code == 204
    rows = _audit(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "user.change_password"
    assert row.actor_id == user.id and row.target_id == user.id
    assert user.email not in str(row.__dict__) and NEW not in str(row.__dict__)


def test_concurrent_revoke_wins_and_hash_is_unchanged(login, session, monkeypatch):
    from app.routers import auth as auth_router

    client, user = login(UserRole.JUDGE)
    original_hash = user.password_hash
    real = auth_router.verify_password

    def racing(password, hashed):
        ok = real(password, hashed)
        session.execute(
            update(User)
            .where(User.id == user.id)
            .values(token_version=User.token_version + 1)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        return ok

    monkeypatch.setattr(auth_router, "verify_password", racing)
    res = client.post(URL, json={"current_password": PASSWORD, "new_password": NEW})
    assert res.status_code == 401
    session.expire_all()
    assert session.get(User, user.id).password_hash == original_hash
    assert _audit(session) == []
