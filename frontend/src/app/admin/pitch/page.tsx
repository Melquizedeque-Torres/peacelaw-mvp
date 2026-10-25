"use client";

import { AppHeader } from "@/components/AppHeader";
import { PitchView } from "@/features/admin/PitchView";
import { RoleGate } from "@/lib/session";

export default function AdminPitchPage() {
  return (
    <RoleGate role="ADMIN">
      <AppHeader title="Kit de pitch (admin)" />
      <PitchView />
    </RoleGate>
  );
}
