# F — Account Controls and Board Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can deactivate/reactivate accounts and reset passwords; creating an ADMIN or resetting a password needs the acting admin's own password; the lawyer board can page through all opportunities.

**Architecture:** `users.is_active` + checks in login and `get_current_user`; three new ADMIN endpoints plus a step-up check helper with its own rate-limit bucket; audit rows in the same transaction; backend board returns only opportunities for `offset > 0`; admin UI and board UI extended.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-account-controls-design.md`.

## Global Constraints
- Backend from `backend/` with `.venv/Scripts/python -m …`; frontend from `frontend/`; tests never touch Neon; never read or print `backend/.env`; pt-BR messages in `app/errors.py`; token classes only in components; Next.js 16 (read `frontend/AGENTS.md` before framework-level changes).
- Passwords are never logged, echoed or returned; audit rows hold ids and action codes only.
- Alembic revision `c9f5b3a28d74`, `down_revision = "b8e4a2d36f19"`; verify `alembic heads` shows one head; never run alembic against a real database in a task (the controller migrates production before pushing).
- Existing key-set assertions are updated, never loosened. Existing tests (backend ~460, frontend ~268) stay green.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not run any curl alert. Update `CONTINUE.md` at the end.

---

### Task 1: Deactivation (model, migration, login, session check, admin endpoints)

**Files:**
- Modify: `backend/app/models.py` (`User.is_active`), `backend/app/deps.py` (`get_current_user`/`user_from_token`), `backend/app/routers/auth.py` (`login`), `backend/app/routers/admin.py`, `backend/app/schemas.py` (`AdminUserOut.is_active`), `backend/app/errors.py`
- Create: `backend/migrations/versions/c9f5b3a28d74_user_is_active.py`
- Test: `backend/tests/test_deactivation.py`

**Interfaces — Produces:** `User.is_active: bool`; `POST /api/admin/users/{id}/deactivate` and `/reactivate` (ADMIN, 204, 404 `USER_NOT_FOUND`, audit `user.deactivate`/`user.reactivate`); `AdminUserOut` gains `is_active`; errors `CANNOT_DEACTIVATE_SELF = "Você não pode desativar a própria conta."`.

- [ ] **Step 1: Failing tests** `backend/tests/test_deactivation.py` (adapt names to the fixtures in `tests/conftest.py`: `login`, `client_factory`, `make_user`, `session`, `PASSWORD`):

```python
from sqlalchemy import select

from app.models import AuditEvent, User, UserRole
from tests.conftest import PASSWORD


def test_deactivate_blocks_login_and_kills_sessions(login, make_user, client_factory):
    admin, _ = login(UserRole.ADMIN)
    judge_client, judge = login(UserRole.JUDGE)
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    assert judge_client.get("/api/auth/me").status_code == 401
    fresh = client_factory()
    res = fresh.post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    assert res.status_code == 401 and res.json()["detail"] == "E-mail ou senha inválidos."


