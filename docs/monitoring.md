# Monitoring

No third-party service: GitHub Actions probes production, GitHub e-mails the repository owner when a run fails, and the admin dashboard shows 24-hour counts. Nothing here stores personal data.

## What watches what

| Signal | Where | When it fails |
|---|---|---|
| Site and database up | `.github/workflows/uptime.yml`, step "Health endpoint" calls `GET /api/health` (runs `select 1`) | 3 tries 15 s apart, then the run fails |
| Login and sessions work | same workflow, step "Login and session" with the read-only account | 2 tries, then the run fails |
| LGPD retention job | `.github/workflows/retention.yml` (daily 03:15 BRT) | a failed run e-mails the owner |
| CI on every push | `.github/workflows/ci.yml` | a failed run e-mails the owner |
| Privileged-action pressure | `/admin`, card "Atividade nas últimas 24 horas" | read it; it alerts nobody |

Alerts go to the e-mail of the GitHub account (the repository owner's e-mail). Keep GitHub Settings → Notifications → "Actions" enabled for e-mail.

## Repository secrets used

`VERCEL_BYPASS` (Deployment Protection bypass token; harmless once the custom domain lifts protection), `MONITOR_EMAIL` and `MONITOR_PASSWORD` (a LAWYER account that is only ever logged into).

## When an alert arrives

1. Open the failed run in GitHub → Actions → Uptime and read which step failed.
2. `/api/health` failing: check the Neon console (project `peacelaw-prod`) and Vercel → Deployments → Runtime Logs. A 503 means the app is up but cannot reach the database.
3. Login failing with health fine: look for a recent deploy (roll back in Vercel), then for a rate limit on the probe account (HTTP 429 means the bucket is full; wait 15 minutes).
4. Retention job failing: rerun it with "Run workflow" (dry run first) and read the log; the secrets `DATABASE_URL` and `RAW_TEXT_KEYS` must still be valid.

## Limits to know

- GitHub schedules can run a few minutes late, and GitHub disables scheduled workflows after 60 days without repository activity; any push re-enables them.
- Vercel Hobby has no native alerting and no log drains, so runtime errors beyond what the probes touch are visible only in the Vercel Runtime Logs.
- Backups: Neon keeps 6 hours of history on this plan. Before real users arrive, raise the retention window or export a periodic dump.
- The health endpoint exposes only `{"status":"ok"}` or `{"status":"unavailable"}`; failure details go to the server log without the connection string.
