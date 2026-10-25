"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/features/auth/styles";
import { ApiError, api, type AdminUser, type FieldError, type Role } from "@/lib/api";
import { useSession } from "@/lib/session";

import { MAX_PASSWORD, UserRow, type ConfirmKind } from "./UserRow";

const MIN_PASSWORD = 12;
const PAGE_SIZE = 50;

type StaffRole = Exclude<Role, "CLIENT">;

const ROLE_LABEL: Record<Role, string> = {
  CLIENT: "Cliente",
  JUDGE: "Juiz",
  LAWYER: "Advogado",
  ADMIN: "Administrador",
};
const STAFF_ROLES: StaffRole[] = ["JUDGE", "LAWYER", "ADMIN"];
const FILTERS: { value: Role | ""; label: string }[] = [
  { value: "", label: "Todos os perfis" },
  { value: "JUDGE", label: "Juízes" },
  { value: "LAWYER", label: "Advogados" },
  { value: "ADMIN", label: "Administradores" },
  { value: "CLIENT", label: "Clientes" },
];

export function UsersAdmin() {
  const { state } = useSession();
  const selfId = state.status === "authenticated" ? state.user.id : null;
  const selfEmail = state.status === "authenticated" ? state.user.email : "";
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [filter, setFilter] = useState<Role | "">("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("JUDGE");
  const [password, setPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  // Always-mounted live regions so announcements are reliable.
  const [status, setStatus] = useState("Carregando usuários…");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ id: string; kind: ConfirmKind } | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  // Step-up password typed inside the confirmation of an ADMIN row.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [toggleErrors, setToggleErrors] = useState<{ id: string; errors: FieldError[] } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const revokeRef = useRef(false);
  const toggleRef = useRef(false);
  const createRef = useRef(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  // Latest-request-wins: a response is applied only if it is still the newest request
  // and its filter is still the selected one.
  const requestId = useRef(0);
  const filterRef = useRef<Role | "">("");
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusKey = useRef<string | null>(null);

  // Hidden routes stay mounted (Activity): never keep the passwords around.
  useEffect(
    () => () => {
      setPassword("");
      setAdminPassword("");
      setConfirmPassword("");
    },
    [],
  );

  // Reloads the first page with the CURRENT filter (after a create, a status change or a stale row).
  const load = useCallback(async () => {
    const current = filterRef.current;
    const id = ++requestId.current;
    try {
      const result = await api.adminUsers({ limit: PAGE_SIZE, offset: 0 }, current || undefined);
      if (id !== requestId.current || current !== filterRef.current) return;
      setUsers(result);
      setHasMore(result.length === PAGE_SIZE);
    } catch (e) {
      if (id !== requestId.current || current !== filterRef.current) return;
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar os usuários.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    filterRef.current = filter;
    const id = ++requestId.current;
    api.adminUsers({ limit: PAGE_SIZE, offset: 0 }, filter || undefined).then(
      (result) => {
        if (cancelled || id !== requestId.current) return;
        setUsers(result);
        setHasMore(result.length === PAGE_SIZE);
        setStatus("");
      },
      (e) => {
        if (cancelled || id !== requestId.current) return;
        setStatus("");
        setError(e instanceof ApiError ? e.message : "Não foi possível carregar os usuários.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Focus follows the confirm/cancel swap and the reset form: to the confirm button,
  // and back to the trigger on cancel or when the reset form closes.
  useEffect(() => {
    if (confirm) (confirmPasswordRef.current ?? confirmButtonRef.current)?.focus();
    else if (restoreFocusKey.current && !resetId) {
      triggerRefs.current.get(restoreFocusKey.current)?.focus();
      restoreFocusKey.current = null;
    }
  }, [confirm, resetId]);

  async function loadMore() {
    if (loadingMore || !users) return;
    setLoadingMore(true);
    setError("");
    const id = requestId.current;
    try {
      const result = await api.adminUsers({ limit: PAGE_SIZE, offset: users.length }, filter || undefined);
      if (id !== requestId.current) return; // the list was reloaded or re-filtered meanwhile
      setUsers((prev) => {
        const seen = new Set((prev ?? []).map((u) => u.id));
        return [...(prev ?? []), ...result.filter((u) => !seen.has(u.id))];
      });
      setHasMore(result.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar mais usuários.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (createRef.current) return;
    createRef.current = true;
    setSubmitting(true);
    setError("");
    setStatus("");
    setFieldErrors([]);
    try {
      if (role === "ADMIN") await api.adminCreateUser(email, role, password, adminPassword);
      else await api.adminCreateUser(email, role, password);
      setPassword("");
      setAdminPassword("");
      setEmail("");
      setStatus("Conta criada.");
      emailRef.current?.focus();
      await load();
    } catch (e) {
      setPassword("");
      setAdminPassword("");
      setError(e instanceof ApiError ? e.message : "Não foi possível criar a conta. Tente novamente.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
    } finally {
      createRef.current = false;
      setSubmitting(false);
    }
  }

  async function revoke(user: AdminUser) {
    if (revokeRef.current) return;
    revokeRef.current = true;
    setRevoking(true);
    setError("");
    setStatus("");
    try {
      await api.adminRevokeSessions(user.id);
      setStatus(`Sessões de ${user.email} encerradas.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível encerrar as sessões.");
      // The account may be gone: show the list as it really is.
      if (e instanceof ApiError && e.status === 404) await load();
    } finally {
      revokeRef.current = false;
      setRevoking(false);
      closeConfirm();
      // The confirm button just unmounted; park focus on the page heading.
      titleRef.current?.focus();
    }
  }

  function openConfirm(id: string, kind: ConfirmKind) {
    setConfirmPassword("");
    setConfirm({ id, kind });
  }

  function closeConfirm() {
    setConfirm(null);
    setConfirmPassword("");
  }

  async function toggleActive(user: AdminUser, activate: boolean) {
    if (toggleRef.current) return;
    toggleRef.current = true;
    setToggling(true);
    setError("");
    setStatus("");
    setToggleErrors(null);
    // Only ADMIN targets need the acting admin's password; other rows stay bodyless.
    const call = activate ? api.adminReactivate : api.adminDeactivate;
    try {
      await (user.role === "ADMIN" ? call(user.id, confirmPassword) : call(user.id));
      setStatus(activate ? "Conta reativada." : "Conta desativada.");
      // A deactivated account has no reset form.
      if (!activate) setResetId((prev) => (prev === user.id ? null : prev));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível alterar a conta.");
      if (e instanceof ApiError && e.fieldErrors.length > 0) setToggleErrors({ id: user.id, errors: e.fieldErrors });
      if (e instanceof ApiError && e.status === 404) await load();
    } finally {
      toggleRef.current = false;
      setToggling(false);
      closeConfirm();
      titleRef.current?.focus();
    }
  }

  function registerTrigger(key: string, el: HTMLButtonElement | null) {
    if (el) triggerRefs.current.set(key, el);
    else triggerRefs.current.delete(key);
  }

  async function resetTotp(user: AdminUser) {
    if (toggleRef.current) return;
    toggleRef.current = true;
    setToggling(true);
    setError("");
    setStatus("");
    setToggleErrors(null);
    try {
      await api.adminResetTotp(user.id, confirmPassword);
      setStatus("Verificação em duas etapas removida.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível remover a verificação em duas etapas.");
      if (e instanceof ApiError && e.status === 404) await load();
    } finally {
      toggleRef.current = false;
      setToggling(false);
      closeConfirm();
      titleRef.current?.focus();
    }
  }

  function closeReset(id: string) {
    restoreFocusKey.current = `reset:${id}`;
    setResetId(null);
  }

  const busy = revoking || toggling;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-slate-900">
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="font-serif text-2xl font-bold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-700"
      >
        Usuários
      </h1>
      <Link href="/admin" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
        Voltar ao painel
      </Link>
      <p role="status" className="text-sm font-medium text-sage-800">
        {status}
      </p>
      <p role="alert" className="text-sm font-medium text-danger-700">
        {error}
      </p>

      <section aria-labelledby="users-new" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="users-new" className="mb-4 text-lg font-semibold">
          Nova conta interna
        </h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="admin-new-email" className="text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="admin-new-email"
              ref={emailRef}
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="admin-new-role" className="text-sm font-medium text-slate-700">
              Perfil
            </label>
            <select
              id="admin-new-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as StaffRole);
                setAdminPassword("");
              }}
              className={inputClass}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="admin-new-password" className="text-sm font-medium text-slate-700">
              Senha inicial
            </label>
            <input
              id="admin-new-password"
              type="password"
              autoComplete="off"
              required
              minLength={MIN_PASSWORD}
              maxLength={MAX_PASSWORD}
              aria-describedby="admin-new-password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <p id="admin-new-password-hint" className="text-xs text-slate-500">
              Mínimo de 12 caracteres.
            </p>
          </div>
          {role === "ADMIN" && (
            <div className="space-y-1.5">
              {/* Lets a password manager attribute the current-password field to the acting admin. */}
              <input
                type="text"
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                autoComplete="username"
                value={selfEmail}
                className="sr-only"
              />
              <label htmlFor="admin-new-admin-password" className="text-sm font-medium text-slate-700">
                Sua senha
              </label>
              <input
                id="admin-new-admin-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={MAX_PASSWORD}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          )}
          <div className="space-y-3 sm:col-span-3">
            <FieldErrors errors={fieldErrors} />
            <Button
              type="submit"
              disabled={submitting || password.length < MIN_PASSWORD || (role === "ADMIN" && !adminPassword)}
            >
              Criar conta
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="users-list" className="space-y-3">
        <h2 id="users-list" className="text-lg font-semibold">
          Contas cadastradas
        </h2>
        <div className="space-y-1.5">
          <label htmlFor="admin-role-filter" className="text-sm font-medium text-slate-700">
            Filtrar por perfil
          </label>
          <select
            id="admin-role-filter"
            value={filter}
            onChange={(e) => {
              closeConfirm();
              setToggleErrors(null);
              setResetId(null);
              setUsers(null);
              setHasMore(false);
              setStatus("Carregando usuários…");
              filterRef.current = e.target.value as Role | "";
              setFilter(e.target.value as Role | "");
            }}
            className={inputClass}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {users && <p className="text-sm text-slate-600">Mostrando {users.length} usuários.</p>}
        {users && users.length === 0 && <p className="text-sm text-slate-600">Nenhum usuário.</p>}
        {users && users.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === selfId}
                confirming={confirm?.id === u.id ? confirm.kind : null}
                busy={busy}
                confirmPassword={confirmPassword}
                onConfirmPasswordChange={setConfirmPassword}
                confirmPasswordRef={confirmPasswordRef}
                confirmButtonRef={confirmButtonRef}
                registerTrigger={registerTrigger}
                onOpenConfirm={(kind) => openConfirm(u.id, kind)}
                onReactivateNow={() => toggleActive(u, true)}
                onConfirm={() =>
                  confirm?.kind === "revoke"
                    ? revoke(u)
                    : confirm?.kind === "totp"
                      ? resetTotp(u)
                      : toggleActive(u, confirm?.kind === "reactivate")
                }
                onCancel={() => {
                  restoreFocusKey.current = `${confirm?.kind}:${u.id}`;
                  closeConfirm();
                }}
                toggleErrors={toggleErrors?.id === u.id ? toggleErrors.errors : null}
                resetOpen={resetId === u.id}
                onOpenReset={() => setResetId(u.id)}
                onCloseReset={() => closeReset(u.id)}
                onError={setError}
                onResetSuccess={(message) => {
                  setStatus(message);
                  closeReset(u.id);
                }}
              />
            ))}
          </ul>
        )}
        {hasMore && (
          <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
            Carregar mais
          </Button>
        )}
      </section>
    </main>
  );
}