def test_inactive_and_wrong_password_look_identical(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    a = client_factory().post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    b = client_factory().post("/api/auth/login", json={"email": judge.email, "password": "outra-senha-qualquer-1"})
    assert (a.status_code, a.json()) == (b.status_code, b.json())


def test_reactivate_restores_login(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    assert admin.post(f"/api/admin/users/{judge.id}/reactivate").status_code == 204
    res = client_factory().post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    assert res.status_code == 200


def test_cannot_deactivate_self(login):
    admin, me = login(UserRole.ADMIN)
    res = admin.post(f"/api/admin/users/{me.id}/deactivate")
    assert res.status_code == 409 and res.json()["detail"] == "Você não pode desativar a própria conta."
    assert admin.get("/api/auth/me").status_code == 200


def test_another_admin_can_be_deactivated_and_caller_stays_active(login, make_user):
    admin, _ = login(UserRole.ADMIN)
    other = make_user(UserRole.ADMIN)
    assert admin.post(f"/api/admin/users/{other.id}/deactivate").status_code == 204
    assert admin.get("/api/auth/me").status_code == 200


def test_audit_rows_and_listing(login, session):
    admin, me = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    admin.post(f"/api/admin/users/{judge.id}/reactivate")
    actions = [r.action for r in session.scalars(select(AuditEvent).order_by(AuditEvent.created_at))]
    assert actions == ["user.deactivate", "user.reactivate"]
    users = {u["id"]: u for u in admin.get("/api/admin/users").json()}
    assert users[str(judge.id)]["is_active"] is True and "password" not in str(users)


def test_only_admins_and_unknown_ids(login):
    client, _ = login(UserRole.LAWYER)
    assert client.post("/api/admin/users/00000000-0000-0000-0000-000000000000/deactivate").status_code == 403
    admin, _ = login(UserRole.ADMIN)
    assert admin.post("/api/admin/users/00000000-0000-0000-0000-000000000000/deactivate").status_code == 404
```


- [ ] **Step 2: Implement.** `User.is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa.true())`. Migration `c9f5b3a28d74`: `op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))`, downgrade drops the column. `login`: verify the password first (as today), then `if user is None or not verified or not user.is_active` → the same 401 `INVALID_CREDENTIALS`. `user_from_token`: return `None` when `not user.is_active`. Deactivate endpoint: 404 unknown; 409 self (the caller is always an active admin, so at least one active ADMIN always remains); then one UPDATE `is_active=False, token_version=token_version+1`, `audit.record(db, admin.id, "user.deactivate", target.id)`, commit, 204. Reactivate: UPDATE `is_active=True` (no version change), audit, 204; both idempotent on repeat (a repeat deactivate of an already inactive user is 204 and writes no second audit row). `AdminUserOut` gains `is_active`.
- [ ] **Step 3:** `.venv/Scripts/python -m pytest -q` all green; `.venv/Scripts/python -m alembic heads` single head `c9f5b3a28d74`. Commit `feat(admin): deactivate and reactivate accounts`.

### Task 2: Admin password reset, step-up re-authentication, board offset semantics

**Files:** Modify `backend/app/routers/admin.py`, `backend/app/routers/lawyer.py`, `backend/app/schemas.py` (`AdminUserCreate.admin_password`, `ResetPasswordIn`), `backend/app/security/ratelimit.py` (`check_stepup`), `backend/app/errors.py`; Test `backend/tests/test_stepup_reset.py`, `backend/tests/test_board_pagination.py`.

**Interfaces — Produces:** `POST /api/admin/users/{id}/reset-password` body `{new_password: 12..128, admin_password: str}` → 204 (audit `user.reset_password`); `POST /api/admin/users` body gains `admin_password: str | None` required (non-empty) when `role == "ADMIN"` (422 `Informe sua senha para criar um administrador.` otherwise); helper `verify_stepup(db, admin, password)` raising 400 `WRONG_PASSWORD`; `ratelimit.check_stepup(admin_id)` (key `stepup:{id}`, env `RATE_LIMIT_STEPUP_PER_15MIN`, default 5, window 15 min); `GET /api/lawyer/board?offset>0` returns ONLY opportunities.

- [ ] **Step 1: Failing tests** (adapt to real fixtures): reset-password: wrong `admin_password` → 400 and hash unchanged; correct → 204, target's old sessions dead (401), target logs in with the new password, audit row `user.reset_password` with `actor=admin`, `target=user`; self-reset → 409 (`Use "Alterar senha" para a própria conta.`); unknown id 404; non-admin 403; new password < 12 → 422; the 6th wrong step-up attempt within the window → 429 with `Retry-After`, and the step-up bucket does not affect login. Create ADMIN: without `admin_password` → 422, wrong → 400 and no user created, correct → 201; creating JUDGE/LAWYER does not require it (existing tests keep passing). Board pagination: with 3 evaluated cases, own mediation and own resolved case, `limit=2&offset=0` returns mediation + resolved + 2 opportunities, `limit=2&offset=2` returns exactly the remaining 1 opportunity and no mediation/resolved; ordering across pages is suggested-first then score, with no duplicates or gaps.
- [ ] **Step 2: Implement.** `verify_stepup`: call `ratelimit.check_stepup(admin.id)` first (every attempt counts), then `verify_password`; mismatch → 400 `errors.WRONG_PASSWORD`. Reset: atomic UPDATE of `password_hash` and `token_version + 1` guarded by `User.id == id`; audit in the same transaction. In `lawyer.board`, wrap the mediations/resolved queries in `if offset == 0` (return empty lists otherwise).
- [ ] **Step 3:** full suite green. Commit `feat(admin): step-up re-authentication, password reset and board paging`.

### Task 3: Admin UI — status, deactivate, reset, step-up

**Files:** Modify `frontend/src/lib/api.ts`, `frontend/src/features/admin/UsersAdmin.tsx` (+ new `ResetPasswordForm.tsx` if the file grows), tests in `frontend/src/features/admin/`.

**Interfaces — Produces in `api.ts`:**

```ts
export type AdminUser = { id: string; email: string; role: Role; created_at: string; is_active: boolean };
adminCreateUser: (email: string, role: Exclude<Role, "CLIENT">, password: string, adminPassword?: string) => post<User>("/api/admin/users", { email, role, password, ...(adminPassword ? { admin_password: adminPassword } : {}) }),
adminDeactivate: (id: string) => post<void>(`/api/admin/users/${encodeURIComponent(id)}/deactivate`),
adminReactivate: (id: string) => post<void>(`/api/admin/users/${encodeURIComponent(id)}/reactivate`),
adminResetPassword: (id: string, newPassword: string, adminPassword: string) => post<void>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { new_password: newPassword, admin_password: adminPassword }),
```

- [ ] **Step 1: Failing tests:** rows show an "Inativa" badge when `is_active` is false; "Desativar" is two-step (like "Encerrar sessões") and calls `adminDeactivate`; inactive rows offer "Reativar"; your own row has no deactivate/reset buttons; "Redefinir senha" opens an inline form with `Nova senha` and `Sua senha` (both `type=password`, `autoComplete="new-password"`/`"current-password"`, `maxLength=128`), submits via `adminResetPassword`, clears both fields on success and on unmount, shows "Senha redefinida." in the status region and server errors (400 `Senha atual incorreta.`, 409, 429) in a `role="alert"`; the create form shows a required `Sua senha` field only while the role select is "Administrador" and sends `adminPassword`; the field is cleared after submit; the API wrapper tests assert URLs and bodies.
- [ ] **Step 2: Implement** following the patterns already in `UsersAdmin.tsx` (single-flight guards, focus management after confirm/cancel, live regions, token classes). 
- [ ] **Step 3:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `BACKEND_URL=http://127.0.0.1:8000 npm run build` green. Commit `feat(admin): deactivate, reactivate and reset password UI`.

