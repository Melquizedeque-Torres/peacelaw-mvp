"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MAX_FILES, UploadZone } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/features/auth/styles";
import { FieldErrors } from "@/components/FieldErrors";
import { ApiError, api, type CaseCreated, type FieldError } from "@/lib/api";
import { AREA_LABEL, CASE_AREAS, type CaseArea } from "@/lib/case-area";
import { CONSENT_FALLBACK_TEXT, CONSENT_FALLBACK_VERSION } from "@/lib/consent";
import { useHeadingFocus } from "@/lib/use-heading-focus";
import { cn } from "@/lib/utils";

import { CaseActions, OwnerTexts } from "./CaseReview";
import { VoiceNotes, VoiceRecorder, type VoiceNote } from "./VoiceRecorder";

const STEPS = ["Fatos", "Provas", "Revisão"];
const MIN_TEXT = 40;
const MIN_TITLE = 3;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Etapas">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2",
            index === current ? "font-semibold text-primary-700" : "text-slate-500",
          )}
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-xs",
              index < current && "bg-sage-700 text-white",
              index === current && "bg-primary-700 text-white",
              index > current && "bg-slate-200 text-slate-600",
            )}
          >
            {index < current ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
          </span>
          {label}
          {index < STEPS.length - 1 && <span aria-hidden="true">·</span>}
        </li>
      ))}
    </ol>
  );
}

