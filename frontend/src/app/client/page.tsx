"use client";

import { ClientWorkspace } from "@/features/client/ClientWorkspace";
import { RoleGate } from "@/lib/session";

export default function ClientPage() {
  return (
    <RoleGate role="CLIENT">
      <ClientWorkspace />
    </RoleGate>
  );
}
