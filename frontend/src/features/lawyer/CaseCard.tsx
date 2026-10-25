import { StatusBadge, badgeForCaseStatus, formatScore, tierFor, type Tier } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import type { CaseForLawyer } from "@/lib/api";
import { AREA_LABEL } from "@/lib/case-area";
import { isEvaluated, isInMediation } from "@/lib/case-status";
import { evidenceCountLabel } from "@/lib/evidence";
import { cn } from "@/lib/utils";

const CHIP: Record<Tier, string> = {
  high: "border-sage-100 bg-sage-50 text-sage-800",
  mid: "border-warning-100 bg-warning-50 text-warning-700",
  low: "border-danger-100 bg-danger-50 text-danger-700",
};

export const cardTitleId = (id: string) => `lawyer-card-title-${id}`;

type CaseCardProps = {
  item: CaseForLawyer;
  busy: boolean;
  onAssume: (item: CaseForLawyer) => void;
  onResolve: (item: CaseForLawyer) => void;
  onView: (item: CaseForLawyer, opener: HTMLElement) => void;
};

// Action buttons use aria-disabled (not disabled) while busy so keyboard focus is never dropped.
export function CaseCard({ item, busy, onAssume, onResolve, onView }: CaseCardProps) {
  const score = item.ai_probability_score;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3
        id={cardTitleId(item.id)}
        tabIndex={-1}
        className="font-serif text-base font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-700"
      >
        {item.title}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={badgeForCaseStatus(item.status)} size="sm" />
        <span className="inline-flex h-[26px] items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700">
          {AREA_LABEL[item.area]}
        </span>
        {item.suggested && (
          <span className="inline-flex h-[26px] items-center rounded-full border border-primary-700 bg-white px-2.5 text-xs font-semibold text-primary-700">
            Indicado para você
          </span>
        )}
        {score !== null && (
          <span
            className={cn(
              "inline-flex h-[26px] items-center rounded-full border px-2.5 text-xs font-medium",
              CHIP[tierFor(score)],
            )}
          >
            {`Chance de êxito: ${formatScore(score)}%`}
          </span>
        )}
        <span className="text-xs text-slate-600">{new Date(item.created_at).toLocaleDateString("pt-BR")}</span>
        {evidenceCountLabel(item.evidence_count) && (
          <span className="text-xs text-slate-600">{evidenceCountLabel(item.evidence_count)}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isEvaluated(item.status) && (
          <Button size="sm" aria-disabled={busy || undefined} onClick={() => onAssume(item)}>
            Assumir mediação
          </Button>
        )}
        {isInMediation(item.status) && (
          <Button size="sm" aria-disabled={busy || undefined} onClick={() => onResolve(item)}>
            Registrar acordo
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={(event) => onView(item, event.currentTarget)}>
          Ver caso
        </Button>
      </div>
    </li>
  );
}
