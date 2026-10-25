import { cn } from "@/lib/utils";

const TOKEN = /(\[[^[\]\s]{1,40}\])/;

// Renders anonymized text, turning [LABEL] redaction tokens into visible chips.
// `className` replaces the default size/colour so callers can scale the text; chips follow it.
export function AnonymizedText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap", className ?? "text-sm leading-relaxed text-slate-800")}>
      {text.split(TOKEN).map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            data-token={part.slice(1, -1)}
            className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[0.9em] font-medium text-primary-700"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  );
}
