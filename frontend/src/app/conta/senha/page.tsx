"use client";

import { AppHeader } from "@/components/AppHeader";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { AuthGate } from "@/lib/session";

export default function ChangePasswordPage() {
  return (
    <AuthGate>
      <AppHeader title="Minha conta" />
      <main className="mx-auto flex max-w-5xl justify-center px-4 py-8">
        <ChangePasswordForm />
      </main>
    </AuthGate>
  );
}
