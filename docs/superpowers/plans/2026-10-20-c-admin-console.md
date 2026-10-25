# C — Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ADMIN accounts a console to see platform counts and manage accounts (create JUDGE/LAWYER/ADMIN, revoke sessions), give every user a way to change their password, and record an audit trail with no personal data.

**Architecture:** Extend `app/routers/admin.py` (already ADMIN-only via `AdminUser`), add `audit_events`, add `POST /api/auth/change-password`, and add `/admin` + `/admin/users` pages behind `RoleGate role="ADMIN"`. Admins see metadata only, never case text, originals or evidence.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-site-completion-design.md` (section C). Prerequisite: plan A finished; plan B optional (independent). Latest Alembic head must be read with `alembic heads` before writing the new revision (expected `f6c2e1b58d03` if B ran, else `e5b1d0a47c92`).

## Global Constraints
- Backend from `backend/`; frontend from `frontend/`; tests never touch Neon; pt-BR messages in `app/errors.py`; token classes only.
- Account rules reuse `scripts/create_user.py` semantics: roles `JUDGE|LAWYER|ADMIN` only, password 12–128 characters, e-mail normalized by `Email` type in `app/schemas.py`, an existing e-mail is never modified.
- The audit table stores `actor_id`, `action`, `target_id`, timestamp only. No e-mails, no IPs, no free text.
- Passwords are never logged, echoed or returned. The admin sets the initial password in the form; the new user is told to change it.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Update `CONTINUE.md` at the end.

---

### Task 1: Change password for every role

**Files:** Modify `backend/app/routers/auth.py`, `backend/app/schemas.py`, `backend/app/errors.py`; Test `backend/tests/test_change_password.py`.

**Interfaces:** Produces `POST /api/auth/change-password` body `{current_password, new_password}` → 204; schema `ChangePasswordIn`; error `WRONG_PASSWORD = "Senha atual incorreta."`.

- [ ] **Step 1: Failing tests**

```python
from app.models import UserRole
from app.security.passwords import verify_password
from tests.conftest import PASSWORD

NEW = "uma-senha-nova-bem-longa-1"


def test_changes_password_revokes_other_sessions_and_keeps_this_one(login, session):
    client, user = login(UserRole.JUDGE)
    other = client.__class__(client.app)
    assert other.post("/api/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 200
    res = client.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": NEW})
    assert res.status_code == 204
    session.refresh(user)
    assert verify_password(NEW, user.password_hash)
    assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200  # a fresh cookie was issued


def test_wrong_current_password_is_rejected(login):
    client, _ = login(UserRole.CLIENT)
    res = client.post("/api/auth/change-password", json={"current_password": "errada-errada-1", "new_password": NEW})
    assert res.status_code == 400 and res.json()["detail"] == "Senha atual incorreta."


def test_requires_login_and_validates_length(login, client_factory):
    assert client_factory().post("/api/auth/change-password", json={"current_password": "a", "new_password": NEW}).status_code == 401
    client, _ = login(UserRole.CLIENT)
    assert client.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "curta"}).status_code == 422


def test_is_rate_limited(login):
    client, _ = login(UserRole.CLIENT)
    codes = [client.post("/api/auth/change-password", json={"current_password": "x" * 12, "new_password": NEW}).status_code for _ in range(7)]
    assert codes[:5] == [400] * 5 and codes[-1] == 429
