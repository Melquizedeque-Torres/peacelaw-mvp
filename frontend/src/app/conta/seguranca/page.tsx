"use client";

import { AppHeader } from "@/components/AppHeader";
import { TwoFactorSettings } from "@/features/auth/TwoFactorSettings";
import { AuthGate } from "@/lib/session";

export default function SecurityPage() {
  return (
    <AuthGate>
      <AppHeader title="Minha conta" />
      <main className="mx-auto flex max-w-5xl justify-center px-4 py-8">
        <TwoFactorSettings />
      </main>
    </AuthGate>
  );
}
