"use client";

import { FileText, Mic, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MAX_FILES, UploadZone, formatFileSize } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { ApiError, api, type Evidence } from "@/lib/api";

// Plays the owner's voice note in the page: fetched on demand, shown with native controls.
function EvidenceAudio({ caseId, item }: { caseId: string; item: Evidence }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const blob = await api.evidenceBlob(caseId, item.id);
      const next = URL.createObjectURL(blob);
      urlRef.current = next;
      setUrl(next);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    return (
      <audio controls autoPlay src={url} className="order-last h-10 w-full basis-full" aria-label={`Ouvir ${item.filename}`} />
    );
  }
  return (
    <span className="order-last flex w-full basis-full items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={load} aria-label={`Ouvir ${item.filename}`}>
        {loading ? "Carregando…" : "Ouvir"}
      </Button>
      {failed && <span className="text-xs text-danger-600">Não foi possível carregar o áudio.</span>}
    </span>
  );
}

type EvidenceListProps = {
  caseId: string;
  editable: boolean;
  /** Render nothing while the list is empty (e.g. after the original was erased). */
  hideWhenEmpty?: boolean;
  /** Show an upload control (only while fewer than 5 files are attached). */
  canAdd?: boolean;
};

export function EvidenceList({ caseId, editable, hideWhenEmpty = false, canAdd = false }: EvidenceListProps) {
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listEvidence(caseId)
      .then((result) => {
        if (cancelled) return;
        setItems(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Não foi possível carregar os anexos.");
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  async function remove(item: Evidence) {
    setRemoving(item.id);
    setError(null);
    try {
      await api.deleteEvidence(caseId, item.id);
      setItems((prev) => (prev ?? []).filter((other) => other.id !== item.id));
      setConfirmingId(null);
      setAnnouncement("Anexo removido.");
      headingRef.current?.focus();
    } catch (e) {
      setConfirmingId(null);
      setError(e instanceof ApiError ? e.message : "Não foi possível remover o anexo.");
    } finally {
      setRemoving(null);
    }
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setUploadErrors([]);
    const failures: string[] = [];
    let count = items?.length ?? 0;
    for (const file of files) {
      if (count >= MAX_FILES) {
        failures.push(`Não foi possível enviar ${file.name}: Limite de 5 arquivos por caso.`);
        continue;
      }
      try {
        await api.uploadEvidence(caseId, file);
        count += 1;
        // Refresh after each success so the list matches what the server stored.
        setItems(await api.listEvidence(caseId));
        setAnnouncement(`${file.name} anexado.`);
      } catch (e) {
        failures.push(`Não foi possível enviar ${file.name}${e instanceof ApiError ? `: ${e.message}` : "."}`);
      }
    }
    setUploadErrors(failures);
    setUploading(false);
  }

  if (hideWhenEmpty && items && items.length === 0 && !error) return null;

  return (
    <section aria-labelledby={`evidence-title-${caseId}`} className="space-y-3">
      <h2
        ref={headingRef}
        tabIndex={-1}
        id={`evidence-title-${caseId}`}
        className="font-medium text-slate-900 focus:outline-none"
      >
        Anexos
      </h2>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}
      {uploadErrors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-danger-600">
          {uploadErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {items && items.length === 0 && <p className="text-sm text-slate-600">Nenhum anexo.</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-slate-200 bg-white p-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-sage-50 text-sage-700">
                {item.content_type.startsWith("audio/") ? (
                  <Mic aria-hidden="true" className="h-[18px] w-[18px]" />
                ) : (
                  <FileText aria-hidden="true" className="h-[18px] w-[18px]" />
                )}
              </span>
              {item.content_type.startsWith("audio/") ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{item.filename}</span>
                  <EvidenceAudio caseId={caseId} item={item} />
                </>
              ) : (
                <a
                  href={api.evidenceDownloadUrl(caseId, item.id)}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary-700 underline underline-offset-2"
                >
                  {item.filename}
                </a>
              )}
              <span className="flex-none text-xs text-slate-500 tabular-nums">{formatFileSize(item.size_bytes)}</span>
              {editable &&
                (confirmingId === item.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={removing !== null}
                      onClick={() => remove(item)}
                    >
                      Confirmar remoção
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removing !== null}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={removing !== null}
                    aria-label={`Remover ${item.filename}`}
                    onClick={() => {
                      setError(null);
                      setConfirmingId(item.id);
                    }}
                    className="flex h-8 flex-none items-center gap-1 rounded-md px-2 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    Remover
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {canAdd && items && items.length < MAX_FILES && (
        <UploadZone files={[]} onFilesChange={upload} disabled={uploading} />
      )}
    </section>
  );
}
