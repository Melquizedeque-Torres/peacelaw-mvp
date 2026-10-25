# E — Rule-Based Lawyer Matchmaking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients label the area of their dispute, lawyers declare the areas they handle, and the lawyer board highlights and prioritises the cases that fit ("Indicado para você"). Pure rules; no external AI.

**Architecture:** `cases.area` (enum) set in the wizard; `lawyer_areas(user_id, area)` association table with `GET/PUT /api/lawyer/areas`; the board query returns each opportunity with `area` and `suggested`, ordering suggested first, then by score. Areas are not personal data and are visible to judges and lawyers.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-site-completion-design.md` (section E). Prerequisite: plan A finished. Read `alembic heads` before writing the revision.

## Global Constraints
- Areas (verbatim): `CONSUMIDOR`, `CIVIL`, `TRABALHISTA`, `FAMILIA`, `ALUGUEL`, `EMPRESARIAL`, `OUTROS` (default `OUTROS`). UI labels: Consumidor, Civil, Trabalhista, Família, Aluguel, Empresarial, Outros.
- Existing behaviour must hold: own mediations and resolved cases always appear in full on the board; only opportunities are paginated; `POST /api/cases/{id}/match` stays a conditional UPDATE and is NOT restricted by area (a lawyer may still take any evaluated case).
- Backend from `backend/`; frontend from `frontend/`; tests never touch Neon; pt-BR messages; token classes only.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Update `CONTINUE.md` at the end.

---

### Task 1: Data model, migration and case area

**Files:** Modify `backend/app/models.py` (`CaseArea`, `Case.area`, `LawyerArea`), `backend/app/schemas.py` (`CaseCreate.area`, `CaseOwnerView.area`, `CaseForJudge.area`, `CaseForLawyer.area`+`suggested`), `backend/app/routers/cases.py`; Create migration `backend/migrations/versions/b8e4a2d36f19_case_area_lawyer_areas.py`; Test `backend/tests/test_case_area.py`.

**Interfaces:** Produces `CaseArea` enum (names above), `Case.area` (non-null, default `OUTROS`, server default `'OUTROS'`), `LawyerArea(user_id FK users CASCADE, area, PK(user_id, area))`; `POST /api/cases` accepts optional `"area"`.

- [ ] **Step 1: Failing tests**

```python
from app.consent import CONSENT_VERSION
from app.models import UserRole

BODY = {"title": "Obra", "text": "Texto do caso.", "lgpd_consent": True, "consent_version": CONSENT_VERSION}


def test_area_defaults_to_outros(login):
    client, _ = login(UserRole.CLIENT)
    res = client.post("/api/cases", json=BODY)
    assert res.status_code == 201 and res.json()["area"] == "OUTROS"


def test_area_is_stored_and_validated(login):
    client, _ = login(UserRole.CLIENT)
    ok = client.post("/api/cases", json={**BODY, "area": "ALUGUEL"})
    assert ok.json()["area"] == "ALUGUEL"
    bad = client.post("/api/cases", json={**BODY, "area": "PENAL"})
    assert bad.status_code == 422


def test_judges_see_the_area_without_pii(login):
    client, _ = login(UserRole.CLIENT)
    cid = client.post("/api/cases", json={**BODY, "area": "CONSUMIDOR"}).json()["id"]
    client.post(f"/api/cases/{cid}/approve")
    judge, _ = login(UserRole.JUDGE)
    assert judge.get("/api/judge/queue").json()[0]["area"] == "CONSUMIDOR"
