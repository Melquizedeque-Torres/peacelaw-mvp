"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { AREA_LABEL, CASE_AREAS, type CaseArea } from "@/lib/case-area";
import { cn } from "@/lib/utils";

const sortAreas = (areas: CaseArea[]) => CASE_AREAS.filter((a) => areas.includes(a));
const sameAreas = (a: CaseArea[], b: CaseArea[]) => sortAreas(a).join() === sortAreas(b).join();

/** `onSaved` reloads the board; resolving `false` means that reload failed. */
export function AreasPicker({ onSaved }: { onSaved: () => Promise<boolean | void> | void }) {
  const [areas, setAreas] = useState<CaseArea[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // confirmed: last set the server returned. desired: what the user wants now (latest click wins).
  const confirmedRef = useRef<CaseArea[]>([]);
  const desiredRef = useRef<CaseArea[]>([]);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .lawyerAreas()
      .then((result) => {
        if (cancelled) return;
        confirmedRef.current = result.areas;
        desiredRef.current = result.areas;
        setAreas(result.areas);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof ApiError ? e.message : "Não foi possível carregar suas áreas.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retryLoad() {
    setLoadError("");
    setAttempt((n) => n + 1);
  }

  // Sends the latest desired set one PUT at a time; clicks made meanwhile only update `desiredRef`.
  async function drain() {
    inFlightRef.current = true;
    setSaving(true);
    try {
      while (!sameAreas(desiredRef.current, confirmedRef.current)) {
        const sent = desiredRef.current;
        let saved: CaseArea[];
        try {
          saved = (await api.setLawyerAreas(sent)).areas;
        } catch (e) {
          desiredRef.current = confirmedRef.current;
          if (mountedRef.current) {
            setAreas(confirmedRef.current);
            setError(e instanceof ApiError ? e.message : "Não foi possível salvar suas áreas.");
          }
          return;
        }
        confirmedRef.current = saved;
        if (desiredRef.current === sent) {
          // No newer click: the server response is the truth.
          desiredRef.current = saved;
          if (mountedRef.current) setAreas(saved);
        }
        if (sameAreas(desiredRef.current, confirmedRef.current)) {
          const reloaded = await onSaved();
          if (!mountedRef.current) return;
          if (reloaded === false) {
            setError("Áreas salvas, mas não foi possível atualizar o quadro.");
          } else {
            setError("");
            if (sameAreas(desiredRef.current, confirmedRef.current)) setStatus("Áreas salvas.");
          }
        }
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function toggle(area: CaseArea) {
    const current = desiredRef.current;
    const next = sortAreas(current.includes(area) ? current.filter((a) => a !== area) : [...current, area]);
    desiredRef.current = next;
    setAreas(next);
    setError("");
    setStatus("");
    if (!inFlightRef.current) void drain();
  }

  return (
    <div className="mb-4">
      <fieldset className="rounded-xl border border-slate-200 bg-white p-3">
        <legend className="px-1 text-sm font-semibold text-slate-800">Áreas em que atuo</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CASE_AREAS.map((area) => (
            <label key={area} className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={areas.includes(area)}
                disabled={!loaded}
                onChange={() => toggle(area)}
                className="size-4 accent-primary-700"
              />
              {AREA_LABEL[area]}
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" className={cn("text-sm text-slate-700", (saving || status) && "mt-2")}>
        {saving ? "Salvando…" : status}
      </p>
      {loadError && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm font-medium text-danger-700">
            {loadError}
          </p>
          <Button variant="outline" onClick={retryLoad}>
            Tentar novamente
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
