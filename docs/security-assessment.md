# Security assessment: PeaceLaw MVP

Date: 2026-10-21 · Target: production (`https://peacelaw.vercel.app`, behind Vercel Deployment Protection) and the code at `main` · Assessor: Claude (AI-assisted, self-directed) · Authorised by the project owner.

**This is not a substitute for a professional penetration test.** It is an automated, AI-driven review plus an adversarial regression suite. It found no critical or high-severity vulnerability in the application logic, one product-level privacy gap (anonymisation misses), and a set of hardening items that should be closed before opening to the public.

## 1. Scope and method

| Layer | What was done | Result |
|---|---|---|
| Static analysis | Bandit on `app/`, `main.py`, `scripts/`; `pip-audit` on `requirements.txt`; `npm audit --omit=dev` | 0 medium/high; 9 low, all false positives (5 constant names or messages containing the word "password" in `app/`, 4 deliberately wrong passwords in the smoke scripts); 0 known vulnerable dependencies (Python and npm) |
| Code review | Manual read of auth, sessions, tokens, RBAC, cases, evidence, judge, lawyer, admin, rate limiter, password hashing, body limits | No logic flaw found; findings below are hardening |
| Adversarial tests | 39 attack tests, committed as `backend/tests/test_attack_surface.py` (permanent regression guard) | All 39 attacks fail as intended |
| Production probes | Headers, exposed docs/files, CSRF, CORS, rate-limit IP trust and spoofing | See section 3 |
| Redaction probe | Adversarial PII samples against the anonymiser | 4 gaps found, 2 fixed (section 4) |

Not done, and why: Semgrep (install timed out on Windows), OWASP ZAP and Nuclei (not run), browser-level XSS testing (the only `innerHTML` is the admin pitch from a repository-owned file; there is no `localStorage` use), load or denial-of-service testing (not allowed against Vercel and the database is shared with real data), social engineering and infrastructure review of the Vercel, Neon and GitHub accounts.

## 2. What the attacks covered (all blocked)

- **Authentication:** every non-public API route answers 401 to an anonymous caller; wrong-role access gets 403 on every route of the admin, judge and lawyer areas (8 role/area pairs, checked by enumerating the OpenAPI routes).
- **Object-level authorisation (IDOR):** another client cannot read, approve, erase, delete or upload to a case or its files; the answer is the same 404 as for a non-existent id; evidence of one case is unreachable through another case's URL; judges, lawyers and admins cannot use the client case endpoints.
- **Data exposure:** judge, lawyer and admin responses contain no original text, no `client_id`, no e-mails and none of the seeded PII.
- **Token forgery:** wrong signing key, bad signature, expired, unknown user, wrong version, missing `exp`, malformed strings and `alg: none` are all rejected; a `role: ADMIN` claim is ignored (role is read from the database); a stolen cookie dies after logout.
- **Mass assignment:** public sign-up cannot choose a role, `is_active` or `token_version`.
- **Injection:** SQL injection strings in login, role filter and offset fail with 401/422 and leave the tables intact; markup in a title is stored as text and served as JSON with `nosniff`.
- **Upload abuse:** SVG, HTML (including leading whitespace), PE, ELF, ZIP and binary payloads are refused (415); hostile filenames (path traversal, CRLF header injection, quote injection, bidi override) are neutralised in `Content-Disposition`; oversized bodies are cut with 413 before buffering.
- **Cross-site:** a state-changing request with a foreign `Origin` gets 403 even with a valid cookie; CORS gives no allow-origin to a foreign origin.
- **Account attacks:** identical answers for unknown e-mail and wrong password; the login throttle trips after 5 failures and cannot be reset with spoofed `X-Forwarded-For` or `X-Real-IP`; e-mail case and padding cannot create a duplicate identity; passwords are stored as Argon2id and never returned.
- **Error handling:** 422 responses never echo submitted input; unhandled errors expose no detail.

## 3. Production probes

