import {
  Archive,
  Check,
  Clock,
  EyeOff,
  FilePen,
  Handshake,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import type { CaseStatus } from "@/lib/case-status";
import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "draft"
  | "awaiting_approval"
  | "awaiting_judge"
  | "ready_for_agreement"
  | "in_mediation"
  | "resolved"
  | "anonymized";

const CASE_STATUS_BADGE: Record<CaseStatus, BadgeStatus> = {
  DRAFT: "draft",
  AWAITING_APPROVAL: "awaiting_approval",
  READY_FOR_JUDGE: "awaiting_judge",
  EVALUATED: "ready_for_agreement",
  IN_MEDIATION: "in_mediation",
  RESOLVED: "resolved",
};

export function badgeForCaseStatus(status: CaseStatus): BadgeStatus {
  return CASE_STATUS_BADGE[status];
}
export type BadgeTone = "subtle" | "solid";

type BadgeSpec = {
  label: string;
  icon: LucideIcon;
  solidIcon?: LucideIcon;
  subtle: string;
  solid: string;
};

const BADGES: Record<BadgeStatus, BadgeSpec> = {
  draft: {
    label: "Rascunho",
    icon: FilePen,
    subtle: "border-slate-200 bg-slate-100 text-slate-700",
    solid: "border-slate-700 bg-slate-700 text-white",
  },
  awaiting_approval: {
    label: "Aguardando sua aprovação",
    icon: ShieldAlert,
    subtle: "border-primary-100 bg-primary-50 text-primary-800",
    solid: "border-primary-700 bg-primary-700 text-white",
  },
  awaiting_judge: {
    label: "Aguardando Juiz",
    icon: Clock,
    subtle: "border-warning-100 bg-warning-50 text-warning-700",
    solid: "border-warning-600 bg-warning-600 text-white",
  },
  ready_for_agreement: {
    label: "Pronto para Acordo",
    icon: Check,
    subtle: "border-sage-100 bg-sage-50 text-sage-800",
    solid: "border-sage-700 bg-sage-700 text-white shadow-md shadow-sage-700/25",
  },
  anonymized: {
    label: "Anonimizado",
    icon: EyeOff,
    solidIcon: ShieldCheck,
    subtle: "border-primary-100 bg-primary-50 text-primary-800",
    solid: "border-primary-800 bg-primary-800 text-white",
  },
  in_mediation: {
    label: "Em mediação",
    icon: Handshake,
    subtle: "border-primary-200 bg-primary-50 text-primary-700",
    solid: "border-primary-600 bg-primary-600 text-white",
  },
  resolved: {
    label: "Acordo fechado",
    icon: Archive,
    subtle: "border-slate-200 bg-slate-100 text-slate-700",
    solid: "border-slate-700 bg-slate-700 text-white",
  },
};

type StatusBadgeProps = {
  status: BadgeStatus;
  tone?: BadgeTone;
  size?: "sm" | "md";
  // Overrides the default wording where the audience differs (e.g. the admin view).
  label?: string;
  className?: string;
};

export function StatusBadge({ status, tone = "subtle", size = "md", label, className }: StatusBadgeProps) {
  const badge = BADGES[status];
  const Icon = tone === "solid" && badge.solidIcon ? badge.solidIcon : badge.icon;

  return (
    <span
      data-status={status}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
        badge[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {label ?? badge.label}
    </span>
  );
}
