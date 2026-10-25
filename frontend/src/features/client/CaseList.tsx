"use client";

import { useEffect, useState } from "react";

import { StatusBadge, badgeForCaseStatus, formatScore } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { ApiError, api, type CaseSummary } from "@/lib/api";
import { useHeadingFocus } from "@/lib/use-heading-focus";

type Props = { onNew: () => void; onOpen: (id: string) => void; focusHeading?: boolean };

export function CaseList({ onNew, onOpen, focusHeading = false }: Props) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>(focusHeading);
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .myCases()
      .then((result) => {
        if (!cancelled) setCases(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar os casos.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="font-serif text-2xl text-slate-900 focus:outline-none">
          Meus casos
        </h1>
        <Button onClick={onNew}>Novo caso</Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}
      {cases === null && !error && (
        <p role="status" className="text-slate-600">
          Carregando casos…
        </p>
      )}
      {cases?.length === 0 && <p className="text-slate-600">Você ainda não enviou nenhum caso.</p>}
      {cases && cases.length > 0 && (
        <ul className="space-y-3">
          {cases.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="font-medium text-slate-900">{item.title}</span>
                <span className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <StatusBadge status={badgeForCaseStatus(item.status)} size="sm" />
                  <span>{new Date(item.created_at).toLocaleDateString("pt-BR")}</span>
                  {item.ai_probability_score !== null && (
                    <span>{`Chance de êxito: ${formatScore(item.ai_probability_score)}%`}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
