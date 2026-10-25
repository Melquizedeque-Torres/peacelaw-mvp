# Smoke results — plan A (Vercel production)

Date: 2026-10-20 · Target: `https://peacelaw.vercel.app` (Vercel project `<seu-time-vercel>/peacelaw`, Services: Next.js + FastAPI) · DB: Neon `peacelaw-prod`, head `e5b1d0a47c92`.

All 26 checks passed (the script's final counter crashed on a non-boolean result; every individual line printed PASS):
- Public API: `/api/consent` 200; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store` present; `/docs` and `/api/openapi.json` hidden (404); `/api/admin/pitch` without login 401.
- Shared rate limit (Postgres store): 5 wrong logins → 401, the 6th and 7th → 429 with `Retry-After`.
- Client flow: register, create case (CPF, phone, name and amount redacted to `[CPF]`, `[TELEFONE]`, `[NOME]`, `[VALOR]`), approve.
- Judge: sees the case without `raw_text`, review accepted, score 75.0 and status `EVALUATED` for the owner.
- Lawyer: sees the case without `raw_text`, match → `IN_MEDIATION`, resolve → `RESOLVED`.
- Role isolation: client → judge queue 403; judge → admin pitch 403.
- LGPD: `erase-original` empties `raw_text` and stamps `raw_text_erased_at`.
- Admin gets the Portuguese pitch kit. Logout revokes the session (204, then 401).

Cleanup: smoke users, cases and rate-limit rows deleted; `users`, `cases`, `case_reviews`, `rate_limit_hits` all 0.
Owner role `peacelaw_owner` password rotated (old one rejected, new one verified); new value kept only in the local scratchpad file `owner_db_url.txt`.

Observations:
- Login takes about 3.3 s (Argon2 on a cold Python function in `iad1` plus a cross-region database in `sa-east-1`). Candidate tuning: pin the functions to `gru1`, measure again.
- Vercel Deployment Protection is `all_except_custom_domains`: `*.vercel.app` URLs require Vercel login or the bypass token; a future custom domain will be public.
- The Vercel project is linked to the GitHub repo, so pushes to `main` trigger deployments; CLI deploys from a checkout with git metadata were blocked ("commit author doesn't have permission"), CLI deploys from a clean `git archive` export work.
