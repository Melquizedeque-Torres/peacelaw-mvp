"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api, type CaseOwnerView } from "@/lib/api";
import { canApprove, canDelete, type CaseStatus } from "@/lib/case-status";

import { AnonymizedText } from "./AnonymizedText";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function OwnerTexts({
  anonymizedText,
  rawText,
  erasedAt = null,
}: {
  anonymizedText: string;
  rawText: string;
  erasedAt?: string | null;
}) {
  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <AnonymizedText text={anonymizedText} />
      </div>
      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium">Seu relato original (somente você vê)</summary>
        {erasedAt ? (
          <p className="mt-3">{`Relato original apagado em ${formatDate(erasedAt)}.`}</p>
        ) : (
          <p className="mt-3 whitespace-pre-wrap">{rawText}</p>
        )}
      </details>
    </>
  );
}

type Props = {
  id: string;
  status: CaseStatus;
  onApproved: (updated: CaseOwnerView) => void;
  onDeleted: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Another action on the same page is in flight. */
  disabled?: boolean;
};

// Approve / delete actions shared by the wizard review step and the case detail.
export function CaseActions({ id, status, onApproved, onDeleted, onBusyChange, disabled = false }: Props) {
  const [ownBusy, setBusy] = useState(false);
  const busy = ownBusy || disabled;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>, done: (result: T) => void) {
    setBusy(true);
    onBusyChange?.(true);
    setConfirming(false);
    setError(null);
    try {
      done(await action());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível concluir a operação.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const showApprove = canApprove(status);
  const showDelete = canDelete(status);
  if (!showApprove && !showDelete) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {showApprove && (
          <Button disabled={busy} onClick={() => run(() => api.approveCase(id), onApproved)}>
            Aprovar e enviar aos juízes
          </Button>
        )}
        {showDelete &&
          (confirming ? (
            <>
              <Button variant="destructive" disabled={busy} onClick={() => run(() => api.deleteCase(id), onDeleted)}>
                Confirmar exclusão
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
              Excluir caso
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}

// LGPD: owner-requested erasure of the original report, in any case status.
export function EraseOriginal({
  id,
  onErased,
  disabled = false,
  onBusyChange,
}: {
  id: string;
  onErased: (updated: CaseOwnerView) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [ownBusy, setBusy] = useState(false);
  const busy = ownBusy || disabled;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      onErased(await api.eraseOriginal(id));
    } catch (e) {
      setConfirming(false);
      setError(e instanceof ApiError ? e.message : "Não foi possível apagar o relato original.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <Button variant="destructive" disabled={busy} onClick={erase}>
              Confirmar apagamento
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <p className="text-sm text-slate-700">
              O texto anonimizado e o andamento do caso permanecem. Seus anexos também serão apagados. Esta ação não pode ser desfeita.
            </p>
          </>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
            Apagar meu relato original
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
