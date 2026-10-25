# PeaceLaw API

FastAPI + SQLAlchemy + Neon Postgres.

## Setup
1. `python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt`
2. Copy `.env.example` to `.env` and fill `DATABASE_URL`, `JWT_SECRET`, `RAW_TEXT_KEYS`.
3. `.venv/Scripts/python -m alembic upgrade head`
4. Real JUDGE/LAWYER/ADMIN accounts: `.venv/Scripts/python -m scripts.create_user --email ... --role JUDGE` (prompts for the password; `--password-stdin` for automation).
5. Demo accounts (refused when `APP_ENV=production`): `.venv/Scripts/python -m scripts.seed_demo_users` (prints passwords once).

## Run
`.venv/Scripts/python -m uvicorn main:app --reload --port 8000` — docs at `/docs` (development only).

## Production configuration
- `APP_ENV=production` hides `/docs`, `/redoc` and `/openapi.json` (set `ENABLE_API_DOCS=true` to re-enable) and makes startup fail unless `CORS_ORIGINS` is set (comma-separated origins).
- Every response carries `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`.
- Logout increments `users.token_version`, which revokes every session of that user.
- `APP_ENV` must be `development` (default) or `production`; any other value aborts startup. Unhandled errors return a generic `{"detail": "Erro interno."}` 500 that still carries the security headers.
- Startup guards (`APP_ENV=production`): the app refuses to start if `COOKIE_SECURE=false` or `JWT_SECRET` has fewer than 48 characters.
- Rate limiting (in-memory sliding window): `POST /api/auth/login` allows `RATE_LIMIT_LOGIN_PER_15MIN` (default 5) attempts per client IP + email and `RATE_LIMIT_LOGIN_IP_PER_15MIN` (default 30) per IP in 15 minutes; a successful login resets the IP+email counter. `POST /api/auth/register` allows `RATE_LIMIT_REGISTER_PER_HOUR` (default 5) per IP. Admin step-up re-authentication (creating an ADMIN, `POST /api/admin/users/{id}/reset-password`) allows `RATE_LIMIT_STEPUP_PER_15MIN` (default 5) attempts per acting admin in 15 minutes, in its own bucket; every attempt counts. Exceeding returns 429 with `Retry-After`. The client IP is `request.client.host`: behind a reverse proxy run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy ip>`, otherwise every user shares the proxy's IP. State is per process (N workers = N times the limit, cleared on restart), so production should also rate-limit at the edge or use a shared store such as Redis.
- Request size: bodies over `MAX_BODY_BYTES` (default 131072) under `/api/` get 413, checked by `Content-Length` and by counting streamed (chunked) bytes.
- Reproducible installs: `pip install -r requirements.lock` (exact versions frozen from the working venv, dev tools included). Regenerate with `.venv/Scripts/python -m pip freeze > requirements.lock` after changing `requirements*.txt`.

## Test
`.venv/Scripts/python -m pytest` (in-memory SQLite; never touches Neon).

## Privacy by Design
- Case title, report and judge notes are redacted before storage for third parties.
- `raw_text` is encrypted at rest (Fernet, `RAW_TEXT_KEYS`) and only returned to its owner.
- Sessions: JWT in an httpOnly, SameSite=Lax cookie; role re-read from the DB per request.

## LGPD / ops note: erasure is logical
`POST /api/cases/{id}/erase-original` overwrites `raw_text` with a ciphertext of the empty string at row level and stamps `raw_text_erased_at`. It is not physical deletion: the previous ciphertext remains in Postgres dead tuples and in Neon point-in-time history until `VACUUM` reclaims it and the project's history-retention window expires (currently 6 h). The old ciphertext is only readable with the `RAW_TEXT_KEYS` that encrypted it, so retiring those keys after the window is the way to make erasure irrecoverable. Disclose this window when answering data-subject requests.

## LGPD retention job
`scripts/purge_raw_text.py` erases the original report (`raw_text` -> `""`, `raw_text_erased_at` stamped, same semantics as the erase endpoint) of cases in status `RESOLVED` whose `updated_at` is older than `RAW_TEXT_RETENTION_DAYS` (default `180`) and not yet erased. It is idempotent and prints only counts, never text.

```
.venv/Scripts/python -m scripts.purge_raw_text --dry-run   # how many would be erased
.venv/Scripts/python -m scripts.purge_raw_text             # erase them
```

Schedule it daily, from `backend/`, with the production `.env` loaded. Linux cron: `15 3 * * * cd /srv/peacelaw/backend && .venv/bin/python -m scripts.purge_raw_text >> /var/log/peacelaw-purge.log 2>&1`. Windows Task Scheduler: `schtasks /Create /SC DAILY /ST 03:15 /TN PeaceLawPurge /TR "cmd /c cd /d C:\path\to\PeaceLaw\backend && .venv\Scripts\python -m scripts.purge_raw_text"`. The privacy notice (`/privacidade`) promises 180 days; keep `RAW_TEXT_RETENTION_DAYS` in sync. The same logical-erasure caveat above applies.
