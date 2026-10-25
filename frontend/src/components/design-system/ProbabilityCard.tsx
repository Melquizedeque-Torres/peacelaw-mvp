import { Info, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

export type Tier = "high" | "mid" | "low";
export type ProbabilityFactor = { direction: "up" | "down"; label: string };

export type Audience = "client" | "professional";
type Copy = { headline: string; copy: string };

type TierSpec = {
  label: string;
  copy: Record<Audience, Copy>;
  chip: string;
  dot: string;
  text: string;
  stroke: string;
  bar: string;
};

const TIERS: Record<Tier, TierSpec> = {
  high: {
    label: "Alta",
    copy: {
      client: {
        headline: "Seu caso tem boas chances",
        copy: "Mesmo com boas chances, um processo pode levar anos. Um acordo mediado tende a ser a via mais rápida para receber.",
      },
      professional: {
        headline: "Alta probabilidade de êxito no Judiciário",
        copy: "Avaliadores consideram as provas e a jurisprudência favoráveis. Bom cenário para propor acordo rápido.",
      },
    },
    chip: "border-sage-100 bg-sage-50 text-sage-800",
    dot: "bg-sage-600",
    text: "text-sage-800",
    stroke: "stroke-sage-600",
    bar: "bg-sage-600",
  },
  mid: {
    label: "Média",
    copy: {
      client: {
        headline: "Seu caso tem chances moderadas",
        copy: "Há pontos em aberto. Um acordo mediado reduz o risco de perda e as custas do processo.",
      },
      professional: {
        headline: "Probabilidade moderada de êxito",
        copy: "Resultado incerto no Judiciário; a mediação reduz risco para as duas partes.",
      },
    },
    chip: "border-warning-100 bg-warning-50 text-warning-700",
    dot: "bg-warning-500",
    text: "text-warning-700",
    stroke: "stroke-warning-500",
    bar: "bg-warning-500",
  },
  low: {
    label: "Baixa",
    copy: {
      client: {
        headline: "Seu caso tem risco alto",
        copy: "Há risco relevante de perda e de arcar com custas processuais. A mediação com um advogado é o caminho de menor risco.",
      },
      professional: {
        headline: "Baixa probabilidade de êxito",
        copy: "Alto risco de perda no Judiciário; priorize um acordo mediado.",
      },
    },
    chip: "border-danger-100 bg-danger-50 text-danger-700",
    dot: "bg-danger-500",
    text: "text-danger-700",
    stroke: "stroke-danger-500",
    bar: "bg-danger-500",
  },
};

const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function tierFor(score: number): Tier {
  return score >= 80 ? "high" : score >= 60 ? "mid" : "low";
}

// Clamps to 0-100 and truncates to one decimal, so the shown number can never
// cross a tier boundary the raw score has not crossed (79.96 shows 79,9, not 80).
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const clamped = Math.min(100, Math.max(0, score));
  return Math.floor(clamped * 10 + 1e-9) / 10;
}

/** pt-BR display: up to one decimal with a comma (79,6 / 80). */
export function formatScore(score: number): string {
  return String(clampScore(score)).replace(".", ",");
}

type ProbabilityCardProps = {
  score: number;
  caseLabel?: string;
  factors?: ProbabilityFactor[];
  audience?: Audience;
  /** Replaces the default statistical disclaimer. */
  note?: string;
  className?: string;
};

export function ProbabilityCard({ score, caseLabel, factors = [], audience = "client", note, className }: ProbabilityCardProps) {
  const value = clampScore(score);
  const shown = formatScore(score);
  const tier = TIERS[tierFor(value)];
  const { headline, copy } = tier.copy[audience];
  const factorsId = useId();

  return (
    <section
      className={cn(
        "flex flex-col gap-[22px] rounded-xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-900/5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">
            <Scale aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[15px] font-semibold text-slate-900">Probabilidade de êxito</h3>
            {caseLabel && <span className="text-xs text-slate-500">{caseLabel}</span>}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-200",
            tier.chip,
          )}
        >
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", tier.dot)} />
          {tier.label}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div
          className="relative h-[132px] w-[132px] flex-none"
          role="img"
          aria-label={`Score ${shown} por cento, probabilidade ${tier.label.toLowerCase()}`}
        >
          <svg width="132" height="132" className="-rotate-90" aria-hidden="true">
            <circle cx="66" cy="66" r={RADIUS} fill="none" strokeWidth="10" className="stroke-slate-100" />
            <circle
              cx="66"
              cy="66"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * value) / 100} 999`}
              className={cn("transition-all duration-300 ease-out", tier.stroke)}
            />
          </svg>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-[34px] leading-none font-semibold tracking-tight text-slate-900 tabular-nums">
              {shown}%
            </span>
            <span className={cn("text-[11px] font-medium tracking-[.06em] uppercase", tier.text)}>{tier.label}</span>
          </div>
        </div>

        <div className="flex min-w-[200px] flex-1 flex-col gap-3.5">
          <p className="font-serif text-lg text-slate-900">{headline}</p>
          <p className="text-sm leading-relaxed text-slate-700">{copy}</p>
          <div className="flex flex-col gap-1.5" aria-hidden="true">
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all duration-300 ease-out", tier.bar)}
                style={{ width: `${value}%` }}
              />
              <span className="absolute inset-y-0 left-[60%] w-0.5 bg-white" />
              <span className="absolute inset-y-0 left-[80%] w-0.5 bg-white" />
            </div>
            <div className="grid grid-cols-[60fr_20fr_20fr] text-[11px] font-medium text-slate-500">
              <span>Baixa</span>
              <span>Média</span>
              <span>Alta</span>
            </div>
          </div>
        </div>
      </div>

      {factors.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-[18px]">
          <span id={factorsId} className="text-xs font-medium text-slate-500">
            Fatores considerados
          </span>
          <ul aria-labelledby={factorsId} className="flex flex-col gap-2.5">
            {factors.map((factor, index) => {
              const Icon = factor.direction === "up" ? TrendingUp : TrendingDown;
              return (
                <li key={`${index}-${factor.label}`} className="flex items-center gap-2.5 text-[13px] text-slate-700">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "h-[15px] w-[15px] flex-none",
                      factor.direction === "up" ? "text-sage-600" : "text-danger-600",
                    )}
                  />
                  {factor.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-normal text-slate-500">
        <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" />
        {note ?? "Estimativa estatística baseada em decisões similares. Não constitui decisão judicial."}
      </p>
    </section>
  );
}
