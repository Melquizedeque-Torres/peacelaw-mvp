"""Sliding-window rate limiter backed by Postgres, shared by every serverless instance."""

import hashlib
import hmac
import math
import time
from collections.abc import Callable
from functools import lru_cache

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import get_jwt_secret
from app.models import RateLimitHit


def _digest(key: str) -> str:
    # Keyed hash: the table never holds IPs or e-mails, and cannot be matched offline without the secret.
    return hmac.new(get_jwt_secret().encode(), key.encode(), hashlib.sha256).hexdigest()


class DbRateLimiter:
    def __init__(self, factory: Callable[[], Session], clock: Callable[[], float] = time.time) -> None:
        self._factory = factory
        self._clock = clock

    def hit(self, key: str, limit: int, window: float) -> int:
        """0 if allowed (and recorded), else seconds until retry. Rejected attempts are not recorded."""
        digest = _digest(key)
        now = self._clock()
        with self._factory() as db:
            if db.bind.dialect.name == "postgresql":
                # Serialize concurrent hits on the same key so the count cannot be raced past the limit.
                db.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": digest})
            # Prune: this key's expired hits and any row whose own window is long gone.
            db.execute(delete(RateLimitHit).where(RateLimitHit.key_hash == digest, RateLimitHit.hit_at <= now - window))
            db.execute(delete(RateLimitHit).where(RateLimitHit.hit_at <= now - RateLimitHit.window - 3600))
            oldest = db.scalar(select(func.min(RateLimitHit.hit_at)).where(RateLimitHit.key_hash == digest))
            count = db.scalar(select(func.count()).select_from(RateLimitHit).where(RateLimitHit.key_hash == digest))
            if count >= limit:
                db.commit()
                return max(1, math.ceil(oldest + window - now))
            db.add(RateLimitHit(key_hash=digest, hit_at=now, window=window))
            db.commit()
            return 0

    def reset(self, key: str) -> None:
        with self._factory() as db:
            db.execute(delete(RateLimitHit).where(RateLimitHit.key_hash == _digest(key)))
            db.commit()

    def reset_all(self) -> None:
        with self._factory() as db:
            db.execute(delete(RateLimitHit))
            db.commit()


@lru_cache
def get_limiter() -> DbRateLimiter:
    from app.db import _session_factory

    return DbRateLimiter(lambda: _session_factory()())
