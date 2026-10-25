"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { FieldErrors } from "@/components/FieldErrors";
import { Button } from "@/components/ui/button";
import { ApiError, api, type FieldError } from "@/lib/api";
import { useSession } from "@/lib/session";

import { inputClass } from "./styles";

const MIN_PASSWORD = 12;

export function RegisterForm() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Hidden routes stay mounted (Activity): never keep the password around.
  useEffect(() => () => setPassword(""), []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const user = await api.register(email, password);
      setPassword("");
      setUser(user);
      router.replace("/client");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível criar a conta. Tente novamente.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="font-serif text-2xl text-slate-900">Criar conta de cliente</h1>
      <div className="space-y-1.5">
        <label htmlFor="register-email" className="text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="register-password" className="text-sm font-medium text-slate-700">
          Senha
        </label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          aria-describedby="register-password-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <p id="register-password-hint" className="text-xs text-slate-500">
          Mínimo de 12 caracteres.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}
      <FieldErrors errors={fieldErrors} />
      <Button type="submit" disabled={submitting || password.length < MIN_PASSWORD} className="w-full">
        Criar conta
      </Button>
      <p className="text-center text-sm text-slate-600">
        Já tem conta?{" "}
        <Link href="/login" className="text-primary underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  );
}