| Probe | Result |
|---|---|
| `/docs`, `/redoc`, `/openapi.json`, `/.env` | 404 |
| Admin and session endpoints, anonymous | 401 |
| Landing headers | CSP (`object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`), HSTS two years, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| API headers | `Cache-Control: no-store`, HSTS with preload, `nosniff`, `X-Frame-Options: DENY` |
| Login POST with `Origin: https://evil.example` | 403 |
| CORS preflight from a foreign origin | no `Access-Control-Allow-Origin` (browser blocks it) |
| Rate-limit key | uses the real client IP; spoofed `X-Forwarded-For`/`X-Real-IP` did not change it (verified by recomputing the keyed hash for the tester's real IP and watching its bucket grow) |

## 4. Findings

Severity is the assessor's judgement for a public launch with real legal data. No finding was exploited against production data.

### Medium

**M1. Anonymisation misses some personal data** (privacy, the product's core promise). The rule-based redactor left: lowercase names (`meu nome é joão da silva`), a city (`Curitiba`), a birth date (`nascido em 03/04/1985`), an IP address, and names that are misspelled or lack a cue. Judges and lawyers see this text. Mitigations in place: the client must approve the anonymised version before anyone else sees it, and the limitations are documented in the module header. **Fixed in this assessment:** IP addresses and birth dates introduced by a birth cue (`backend/app/privacy/redaction.py`, tests in `test_redaction_gaps.py`). **Still open:** lowercase and cue-less names and place names need an NER layer; until then keep the approval step prominent and say so in the consent text.

**M2. No second factor for administrators.** An admin password is the only barrier; step-up re-authentication limits what a stolen cookie can do but not a stolen password. Recommended: TOTP for ADMIN first, then JUDGE and LAWYER.

**M3. No edge protection against distributed abuse.** Login and sign-up run Argon2 (bounded to 4 concurrent hashes per instance), and limits are per IP and per account only. A distributed attacker can raise latency or exhaust capacity. Vercel provides platform DDoS mitigation, but no custom firewall rules are configured. Recommended: Vercel Firewall rate-limit rules on `/api/auth/*` once the domain is attached.

### Low

**L1. CSP allows `'unsafe-inline'` scripts.** Required today by the Next.js setup. A nonce-based CSP would remove it.

**L2. Sign-up reveals whether an e-mail exists** (409 `EMAIL_TAKEN`). Usual trade-off; limited to 5 attempts per hour per IP. Login does not reveal it.

**L3. Password policy is length only (12 to 128).** No breached-password check and no complexity rule. Acceptable with Argon2id; consider a breached-password check.

**L4. Sessions last a fixed 60 minutes** with no idle timeout, and the cookie name has no `__Host-` prefix.

**L5. Evidence content checks are signature-based.** Plain text accepts any UTF-8 text without NUL bytes (including scripts); PDFs and images are not scanned for malware or active content. Files are served only to their owner, as `attachment` with `nosniff`, so the risk is to the owner's own device.

**L6. Test accounts exist in production** (`juiz.teste@`, `advogado.teste@`, `admin.teste@`, `monitor@peacelaw.dev`). Delete or rotate them before launch, except the monitoring account.

### Informational

- The Deployment Protection bypass token is stored in the GitHub secret `VERCEL_BYPASS`. Rotate it after launch, when protection is lifted.
- Production secrets (`JWT_SECRET`, `RAW_TEXT_KEYS`, DB owner URL) still have no backup outside the working session; loss of `RAW_TEXT_KEYS` makes stored original reports unreadable.
- `audit_events` is append-only for the app role (INSERT and SELECT only); failed step-up attempts are now audited.
- Dependencies: no known vulnerabilities today; `pip-audit` runs in CI on every push.

## 5. Recommendations in priority order

1. Close M1 for the launch: keep the "approve the anonymised text" step mandatory, state the limits in the consent text, then add an NER layer or an assisted review step.
2. Add TOTP for admins (M2), then configure Vercel Firewall rules (M3) when the domain is live.
3. Delete test accounts and rotate the bypass token at launch (L6, informational).
4. Move to a nonce-based CSP (L1) and add a breached-password check (L3).
5. Commission a professional penetration test before opening to the public: this assessment cannot test infrastructure, accounts or business-logic abuse with the depth a human tester can.

## 6. Reproducing

```bash
cd backend
.venv/Scripts/python -m pytest tests/test_attack_surface.py tests/test_redaction_gaps.py -q
.venv/Scripts/python -m bandit -r app main.py -q
.venv/Scripts/python -m pip_audit -r requirements.txt
cd ../frontend && npm audit --omit=dev
```

## 7. Remediation status (2026-10-23)

| Finding | Status | What was done |
|---|---|---|
| M1 anonymisation misses | Partly fixed | Added: IP addresses, birth dates after a birth cue, lowercase names after "meu nome é / me chamo / nome completo", places after residence cues ("moro em", "natural de", "cidade de"). Still open: names without any cue and bare place names (needs an NER layer). |
| M2 no second factor | Fixed (opt-in) | TOTP (RFC 6238) with 8 one-time recovery codes, replay protection, separate rate-limit buckets, admin-assisted reset with step-up, audit events, screens at `/conta/seguranca`, a nudge on the admin dashboard. Production smoke test 13/13 (`backend/scripts/smoke_totp.py`). Not yet mandatory: the owner must enable it on each admin account. |
| M3 no edge protection | Partly fixed | Vercel Firewall rule published: 20 requests per minute per IP on `/api/auth/*` (Hobby allows one custom rule, so the API-wide rule was not added; the app limiter still applies). Re-evaluate managed rules after upgrading the plan. |
| L1 CSP `unsafe-inline` | Open | A nonce-based CSP needs dynamic rendering of every page and would drop static prerendering; deferred. |
| L2 sign-up reveals e-mail existence | Accepted | Fixing it needs e-mail verification (no e-mail provider yet). |
| L3 password policy | Fixed | Blocklist of common passwords, repeated characters and sequences (offline), enforced on sign-up, change and admin reset. |
| L4 fixed 60 minute session | Open | Low value until real users exist. |
| L5 evidence content checks | Accepted | Files are owner-only, served as attachments with `nosniff`. |
| L6 test accounts in production | Open on purpose | Eight demo accounts (`*.teste@` and `*.demo@peacelaw.dev`, passwords in the owner's password manager): delete before launch. |
| Backups | Done | Daily encrypted dump as a workflow artifact (14 days), round-trip verified, restore guide in `docs/backup.md`; secrets copy encrypted with DPAPI on the owner's PC. |
| Accessibility | Done | axe-core (WCAG 2.0/2.1 A and AA plus best practice) on the public pages and every role's home: one real issue (an in-text link distinguished only by colour on `/register`), fixed. |
| Load | Checked lightly | Production login with wrong passwords: median 0.34 s, max 0.65 s at 8 concurrent requests; throttling (HTTP 429) engaged as designed. A real load test was not run. |

