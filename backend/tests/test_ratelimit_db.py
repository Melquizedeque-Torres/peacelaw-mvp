import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.models import RateLimitHit
from app.security import ratelimit, ratelimit_db


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def limiter(engine):
    clock = Clock()
    return ratelimit_db.DbRateLimiter(sessionmaker(bind=engine), clock=clock), clock


def test_blocks_after_limit_then_recovers(limiter):
    lim, clock = limiter
    assert [lim.hit("k", 2, 60) for _ in range(2)] == [0, 0]
    wait = lim.hit("k", 2, 60)
    assert wait == 60
    clock.now += 61
    assert lim.hit("k", 2, 60) == 0


def test_rejected_attempts_are_not_recorded(limiter, session):
    lim, _ = limiter
    for _ in range(5):
        lim.hit("k", 1, 60)
    assert len(session.scalars(select(RateLimitHit)).all()) == 1


def test_keys_are_stored_hashed_not_in_clear(limiter, session):
    lim, _ = limiter
    lim.hit("login:203.0.113.9:ana@exemplo.com", 5, 60)
    stored = session.scalar(select(RateLimitHit.key_hash))
    assert "203.0.113.9" not in stored and "ana@" not in stored and len(stored) == 64


def test_reset_and_reset_all(limiter):
    lim, _ = limiter
    lim.hit("a", 1, 60)
    lim.hit("b", 1, 60)
    lim.reset("a")
    assert lim.hit("a", 1, 60) == 0 and lim.hit("b", 1, 60) > 0
    lim.reset_all()
    assert lim.hit("b", 1, 60) == 0


def test_expired_rows_are_pruned(limiter, session):
    lim, clock = limiter
    lim.hit("old", 5, 60)
    clock.now += 4000
    lim.hit("new", 5, 60)
    keys = session.scalars(select(RateLimitHit.key_hash)).all()
    assert len(keys) == 1


def test_store_selection(monkeypatch):
    from app import config

    monkeypatch.delenv("RATE_LIMIT_STORE", raising=False)
    monkeypatch.setenv("APP_ENV", "production")
    assert config.rate_limit_store() == "db"
    monkeypatch.setenv("APP_ENV", "development")
    assert config.rate_limit_store() == "memory"
    monkeypatch.setenv("RATE_LIMIT_STORE", "db")
    assert config.rate_limit_store() == "db"


def test_enforce_uses_db_store_when_selected(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_STORE", "db")
    assert ratelimit.active_limiter() is ratelimit_db.get_limiter()
    monkeypatch.setenv("RATE_LIMIT_STORE", "memory")
    assert ratelimit.active_limiter() is ratelimit.limiter
