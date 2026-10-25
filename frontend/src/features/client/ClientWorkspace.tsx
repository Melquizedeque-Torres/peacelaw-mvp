"use client";

import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";

import { CaseDetail } from "./CaseDetail";
import { CaseList } from "./CaseList";
import { NewCaseWizard } from "./NewCaseWizard";

type View = { kind: "list" } | { kind: "new" } | { kind: "case"; id: string };

export function ClientWorkspace() {
  const [view, setView] = useState<View>({ kind: "list" });
  // Stay quiet on first load; afterwards every view change moves focus to the new heading.
  const [navigated, setNavigated] = useState(false);
  const go = (next: View) => {
    setNavigated(true);
    setView(next);
  };
  const toList = () => go({ kind: "list" });

  return (
    <>
      <AppHeader title="Meus casos" />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {view.kind === "list" && (
          <CaseList focusHeading={navigated} onNew={() => go({ kind: "new" })} onOpen={(id) => go({ kind: "case", id })} />
        )}
        {view.kind === "new" && <NewCaseWizard onExit={toList} />}
        {view.kind === "case" && <CaseDetail id={view.id} onBack={toList} />}
      </main>
    </>
  );
}
