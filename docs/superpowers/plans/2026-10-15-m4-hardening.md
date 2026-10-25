# M4 — Production & Security Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD per task; each task ends with all suites green.

**Goal:** Close the findings of the 2026-10-15 review round (two-axis code review, static security audit, dynamic security probes, browser dogfood) so the MVP is production-ready apart from deployment-side controls.

**Sources of findings:** code-review Standards/Spec axes, security audit (no High; Medium: quadratic redaction, unbounded lists/case flooding, unbounded Argon2 concurrency; Low: no token revocation, no erasure after evaluation, docs exposed, unpinned deps), dynamic probes (no security headers on pages, `X-Powered-By`, `/docs` + `/openapi.json` reachable on the backend).

**Spec:** `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md` (M3 section) + this plan's rulings.

## Global Constraints
- Backend commands from `backend/` with `.venv/Scripts/python -m …`; frontend from `frontend/` (`npm test`, `npm run lint`, `npx tsc --noEmit`; `npm run build` only when no server is running from the checkout).
- Never print/commit `backend/.env`. Tests never touch Neon. pt-BR user messages. Token classes only (no hex) in components.
- Privacy by Design: `raw_text` only in owner views; over-redaction acceptable, leaks not.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings
- Register 409 enumeration: accepted for the MVP (UX trade-off); deployment rate limiting mitigates.
- Neon plaintext remnants: not applicable — `cases` was empty when the encryption migration ran (all rows created afterwards are encrypted).
- Cookie `__Host-` prefix: deferred (breaks plain-http dev); documented in the hardening checklist.
- Score display: tier is computed from the stored score (spec thresholds); the number is displayed with up to one decimal (pt-BR comma) so number and tier never disagree.

---

### Task 1: Backend DoS and abuse limits
- `redaction.py`: replace the O(n²) overlap scan with sorted accepted spans + `bisect` (O(n log n)); behaviour and all redaction tests unchanged; add a timing test: 20 000-char `"R$1 " * 5000` and `"a@b.co " * 2800` redact in < 0.3 s.
- `security/passwords.py`: bound concurrent Argon2 work with a module-level `threading.BoundedSemaphore(4)` around hash and verify (incl. the dummy verify).
- Per-client cap on open cases: creating a case when the client already has ≥ 20 cases in `AWAITING_APPROVAL`/`READY_FOR_JUDGE`/`EVALUATED`/`IN_MEDIATION` → 429 `{"detail": "Limite de casos em andamento atingido."}`.
- Pagination: `GET /api/cases/mine`, `/api/judge/queue`, `/api/lawyer/board` accept `limit` (1–100, default 50) and `offset` (≥ 0, default 0); ordering unchanged.
- Tests for each.

### Task 2: Backend configuration posture and session revocation
- `APP_ENV` (`development` default, `production`): in production, FastAPI is built with `docs_url=None, redoc_url=None, openapi_url=None`, and startup fails with a clear RuntimeError if `CORS_ORIGINS` is unset. `ENABLE_API_DOCS=true` can re-enable docs explicitly.
- Security headers middleware on every backend response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Token revocation: `users.token_version` (int, default 0); tokens carry `ver`; `get_current_user` rejects mismatches; logout increments the version (all sessions of that user end). Alembic migration (down_revision `b7e41f0c9a25`), applied to Neon with round-trip + `alembic check`.
- `requirements.lock` generated from the venv (`pip freeze`), README documents `pip install -r requirements.lock` for reproducible deploys.
- Tests: docs 404 and startup guard under production env (build the app via a factory or reload in test), headers present, a token minted before logout is rejected after logout.

### Task 3: LGPD erasure of the original report
- `POST /api/cases/{id}/erase-original` (owner only, any status): replaces `raw_text` with an empty string, sets `raw_text_erased_at` (new nullable timestamptz column, same migration as Task 2 or its own), keeps `anonymized_text` and the workflow intact; idempotent; 404 for non-owners.
- Owner view exposes `raw_text_erased_at`; tests.
- Frontend (CaseDetail): button "Apagar meu relato original" with confirmation (two-step, like delete) → calls the endpoint; afterwards the owner-only `<details>` shows "Relato original apagado em {data}."; api.ts method `eraseOriginal(id)`.

### Task 4: Frontend hardening and copy fixes
- `next.config.ts`: `poweredByHeader: false`; `headers()` for all routes: CSP (`default-src 'self'; script-src 'self' 'unsafe-inline'` + `'unsafe-eval'` only in development; `style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and HSTS only when `NODE_ENV === "production"`. Verify the production build still renders every route (no CSP violations in the console).
- UploadZone honest copy: drag hint "Solte para anexar", ready state "Anexado (fica só no seu navegador)", live summary wording without "prontos para envio".
- Judge preview: `ProbabilityCard` gets an optional `note` prop that replaces the statistical disclaimer; the judge passes "Prévia calculada a partir das suas notas." (keeps the separate caption).
- Score display: `ProbabilityCard`, CaseList, lawyer CaseCard show up to one decimal with comma; tier from the raw score.
- Lawyer success message uses the column name "Em contato".
- Pagination-aware API client (`limit`/`offset` optional params; pages request the default).

### Task 5: Standards cleanup
- Centralise lifecycle rules: backend `app/lifecycle.py` (sets `DELETABLE`, `REVIEWABLE`, `NOT_YET_APPROVED`, `NOT_YET_EVALUATED`, `OPEN_STATUSES`) and shared `app/errors.py` message constants used by all routers; frontend `src/lib/case-status.ts` predicates (`canDelete`, `isOpenOpportunity`, `isInMediation`, …) used by CaseDetail/CaseReview/CaseCard.
- StatusBadge shadow → token utility (no raw rgb).
- Delete unused create-next-app SVGs in `frontend/public/`.
- No behaviour change; all tests green.

## Done
Run both suites, production build + `next start` smoke, re-run the dynamic probes, then superpowers:finishing-a-development-branch.
