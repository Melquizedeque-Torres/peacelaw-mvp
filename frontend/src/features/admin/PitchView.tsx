"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api";

// The markup comes only from GET /api/admin/pitch (admin-only, repository-owned static file,
// never user input). It is mounted in a shadow root so its styles cannot leak into, or be
// affected by, the rest of the app.
export function PitchView() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.adminPitch().then(
      ({ html }) => {
        const node = host.current;
        if (cancelled || !node) return;
        const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
        root.innerHTML = html;
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Não foi possível carregar o kit de pitch.");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      {loading && (
        <p role="status" className="p-8 text-slate-600">
          Carregando…
        </p>
      )}
      {error && (
        <p role="alert" className="p-8 text-danger-700">
          {error}
        </p>
      )}
      <div ref={host} data-testid="pitch-host" />
    </main>
  );
}
