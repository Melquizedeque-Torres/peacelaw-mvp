"use client";

import { AppHeader } from "@/components/AppHeader";
import { UsersAdmin } from "@/features/admin/UsersAdmin";
import { RoleGate } from "@/lib/session";

export default function AdminUsersPage() {
  return (
    <RoleGate role="ADMIN">
      <AppHeader title="Usuários (admin)" />
      <UsersAdmin />
    </RoleGate>
  );
}
