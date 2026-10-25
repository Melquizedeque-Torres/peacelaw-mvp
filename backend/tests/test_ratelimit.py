import pytest

from app.security import ratelimit
from app.security.ratelimit import SlidingWindowLimiter
from tests.conftest import PASSWORD

MSG = "Muitas tentativas. Tente novamente mais tarde."


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    c = FakeClock()
    monkeypatch.setattr(ratelimit.limiter, "_clock", c)
    return c


def test_limiter_blocks_then_recovers_after_window():
    c = FakeClock()
    lim = SlidingWindowLimiter(clock=c)
    assert all(lim.hit("k", 3, 60) == 0 for _ in range(3))
    wait = lim.hit("k", 3, 60)
    assert wait == 60
    c.now += 30
    assert lim.hit("k", 3, 60) == 30
    c.now += 31
    assert lim.hit("k", 3, 60) == 0


def test_limiter_reset_and_independent_keys():
    lim = SlidingWindowLimiter(clock=FakeClock())
    for _ in range(2):
        lim.hit("a", 2, 60)
    assert lim.hit("a", 2, 60) > 0
    assert lim.hit("b", 2, 60) == 0
    lim.reset("a")
    assert lim.hit("a", 2, 60) == 0


def _bad(client, email="x@exemplo.com"):
    return client.post("/api/auth/login", json={"email": email, "password": "errada"})


def test_login_blocks_sixth_attempt_with_headers(client_factory, clock):
    client = client_factory()
    for _ in range(5):
        assert _bad(client).status_code == 401
    res = _bad(client)
    assert res.status_code == 429
    assert res.json() == {"detail": MSG}
    assert int(res.headers["retry-after"]) == 15 * 60
    assert res.headers["x-content-type-options"] == "nosniff"
    clock.now += 15 * 60 + 1
    assert _bad(client).status_code == 401


def test_login_email_is_normalized_and_other_email_unaffected(client_factory, clock):
    client = client_factory()
    for _ in range(5):
        _bad(client, "Mixed@Exemplo.com")
    assert _bad(client, "mixed@exemplo.com").status_code == 429
    assert _bad(client, "outro@exemplo.com").status_code == 401


def test_successful_login_resets_pair_counter(client_factory, make_user, clock):
    user = make_user()
    client = client_factory()
    for _ in range(4):
        assert _bad(client, user.email).status_code == 401
    ok = client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})
    assert ok.status_code == 200
    for _ in range(5):
        assert _bad(client, user.email).status_code == 401
    assert _bad(client, user.email).status_code == 429


def test_login_per_ip_limit(client_factory, clock):
    client = client_factory()
    for i in range(30):
        assert _bad(client, f"u{i}@exemplo.com").status_code == 401
    assert _bad(client, "novo@exemplo.com").status_code == 429


def test_login_limits_configurable(client_factory, clock, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_LOGIN_PER_15MIN", "2")
    client = client_factory()
    assert _bad(client).status_code == 401
    assert _bad(client).status_code == 401
    assert _bad(client).status_code == 429


def test_register_limited_per_ip_per_hour(client_factory, clock):
    client = client_factory()
    for i in range(5):
        res = client.post(
            "/api/auth/register", json={"email": f"n{i}@exemplo.com", "password": PASSWORD}
        )
        assert res.status_code == 201
    res = client.post("/api/auth/register", json={"email": "n9@exemplo.com", "password": PASSWORD})
    assert res.status_code == 429
    assert res.json() == {"detail": MSG}
    assert int(res.headers["retry-after"]) == 3600
    clock.now += 3601
    res = client.post("/api/auth/register", json={"email": "n9@exemplo.com", "password": PASSWORD})
    assert res.status_code == 201


def test_expired_keys_are_reclaimed_after_window():
    c = FakeClock()
    lim = SlidingWindowLimiter(clock=c)
    for i in range(100):
        lim.hit(f"k{i}", 3, 60)
    assert len(lim) == 100
    c.now += 61
    lim.hit("fresh", 3, 60)  # any call past the sweep interval reclaims expired keys
    assert len(lim) == 1


def test_key_cap_holds_and_evicts_stalest():
    c = FakeClock()
    lim = SlidingWindowLimiter(clock=c, max_keys=50)
    for i in range(500):
        c.now += 0.001
        lim.hit(f"k{i}", 3, 3600)
    assert len(lim) <= 50
    assert "k499" in lim._hits and "k0" not in lim._hits


def test_cap_is_configurable_by_env(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_MAX_KEYS", "10")
    lim = SlidingWindowLimiter(clock=FakeClock())
    for i in range(100):
        lim.hit(f"k{i}", 3, 3600)
    assert len(lim) <= 10


def test_blocked_ip_does_not_create_pair_keys(monkeypatch):
    from types import SimpleNamespace

    from fastapi import HTTPException

    lim = SlidingWindowLimiter(clock=FakeClock())
    monkeypatch.setattr(ratelimit, "limiter", lim)
    req = SimpleNamespace(client=SimpleNamespace(host="9.9.9.9"))
    for i in range(30):
        ratelimit.check_login(req, f"u{i}@exemplo.com")
    before = len(lim)
    for i in range(1000):
        with pytest.raises(HTTPException):
            ratelimit.check_login(req, f"spam{i}@exemplo.com")
    assert len(lim) == before
