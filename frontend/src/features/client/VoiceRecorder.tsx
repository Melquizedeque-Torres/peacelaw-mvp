"use client";

import { Mic, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  MAX_VOICE_SECONDS,
  createRecognizer,
  extensionFor,
  formatDuration,
  pickMimeType,
  type SpeechRecognitionLike,
} from "@/lib/voice";

const MAX_BYTES = 2.5 * 1024 * 1024;

export type VoiceNote = { id: string; file: File; url: string; seconds: number };

type Props = {
  /** Free attachment slots left (voice notes share the 5-file limit). */
  slotsLeft: number;
  disabled?: boolean;
  onNote: (note: VoiceNote) => void;
  onTranscript: (text: string) => void;
};

export function VoiceRecorder({ slotsLeft, disabled = false, onNote, onTranscript }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);
  const transcript = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const keep = useRef(true);
  const startedAt = useRef(0);
  const live = useRef(false);

  function cleanup() {
    live.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    try {
      recognizer.current?.stop();
    } catch {
      /* already stopped */
    }
    recognizer.current = null;
    setRecording(false);
  }

  // Hidden routes stay mounted (Activity) and a closed page must release the microphone.
  useEffect(
    () => () => {
      keep.current = false;
      try {
        recorder.current?.stop();
      } catch {
        /* not recording */
      }
      cleanup();
    },
    [],
  );

  async function start() {
    setError("");
    setInfo("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não permite gravar áudio. Escreva o relato ou use outro navegador.");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Não foi possível usar o microfone. Permita o acesso nas configurações do navegador.");
      return;
    }
    stream.current = media;
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    chunks.current = [];
    transcript.current = [];
    keep.current = true;
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    rec.onstop = () => {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      const spoken = transcript.current.join(" ").replace(/\s+/g, " ").trim();
      cleanup();
      if (!keep.current) return;
      if (blob.size > MAX_BYTES) {
        setError("O áudio ficou grande demais (máximo de 2,5 MB). Grave um trecho mais curto.");
        return;
      }
      const name = `relato-voz-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extensionFor(type)}`;
      const file = new File([blob], name, { type });
      onNote({ id: crypto.randomUUID(), file, url: URL.createObjectURL(blob), seconds: elapsed });
      if (spoken) {
        onTranscript(spoken);
        setInfo("Áudio guardado e transcrito no relato. Revise o texto antes de continuar.");
      } else {
        setInfo("Áudio guardado. Não foi possível transcrever: escreva ou cole o relato no campo acima.");
      }
    };

    const speech = createRecognizer();
    recognizer.current = speech;
    live.current = true;
    if (speech) {
      speech.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          if (event.results[i].isFinal) transcript.current.push(event.results[i][0].transcript);
        }
      };
      // Browsers end recognition after a pause: keep listening while the recording runs.
      speech.onend = () => {
        if (live.current) {
          try {
            speech.start();
          } catch {
            /* already started */
          }
        }
      };
      speech.onerror = () => {};
      try {
        speech.start();
      } catch {
        /* recognition is optional */
      }
    }

    startedAt.current = Date.now();
    rec.start();
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_VOICE_SECONDS) stop(true);
    }, 500);
  }

  function stop(useIt: boolean) {
    keep.current = useIt;
    live.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    else cleanup();
  }

  const noSlots = slotsLeft <= 0;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {!recording ? (
          <Button type="button" variant="outline" disabled={disabled || noSlots} onClick={start}>
            <Mic aria-hidden="true" className="size-4" />
            Gravar relato em áudio
          </Button>
        ) : (
          <>
            <Button type="button" onClick={() => stop(true)}>
              <Square aria-hidden="true" className="size-4" />
              Parar e usar
            </Button>
            <Button type="button" variant="outline" onClick={() => stop(false)}>
              <Trash2 aria-hidden="true" className="size-4" />
              Descartar
            </Button>
            <span className="text-sm font-medium text-danger-700 tabular-nums" role="timer">
              {`Gravando ${formatDuration(seconds)} / ${formatDuration(MAX_VOICE_SECONDS)}`}
            </span>
          </>
        )}
      </div>
      {noSlots && !recording && (
        <p className="text-xs text-slate-600">Limite de 5 anexos atingido: remova um para gravar outro áudio.</p>
      )}
      <p className="text-xs text-slate-600">
        O áudio é guardado criptografado e só você pode ouvi-lo de novo. Juízes e advogados veem apenas o texto
        anonimizado. A transcrição usa o reconhecimento de voz do navegador (no Chrome e no Edge, o áudio é processado
        pelo serviço do fabricante).
      </p>
      <p role="status" className="text-sm text-sage-800">
        {info}
      </p>
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    </div>
  );
}

export function VoiceNotes({ notes, onRemove, disabled }: { notes: VoiceNote[]; onRemove: (id: string) => void; disabled?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Áudios gravados">
      {notes.map((note, index) => (
        <li key={note.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <span className="text-sm font-medium text-slate-700">{`Áudio ${index + 1} · ${formatDuration(note.seconds)}`}</span>
          <audio controls src={note.url} className="order-last h-10 w-full basis-full" aria-label={`Ouvir áudio ${index + 1}`} />
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onRemove(note.id)}>
            Remover
          </Button>
        </li>
      ))}
    </ul>
  );
}
