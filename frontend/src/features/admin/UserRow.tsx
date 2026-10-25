"use client";

import type { Ref } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/features/auth/styles";
import type { AdminUser, FieldError, Role } from "@/lib/api";

import { ResetPasswordForm } from "./ResetPasswordForm";

export type ConfirmKind = "revoke" | "deactivate" | "reactivate" | "totp";

export const MAX_PASSWORD = 128;

const ROLE_LABEL: Record<Role, string> = {
  CLIENT: "Cliente",
  JUDGE: "Juiz",
  LAWYER: "Advogado",
  ADMIN: "Administrador",
};

const dateFormat = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export type UserRowProps = {
  user: AdminUser;
  isSelf: boolean;
  confirming: ConfirmKind | null;
  busy: boolean;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  confirmPasswordRef: Ref<HTMLInputElement>;
  confirmButtonRef: Ref<HTMLButtonElement>;
  registerTrigger: (key: string, el: HTMLButtonElement | null) => void;
  onOpenConfirm: (kind: ConfirmKind) => void;
  onReactivateNow: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  toggleErrors: FieldError[] | null;
  resetOpen: boolean;
  onOpenReset: () => void;
  onCloseReset: () => void;
  onError: (message: string) => void;
  onResetSuccess: (message: string) => void;
};

export function UserRow({
  user: u,
  isSelf,
  confirming,
  busy,
  confirmPassword,
  onConfirmPasswordChange,
  confirmPasswordRef,
  confirmButtonRef,
  registerTrigger,
  onOpenConfirm,
  onReactivateNow,
  onConfirm,
  onCancel,
  toggleErrors,
  resetOpen,
  onOpenReset,
  onCloseReset,
  onError,
  onResetSuccess,
}: UserRowProps) {
  const needsPassword =
    confirming === "totp" || (confirming !== null && confirming !== "revoke" && u.role === "ADMIN");
  const trigger = (key: string) => (el: HTMLButtonElement | null) => registerTrigger(`${key}:${u.id}`, el);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium">
          {u.email}
          {isSelf && <span className="font-normal text-slate-600"> (você)</span>}
        </p>
        <p className="text-sm text-slate-600">
          <span>{ROLE_LABEL[u.role]}</span> · criado em {dateFormat(u.created_at)}
          {!u.is_active && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              Inativa
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            {needsPassword && (
              <div className="flex items-center gap-2">
                <label htmlFor={`confirm-admin-${u.id}`} className="text-sm font-medium text-slate-700">
                  Sua senha
                </label>
                <input
                  id={`confirm-admin-${u.id}`}
                  ref={confirmPasswordRef}
                  type="password"
                  autoComplete="current-password"
                  maxLength={MAX_PASSWORD}
                  value={confirmPassword}
                  onChange={(e) => onConfirmPasswordChange(e.target.value)}
                  className={inputClass}
                />
              </div>
            )}
            <Button
              ref={confirmButtonRef}
              variant="destructive"
              size="sm"
              disabled={busy || (needsPassword && !confirmPassword)}
              onClick={onConfirm}
            >
              {confirming === "revoke"
                ? "Confirmar encerramento"
                : confirming === "deactivate"
                  ? "Confirmar desativação"
                  : confirming === "totp"
                    ? "Confirmar remoção do 2FA"
                    : "Confirmar reativação"}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button
              ref={trigger("revoke")}
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Encerrar sessões de ${u.email}`}
              onClick={() => onOpenConfirm("revoke")}
            >
              Encerrar sessões
            </Button>
            {!u.is_active && (
              <Button
                ref={trigger("reactivate")}
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label={`Reativar ${u.email}`}
                onClick={() => (u.role === "ADMIN" ? onOpenConfirm("reactivate") : onReactivateNow())}
              >
                Reativar
              </Button>
            )}
            {u.is_active && !isSelf && (
              <>
                <Button
                  ref={trigger("deactivate")}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-label={`Desativar ${u.email}`}
                  onClick={() => onOpenConfirm("deactivate")}
                >
                  Desativar
                </Button>
                {u.totp_enabled && (
                  <Button
                    ref={trigger("totp")}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remover verificação em duas etapas de ${u.email}`}
                    onClick={() => onOpenConfirm("totp")}
                  >
                    Remover 2FA
                  </Button>
                )}
                {!resetOpen && (
                  <Button
                    ref={trigger("reset")}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Redefinir senha de ${u.email}`}
                    onClick={onOpenReset}
                  >
                    Redefinir senha
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
      {toggleErrors && (
        <div className="w-full">
          <FieldErrors errors={toggleErrors} />
        </div>
      )}
      {resetOpen && (
        <ResetPasswordForm user={u} onClose={onCloseReset} onError={onError} onSuccess={onResetSuccess} />
      )}
    </li>
  );
}
