"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusBadge, badgeForCaseStatus } from "@/components/design-system";
import { ApiError, api, type AdminStats, type Role } from "@/lib/api";
import type { CaseStatus } from "@/lib/case-status";

const STATUSES: CaseStatus[] = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "READY_FOR_JUDGE",
  "EVALUATED",
  "IN_MEDIATION",
  "RESOLVED",
];

const ROLES: { role: Role; label: string }[] = [
  { role: "CLIENT", label: "Clientes" },
  { role: "JUDGE", label: "Juízes" },
  { role: "LAWYER", label: "Advogados" },
  { role: "ADMIN", label: "Administradores" },
];

const ACTIVITY: { key: keyof AdminStats["last_24h"]; label: string }[] = [
  { key: "audit_events", label: "Ações administrativas" },
  { key: "stepup_failures", label: "Senhas de admin erradas" },
  { key: "rate_limit_hits", label: "Tentativas contadas pelo limite" },
];

// The default badge speaks to the client ("sua aprovação"); the admin view is neutral.
const ADMIN_AWAITING_APPROVAL = "Aguardando aprovação do cliente";

const linkClass = "text-primary underline-offset-4 hover:underline";

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [status, setStatus] = useState("Carregando painel…");
  const [error, setError] = useState("");
  const [totpOff, setTotpOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .adminStats()
      .then((result) => {
        if (cancelled) return;
        setStats(result);
        setStatus("");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("");
        setError(e instanceof ApiError ? e.message : "Não foi possível carregar o painel.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A nudge only: any failure just hides it.
    api.totpStatus().then(
      (result) => {
        if (!cancelled) setTotpOff(!result.enabled);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-slate-900">
      <h1 className="font-serif text-2xl font-bold">Painel administrativo</h1>
      <p role="status" className="text-sm">
        {status}
      </p>
      <p role="alert" className="text-sm font-medium text-danger-700">
        {error}
      </p>

      {totpOff && (
        <p role="note" className="rounded-lg border border-warning-600 bg-warning-50 p-3 text-sm text-slate-900">
          Sua conta de administrador ainda não tem verificação em duas etapas.{" "}
          <Link href="/conta/seguranca" className={`${linkClass} underline`}>
            Ativar agora
          </Link>
        </p>
      )}

      {stats && (
        <>
          <section aria-labelledby="admin-cases" className="space-y-3">
            <h2 id="admin-cases" className="text-lg font-semibold">
              Casos por status
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STATUSES.map((s) => (
                <li
                  key={s}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <StatusBadge
                    status={badgeForCaseStatus(s)}
                    size="sm"
                    label={s === "AWAITING_APPROVAL" ? ADMIN_AWAITING_APPROVAL : undefined}
                  />
                  <span className="text-2xl font-semibold">{stats.cases_by_status[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="admin-roles" className="space-y-3">
            <h2 id="admin-roles" className="text-lg font-semibold">
              Usuários por perfil
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map(({ role, label }) => (
                <li
                  key={role}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className="text-2xl font-semibold">{stats.users_by_role[role] ?? 0}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="admin-activity" className="space-y-3">
            <h2 id="admin-activity" className="text-lg font-semibold">
              Atividade nas últimas 24 horas
            </h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {ACTIVITY.map(({ key, label }) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className="text-2xl font-semibold">{stats.last_24h[key]}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <nav aria-label="Administração" className="flex flex-wrap gap-6 text-sm">
        <Link href="/admin/users" className={linkClass}>
          Gerenciar usuários
        </Link>
        <Link href="/admin/pitch" className={linkClass}>
          Kit de pitch
        </Link>
      </nav>
    </main>
  );
}