```

- [ ] **Step 2: Implement.** `CaseArea(str, enum.Enum)` in `models.py`; `Case.area: Mapped[CaseArea] = mapped_column(Enum(CaseArea, name="case_area"), default=CaseArea.OUTROS, server_default="OUTROS")`; `LawyerArea` model with composite PK. Migration: create the `case_area` enum type, add `cases.area` with `server_default='OUTROS'` NOT NULL, create `lawyer_areas` (`user_id` Uuid FK `users.id` ondelete CASCADE, `area` same enum with `create_type=False` after creating the type once, composite primary key); downgrade drops the table, column, then the enum type. `CaseCreate.area: CaseArea = CaseArea.OUTROS`; copy into `Case(... area=payload.area)`. Add `area` to `CaseOwnerView`, `CaseForJudge`, and `CaseForLawyer`; update the key-set assertions in existing judge/lawyer tests.
- [ ] **Step 3:** tests + full suite → PASS. Commit `feat(matchmaking): case area and lawyer areas tables`.

### Task 2: Lawyer areas API and suggested ordering

**Files:** Modify `backend/app/routers/lawyer.py`, `backend/app/schemas.py` (`LawyerAreasIn/Out`); Test `backend/tests/test_lawyer_matching.py`.

**Interfaces:** `GET /api/lawyer/areas` → `{"areas": ["CIVIL", …]}` sorted; `PUT /api/lawyer/areas` body `{"areas": [...]}` (0–7 unique valid values) replaces the set (atomic delete + insert) → same shape; board items gain `suggested: bool`.

- [ ] **Step 1: Failing tests**

```python
def test_areas_round_trip_and_reject_bad_input(login):
    lawyer, _ = login(UserRole.LAWYER)
    assert lawyer.get("/api/lawyer/areas").json() == {"areas": []}
    assert lawyer.put("/api/lawyer/areas", json={"areas": ["CIVIL", "ALUGUEL", "CIVIL"]}).json() == {"areas": ["ALUGUEL", "CIVIL"]}
    assert lawyer.put("/api/lawyer/areas", json={"areas": ["PENAL"]}).status_code == 422
    assert lawyer.put("/api/lawyer/areas", json={"areas": []}).json() == {"areas": []}


def test_only_lawyers_manage_areas(login):
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.ADMIN):
        c, _ = login(role)
        assert c.get("/api/lawyer/areas").status_code == 403
        assert c.put("/api/lawyer/areas", json={"areas": []}).status_code == 403


def test_board_puts_suggested_opportunities_first(login, evaluated_case, session):
    # Create two evaluated cases: low score in ALUGUEL, high score in CIVIL.
    low = evaluated_case(3, 3)
    high = evaluated_case(9, 9)
    session.execute(update(Case).where(Case.id == uuid.UUID(low)).values(area=CaseArea.ALUGUEL))
    session.execute(update(Case).where(Case.id == uuid.UUID(high)).values(area=CaseArea.CIVIL))
    session.commit()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["ALUGUEL"]})
    board = lawyer.get("/api/lawyer/board").json()
    assert [(c["id"], c["suggested"]) for c in board] == [(low, True), (high, False)]
    lawyer.put("/api/lawyer/areas", json={"areas": []})
    assert [c["id"] for c in lawyer.get("/api/lawyer/board").json()] == [high, low]  # score order, none suggested


def test_match_is_not_restricted_by_area(login, evaluated_case):
    cid = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.put("/api/lawyer/areas", json={"areas": ["TRABALHISTA"]})
    assert lawyer.post(f"/api/cases/{cid}/match").status_code == 200
