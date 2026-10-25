"use client";

import { useEffect, useRef, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ApiError, api, type CaseForLawyer } from "@/lib/api";
import type { CaseStatus } from "@/lib/case-status";
import { cn } from "@/lib/utils";

import { AreasPicker } from "./AreasPicker";
import { CaseCard, cardTitleId } from "./CaseCard";
import { CaseDrawer } from "./CaseDrawer";

const PAGE_SIZE = 50;

const COLUMNS: { status: CaseStatus; title: string; headingId: string }[] = [
  { status: "EVALUATED", title: "Oportunidades", headingId: "lawyer-col-evaluated" },
  { status: "IN_MEDIATION", title: "Em contato", headingId: "lawyer-col-mediation" },
  { status: "RESOLVED", title: "Acordos fechados", headingId: "lawyer-col-resolved" },
];

const countOpportunities = (list: CaseForLawyer[]) => list.filter((c) => c.status === "EVALUATED").length;

type FocusRequest = { caseId: string | null; n: number };

export function LawyerBoard() {
  const [cases, setCases] = useState<CaseForLawyer[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Two always-mounted live regions: announcements are reliable only when the region pre-exists.
  const [status, setStatus] = useState("Carregando quadro…");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const requestIdRef = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  // Bumped only when a first page (offset 0) is applied; a load-more from an older generation is dropped.
  const generationRef = useRef(0);
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);

  // Latest request wins: resolves null when a newer board request started meanwhile.
  function fetchLatestBoard(onPending?: (pending: boolean) => void): Promise<CaseForLawyer[] | null> {
    const id = ++requestIdRef.current;
    reloadingRef.current = true;
    onPending?.(true);
    const settle = () => {
      if (id !== requestIdRef.current) return false;
      reloadingRef.current = false;
      onPending?.(false);
      return true;
    };
    return api.lawyerBoard({ limit: PAGE_SIZE, offset: 0 }).then(
      (result) => (settle() ? result : null),
      (e) => {
        if (!settle()) return null;
        throw e;
      },
    );
  }

  // A fresh first page replaces the list and resets paging.
  function applyFirstPage(result: CaseForLawyer[]) {
    setCases(result);
    setHasMore(countOpportunities(result) >= PAGE_SIZE);
    generationRef.current += 1;
  }

  useEffect(() => {
    let cancelled = false;
    // The initial load has no button to disable, so it reports no pending state.
    fetchLatestBoard()
      .then((result) => {
        if (cancelled || !result) return;
        applyFirstPage(result);
        setStatus("");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("");
        setError(e instanceof ApiError ? e.message : "Não foi possível carregar o quadro.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Runs after render, so the card already sits in its new column (or is gone after a reload).
  useEffect(() => {
    if (!focusRequest) return;
    const card = focusRequest.caseId ? document.getElementById(cardTitleId(focusRequest.caseId)) : null;
    (card ?? titleRef.current)?.focus();
  }, [focusRequest]);

  function requestFocus(caseId: string | null) {
    setFocusRequest((prev) => ({ caseId, n: (prev?.n ?? 0) + 1 }));
  }

  async function act(
    item: CaseForLawyer,
    run: (id: string) => Promise<CaseForLawyer>,
    failure: string,
    done: string,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const updated = await run(item.id);
      setCases((current) => current?.map((c) => (c.id === item.id ? { ...c, ...updated } : c)) ?? current);
      setStatus(done);
      requestFocus(item.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failure);
      if (e instanceof ApiError && e.status === 409) {
        try {
          const fresh = await fetchLatestBoard(setReloading);
          if (fresh) applyFirstPage(fresh);
        } catch {
          // Keep the stale board; the alert already explains the conflict.
        }
      }
      // The case may be gone or moved; the board heading is always there.
      requestFocus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Resolves false when the reload failed; the current board stays and the areas were saved anyway.
  async function reloadBoard(): Promise<boolean> {
    try {
      const fresh = await fetchLatestBoard(setReloading);
      if (fresh) {
        applyFirstPage(fresh);
        setStatus((s) => (s === "Carregando quadro…" ? "" : s));
      }
      return true;
    } catch {
      return false;
    }
  }

  async function loadMore() {
    if (loadingMoreRef.current || reloadingRef.current || !cases) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");
    setStatus("");
    // Not a new request id: a reload started meanwhile bumps it and this response is then ignored.
    const id = requestIdRef.current;
    const generation = generationRef.current;
    try {
      const next = await api.lawyerBoard({ limit: PAGE_SIZE, offset: countOpportunities(cases) });
      if (id !== requestIdRef.current || generation !== generationRef.current) return;
      const known = new Set(cases.map((c) => c.id));
      const added = next.filter((c) => !known.has(c.id));
      setCases((current) => {
        const have = new Set((current ?? []).map((c) => c.id));
        return [...(current ?? []), ...added.filter((c) => !have.has(c.id))];
      });
      setHasMore(countOpportunities(next) >= PAGE_SIZE);
      if (added.length === 0) {
        setStatus("Nenhuma nova oportunidade.");
      } else {
        setStatus(`${added.length} ${added.length === 1 ? "oportunidade carregada" : "oportunidades carregadas"}.`);
        requestFocus(added[0].id);
      }
    } catch (e) {
      if (id !== requestIdRef.current || generation !== generationRef.current) return;
      setError(e instanceof ApiError ? e.message : "Não foi possível carregar mais oportunidades.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  const assume = (item: CaseForLawyer) =>
    act(item, api.matchCase, "Não foi possível assumir a mediação.", `«${item.title}» movido para Em contato.`);
  const resolve = (item: CaseForLawyer) =>
    act(item, api.resolveCase, "Não foi possível registrar o acordo.", `Acordo de «${item.title}» registrado.`);

  function view(item: CaseForLawyer, opener: HTMLElement) {
    openerRef.current = opener;
    setOpenId(item.id);
  }

  function closeDrawer() {
    const opener = openerRef.current;
    openerRef.current = null;
    setOpenId(null);
    // Defer so focus lands after the dialog unmounts.
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
      else titleRef.current?.focus();
    });
  }

  const open = cases?.find((c) => c.id === openId) ?? null;

  return (
    <>
      <AppHeader title="Mediação" />
      <main className="mx-auto max-w-7xl px-4 py-6 text-slate-900">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="mb-4 font-serif text-2xl font-bold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-700"
        >
          Quadro de mediação
        </h1>
        <p role="status" className={cn("text-sm", status && "mb-4 rounded-lg border border-sage-700 bg-white p-3")}>
          {status}
        </p>
        <p
          role="alert"
          className={cn("text-sm font-medium text-danger-700", error && "mb-4 rounded-lg border border-danger-700 bg-white p-3")}
        >
          {error}
        </p>

        <AreasPicker onSaved={reloadBoard} />

        {cases && (
          <div className="grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((column) => {
              const items = cases.filter((c) => c.status === column.status);
              return (
                <section
                  key={column.status}
                  aria-labelledby={column.headingId}
                  className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3"
                >
                  <h2 id={column.headingId} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {column.title}
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">{items.length}</span>
                  </h2>
                  {items.length === 0 ? (
                    <p className="text-sm text-slate-600">Nenhum caso aqui.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {items.map((item) => (
                        <CaseCard
                          key={item.id}
                          item={item}
                          busy={busy}
                          onAssume={assume}
                          onResolve={resolve}
                          onView={view}
                        />
                      ))}
                    </ul>
                  )}
                  {column.status === "EVALUATED" && hasMore && (
                    <Button variant="outline" disabled={loadingMore || reloading} onClick={loadMore}>
                      Carregar mais oportunidades
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
      {open && <CaseDrawer item={open} onClose={closeDrawer} />}
    </>
  );
}