export function NewCaseWizard({ onExit }: { onExit: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [area, setArea] = useState<CaseArea>("OUTROS");
  const [files, setFiles] = useState<File[]>([]);
  const [voices, setVoices] = useState<VoiceNote[]>([]);
  const [created, setCreated] = useState<CaseCreated | null>(null);
  const [stage, setStage] = useState<"facts" | "proofs">("facts");
  const [consent, setConsent] = useState(false);
  const [consentText, setConsentText] = useState(CONSENT_FALLBACK_TEXT);
  // The version of the wording actually on screen; the bundled one if the fetch failed.
  const [consentVersion, setConsentVersion] = useState(CONSENT_FALLBACK_VERSION);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    api
      .consent()
      .then((c) => {
        if (!active) return;
        setConsentText(c.text);
        setConsentVersion(c.version);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Object URLs of recorded notes are released when the wizard closes.
  const voiceUrls = useRef<string[]>([]);
  useEffect(() => {
    voiceUrls.current = voices.map((v) => v.url);
  }, [voices]);
  useEffect(
    () => () => {
      voiceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  function removeVoice(id: string) {
    setVoices((prev) => {
      const gone = prev.find((v) => v.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((v) => v.id !== id);
    });
  }

  const trimmedTitle = title.trim();
  const trimmedText = text.trim();
  const valid = trimmedTitle.length >= MIN_TITLE && trimmedText.length >= MIN_TEXT;

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    setUploadErrors([]);
    try {
      const newCase = await api.createCase(trimmedTitle, trimmedText, true, consentVersion, area);
      // Evidence upload failures never block the review step; they are listed there.
      const failures: string[] = [];
      for (const file of [...voices.map((v) => v.file), ...files]) {
        try {
          await api.uploadEvidence(newCase.id, file);
        } catch (e) {
          failures.push(`Não foi possível enviar ${file.name}${e instanceof ApiError ? `: ${e.message}` : "."}`);
        }
      }
      setUploadErrors(failures);
      setCreated(newCase);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The wording changed since it was displayed: show the new one and ask again.
        setConsent(false);
        try {
          const c = await api.consent();
          setConsentText(c.text);
          setConsentVersion(c.version);
        } catch {
          setConsentText(CONSENT_FALLBACK_TEXT);
          setConsentVersion(CONSENT_FALLBACK_VERSION);
        }
      }
      setError(e instanceof ApiError ? e.message : "Não foi possível anonimizar o relato.");
      setFieldErrors(e instanceof ApiError ? e.fieldErrors : []);
    } finally {
      setBusy(false);
    }
  }

  const step = sent ? 3 : created ? 2 : stage === "proofs" ? 1 : 0;
  const headingRef = useHeadingFocus<HTMLHeadingElement>(true, step);
  const headingProps = { ref: headingRef, tabIndex: -1, className: "font-serif text-2xl text-slate-900 focus:outline-none" } as const;

  return (
    <section className="space-y-6">
      <Stepper current={step} />

      {step === 0 && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 {...headingProps}>Conte o que aconteceu</h1>
          <div className="space-y-1.5">
            <label htmlFor="case-title" className="text-sm font-medium text-slate-700">
              Título do caso
            </label>
            <input
              id="case-title"
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setConsent(false);
              }}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="case-area" className="text-sm font-medium text-slate-700">
              Área do caso
            </label>
            <select
              id="case-area"
              value={area}
              onChange={(e) => setArea(e.target.value as CaseArea)}
              className={inputClass}
            >
              {CASE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="case-text" className="text-sm font-medium text-slate-700">
              Relato
            </label>
            <textarea
              id="case-text"
              rows={8}
              maxLength={20000}
              aria-describedby={trimmedText.length < MIN_TEXT ? "case-text-count" : undefined}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setConsent(false);
              }}
              className={cn(inputClass, "h-auto py-2")}
            />
            <VoiceRecorder
              slotsLeft={MAX_FILES - files.length - voices.length}
              disabled={busy}
              onNote={(note) => setVoices((prev) => [...prev, note])}
              onTranscript={(spoken) => {
                setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${spoken}` : spoken));
                setConsent(false);
              }}
            />
            <VoiceNotes notes={voices} onRemove={removeVoice} disabled={busy} />
            {trimmedText.length < MIN_TEXT && (
              <p id="case-text-count" className="text-xs text-slate-600">{`${trimmedText.length}/${MIN_TEXT} caracteres mínimos`}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button disabled={!valid} onClick={() => setStage("proofs")}>
              Continuar
            </Button>
            <Button variant="outline" onClick={onExit}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 {...headingProps}>Anexe suas provas</h1>
          <UploadZone files={files} onFilesChange={setFiles} disabled={busy} />
          <div className="flex items-start gap-3">
            <input
              id="lgpd-consent"
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-primary-700"
            />
            <label htmlFor="lgpd-consent" className="text-sm text-slate-700">
              {consentText}
            </label>
          </div>
          <p className="text-sm">
            <Link href="/privacidade" className="text-primary-700 underline underline-offset-2">
              Política de privacidade
            </Link>
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger-600">
              {error}
            </p>
          )}
          <FieldErrors errors={fieldErrors} />
          <div className="flex flex-wrap gap-3">
            <Button disabled={!consent || busy} onClick={submit}>
              Enviar para anonimização
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => {
                setConsent(false);
                setStage("facts");
              }}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {step === 2 && created && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 {...headingProps}>Confira o que juízes e advogados vão ver</h1>
          <h2 className="font-medium text-slate-900">{created.title}</h2>
          <p className="text-sm text-slate-700">{`Área: ${AREA_LABEL[created.area]}`}</p>
          <OwnerTexts anonymizedText={created.anonymized_text} rawText={created.raw_text} />
          {created.redactions.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs text-slate-700">
              {created.redactions.map((r) => (
                <li key={r.label} className="rounded-full bg-slate-100 px-2.5 py-1">
                  {`${r.label}: ${r.count}`}
                </li>
              ))}
            </ul>
          )}
          {uploadErrors.length > 0 && (
            <div role="alert" className="space-y-1 text-sm text-danger-600">
              {uploadErrors.map((message, index) => (
                <p key={`${index}-${message}`}>{message}</p>
              ))}
            </div>
          )}
          <CaseActions id={created.id} status="AWAITING_APPROVAL" onApproved={() => setSent(true)} onDeleted={onExit} onBusyChange={setActing} />
          <Button variant="outline" disabled={acting} onClick={onExit}>
            Decidir depois
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 {...headingProps}>Caso enviado para avaliação.</h1>
          <p className="text-sm text-slate-700">Você verá o score aqui quando um juiz avaliar.</p>
          <Button onClick={onExit}>Ver meus casos</Button>
        </div>
      )}
    </section>
  );
}
