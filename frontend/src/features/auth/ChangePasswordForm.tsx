"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { ApiError, api, type FieldError } from "@/lib/api";

import { inputClass } from "./styles";

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  // Hidden routes stay mounted (Activity): never keep passwords around.
  useEffect(
    () => () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    [],
  );

  function clear() {
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError(null);
    setFieldErrors([]);
    setDone(false);
    if (next !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    busy.current = true;
    setSubmitting(true);
    try {
      await api.changePassword(current, next);
      clear();
      setDone(true);
    } catch (e) {
      clear();
      setError(e instanceof ApiError ? e.message : "Não foi possível alterar a senha. Tente novamente.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="font-serif text-2xl text-slate-900">Alterar senha</h1>
      <div className="space-y-1.5">
        <label htmlFor="change-current" className="text-sm font-medium text-slate-700">
          Senha atual
        </label>
        <input
          id="change-current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={MAX_PASSWORD}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="change-new" className="text-sm font-medium text-slate-700">
          Nova senha
        </label>
        <input
          id="change-new"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          aria-describedby="change-new-hint"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputClass}
        />
        <p id="change-new-hint" className="text-xs text-slate-500">
          Mínimo de 12 caracteres. Seus outros dispositivos serão desconectados.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="change-confirm" className="text-sm font-medium text-slate-700">
          Confirmar nova senha
        </label>
        <input
          id="change-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
      </div>
      <p role="alert" className="text-sm text-danger-700">
        {error}
      </p>
      <FieldErrors errors={fieldErrors} />
      <p role="status" className="text-sm font-medium text-sage-800">
        {done ? "Senha alterada." : ""}
      </p>
      <Button type="submit" disabled={submitting || next.length < MIN_PASSWORD} className="w-full">
        Alterar senha
      </Button>
    </form>
  );
}
