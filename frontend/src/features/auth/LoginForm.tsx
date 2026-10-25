"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { ApiError, HOME_FOR_ROLE, api, type FieldError } from "@/lib/api";
import { useSession } from "@/lib/session";

import { inputClass } from "./styles";

export function LoginForm() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Hidden routes stay mounted (Activity): never keep the password around.
  useEffect(
    () => () => {
      setPassword("");
      setCode("");
    },
    [],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const user = needsCode ? await api.login(email, password, code) : await api.login(email, password);
      setPassword("");
      setCode("");
      setUser(user);
      router.replace(HOME_FOR_ROLE[user.role]);
    } catch (e) {
      if (e instanceof ApiError && e.totpRequired) {
        // Password accepted: keep it in the form and ask for the second factor.
        setNeedsCode(true);
        setCode("");
      }
      setError(e instanceof ApiError ? e.message : "Não foi possível entrar. Tente novamente.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="font-serif text-2xl text-slate-900">Entrar</h1>
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-sm font-medium text-slate-700">
          Senha
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      {needsCode && (
        <div className="space-y-1.5">
          <label htmlFor="login-totp" className="text-sm font-medium text-slate-700">
            Código de verificação
          </label>
          <input
            id="login-totp"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            required
            maxLength={32}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby="login-totp-hint"
            className={inputClass}
          />
          <p id="login-totp-hint" className="text-xs text-slate-600">
            Digite o código de 6 dígitos do aplicativo autenticador, ou um código de recuperação.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}
      <FieldErrors errors={fieldErrors} />
      <Button type="submit" disabled={submitting} className="w-full">
        Entrar
      </Button>
      <p className="text-center text-sm text-slate-600">
        <Link href="/register" className="text-primary underline underline-offset-4">
          Criar conta de cliente
        </Link>
      </p>
    </form>
  );
}
