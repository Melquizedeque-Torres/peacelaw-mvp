"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api, type TotpSetup, type TotpStatus } from "@/lib/api";

import { inputClass } from "./styles";

type Step = "idle" | "scan" | "codes";

export function TwoFactorSettings() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  // Hidden routes stay mounted (Activity): never keep secrets around.
  useEffect(
    () => () => {
      setPassword("");
      setCode("");
      setSetup(null);
      setRecovery([]);
    },
    [],
  );

  async function refresh() {
    try {
      setStatus(await api.totpStatus());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar o estado da verificação.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    api.totpStatus().then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar o estado da verificação.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<void>, failure: string) {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failure);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  function onStart(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await api.totpSetup(password);
      setPassword("");
      setSetup(result);
      setStep("scan");
    }, "Não foi possível iniciar a configuração.");
  }

  function onEnable(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await api.totpEnable(code);
      setCode("");
      setSetup(null);
      setRecovery(result.recovery_codes);
      setStep("codes");
      await refresh();
    }, "Não foi possível ativar a verificação.");
  }

  function onDisable(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api.totpDisable(password, code);
      setPassword("");
      setCode("");
      setMessage("Verificação em duas etapas desativada.");
      await refresh();
    }, "Não foi possível desativar a verificação.");
  }

  const label = "text-sm font-medium text-slate-700";

  return (
    <section
      aria-labelledby="twofa-title"
      className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 id="twofa-title" className="font-serif text-2xl text-slate-900">
        Verificação em duas etapas
      </h1>
      <p role="status" className="text-sm font-medium text-sage-800">
        {message}
      </p>
      <p role="alert" className="text-sm font-medium text-danger-700">
        {error}
      </p>

      {status === null && !error && <p className="text-sm text-slate-600">Carregando…</p>}

      {status && step === "codes" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Verificação ativada. Guarde estes códigos de recuperação em um lugar seguro: cada um vale uma vez e só
            aparece agora.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-900">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={() => {
              setRecovery([]);
              setStep("idle");
            }}
          >
            Guardei os códigos
          </Button>
        </div>
      )}

      {status && step === "scan" && setup && (
        <form onSubmit={onEnable} className="space-y-4">
          <p className="text-sm text-slate-700">
            No aplicativo autenticador (Google Authenticator, Authy, 1Password…), adicione uma conta digitando esta
            chave manualmente, e informe o código de 6 dígitos que ele mostrar.
          </p>
          <p className="break-all rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-900" aria-label="Chave secreta">
            {setup.secret}
          </p>
          <div className="space-y-1.5">
            <label htmlFor="twofa-code" className={label}>
              Código do aplicativo
            </label>
            <input
              id="twofa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || code.trim().length < 6}>
              Ativar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setSetup(null);
                setCode("");
                setStep("idle");
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {status && step === "idle" && !status.enabled && (
        <form onSubmit={onStart} className="space-y-4">
          <p className="text-sm text-slate-700">
            Proteja sua conta com um segundo fator: além da senha, o login passa a pedir um código do seu celular.
            Recomendado para administradores.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="twofa-password" className={label}>
              Sua senha
            </label>
            <input
              id="twofa-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button type="submit" disabled={submitting || !password}>
            Configurar
          </Button>
        </form>
      )}

      {status && step === "idle" && status.enabled && (
        <form onSubmit={onDisable} className="space-y-4">
          <p className="text-sm text-slate-700">
            A verificação em duas etapas está <strong>ativa</strong>. Códigos de recuperação restantes:{" "}
            {status.recovery_codes_left}.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="twofa-off-password" className={label}>
              Sua senha
            </label>
            <input
              id="twofa-off-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="twofa-off-code" className={label}>
              Código do aplicativo ou de recuperação
            </label>
            <input
              id="twofa-off-code"
              type="text"
              autoComplete="one-time-code"
              required
              maxLength={32}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button type="submit" variant="outline" disabled={submitting || !password || !code}>
            Desativar
          </Button>
        </form>
      )}
    </section>
  );
}
