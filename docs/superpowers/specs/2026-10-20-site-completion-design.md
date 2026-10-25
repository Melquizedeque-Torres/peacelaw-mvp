# PeaceLaw — Site completion design

Date: 2026-10-20 · Status: approved by the user's scope decision (1 + 2 + third-party-free items of 3); the user waived the per-section review and asked for autonomous execution.

## Goal
Put the MVP on Vercel and finish the parts of the site that do not need a third party: real evidence upload, admin console, landing page, rule-based lawyer matchmaking. Out of scope: payments, arbitration chamber homologation, LLM anonymization (they need external parties or legal decisions).

## Decomposition (each sub-project = own plan, built and verified in this order)
| # | Sub-project | Depends on |
|---|---|---|
| A | Deploy to Vercel (+ shared rate-limit store, production smoke test) | — |
| B | Evidence upload (encrypted, owner-only) | A |
| C | Admin console + password change + audit log | A |
| D | Landing page | A |
| E | Rule-based lawyer matchmaking | A |
After each sub-project: all suites green, redeploy, production smoke test of that feature, update `CONTINUE.md`.

## A. Deploy to Vercel
- **One Vercel project, two services** (Vercel Services): `frontend` (`frontend/`, Next.js) and `backend` (`backend/`, FastAPI, entrypoint `main:app`). Root `vercel.json` routes `/api/(.*)` to `backend` and everything else to `frontend`. The browser sees a single origin, so the session cookie stays first-party. The backend keeps its `/api` prefix because Vercel preserves the original path. Fallback if Services is unavailable on the account: two projects joined by the existing `BACKEND_URL` rewrite.
- **Scope/team:** personal scope if the CLI has one; otherwise create a new team `peacelaw`. Not the existing `EqualisPsi` team (belongs to another venture).
- **Environment (Production):** `APP_ENV=production`, `DATABASE_URL` (role `peacelaw_app`), `JWT_SECRET`, `RAW_TEXT_KEYS`, `CORS_ORIGINS` (the project's production URL; no custom domain until MVP launch). Values come from files in the previous session's scratchpad or are regenerated; never printed, never committed.
- **Rate limiting must survive serverless.** Today it is in memory per process, which does nothing across Vercel instances. Replace the store behind the same interface with a Postgres table `rate_limit_hits(key, window_start, count)` updated by atomic upsert; stale rows pruned opportunistically. Same limits and `Retry-After` behaviour; tests keep using SQLite.
- **Pre-launch privacy:** the consent text and `/privacidade` are still drafts, so keep Vercel Deployment Protection (Vercel Authentication) enabled on every deployment until the user lifts it at launch. Smoke tests use the documented bypass.
- **Schema changes** are applied to Neon `peacelaw-prod` with the owner role (`alembic upgrade head`); the app role never gets DDL. After the deploy work, rotate the `peacelaw_owner` password (it appeared in a past session log).
- **Production smoke test** (agent-browser or curl): register a client, create a case, approve, create judge/lawyer accounts with `scripts.create_user`, review, match, resolve, erase original, check security headers. Delete every test row afterwards.
- Retention stays on GitHub Actions (`retention.yml`).

## B. Evidence upload
- **Privacy rule:** evidence files can contain personal data that cannot be redacted, so they are encrypted at rest and readable only by the case owner. Judges and lawyers see only metadata (count and file kinds). The judge's "Provas" score is based on the anonymized text.
- Table `evidence_files(id, case_id → cases ON DELETE CASCADE, filename, content_type, size_bytes, data (Fernet-encrypted bytes, deferred), created_at, erased_at)`.
- Endpoints (owner only, 404 otherwise): `POST /api/cases/{id}/evidence?filename=` (raw body, no multipart dependency), `GET /api/cases/{id}/evidence` (metadata), `GET /api/cases/{id}/evidence/{eid}` (download, `Content-Disposition: attachment`, `nosniff`), `DELETE /api/cases/{id}/evidence/{eid}`.
- Limits: 5 files per case, 2.5 MB per file (Vercel request body cap is 4.5 MB), allowlist by content sniffing (PDF, PNG, JPEG, plain text), filename sanitized, upload allowed only while the case is `AWAITING_APPROVAL` or `READY_FOR_JUDGE`. The body-size middleware gets a per-route override for this one path.
- Erasure: `erase-original` and the retention job also blank evidence data and stamp `erased_at`; deleting a case cascades.
- Frontend: the wizard uploads the selected files right after the case is created (progress and per-file errors); `CaseDetail` lists them with download and delete; judge and lawyer views show "N anexos (tipos)" only.

## C. Admin console
- Pages: `/admin` (counts by case status and users by role, metadata only), `/admin/users` (list, create, revoke sessions), existing `/admin/pitch`. Admins never see case text, originals or evidence.
- Endpoints (ADMIN only): `GET /api/admin/stats`, `GET /api/admin/users` (paginated), `POST /api/admin/users` (email, role JUDGE/LAWYER/ADMIN, initial password 12–128 chars; same validation and non-overwrite rule as `scripts.create_user`), `POST /api/admin/users/{id}/revoke-sessions` (bumps `token_version`).
- `POST /api/auth/change-password` for every role (current + new password; bumps `token_version`), so admin-created accounts can replace the initial password.
- Audit log: table `audit_events(id, actor_id, action, target_id, created_at)` with no personal data in the payload; written for account creation and session revocation.

## D. Landing page
Replace the placeholder home with a pt-BR landing page: value proposition, "como funciona" in three steps, privacy promises (anonymization, encryption, 180-day erasure), sections for judges and lawyers, short FAQ, footer with `/privacidade`. Uses the existing tokens and components; no new dependencies; the role-based redirect for signed-in users stays.

## E. Rule-based lawyer matchmaking
- `cases.area` (enum: CONSUMIDOR, CIVIL, TRABALHISTA, FAMILIA, ALUGUEL, EMPRESARIAL, OUTROS; default OUTROS) chosen in wizard step 1; shown to judges and lawyers (it is not personal data).
- Table `lawyer_areas(user_id, area)`; `GET/PUT /api/lawyer/areas`; the lawyer picks areas on the board.
- Board response gains `area` and `suggested` (case area is in the lawyer's areas); ordering: suggested first, then by score. UI badge "Indicado para você". No external AI.

## Cross-cutting
- TDD per task; backend tests on SQLite, never against Neon; frontend Vitest; lint, `tsc`, `npm audit`, `pip-audit` stay green.
- Each schema change is an Alembic revision chained from `d4a9c6e18f03`, round-tripped locally and applied to Neon `peacelaw-prod` (and the dev database).
- pt-BR user messages, token classes only in components, shared error strings in `app/errors.py`.
- Security checks added per sub-project: authorization matrix tests (every role × endpoint), no sensitive data in logs or error bodies, response headers.

## Risks
- Vercel Services availability/limits on this account: mitigated by the two-project fallback.
- Python function cold start with Argon2 and psycopg: measured in the smoke test; reduce workers' memory use if needed.
- Evidence in Postgres grows the database: capped by the per-case limits; revisit with object storage after launch.
