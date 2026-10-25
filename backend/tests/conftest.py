from app.consent import CONSENT_VERSION
import uuid

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers tables on Base.metadata)
from app.db import Base, _session_factory, get_engine, get_session
from app.models import User, UserRole
from app.security.passwords import hash_password
from app.security.crypto import _fernet

TEST_JWT_SECRET = "segredo-de-teste-" + "x" * 40
TEST_RAW_TEXT_KEY = Fernet.generate_key().decode()


@pytest.fixture(autouse=True)
def _isolate_database_url(monkeypatch):
    """Guarantee no test can fall through to the real (Neon) database."""
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("RAW_TEXT_KEYS", TEST_RAW_TEXT_KEY)
    # The test client talks plain http, which never resends Secure cookies.
    monkeypatch.setenv("COOKIE_SECURE", "false")
    get_engine.cache_clear()
    _session_factory.cache_clear()
    _fernet.cache_clear()
    yield
    get_engine.cache_clear()
    _session_factory.cache_clear()
    _fernet.cache_clear()


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with sessionmaker(bind=engine, expire_on_commit=False)() as s:
        yield s


PASSWORD = "senha-forte-123"


@pytest.fixture
def make_user(session):
    def _make(role=UserRole.CLIENT, email=None, password=PASSWORD):
        user = User(
            email=email or f"{role.value.lower()}-{uuid.uuid4().hex[:8]}@exemplo.com",
            role=role,
            password_hash=hash_password(password),
        )
        session.add(user)
        session.commit()
        return user

    return _make


@pytest.fixture
def client_factory(session):
    from main import app

    app.dependency_overrides[get_session] = lambda: session
    clients: list[TestClient] = []

    def _client(raise_server_exceptions: bool = True) -> TestClient:
        client = TestClient(app, raise_server_exceptions=raise_server_exceptions)
        clients.append(client)
        return client

    yield _client
    for client in clients:
        client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def login(make_user, client_factory):
    def _login(role=UserRole.CLIENT, raise_server_exceptions=True, **kw):
        password = kw.pop("password", PASSWORD)
        user = make_user(role, password=password, **kw)
        client = client_factory(raise_server_exceptions)
        res = client.post("/api/auth/login", json={"email": user.email, "password": password})
        assert res.status_code == 200, res.text
        return client, user

    return _login


CASE_TITLE = "Obra abandonada por Carlos Menezes"
CASE_TEXT = (
    "O responsável, Carlos Menezes, abandonou a obra. Paguei R$ 18.400. "
    "Meu CPF é 123.456.789-00 e meu telefone é (11) 98765-4321."
)
PII = ("Carlos Menezes", "18.400", "123.456.789-00", "98765-4321")


def assert_no_pii(text: str) -> None:
    for secret in PII:
        assert secret not in text


@pytest.fixture
def approved_case(login):
    def _make() -> str:
        client, _ = login(UserRole.CLIENT)
        case_id = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT, "lgpd_consent": True, "consent_version": CONSENT_VERSION}).json()["id"]
        assert client.post(f"/api/cases/{case_id}/approve").status_code == 200
        return case_id

    return _make


@pytest.fixture
def evaluated_case(login, approved_case):
    def _make(evidence: int = 8, jurisprudence: int = 6) -> str:
        case_id = approved_case()
        judge, _ = login(UserRole.JUDGE)
        res = judge.post(
            f"/api/cases/{case_id}/reviews",
            json={"score_evidence": evidence, "score_jurisprudence": jurisprudence},
        )
        assert res.status_code == 201, res.text
        return case_id

    return _make


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from app.security import ratelimit

    ratelimit.limiter.reset_all()
    yield
    ratelimit.limiter.reset_all()
