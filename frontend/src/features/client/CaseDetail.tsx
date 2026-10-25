"use client";

import { useEffect, useState } from "react";

import { ProbabilityCard, StatusBadge, badgeForCaseStatus, tierFor } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { ApiError, api, type CaseOwnerView } from "@/lib/api";
import { AREA_LABEL } from "@/lib/case-area";
import { canDelete, isAwaitingJudges, isEvaluated, isInMediation, isResolved } from "@/lib/case-status";
import { useHeadingFocus } from "@/lib/use-heading-focus";

import { EvidenceList } from "./EvidenceList";
import { CaseActions, EraseOriginal, OwnerTexts, formatDate } from "./CaseReview";

export function CaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [item, setItem] = useState<CaseOwnerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useHeadingFocus<HTMLHeadingElement>(item !== null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCase(id)
      .then((result) => {
        if (!cancelled) setItem(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar o caso.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = (
    <Button variant="outline" onClick={onBack}>
      Voltar
    </Button>
  );

  if (!item) {
    return (
      <section className="space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        ) : (
          <p role="status" className="text-slate-600">
            Carregando caso…
          </p>
        )}
        {back}
      </section>
    );
  }

  const score = item.ai_probability_score;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="font-serif text-2xl text-slate-900 focus:outline-none">
          {item.title}
        </h1>
        <StatusBadge status={badgeForCaseStatus(item.status)} />
      </div>
      <p className="text-sm text-slate-700">{`Área: ${AREA_LABEL[item.area]}`}</p>
      <OwnerTexts anonymizedText={item.anonymized_text} rawText={item.raw_text} erasedAt={item.raw_text_erased_at} />
      {item.consent_at && (
        <p className="text-xs text-slate-600">
          {`Consentimento LGPD${item.consent_version ? ` (versão ${item.consent_version})` : ""} registrado em ${formatDate(item.consent_at)}`}
        </p>
      )}

      <EvidenceList
        caseId={item.id}
        editable={canDelete(item.status)}
        canAdd={canDelete(item.status) && !item.raw_text_erased_at}
        hideWhenEmpty={!!item.raw_text_erased_at}
      />

      {score !== null && (
        <>
          <ProbabilityCard score={score} audience="client" />
          {tierFor(score) === "high" ? (
            <div className="rounded-xl border border-sage-500/40 bg-sage-50 p-4 text-sm text-sage-700">
              Um acordo agora tende a ser a via mais rápida para receber.
            </div>
          ) : (
            <div className="space-y-1 rounded-xl border border-danger-600/30 bg-danger-50 p-4 text-sm text-danger-600">
              <p role="alert" className="font-medium">
                Atenção: há risco de perda e de custas processuais.
              </p>
              {isEvaluated(item.status) && <p>Seu caso está disponível para advogados mediadores.</p>}
            </div>
          )}
        </>
      )}

      {isAwaitingJudges(item.status) && (
        <p className="text-sm text-slate-700">Aguardando avaliação dos juízes.</p>
      )}
      {isInMediation(item.status) && (
        <p className="text-sm text-slate-700">Um advogado mediador assumiu seu caso.</p>
      )}
      {isResolved(item.status) && <p className="text-sm text-slate-700">Acordo registrado.</p>}

      {!item.raw_text_erased_at && <EraseOriginal id={item.id} onErased={setItem} disabled={busy} onBusyChange={setBusy} />}
      <CaseActions
        id={item.id}
        status={item.status}
        onApproved={setItem}
        onDeleted={onBack}
        disabled={busy}
        onBusyChange={setBusy}
      />
      {back}
    </section>
  );
}