```

- [ ] **Step 2: Implement.** `ChangePasswordIn`: `current_password: str (1..128)`, `new_password: str (12..128)`. Endpoint: `ratelimit.check_change_password(request, user.id)` (new helper in `ratelimit.py`: key `change-password:{user_id}`, limit `rate_limit("RATE_LIMIT_CHANGE_PASSWORD_PER_15MIN", 5)`, window `LOGIN_WINDOW`); verify with `verify_password`; on mismatch 400 `errors.WRONG_PASSWORD`; else set `user.password_hash = hash_password(new)`, `user.token_version += 1` via atomic `update(...)`, commit, refresh, call `_start_session(response, user)` so this browser stays signed in. Return 204.
- [ ] **Step 3:** run tests + full suite → PASS. Commit `feat(auth): change password with session revocation`.

### Task 2: Audit log and admin account management API

**Files:** Modify `backend/app/models.py` (`AuditEvent`), `backend/app/routers/admin.py`, `backend/app/schemas.py`, `backend/app/errors.py`; Create migration `backend/migrations/versions/a7d3f9c15e48_audit_events.py` (`down_revision` = current head); Test `backend/tests/test_admin_users_api.py`.

**Interfaces:**
- Produces: `AuditEvent(id, actor_id, action, target_id, created_at)`; `app/audit.py: record(db, actor_id, action, target_id=None) -> None` (adds, does not commit); endpoints:
  - `GET /api/admin/stats` → `{"cases_by_status": {"AWAITING_APPROVAL": 0, …all six statuses…}, "users_by_role": {"CLIENT": n, "JUDGE": n, "LAWYER": n, "ADMIN": n}}`
  - `GET /api/admin/users?limit&offset` → `[{id, email, role, created_at}]` ordered by `created_at desc, id`
  - `POST /api/admin/users` body `{email, role, password}` → 201 `UserOut` (409 `EMAIL_TAKEN` if exists; role `CLIENT` rejected with 422)
  - `POST /api/admin/users/{id}/revoke-sessions` → 204 (404 unknown; atomic `token_version + 1`)
  - audit actions: `"user.create"`, `"user.revoke_sessions"`.

- [ ] **Step 1: Failing tests** (key assertions): non-admin roles get 403 on all four endpoints and anonymous 401; stats counts match seeded data (create one judge, one case in `READY_FOR_JUDGE`) and contain all six statuses and four roles with zeros; stats and users responses never contain `raw_text`, `anonymized_text`, `title`; `POST /api/admin/users` creates a JUDGE who can then log in, creates one `audit_events` row `user.create` with `target_id` = new id and no e-mail anywhere in `str(row.__dict__)`; duplicate e-mail → 409 and no row changed; `role="CLIENT"` → 422; revoke-sessions makes the target's existing session fail with 401 and writes `user.revoke_sessions`; an admin can revoke themselves (allowed, they get 401 next call); limit/offset honored (limit 101 → 422).
- [ ] **Step 2: Implement** `AuditEvent` model (`id` UUID PK, `actor_id` FK users `ondelete=SET NULL` nullable, `action` String(40), `target_id` UUID nullable no FK, `created_at` server default now) and the migration; `AdminUserCreate(email: Email, role: Literal["JUDGE","LAWYER","ADMIN"], password: 12..128)`. Create the user exactly like `register` (hash with `hash_password`, `IntegrityError` → 409), call `audit.record(...)` before the commit so both succeed or fail together. Stats via two grouped queries; fill missing keys with 0.
- [ ] **Step 3:** tests + full suite → PASS. Commit `feat(admin): stats, user management and audit log`.

### Task 3: Frontend — admin console and password change

**Files:**
- Modify: `frontend/src/lib/api.ts` (types/methods), `frontend/src/lib/api.test.ts`, `frontend/src/components/AppHeader.tsx` (link "Alterar senha")
- Create: `frontend/src/app/admin/page.tsx`, `frontend/src/app/admin/users/page.tsx`, `frontend/src/app/conta/senha/page.tsx`, `frontend/src/features/admin/AdminDashboard.tsx`, `frontend/src/features/admin/UsersAdmin.tsx`, `frontend/src/features/auth/ChangePasswordForm.tsx`
- Test: `frontend/src/features/admin/admin-console.test.tsx`, `frontend/src/features/auth/change-password.test.tsx`
- Modify: `HOME_FOR_ROLE.ADMIN` → `"/admin"`; `/admin` page links to `/admin/users` and `/admin/pitch`; update `admin.test.tsx` expectation.

**Interfaces (api.ts):**

```ts
export type AdminStats = { cases_by_status: Record<string, number>; users_by_role: Record<Role, number> };
export type AdminUser = { id: string; email: string; role: Role; created_at: string };
adminStats: () => request<AdminStats>("/api/admin/stats"),
adminUsers: (page?: Page) => request<AdminUser[]>(withPage("/api/admin/users", page)),
adminCreateUser: (email: string, role: Exclude<Role, "CLIENT">, password: string) => post<User>("/api/admin/users", { email, role, password }),
adminRevokeSessions: (id: string) => post<void>(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`),
changePassword: (current: string, next: string) => post<void>("/api/auth/change-password", { current_password: current, new_password: next }),
```

- [ ] **Step 1: Failing tests.** Dashboard renders the six status counts with `StatusBadge` labels and the role counts. `UsersAdmin`: lists users; the create form (fields `E-mail`, `Perfil` select with Juiz/Advogado/Administrador, `Senha inicial` with `minLength=12`) submits via `api.adminCreateUser`, clears the password field afterwards, shows "Conta criada." and refetches; server error text is shown in a `role="alert"`; "Encerrar sessões" asks a second confirmation click (like case delete) then calls `adminRevokeSessions`. `ChangePasswordForm`: mismatch between new and confirmation shows "As senhas não conferem." without calling the API; success shows "Senha alterada."; server 400 text is shown. Password inputs use `autoComplete="new-password"` / `"current-password"`.
- [ ] **Step 2: Implement** with the patterns of `features/lawyer/LawyerBoard.tsx` and `features/auth/RegisterForm.tsx`: pages wrap `RoleGate role="ADMIN"` + `AppHeader`; `/conta/senha` is wrapped in a gate that accepts any authenticated user (add `AuthGate` to `lib/session.tsx` that redirects anonymous users to `/login`; test it in `session.test.tsx`). Password fields must be cleared on success and never persisted (see the earlier fix for hidden `/login` under React Activity: clear state in an effect cleanup).
- [ ] **Step 3:** `npm test`, lint, `tsc`, build green. Commit `feat(admin): console, users management and password change UI`.

### Task 4: Deploy and verify

- [ ] Apply migration(s) to `peacelaw-prod` with the owner role and re-grant (`grant select, insert, update, delete on audit_events to peacelaw_app`); `vercel deploy --prod --scope <seu-time-vercel>`.
- [ ] Smoke (agent-browser): create the first real ADMIN via `scripts.create_user` (password from a temp file), sign in, open `/admin`, create a judge, sign in as the judge, change the password, confirm the old password no longer works and an old session is dead; check `audit_events` has two rows without e-mails; delete smoke users and rows.
- [ ] Update `CONTINUE.md`; commit and push.

## Self-review
- Spec C coverage: stats (T2), users list/create/revoke (T2), change-password (T1), audit log (T2), pages (T3), prod check (T4).
- Names consistent: `ChangePasswordIn`, `AuditEvent`, `audit.record`, `adminStats`, `adminUsers`, `adminCreateUser`, `adminRevokeSessions`, `changePassword`.
