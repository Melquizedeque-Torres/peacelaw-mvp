# A — Deploy to Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the current MVP on Vercel (Next.js + FastAPI as two Vercel Services in one project) against the production Neon database, with rate limiting that works across serverless instances, and verify it end to end.

**Architecture:** Root `vercel.json` defines services `frontend` and `backend` and routes `/api/(.*)` to the backend. A Postgres-backed sliding-window limiter (hashed keys) replaces the in-memory one in production. Deploys are made with the Vercel CLI; no custom domain yet.

**Tech Stack:** Vercel Services/CLI, FastAPI, SQLAlchemy, Alembic, Neon Postgres.

**Spec:** `docs/superpowers/specs/2026-10-20-site-completion-design.md` (section A).

## Global Constraints
- Backend commands from `backend/` with `.venv/Scripts/python -m …`; frontend from `frontend/`. Tests never touch Neon.
- Never print or commit `backend/.env`, `DATABASE_URL`, `JWT_SECRET`, `RAW_TEXT_KEYS`. Secrets go to Vercel only through stdin (`vercel env add NAME production < file`), from files in the scratchpad directory.
- Production secrets already exist as files in the session scratchpad: `app_db_url.txt` (role `peacelaw_app`), `prod_jwt_secret.txt`, `prod_raw_text_keys.txt`. If a file is missing, generate new values (JWT: `secrets.token_urlsafe(64)`; Fernet key) and set the same values in GitHub Actions secrets (`gh secret set`) so the retention job keeps working. A new `RAW_TEXT_KEYS` is only safe while `peacelaw-prod` holds no real data.
- Schema changes: Alembic revision chained from `d4a9c6e18f03`, applied to Neon `peacelaw-prod` with the owner role. The app role never gets DDL.
- Vercel scope: the only scope on this account is `<seu-time-vercel>` (Hobby plan, i.e. the user's personal scope). Project name `peacelaw`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Update `CONTINUE.md` when the plan finishes.

---

### Task 1: Shared (Postgres) rate-limit store

**Files:**
- Create: `backend/migrations/versions/e5b1d0a47c92_rate_limit_hits.py`
- Create: `backend/app/security/ratelimit_db.py`
- Modify: `backend/app/models.py` (add `RateLimitHit`)
- Modify: `backend/app/security/ratelimit.py` (`_enforce`, `reset_login` pick the active store)
- Modify: `backend/app/config.py` (`rate_limit_store()`)
- Test: `backend/tests/test_ratelimit_db.py`

**Interfaces:**
- Produces: `DbRateLimiter.hit(key: str, limit: int, window: float) -> int` (0 allowed, else seconds to wait), `.reset(key)`, `.reset_all()`; `config.rate_limit_store() -> "memory" | "db"` (env `RATE_LIMIT_STORE`, default `db` when `APP_ENV=production`, else `memory`).

- [ ] **Step 1: Failing tests** `backend/tests/test_ratelimit_db.py`

```python
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
```

Run: `.venv/Scripts/python -m pytest tests/test_ratelimit_db.py -q` → FAIL (modules missing).

- [ ] **Step 2: Model + migration.** In `app/models.py` add (imports `BigInteger`/`Float` already available via sqlalchemy; add `Float` is imported):

```python
class RateLimitHit(Base):
    """One attempt in a sliding window. Keys (IP + e-mail) are stored only as a SHA-256 digest."""

    __tablename__ = "rate_limit_hits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_hash: Mapped[str] = mapped_column(String(64), index=True)
    hit_at: Mapped[float] = mapped_column(Float, index=True)  # epoch seconds
    window: Mapped[float] = mapped_column(Float)
```

Migration `e5b1d0a47c92_rate_limit_hits.py` (`down_revision = "d4a9c6e18f03"`): `op.create_table("rate_limit_hits", sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True), sa.Column("key_hash", sa.String(64), nullable=False), sa.Column("hit_at", sa.Float(), nullable=False), sa.Column("window", sa.Float(), nullable=False))`, `op.create_index("ix_rate_limit_hits_key_hash", "rate_limit_hits", ["key_hash"])`, `op.create_index("ix_rate_limit_hits_hit_at", "rate_limit_hits", ["hit_at"])`; downgrade drops indexes then the table. Use `sa.Integer` PK with `autoincrement`; on Postgres this becomes `SERIAL`.

- [ ] **Step 3: `app/security/ratelimit_db.py`**

```python
"""Sliding-window rate limiter backed by Postgres, shared by every serverless instance."""

import hashlib
import hmac
import math
import time
from collections.abc import Callable
from functools import lru_cache

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session, sessionmaker

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
```

Note: `test_expired_rows_are_pruned` relies on the second prune (`window + 3600` margin): after `clock += 4000` the `old` row (window 60) is older than 60+3600, so it is deleted.

- [ ] **Step 4: Selection.** In `app/config.py`:

```python
def rate_limit_store() -> str:
    explicit = os.environ.get("RATE_LIMIT_STORE", "").strip().lower()
    if explicit in ("memory", "db"):
        return explicit
    return "db" if os.environ.get("APP_ENV", "").strip().lower() == "production" else "memory"
```

In `app/security/ratelimit.py` add

```python
def active_limiter():
    if rate_limit_store() == "db":
        from app.security.ratelimit_db import get_limiter

        return get_limiter()
    return limiter
```

(import `rate_limit_store` from `app.config`), and change `_enforce` to `active_limiter().hit(...)` and `reset_login` to `active_limiter().reset(login_key(...))`. Leave the module-level `limiter` and `SlidingWindowLimiter` untouched (existing tests use them).

- [ ] **Step 5:** Run `.venv/Scripts/python -m pytest -q` → all green (≈381). Run `.venv/Scripts/python -m alembic upgrade head` against a throwaway SQLite URL is not needed; verify the migration with `alembic check` after applying to Neon in Task 3.
- [ ] **Step 6: Commit** `feat(security): Postgres-backed rate limiter for serverless`.

### Task 2: Vercel Services configuration

**Files:**
- Create: `vercel.json` (repo root)
- Create: `backend/.vercelignore`
- Modify: `frontend/next.config.ts` (rewrite only when `BACKEND_URL` is set)
- Modify: `frontend/src/next-config.test.ts`
- Modify: `docs/deploy.md` (replace sections 3–5 with the Vercel flow)

**Interfaces:** Produces the deployable layout used by Task 3.

- [ ] **Step 1: `vercel.json`**

```json
{
  "services": {
    "frontend": { "root": "frontend" },
    "backend": { "root": "backend", "entrypoint": "main:app" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```

- [ ] **Step 2:** `main.py` must expose an `app` object (Vercel imports `main:app`). Check the bottom of `backend/main.py`: if it only defines `create_app()` and `app = create_app()` exists, keep it; otherwise add `app = create_app()`. Run `grep -n "^app" backend/main.py`.
- [ ] **Step 3:** `backend/.vercelignore`: `.venv`, `.env`, `.env.*`, `tests`, `__pycache__`, `.pytest_cache`, `scripts` stays (the CLI scripts run locally, not on Vercel, but are small; keep them out of the bundle by listing `scripts`). Do NOT ignore `app/content` or `migrations`.
- [ ] **Step 4: Next rewrite.** In `next.config.ts` `rewrites()`: `const backend = process.env.BACKEND_URL; if (!backend) return [];` (on Vercel the platform routes `/api`; locally `BACKEND_URL` is set to `http://127.0.0.1:8000`, so add `BACKEND_URL=http://127.0.0.1:8000` to `frontend/.env.local.example` and README). Update `next-config.test.ts`: with `BACKEND_URL` unset the rewrite list is empty; with it set it contains the `/api/:path*` destination. Keep the existing header tests.
- [ ] **Step 5:** `npm test`, `npm run lint`, `npx tsc --noEmit` green. Commit `feat(deploy): vercel services config`.

### Task 3: Link project, set environment, migrate, deploy (preview first)

**Files:** none in git except `docs/deploy.md` notes; `.vercel/` is git-ignored (add `.vercel` to `.gitignore`).

- [ ] **Step 1: Link.** From the repo root: `vercel link --yes --project peacelaw --scope <seu-time-vercel>` (creates the project if it does not exist). Confirm with `vercel project ls --scope <seu-time-vercel>`.
- [ ] **Step 2: Environment (Production and Preview).** For each of `DATABASE_URL`, `JWT_SECRET`, `RAW_TEXT_KEYS`: `vercel env add NAME production --scope <seu-time-vercel> < "<scratchpad>/<file>"` (add `--sensitive`). Then plain values: `APP_ENV=production`, `RATE_LIMIT_STORE=db` via `printf production | vercel env add APP_ENV production --scope <seu-time-vercel>`. `CORS_ORIGINS` needs the production URL: first run `vercel deploy --prod` once is NOT allowed to boot without it (startup guard), so set a placeholder-free value after reading the project's production domain from `vercel project inspect peacelaw --scope <seu-time-vercel>` (it is `https://peacelaw-<scope>.vercel.app` or `https://peacelaw.vercel.app`); set `CORS_ORIGINS` to that exact origin, then deploy.
- [ ] **Step 3: Migrate prod DB.** Obtain the owner connection string with the Neon MCP `get_connection_string` (project `<id-do-projeto-neon>`, database `peacelaw`, role `peacelaw_owner`) and run, with the value only in the process environment: `DATABASE_URL=… .venv/Scripts/python -m alembic upgrade head` then `alembic current` → `e5b1d0a47c92 (head)`, then `alembic check` → no drift. Re-grant for the new table: connect as owner and `grant select, insert, update, delete on rate_limit_hits to peacelaw_app; grant usage, select on sequence rate_limit_hits_id_seq to peacelaw_app;` (default privileges cover tables, not always sequences).
- [ ] **Step 4: Deploy production.** `vercel deploy --prod --yes --scope <seu-time-vercel>`. If Services are rejected for this account, STOP and switch to the fallback: two projects (`peacelaw-web` from `frontend/`, `peacelaw-api` from `backend/`), `BACKEND_URL` of the web project pointing at the API project's URL, `CORS_ORIGINS` of the API project set to the web URL; record the change in `CONTINUE.md`.
- [ ] **Step 5: Protection.** Keep Vercel Authentication enabled for all deployments (pre-launch privacy). In the project settings via API: `vercel api` is not required; verify with the Vercel MCP `get_project` that `ssoProtection` is set; if production is public, enable it with `update_project` (`ssoProtection: {deploymentType: "all"}`).
- [ ] **Step 6: Commit** `.gitignore` + docs: `docs: vercel deployment flow`. Push to `main`.

### Task 4: Production smoke test and cleanup

**Files:** Create `docs/superpowers/plans/smoke-results-A.md` (results only, no secrets).

- [ ] **Step 1: Bypass protection** for automated requests using the `vercel:access-protected-vercel-deployment` skill (`vercel curl` or the protection-bypass header). Never put the bypass secret in git.
- [ ] **Step 2: API checks** (curl with `-s -D -`): `GET /health` → 200 via the backend path? (`/health` is not under `/api`; use `GET /api/consent` → 200 JSON); response headers include `X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control: no-store`; `POST /api/auth/login` with wrong password six times from the same email → sixth is 429 with `Retry-After` (proves the shared store); `GET /docs` → 404.
- [ ] **Step 3: Accounts.** With `DATABASE_URL` (app role) in the environment: `.venv/Scripts/python -m scripts.create_user --email smoke-judge@peacelaw.test --role JUDGE --password-stdin` (and LAWYER, ADMIN) using a throwaway password generated in a temp file.
- [ ] **Step 4: Full flow in the browser** (agent-browser skill, desktop and 400 px width): register a client; create a case with a CPF and a name in the text; confirm the review step shows `[CPF]`/`[NOME]`; approve; log in as the judge, score; log in as the lawyer, take and resolve; log in as the client, erase the original; log in as admin, open `/admin/pitch`. Check the console for CSP violations (must be none).
- [ ] **Step 5: Cleanup.** Delete the smoke users and their cases using the owner connection (`delete from cases where client_id in (...)` etc.), confirm `select count(*)` of `users`, `cases`, `rate_limit_hits` is 0 for smoke data.
- [ ] **Step 6: Rotate the exposed owner password.** Neon MCP `reset_postgres_role_password` for `peacelaw_owner`; keep the new value only in a scratchpad file; do not store in git.
- [ ] **Step 7:** Write results to `smoke-results-A.md`, update `CONTINUE.md` (state, production URL, what is verified), commit and push.

## Self-review
- Spec A coverage: services (T2/T3), env and secrets (T3), shared rate limit (T1), protection (T3), migrations (T3), smoke test and cleanup (T4), owner rotation (T4), retention untouched.
- Names: `DbRateLimiter`, `get_limiter`, `active_limiter`, `rate_limit_store`, `RateLimitHit` are used consistently.