### Task 4: Lawyer board — load more opportunities

**Files:** Modify `frontend/src/lib/api.ts` (`lawyerBoard(page?)` already accepts a page; confirm), `frontend/src/features/lawyer/LawyerBoard.tsx`, tests `frontend/src/features/lawyer/pagination.test.tsx`.

- [ ] **Step 1: Failing tests:** when the first page returns exactly 50 `EVALUATED` cases the "Oportunidades" column shows a "Carregar mais oportunidades" button; clicking it requests `offset=50&limit=50`, appends the new cases (dedupe by id), moves focus to the first newly added card title, and hides the button when a page returns fewer than 50; a failed request shows a `role="alert"` and keeps the existing cards; the latest-request-wins guard from plan E still ignores stale responses (a slow initial load cannot overwrite a later page); saving areas (plan E picker) reloads from offset 0 and replaces the list; no button when the first page has fewer than 50 opportunities.
- [ ] **Step 2: Implement** in `LawyerBoard.tsx` using the existing request-id guard; page size constant `PAGE_SIZE = 50`; counts only `EVALUATED` cases returned by the opportunities query to decide `hasMore` (own mediations/resolved arrive only with offset 0).
- [ ] **Step 3:** full frontend suite, lint, `tsc`, build green. Commit `feat(lawyer): load more opportunities`.

### Task 5: Production rollout (controller)

- [ ] Migrate production with the owner role (`alembic upgrade head`, `alembic check`); no new grants needed (`users` already granted at table level), verify with the app role: `select is_active from users limit 1`.
- [ ] Push; wait for the Git-linked deploy; run `backend/scripts/smoke_accounts.py` (new, written by the controller): admin login, create judge, deactivate → judge login 401 and old session dead, reactivate → login 200, reset-password needs the right admin password (wrong → 400, right → 204, old password 401, new 200), create ADMIN without/with wrong/with right step-up, self-deactivate 409, board `offset` semantics, audit rows; clean up smoke data; update `CONTINUE.md`.

## Self-review
- Spec coverage: deactivation (T1), reset and step-up (T2, T3), audit (T1, T2), users list/UI (T3), board pagination (T2 backend, T4 frontend), rollout (T5).
- Names consistent: `is_active`, `verify_stepup`, `check_stepup`, `admin_password`, `adminDeactivate`, `adminReactivate`, `adminResetPassword`.
