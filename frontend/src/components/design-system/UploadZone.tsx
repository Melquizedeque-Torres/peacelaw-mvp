"use client";

import { AlertTriangle, FileText, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";

export const MAX_FILE_BYTES = 2.5 * 1024 * 1024;
export const MAX_FILES = 5;
export const DEFAULT_SECURITY_NOTE =
  "Os arquivos são criptografados e só você consegue baixá-los. Juízes e advogados não os veem.";

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "text/plain"];
const ACCEPTED_EXTENSION = /\.(pdf|jpe?g|png|txt)$/i;

export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSION.test(file.name)) {
    return "Formato não aceito. Envie PDF, JPG, PNG ou TXT.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Arquivo acima de 2,5 MB.";
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type RejectedItem = { id: number; file: File; error: string };
type Row = { key: string; file: File; error: string | null; remove: () => void };

type UploadZoneProps = {
  /** Controlled list of accepted files. When omitted, the component keeps its own list. */
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  disabled?: boolean;
  securityNote?: string;
  className?: string;
};

export function UploadZone({
  files,
  onFilesChange,
  disabled = false,
  securityNote = DEFAULT_SECURITY_NOTE,
  className,
}: UploadZoneProps) {
  const controlled = files !== undefined;
  const [internalFiles, setInternalFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const nextId = useRef(1);
  const accepted = controlled ? files : internalFiles;
  const latestAccepted = useRef<File[]>(accepted);

  useEffect(() => {
    latestAccepted.current = accepted;
  }, [accepted]);

  const publish = (next: File[]) => {
    latestAccepted.current = next;
    if (!controlled) setInternalFiles(next);
    onFilesChange?.(next);
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (disabled) return;
    const incoming = Array.from(list ?? []);
    if (!incoming.length) return;
    const ok: File[] = [];
    const bad: RejectedItem[] = [];
    for (const file of incoming) {
      const error = validateFile(file);
      if (!error && latestAccepted.current.length + ok.length >= MAX_FILES) {
        bad.push({ id: nextId.current++, file, error: "Limite de 5 arquivos." });
      } else if (error) bad.push({ id: nextId.current++, file, error });
      else ok.push(file);
    }
    if (bad.length) setRejected((prev) => [...prev, ...bad]);
    publish([...latestAccepted.current, ...ok]);
  };

  const rows: Row[] = [
    ...accepted.map((file, index) => ({
      key: `ok-${index}-${file.name}`,
      file,
      error: null,
      remove: () => publish(latestAccepted.current.filter((_, i) => i !== index)),
    })),
    ...rejected.map((item) => ({
      key: `bad-${item.id}`,
      file: item.file,
      error: item.error,
      remove: () => setRejected((prev) => prev.filter((other) => other.id !== item.id)),
    })),
  ];
  const readyCount = accepted.length;

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    addFiles(event.dataTransfer.files);
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <label
        data-testid="upload-dropzone"
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "relative flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-9 text-center transition-colors duration-150",
          "focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-2",
          disabled
            ? "cursor-not-allowed border-slate-300 bg-slate-50 opacity-60"
            : cn(
                "cursor-pointer",
                dragging
                  ? "border-primary-500 bg-primary-50"
                  : "border-slate-300 bg-slate-50 hover:border-primary-400 hover:bg-primary-50/60",
              ),
        )}
      >
        <input
          type="file"
          multiple
          disabled={disabled}
          accept=".pdf,.jpg,.jpeg,.png,.txt"
          className="sr-only"
          aria-label="Selecionar arquivos"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <span
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-[14px] transition-colors duration-200",
            dragging ? "bg-primary-700 text-white" : "bg-primary-50 text-primary-700",
          )}
        >
          <ShieldCheck aria-hidden="true" className="h-[26px] w-[26px]" />
        </span>
        <span className="text-[15px] font-semibold text-slate-900">
          {dragging ? "Solte para anexar" : "Arraste PDFs ou provas para cá"}
        </span>
        <span className="text-sm text-slate-600">
          ou <span className="font-medium text-primary-600 underline underline-offset-[3px]">selecione do computador</span>
        </span>
        <span className="text-xs text-slate-500">PDF, JPG, PNG ou TXT · até 5 arquivos de 2,5 MB</span>
      </label>

      <p className="flex items-start gap-2.5 rounded-lg bg-primary-50 px-3.5 py-3 text-[13px] leading-normal text-primary-800">
        <Lock aria-hidden="true" className="mt-px h-4 w-4 flex-none" />
        {securityNote}
      </p>

      <p role="status" className="sr-only">
        {readyCount > 0 ? `${readyCount} ${readyCount === 1 ? "arquivo anexado" : "arquivos anexados"}` : ""}
      </p>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const Icon = row.error ? AlertTriangle : FileText;
            return (
              <li key={row.key} className="flex items-center gap-3 rounded-[10px] border border-slate-200 bg-white p-3">
                <span
                  className={cn(
                    "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
                    row.error ? "bg-danger-50 text-danger-600" : "bg-sage-50 text-sage-700",
                  )}
                >
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">{row.file.name}</span>
                    <span className="flex-none text-xs text-slate-500 tabular-nums">{formatFileSize(row.file.size)}</span>
                  </div>
                  <span className={cn("text-xs", row.error ? "text-danger-600" : "text-sage-700")}>
                    {row.error ?? "Pronto para enviar"}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remover ${row.file.name}`}
                  onClick={row.remove}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
