"""In-memory sliding-window rate limiter.

State lives in this process only: with N uvicorn workers the effective limit is
N times higher, and a restart clears it. Production should also rate-limit at
the edge (reverse proxy / WAF) or swap this for a shared store such as Redis.
"""

import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request, status

from app.config import rate_limit, rate_limit_store

TOO_MANY = "Muitas tentativas. Tente novamente mais tarde."
LOGIN_WINDOW = 15 * 60
REGISTER_WINDOW = 60 * 60


SWEEP_INTERVAL = 60.0


class SlidingWindowLimiter:
    """Memory is bounded: expired keys are swept, and at most `max_keys` are tracked
    (RATE_LIMIT_MAX_KEYS, default 50 000); beyond that the least recently used go first."""

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, max_keys: int | None = None
    ) -> None:
        self._clock = clock
        self._max_keys = max_keys
        self._lock = threading.Lock()
        # key -> (hit timestamps, window); ordered by recency of use (LRU first).
        self._hits: OrderedDict[str, tuple[deque[float], float]] = OrderedDict()
        self._last_sweep = clock()

    def __len__(self) -> int:
        return len(self._hits)

    def _cap(self) -> int:
        return self._max_keys or rate_limit("RATE_LIMIT_MAX_KEYS", 50_000)

    def _sweep(self, now: float) -> None:
        self._last_sweep = now
        for key in [k for k, (q, w) in self._hits.items() if not q or q[-1] <= now - w]:
            del self._hits[key]

    def hit(self, key: str, limit: int, window: float) -> int:
        """Record an attempt. Returns 0 if allowed, else seconds until retry.

        Rejected attempts are not recorded, so waiting out the window always works.
        """
        with self._lock:
            now = self._clock()
            if now - self._last_sweep >= SWEEP_INTERVAL:
                self._sweep(now)
            entry = self._hits.get(key)
            q = entry[0] if entry else deque()
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                self._hits[key] = (q, window)
                self._hits.move_to_end(key)
                return max(1, math.ceil(q[0] + window - now))
            q.append(now)
            self._hits[key] = (q, window)
            self._hits.move_to_end(key)
            cap = self._cap()
            while len(self._hits) > cap:
                self._hits.popitem(last=False)
            return 0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def reset_all(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    # Behind a proxy run uvicorn with --proxy-headers and --forwarded-allow-ips.
    return request.client.host if request.client else "unknown"


def active_limiter():
    if rate_limit_store() == "db":
        from app.security.ratelimit_db import get_limiter

        return get_limiter()
    return limiter


def _enforce(key: str, limit: int, window: int) -> None:
    wait = active_limiter().hit(key, limit, window)
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY, headers={"Retry-After": str(wait)}
        )


def login_key(request: Request, email: str) -> str:
    return f"login:{client_ip(request)}:{email.strip().lower()}"


def check_login(request: Request, email: str) -> None:
    ip = client_ip(request)
    # Per-IP first: a blocked IP must not create a new IP+email bucket per request.
    _enforce(f"login-ip:{ip}", rate_limit("RATE_LIMIT_LOGIN_IP_PER_15MIN", 30), LOGIN_WINDOW)
    _enforce(login_key(request, email), rate_limit("RATE_LIMIT_LOGIN_PER_15MIN", 5), LOGIN_WINDOW)


def reset_login(request: Request, email: str) -> None:
    active_limiter().reset(login_key(request, email))


def check_change_password(user_id: object) -> None:
    # Per user, not per IP, in its own bucket: every attempt counts (successful ones too),
    # max 5 per 15 minutes.
    _enforce(
        f"change-password:{user_id}",
        rate_limit("RATE_LIMIT_CHANGE_PASSWORD_PER_15MIN", 5),
        LOGIN_WINDOW,
    )


def check_stepup(admin_id: object) -> None:
    # Step-up re-authentication of an acting admin: own bucket per admin, every attempt
    # counts (successful ones too), independent of login and change-password.
    _enforce(
        f"stepup:{admin_id}",
        rate_limit("RATE_LIMIT_STEPUP_PER_15MIN", 5),
        LOGIN_WINDOW,
    )


def check_totp_login(user_id: object) -> None:
    # Second-factor guesses at login, per account regardless of IP: max 5 per 15 minutes,
    # cleared by a successful login (a 6-digit code must not be brute-forceable).
    _enforce(f"totp-login:{user_id}", rate_limit("RATE_LIMIT_TOTP_PER_15MIN", 5), LOGIN_WINDOW)


def reset_totp_login(user_id: object) -> None:
    active_limiter().reset(f"totp-login:{user_id}")


def check_totp_manage(user_id: object) -> None:
    # Enabling/disabling 2FA from a live session: its own, roomier bucket (password or
    # code attempts), so setting it up never starves the login bucket.
    _enforce(f"totp-manage:{user_id}", rate_limit("RATE_LIMIT_TOTP_MANAGE_PER_15MIN", 10), LOGIN_WINDOW)


def check_register(request: Request) -> None:
    _enforce(
        f"register:{client_ip(request)}",
        rate_limit("RATE_LIMIT_REGISTER_PER_HOUR", 5),
        REGISTER_WINDOW,
    )
