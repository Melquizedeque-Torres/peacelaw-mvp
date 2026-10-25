"use client";

import { LawyerBoard } from "@/features/lawyer/LawyerBoard";
import { RoleGate } from "@/lib/session";

export default function LawyerPage() {
  return (
    <RoleGate role="LAWYER">
      <LawyerBoard />
    </RoleGate>
  );
}
