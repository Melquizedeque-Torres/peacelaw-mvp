"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/features/auth/styles";
import { ApiError, api, type AdminUser, type FieldError } from "@/lib/api";
import { useSession } from "@/lib/session";

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

type Props = {
  user: AdminUser;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

// Inline "Redefinir senha" form. Neither password outlives a submit or the form itself.
export function ResetPasswordForm({ user, onClose, onSuccess, onError }: Props) {
  const { state } = useSession();
  const selfEmail = state.status === "authenticated" ? state.user.email : "";
  const [newPassword, setNewPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const busyRef = useRef(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    return () => {
      setNewPassword("");
      setAdminPassword("");
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setFieldErrors([]);
    onError("");
    try {
      await api.adminResetPassword(user.id, newPassword, adminPassword);
      setNewPassword("");
      setAdminPassword("");
      onSuccess("Senha redefinida.");
    } catch (e) {
      setNewPassword("");
      setAdminPassword("");
      onError(e instanceof ApiError ? e.message : "Não foi possível redefinir a senha. Tente novamente.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  const id = `reset-${user.id}`;
  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Redefinir senha de ${user.email}`}
      className="grid w-full gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
    >
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
      <div className="space-y-1.5">
        <label htmlFor={`${id}-new`} className="text-sm font-medium text-slate-700">
          Nova senha
        </label>
        <input
          id={`${id}-new`}
          ref={firstRef}
          type="password"
          autoComplete="off"
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-admin`} className="text-sm font-medium text-slate-700">
          Sua senha
        </label>
        <input
          id={`${id}-admin`}
          type="password"
          autoComplete="current-password"
          required
          maxLength={MAX_PASSWORD}
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-3 sm:col-span-2">
        <FieldErrors errors={fieldErrors} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={submitting || newPassword.length < MIN_PASSWORD || !adminPassword}>
            Redefinir senha
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  );
}
