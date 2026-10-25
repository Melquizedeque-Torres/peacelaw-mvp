import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { ProbabilityCard } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { AnonymizedText } from "@/features/client/AnonymizedText";
import type { CaseForLawyer } from "@/lib/api";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type CaseDrawerProps = { item: CaseForLawyer; onClose: () => void };

export function CaseDrawer({ item, onClose }: CaseDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      const nodes = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!panel || !nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-lg flex-col gap-5 overflow-y-auto bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-serif text-xl font-bold text-slate-900">
            {item.title}
          </h2>
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>
            <X aria-hidden="true" />
            Fechar
          </Button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <AnonymizedText text={item.anonymized_text} />
        </div>
        {item.ai_probability_score !== null && (
          <ProbabilityCard score={item.ai_probability_score} audience="professional" />
        )}
      </div>
    </div>
  );
}
