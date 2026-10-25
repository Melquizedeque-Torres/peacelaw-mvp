import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from app.deps import SESSION_COOKIE
from app.models import User, UserRole
from app.security.tokens import create_access_token
from tests.conftest import PASSWORD, TEST_JWT_SECRET


def test_register_creates_client_with_session(client_factory, session):
    client = client_factory()
    res = client.post(
        "/api/auth/register", json={"email": "  Nova@Exemplo.com ", "password": PASSWORD}
    )
    assert res.status_code == 201
    assert res.json() == {"id": res.json()["id"], "email": "nova@exemplo.com", "role": "CLIENT"}
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert client.get("/api/auth/me").json()["email"] == "nova@exemplo.com"
    stored = session.scalar(select(User).where(User.email == "nova@exemplo.com"))
    assert stored.password_hash.startswith("$argon2")


def test_register_ignores_requested_role(client_factory):
    res = client_factory().post(
        "/api/auth/register",
        json={"email": "esperto@exemplo.com", "password": PASSWORD, "role": "JUDGE"},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "CLIENT"


def test_register_rejects_duplicate_email(client_factory, make_user):
    make_user(email="dup@exemplo.com")
    res = client_factory().post(
        "/api/auth/register", json={"email": "DUP@exemplo.com", "password": PASSWORD}
    )
    assert res.status_code == 409
    assert res.json() == {"detail": "E-mail já cadastrado."}


def test_register_validation_never_echoes_password(client_factory):
    res = client_factory().post(
        "/api/auth/register", json={"email": "a@exemplo.com", "password": "curta-xyz"}
    )
    assert res.status_code == 422
    assert "curta-xyz" not in res.text
    assert all(set(item) == {"field", "message"} for item in res.json()["errors"])


def test_login_and_me(login):
    client, user = login(UserRole.JUDGE)
    assert client.get("/api/auth/me").json() == {
        "id": str(user.id), "email": user.email, "role": "JUDGE",
    }


def test_wrong_password_and_unknown_email_get_the_same_answer(client_factory, make_user):
    make_user(email="x@exemplo.com")
    client = client_factory()
    wrong = client.post("/api/auth/login", json={"email": "x@exemplo.com", "password": "errada-123456"})
    unknown = client.post("/api/auth/login", json={"email": "ninguem@exemplo.com", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "E-mail ou senha inválidos."}
    assert "set-cookie" not in wrong.headers


def test_me_requires_a_session(client_factory):
    res = client_factory().get("/api/auth/me")
    assert res.status_code == 401
    assert res.json() == {"detail": "Não autenticado."}


def test_invalid_tokens_are_rejected(client_factory, make_user):
    user = make_user()
    client = client_factory()
    expired = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    for token in (create_access_token(user.id) + "x", expired, create_access_token(uuid.uuid4())):
        client.cookies.set(SESSION_COOKIE, token)
        assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_the_session(login):
    client, _ = login()
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_role_comes_from_the_database_not_the_token(login, session):
    client, user = login(UserRole.LAWYER)
    user.role = UserRole.CLIENT
    session.commit()
    assert client.get("/api/auth/me").json()["role"] == "CLIENT"


def test_session_cookie_is_secure_by_default(client_factory, make_user, monkeypatch):
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    user = make_user()
    client = client_factory()
    res = client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()

    out = client.post("/api/auth/logout")
    assert out.status_code == 204
    cleared = out.headers["set-cookie"]
    assert cleared.startswith(f'{SESSION_COOKIE}="";') or cleared.startswith(f"{SESSION_COOKIE}=;")
    assert "Max-Age=0" in cleared or "expires=Thu, 01 Jan 1970" in cleared.replace("Expires", "expires")
    assert "Secure" in cleared and "HttpOnly" in cleared and "samesite=lax" in cleared.lower()
    assert "Path=/" in cleared


def test_cookie_secure_false_drops_the_flag(client_factory, make_user):
    user = make_user()
    res = client_factory().post(
        "/api/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert "Secure" not in res.headers["set-cookie"]
