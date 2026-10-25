# PeaceLaw MVP — Design

Date: 2026-10-14 · Status: approved in chat (milestone gates still apply)

## What we are building

A LegalTech MVP for Online Dispute Resolution (ODR) with AI-driven probability
scoring and lawyer matchmaking. Three actors, three UIs:

| Actor | UI | Design source |
|---|---|---|
| Client (Demandante) | Wizard: report → privacy review → result | `VisaoDemandante.jsx` |
| Judge (Avaliador) | Accessible split-view: anonymized case + evaluation panel | `VisaoAvaliador.jsx` |
| Lawyer (Solucionador) | Kanban of mediation opportunities | `VisaoSolucionador.jsx` |

The design-system source lives at `C:\Users\mellq\Downloads\design-system`
(tokens, `StatusBadge`, `ProbabilityCard`, `SecureUpload`, the three screens).

## Decisions

1. **Repo root is `PeaceLaw/`** (no extra `legaltech-mvp/` level):
   `backend/`, `frontend/`, `docs/`, `.cursorrules`, `CLAUDE.md`.
2. **Design system is ported, not rewritten.** Tokens become the Tailwind v4
   theme + shadcn CSS variables; components become typed TSX using tokens
   instead of hard-coded hex. (Milestone 2.)
3. **Database is Neon Postgres** from day one: project `peacelaw`
   (`wispy-sun-39281027`, aws-sa-east-1, database `peacelaw`). Schema managed
   by Alembic. Unit tests run against in-memory SQLite; models stay portable.
4. **Privacy by Design.** Every case text passes through `redact_pii` before
   it is persisted. `raw_text` is stored for the owner only and is never
   serialized by any API response schema. Third parties (judges, lawyers) only
   ever receive `anonymized_text`.
5. **PII redaction is real, rule-based (regex) code**, ported from the
   design system's `redact()` and extended with CNPJ and CEP. It is the
   MVP layer; an NER model can replace it behind the same interface later.
6. **Mock scope for Milestone 1:** no authentication yet. `POST /api/cases`
   takes `client_id` in the body. Auth is a later milestone.
7. **IDs are UUIDs** (non-enumerable case URLs).

## Milestones (each ends at a STOP for user approval)

- **M1 — Backend + Neon:** config, PII redaction, models, Alembic migration
  applied to Neon, `/api/cases` endpoints. STOP: show models.
- **M2 — Frontend + design system:** `create-next-app` + shadcn, port tokens
  and components, install missing deps. STOP: frontend compiles.
- **M3 — Actor pages:** `/client`, `/judge`, `/lawyer` wired to FastAPI.
  STOP: both dev servers running, URLs handed over.

## Milestone 3 — decisions from the NotebookLM sources (2026-10-14)

Sources read via NotebookLM: PRD (e6fea043), Arquitetura e Tech Stack (27129b7d),
Lógica de Negócio - Probabilidade e Matchmaking (68bee6f2), Diretrizes de
Segurança/LGPD/PbD (82f35993). Where they conflict with M1, they win.

**Schema (Arquitetura doc)**
- `User`: + `password_hash`.
- `Case`: + `title` (stored redacted only), `ai_probability_score` (0–100, nullable),
  `lawyer_id` (nullable FK, set on match); `status` enum becomes
  `DRAFT, AWAITING_APPROVAL, READY_FOR_JUDGE, EVALUATED, IN_MEDIATION, RESOLVED`
  (`DRAFT` kept for fidelity; unused because redaction is synchronous).
- `CaseReview`: `score` replaced by `score_evidence` and `score_jurisprudence`
  (integers 0–10 — the Arquitetura doc says 1–10, the Probabilidade doc 0–10; we accept
  the superset), `notes` (redacted); one review per judge per case.
- `raw_text` is **encrypted at rest** (Segurança doc: mandatory) with Fernet/MultiFernet,
  keys from `RAW_TEXT_KEYS` (comma-separated, first key encrypts, all decrypt → rotation).

**Lifecycle and who moves it**
`POST /cases` (client) → `AWAITING_APPROVAL` → client approves → `READY_FOR_JUDGE` →
first judge review → `EVALUATED` (score recomputed on every review) → lawyer requests
match → `IN_MEDIATION` (lawyer assigned) → lawyer registers agreement → `RESOLVED`.
Client may delete own case while `AWAITING_APPROVAL` or `READY_FOR_JUDGE` (LGPD).

**Score (Probabilidade doc)**
judge score = (evidence + jurisprudence) / 2; `ai_probability_score` =
mean of judge scores × 10, rounded to 1 decimal. The doc says "weighted average" without
weights → equal weights. Tiers: high ≥ 80, mid 60–79, low < 60. High: suggest agreement
as the faster path; mid/low: warn about risk and costs, strong CTA to the mediator.

**Auth & RBAC (Arquitetura doc: JWT)**
- HS256 JWT (`JWT_SECRET` ≥ 32 chars, 60 min) in an httpOnly, SameSite=Lax cookie;
  role is read from the DB on every request, not trusted from the token.
- Passwords hashed with Argon2 (pwdlib). Public sign-up creates CLIENT only; JUDGE,
  LAWYER and ADMIN accounts are created by a server-side script.
- CLIENT: create, approve, delete, read own cases (owner view includes `raw_text`).
  JUDGE: queue of anonymized cases not yet reviewed by them; submit review; never sees
  `raw_text` or other judges' scores. LAWYER: board of evaluated cases + own
  mediations; match; resolve; never sees `raw_text`. ADMIN: no endpoints in the MVP.
- Not owner → 404 (no enumeration). Invalid transition → 409.
- The frontend reaches the API through a Next.js rewrite (`/api/*` → FastAPI), so the
  cookie is first-party and CORS is not on the request path.

**Redaction additions (Segurança doc)**: financial amounts (R$), bank data
(agência/conta), RG, CNH, passport — on top of the M1 set. Applies to case title, text
and judge notes.

**Out of scope for the MVP** (not specified enough to build without guessing):
payments, arbitration-chamber homologation API, LLM-based anonymization (rule-based
layer stays behind the same interface), AI lawyer matchmaking (lawyer self-assigns from
the board), ADMIN screens, login rate limiting, file upload pipeline.

## Open items

- Resolved in M3: NotebookLM sources read; `raw_text` encryption at rest is mandatory.
