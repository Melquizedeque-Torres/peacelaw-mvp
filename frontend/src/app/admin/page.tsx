"use client";

import { AppHeader } from "@/components/AppHeader";
import { AdminDashboard } from "@/features/admin/AdminDashboard";
import { RoleGate } from "@/lib/session";

export default function AdminPage() {
  return (
    <RoleGate role="ADMIN">
      <AppHeader title="Administração" />
      <AdminDashboard />
    </RoleGate>
  );
}
