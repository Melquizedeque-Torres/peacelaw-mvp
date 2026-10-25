# PeaceLaw — Account controls and board pagination (sub-project F)

Date: 2026-10-20 · Status: approved by the user's "Sim" to the follow-up list in CONTINUE.md; autonomous execution as in the site-completion spec.

## Goal
Close the follow-ups left by the plan C review: an admin can deactivate/reactivate an account and reset a password, creating privileged access needs the acting admin's password, and the lawyer board can page through more than 50 opportunities.

## Decisions
1. **Deactivation.** `users.is_active` (bool, NOT NULL, server default true). A deactivated user cannot log in and every existing token stops working (`get_current_user` rejects inactive users and deactivation bumps `token_version`). Login answers the same generic `E-mail ou senha inválidos.` (401) for an inactive account, after verifying the password, so the response does not reveal that the account exists or is inactive. An admin cannot deactivate themselves (409); because the caller is always an active admin, at least one active ADMIN always remains, so the platform cannot lock itself out (no separate last-admin rule is needed). Reactivation restores login (old sessions stay dead because the version was bumped).
2. **Password reset by an admin.** `POST /api/admin/users/{id}/reset-password` with the new password (12–128). It sets the hash and bumps `token_version` (all sessions of that user end). Not allowed on yourself (409, use change-password). The admin communicates the new password out of band; the user changes it via `/conta/senha`.
3. **Step-up re-authentication.** Creating an ADMIN account and resetting a password require the acting admin's own current password in the request (`admin_password`). Wrong value → 400 `Senha atual incorreta.`; its own rate-limit bucket (`stepup:{admin_id}`, 5 per 15 minutes, every attempt counts). A stolen admin cookie alone can no longer mint an admin or take over an account. The same step-up covers deactivating and reactivating ADMIN accounts (`POST /deactivate` and `/reactivate` take an optional body `{admin_password}`, required only when the target is an ADMIN; reactivating an admin restores full admin rights, so it is as sensitive as creating one). Targets of other roles stay bodyless.
4. **Audit.** New actions `user.deactivate`, `user.reactivate`, `user.reset_password`, written in the same transaction as the change; ids only.
5. **Users list** exposes `is_active`; the UI marks inactive accounts and offers two-step deactivate/reactivate, a reset-password form (new password + the admin's password) and the extra "Sua senha" field when the role is ADMIN.
6. **Lawyer board pagination.** The opportunities column loads 50 at a time with "Carregar mais". For `offset > 0` the backend returns ONLY opportunities (own mediations and resolved cases are returned on the first page only), so pages never repeat them. Ordering (suggested first, then score) is applied in SQL before `limit/offset`, so pages are consistent.

## Out of scope
Self-service password reset by e-mail (needs an e-mail provider), forced password change on first login, MFA.

## Cross-cutting
Same rules as the site-completion spec: TDD, SQLite tests, pt-BR messages in `app/errors.py`, Alembic revision `c9f5b3a28d74` chained from `b8e4a2d36f19`, migrate production before pushing code (the Vercel Git link deploys every push), production smoke test and cleanup, `CONTINUE.md` updated.
