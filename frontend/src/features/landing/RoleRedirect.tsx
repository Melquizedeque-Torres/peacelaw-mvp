"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { HOME_FOR_ROLE } from "@/lib/api";
import { useSession } from "@/lib/session";

export function RoleRedirect() {
  const router = useRouter();
  const { state } = useSession();
  const role = state.status === "authenticated" ? state.user.role : null;
  const target = role ? HOME_FOR_ROLE[role] : null;

  useEffect(() => {
    if (target && target !== "/") router.replace(target);
  }, [target, router]);

  if (role === "ADMIN") {
    return (
      <p role="status" className="mx-auto max-w-5xl px-4 py-4 text-slate-700">
        Abrindo a área administrativa…
      </p>
    );
  }
  return null;
}