```

(import `uuid`, `update`, `Case`, `CaseArea`, `UserRole` at the top.)

- [ ] **Step 2: Implement.** `LawyerAreasIn(areas: Annotated[list[CaseArea], Field(max_length=7)])` with a validator that de-duplicates. `PUT`: `db.execute(delete(LawyerArea).where(LawyerArea.user_id == lawyer.id))`, insert the unique set, commit. In `board`, load the lawyer's areas once, then for opportunities order by `case((Case.area.in_(areas), 0), else_=1)` first (skip the clause when `areas` is empty to keep the old order exactly), then the existing score/created/id order; set `case.suggested = case.area in areas` on each opportunity (own mediations and resolved: `suggested=False`). `CaseForLawyer.suggested: bool = False`.
- [ ] **Step 3:** tests + full suite → PASS. Commit `feat(matchmaking): lawyer areas and suggested ordering`.

### Task 3: Frontend — area in the wizard, areas picker and badge on the board

**Files:** Modify `frontend/src/lib/api.ts`, `frontend/src/features/client/NewCaseWizard.tsx`, `frontend/src/features/lawyer/LawyerBoard.tsx`, `frontend/src/features/lawyer/CaseCard.tsx`, `frontend/src/features/judge/*` card; Create `frontend/src/lib/case-area.ts`, `frontend/src/features/lawyer/AreasPicker.tsx`; Tests `frontend/src/features/lawyer/matching.test.tsx` and updates to `client.test.tsx`, `lawyer.test.tsx`.

**Interfaces:**

```ts
// case-area.ts
export const CASE_AREAS = ["CONSUMIDOR","CIVIL","TRABALHISTA","FAMILIA","ALUGUEL","EMPRESARIAL","OUTROS"] as const;
export type CaseArea = (typeof CASE_AREAS)[number];
export const AREA_LABEL: Record<CaseArea, string> = { CONSUMIDOR: "Consumidor", CIVIL: "Civil", TRABALHISTA: "Trabalhista", FAMILIA: "Família", ALUGUEL: "Aluguel", EMPRESARIAL: "Empresarial", OUTROS: "Outros" };
// api.ts
createCase(title, text, lgpdConsent, consentVersion, area?: CaseArea)   // sends "area" when given
lawyerAreas: () => request<{ areas: CaseArea[] }>("/api/lawyer/areas"),
setLawyerAreas: (areas: CaseArea[]) => request<{ areas: CaseArea[] }>("/api/lawyer/areas", { method: "PUT", body: JSON.stringify({ areas }) }),
```

`CaseSummary`/`CaseForJudge`/`CaseForLawyer` gain `area: CaseArea`; `CaseForLawyer` gains `suggested: boolean`. (If `request` only allows POST helpers for bodies, `PUT` already works through `request(path, {method, body})`; make sure the `allow_methods` of CORS in `main.py` includes `PUT` — add it and a test.)

- [ ] **Step 1: Failing tests.** Wizard step 1 has a `Área do caso` select with the seven labels defaulting to Outros; submitting passes the chosen area to `api.createCase` (assert the 5th argument). `AreasPicker` shows seven checkboxes reflecting `api.lawyerAreas`, saves with `api.setLawyerAreas` on change and shows "Áreas salvas."; the board refetches after saving. `CaseCard` shows a badge "Indicado para você" only when `suggested` and always shows the area label; a judge card shows the area label.
- [ ] **Step 2: Implement** (selects/checkboxes use existing `components/ui` primitives; label `Áreas em que atuo`).
- [ ] **Step 3:** `npm test`, lint, `tsc`, build green; backend suite still green after the CORS change. Commit `feat(matchmaking): area selection, areas picker and suggestion badge`.

### Task 4: Deploy and verify

- [ ] Apply the migration to `peacelaw-prod` with the owner role; re-grant `lawyer_areas` to `peacelaw_app` (`grant select, insert, update, delete on lawyer_areas to peacelaw_app`); deploy.
- [ ] Smoke (agent-browser): client creates an ALUGUEL case, approve, judge scores; lawyer without areas sees score order; after selecting Aluguel the case shows "Indicado para você" and moves first; cleanup test data.
- [ ] Update `CONTINUE.md`; commit and push.

## Self-review
- Spec E coverage: `cases.area` and wizard (T1, T3), `lawyer_areas` + GET/PUT (T2), `suggested` and ordering (T2), badge (T3), prod check (T4). Match stays unrestricted.
- Names consistent: `CaseArea`, `LawyerArea`, `suggested`, `AREA_LABEL`, `setLawyerAreas`.
