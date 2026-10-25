"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";

export function AppHeader({ title }: { title: string }) {
  const router = useRouter();
  const { state, setUser, beginLogout, endLogout } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    setError(null);
    // Set before the call: a 401 fires the unauthorized handler before it resolves.
    beginLogout();
    try {
      await api.logout();
    } catch (e) {
      // 401 means the session is already gone; anything else leaves the cookie
      // alive server-side, so keep the user signed in and tell them.
      if (!(e instanceof ApiError && e.status === 401)) {
        endLogout();
        setError("Não foi possível sair. Tente novamente.");
        setBusy(false);
        return;
      }
    }
    setUser(null);
    router.replace("/");
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-lg font-semibold text-primary">PeaceLaw</span>
          <span className="text-sm text-slate-600">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {state.status === "authenticated" && (
            <span className="text-sm text-slate-600">{state.user.email}</span>
          )}
          <Link href="/conta/senha" className="text-sm text-primary underline-offset-4 hover:underline">
            Alterar senha
          </Link>
          <Link href="/conta/seguranca" className="text-sm text-primary underline-offset-4 hover:underline">
            Segurança
          </Link>
          <Button variant="outline" size="sm" disabled={busy} onClick={logout}>
            Sair
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mx-auto max-w-5xl px-4 pb-3 text-sm text-danger-700">
          {error}
        </p>
      )}
    </header>
  );
}
