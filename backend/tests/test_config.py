import pytest

from app.config import get_database_url


def test_rewrites_plain_postgres_scheme_to_psycopg(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host/db?sslmode=require")
    assert get_database_url() == "postgresql+psycopg://u:p@host/db?sslmode=require"


def test_keeps_explicit_driver(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    assert get_database_url() == "sqlite+pysqlite:///:memory:"


def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        get_database_url()


from app.config import cookie_secure, get_jwt_secret, get_raw_text_keys


def test_jwt_secret_must_be_long(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "curto")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        get_jwt_secret()


def test_raw_text_keys_are_split_and_required(monkeypatch):
    monkeypatch.setenv("RAW_TEXT_KEYS", " k1 , k2 ,")
    assert get_raw_text_keys() == ["k1", "k2"]
    monkeypatch.setenv("RAW_TEXT_KEYS", "")
    with pytest.raises(RuntimeError, match="RAW_TEXT_KEYS"):
        get_raw_text_keys()


def test_cookie_secure_defaults_to_true(monkeypatch):
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    assert cookie_secure() is True
    monkeypatch.setenv("COOKIE_SECURE", "")
    assert cookie_secure() is True
    monkeypatch.setenv("COOKIE_SECURE", "true")
    assert cookie_secure() is True
    monkeypatch.setenv("COOKIE_SECURE", "0")  # only the literal "false" opts out
    assert cookie_secure() is True


def test_cookie_secure_can_be_disabled_only_with_false(monkeypatch):
    for value in ("false", "FALSE", " False "):
        monkeypatch.setenv("COOKIE_SECURE", value)
        assert cookie_secure() is False
