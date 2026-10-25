"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppHeader } from "@/components/AppHeader";
import { ProbabilityCard, StatusBadge } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { AnonymizedText } from "@/features/client/AnonymizedText";
import { ApiError, api, type CaseForJudge } from "@/lib/api";
import { AREA_LABEL } from "@/lib/case-area";
import { evidenceCountLabel } from "@/lib/evidence";
import { cn } from "@/lib/utils";

import { ScoreSlider } from "./ScoreSlider";

const SIZES = [18, 20, 22, 24, 26, 28, 32];
const DEFAULT_SIZE_INDEX = 1;
const DEFAULT_SCORE = 5;
const RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-700 focus-visible:ring-offset-[3px]";
// aria-disabled (not disabled) so keyboard focus is not lost when a limit is reached.
const STEP_BUTTON = cn(
  "flex h-14 w-16 items-center justify-center rounded-lg border-2 border-slate-900 bg-white text-slate-900 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
  RING,
);

const liveScore = (evidence: number, jurisprudence: number) =>
  ((evidence + jurisprudence) / 2) * 10;
const formatAverage = (value: number) => value.toFixed(1).replace(".", ",");

export function JudgeWorkspace() {
  const [queue, setQueue] = useState<CaseForJudge[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sizeIndex, setSizeIndex] = useState(DEFAULT_SIZE_INDEX);
  const [evidence, setEvidence] = useState(DEFAULT_SCORE);
  const [jurisprudence, setJurisprudence] = useState(DEFAULT_SCORE);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Two always-mounted live regions: announcements are reliable only when the region pre-exists.
  const [status, setStatus] = useState("Carregando fila…");
  const [error, setError] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .judgeQueue()
      .then((result) => {
        if (cancelled) return;
        setQueue(result);
        setStatus("");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("");
        setError(
          e instanceof ApiError
            ? e.message
            : "Não foi possível carregar a fila.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    queue?.find((item) => item.id === selectedId) ?? queue?.[0] ?? null;
  const fontSize = SIZES[sizeIndex];

  // Runs after render, so the new heading (or the empty message) already exists.
  useEffect(() => {
    if (focusRequest === 0) return;
    (headingRef.current ?? emptyRef.current)?.focus();
  }, [focusRequest]);

  function resetForm() {
    setEvidence(DEFAULT_SCORE);
    setJurisprudence(DEFAULT_SCORE);
    setNotes("");
  }

  function dropFromQueue(id: string) {
    if (!queue) return;
    const index = queue.findIndex((item) => item.id === id);
    const rest = queue.filter((item) => item.id !== id);
    setQueue(rest);
    // Only move the selection when the dropped case is the one being read.
    if (selected?.id === id) {
      setSelectedId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
      resetForm();
    }
    setFocusRequest((n) => n + 1);
  }

  function select(id: string) {
    if (busy || id === selected?.id) return;
    setSelectedId(id);
    resetForm();
    setError("");
    setStatus("");
  }

  function changeSize(delta: number) {
    const next = sizeIndex + delta;
    if (next < 0 || next >= SIZES.length) return;
    setSizeIndex(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await api.submitReview(selected.id, {
        score_evidence: evidence,
        score_jurisprudence: jurisprudence,
        notes: notes.trim() || undefined,
      });
      dropFromQueue(selected.id);
      setStatus("Avaliação registrada.");
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : "Não foi possível registrar a avaliação.";
      // 404/409: deleted by its owner, already reviewed, or moved on. It is no longer reviewable.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        setError(`«${selected.title}» foi removido da fila: ${message}`);
        dropFromQueue(selected.id);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader title="Avaliação de casos" />
      <main className="mx-auto max-w-7xl px-4 py-6 text-slate-900">
        <h1 className="mb-4 font-serif text-2xl font-bold">Avaliação de casos</h1>
        <p
          role="status"
          className={cn(
            "text-lg font-semibold",
            status && "mb-4 rounded-lg border-2 border-sage-700 bg-white p-3",
          )}
        >
          {status}
        </p>
        <p
          role="alert"
          className={cn(
            "text-lg font-semibold text-red-800",
            error && "mb-4 rounded-lg border-2 border-red-800 bg-white p-3",
          )}
        >
          {error}
        </p>
        {queue && queue.length === 0 && (
          <p ref={emptyRef} tabIndex={-1} className="text-lg">
            Nenhum caso aguardando avaliação.
          </p>
        )}

        {queue && selected && (
          <div className="space-y-4">
            <nav aria-label="Fila de casos">
              <ul className="flex flex-wrap gap-2">
                {queue.map((item) => (
                  <li key={item.id} className="max-w-full shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      aria-current={
                        item.id === selected.id ? "true" : undefined
                      }
                      onClick={() => select(item.id)}
                      className={cn(
                        "flex max-w-full flex-wrap items-baseline gap-x-2 rounded-lg border-2 px-3 py-2 text-left text-base disabled:opacity-60",
                        item.id === selected.id
                          ? "border-primary-700 bg-slate-100"
                          : "border-slate-300 bg-white",
                        RING,
                      )}
                    >
                      <span className="font-semibold">{item.title}</span>
                      <span className="text-sm text-slate-700">{AREA_LABEL[item.area]}</span>
                      <span className="text-sm text-slate-700">
                        {new Date(item.created_at).toLocaleDateString("pt-BR")}
                      </span>
                      {evidenceCountLabel(item.evidence_count) && (
                        <span className="text-sm text-slate-700">{evidenceCountLabel(item.evidence_count)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <article
                aria-label="Documento do caso"
                className="min-w-0 rounded-xl border-2 border-slate-200 bg-white p-6"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2
                      ref={headingRef}
                      tabIndex={-1}
                      className={cn("font-serif text-2xl font-bold", RING)}
                    >
                      {selected.title}
                    </h2>
                    <StatusBadge status="anonymized" />
                  </div>
                  <div
                    role="group"
                    aria-label="Tamanho do texto"
                    className="flex items-center gap-2"
                  >
                    <button
                      type="button"
                      aria-label="Diminuir texto"
                      aria-disabled={sizeIndex === 0}
                      onClick={() => changeSize(-1)}
                      className={STEP_BUTTON}
                    >
                      <Minus className="size-6" aria-hidden="true" />
                    </button>
                    <span
                      className="min-w-14 text-center text-lg font-semibold tabular-nums"
                      aria-hidden="true"
                    >
                      {fontSize}px
                    </span>
                    <button
                      type="button"
                      aria-label="Aumentar texto"
                      aria-disabled={sizeIndex === SIZES.length - 1}
                      onClick={() => changeSize(1)}
                      className={STEP_BUTTON}
                    >
                      <Plus className="size-6" aria-hidden="true" />
                    </button>
                    <span aria-live="polite" className="sr-only">
                      {`Tamanho do texto: ${fontSize} px`}
                    </span>
                  </div>
                </div>
                <div data-font-size={fontSize} style={{ fontSize }}>
                  <AnonymizedText
                    text={selected.anonymized_text}
                    className="font-serif leading-[1.75] text-slate-900"
                  />
                </div>
              </article>

              <div className="space-y-4 p-1 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
                <div>
                  <ProbabilityCard
                    audience="professional"
                    note="Prévia calculada a partir das suas notas."
                    score={liveScore(evidence, jurisprudence)}
                  />
                  <p className="mt-2 text-base text-slate-700">
                    Prévia da sua avaliação — não inclui notas de outros
                    avaliadores.
                  </p>
                </div>
                <form
                  onSubmit={submit}
                  className="space-y-6 rounded-xl border-2 border-slate-200 bg-white p-6"
                >
                  <h2 className="text-2xl font-bold">Sua avaliação</h2>
                  <ScoreSlider
                    id="score-evidence"
                    label="Provas"
                    value={evidence}
                    onChange={setEvidence}
                  />
                  <ScoreSlider
                    id="score-jurisprudence"
                    label="Jurisprudência"
                    value={jurisprudence}
                    onChange={setJurisprudence}
                  />
                  <p aria-live="polite" className="text-xl font-bold">
                    {`Nota do avaliador: ${formatAverage((evidence + jurisprudence) / 2)}`}
                  </p>
                  <div className="space-y-2">
                    <label
                      htmlFor="review-notes"
                      className="text-xl font-semibold"
                    >
                      Observações (opcional)
                    </label>
                    <p
                      id="review-notes-hint"
                      className="text-base text-slate-700"
                    >
                      Não inclua dados pessoais.
                    </p>
                    <textarea
                      id="review-notes"
                      aria-describedby="review-notes-hint"
                      maxLength={2000}
                      rows={5}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className={cn(
                        "w-full rounded-lg border-2 border-slate-900 bg-white p-3 text-lg text-slate-900",
                        RING,
                      )}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={busy}
                    className="h-14 w-full text-lg"
                  >
                    Enviar avaliação
                  </Button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
