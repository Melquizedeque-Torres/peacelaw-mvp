# PeaceLaw — Product Requirements (MVP)

Source of truth: the NotebookLM notebooks (PRD, Arquitetura e Tech Stack,
Probabilidade e Matchmaking, Segurança/LGPD/PbD, Design System e UX, Compliance
LGPD, Compliance OAB). This file summarizes what the MVP implements; details and
rulings are in `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md`.

## Core concept
Online Dispute Resolution (ODR) platform with predictive scoring and lawyer
mediation. A client describes a dispute; the text is anonymized and approved by
the client; judges score the anonymized case; the platform computes the
probability of success in court and suggests mediation; a lawyer mediator takes
the case to an agreement.

## Actors
| Actor | UI | Responsibilities |
|---|---|---|
| Client (Demandante) | Wizard | Submits title + report, reviews and approves the anonymized version, sees the probability score, may delete the case before evaluation. |
| Judge (Avaliador) | Split-view (accessible, WCAG AAA target) | Reads only the anonymized case; scores "Provas" and "Jurisprudência" (0–10) and writes notes. |
| Lawyer (Mediador) | Kanban | Sees evaluated cases (anonymized), assumes a case for mediation, registers the agreement. |
| Admin | — | Arbitration chambers and payments (out of MVP scope). |

## Case lifecycle
`DRAFT` → `AWAITING_APPROVAL` (client) → `READY_FOR_JUDGE` (judges) →
`EVALUATED` (score available) → `IN_MEDIATION` (lawyer assigned) → `RESOLVED`

## Probability score
- Judge score = (Provas + Jurisprudência) / 2, each 0–10.
- `ai_probability_score` = mean of judge scores × 10 (%).
- ≥ 80%: agreement suggested as the faster path. < 60%: risk warning and a strong
  call to action for the mediator. 60–79%: moderate.

## Privacy by Design (non-negotiable)
- ALL case texts (title, report, judge notes) pass through the PII redaction layer
  before being stored for third-party viewing.
- The client approves the anonymized version before any judge can see it.
- `raw_text` is encrypted at rest and visible only to the case owner. It is never
  returned by any API consumed by judges or lawyers.
- Third parties only ever see anonymized data. Judges do not see other judges'
  scores.
- PII covered by the MVP redaction layer: e-mail, CPF, CNPJ, RG, CNH, passport,
  phone, CEP, street address, company names, person names, financial amounts,
  bank data.

## Access
JWT session (httpOnly cookie), role-based access control; public sign-up creates
clients only.
