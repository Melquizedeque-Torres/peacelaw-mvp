"use client";

import { JudgeWorkspace } from "@/features/judge/JudgeWorkspace";
import { RoleGate } from "@/lib/session";

export default function JudgePage() {
  return (
    <RoleGate role="JUDGE">
      <JudgeWorkspace />
    </RoleGate>
  );
}
