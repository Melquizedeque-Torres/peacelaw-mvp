# M3b — Frontend: Auth and the Three Actor Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-up/login and the three actor experiences — `/client` (wizard + own cases), `/judge` (accessible split-view scoring), `/lawyer` (Kanban) — wired to the M3a FastAPI API through a same-origin Next.js rewrite.

**Architecture:** `next.config.ts` rewrites `/api/*` to FastAPI, so the httpOnly session cookie is first-party. `src/lib/api.ts` is the only module that talks HTTP (typed, throws `ApiError`). `src/lib/session.tsx` holds the current user (React context) and `RoleGate` guards each page client-side (the API enforces RBAC regardless). Pages are Client Components that fetch after mount — compatible with Cache Components (no uncached server fetches, no dynamic route params, no `useSearchParams`). Feature UI lives in `src/features/{auth,client,judge,lawyer}/`.

**Tech Stack:** Next.js 16.4 (App Router, Cache Components on), React 19, Tailwind v4 tokens, shadcn Button (base-ui), lucide-react, Vitest 5 + Testing Library + user-event.

**Spec:** `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md` (M3 section). **Backend contract:** `docs/superpowers/plans/2026-10-14-m3a-backend-auth-lifecycle.md` (Tasks 4–6 list every endpoint, body and error string).

**UI reference (port the look, not the code):** `docs/design-system/VisaoDemandante.jsx` (client wizard), `VisaoAvaliador.jsx` (judge split-view, font-size control, big sliders), `VisaoSolucionador.jsx` (Kanban cards, drawer).

## Global Constraints

- Run frontend commands from `frontend/` (Windows + Git Bash). Every task ends with `npm test`, `npm run lint` and `npm run build` passing, test output pristine (no warnings, no `act()` warnings).
- No hard-coded hex colors (use token classes: `primary-*`, `sage-*`, `danger-*`, `warning-*`, Tailwind `slate-*`, shadcn semantic `bg-primary` etc.).
- All user-facing copy is pt-BR.
- Only `src/lib/api.ts` calls `fetch`. Components never build URLs.
- Never render or store `raw_text` outside the client's own case view; never put tokens or passwords in `localStorage`/`sessionStorage` (the session is the httpOnly cookie).
- Do not add dynamic route segments (`[id]`) or `useSearchParams` (Cache Components would require Suspense/static params); keep per-case navigation as component state.
- Accessibility: every input has a visible label; buttons have accessible names; status changes are announced (`role="status"`/`role="alert"`); focus rings use `focus-visible:ring-*`.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: API client, session, rewrite and Button restyle

**Files:**
- Modify: `frontend/next.config.ts`, `frontend/src/components/ui/button.tsx`, `frontend/src/app/layout.tsx`
- Create: `frontend/.env.example`, `frontend/src/lib/case-status.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/session.tsx`
- Test: `frontend/src/lib/api.test.ts`, `frontend/src/lib/session.test.tsx`

**Interfaces:**
- Produces:
  - `@/lib/case-status`: `type CaseStatus = "DRAFT" | "AWAITING_APPROVAL" | "READY_FOR_JUDGE" | "EVALUATED" | "IN_MEDIATION" | "RESOLVED"`.
  - `@/lib/api`: types `Role`, `User`, `RedactionCount`, `CaseSummary`, `CaseOwnerView`, `CaseCreated`, `CaseForJudge`, `CaseForLawyer`, `Review`, `ReviewInput`, `FieldError`; class `ApiError { status: number; message: string; fieldErrors: FieldError[] }`; object `api` with `register, login, logout, me, createCase, myCases, getCase, approveCase, deleteCase, judgeQueue, submitReview, lawyerBoard, matchCase, resolveCase`; `HOME_FOR_ROLE: Record<Role, string>`; `setUnauthorizedHandler(fn | null)` (a 401 from any non-auth call invokes it; SessionProvider marks the session anonymous so RoleGate redirects to /login).
  - `@/lib/session`: `SessionState`, `SessionProvider({ children, initialState? })`, `useSession() -> { state, setUser(user | null), refresh() }`, `RoleGate({ role, children })`.
  - Button sizes: `default` h-10, `sm` h-8, `lg` h-12; `destructive` solid.

- [ ] **Step 1: Rewrite and env example**

`frontend/next.config.ts` — add a `rewrites` key (keep everything else):
```ts
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
```
`frontend/.env.example`:
```dotenv
# FastAPI origin used by the /api/* rewrite (server-side only; never exposed to the browser).
BACKEND_URL=http://127.0.0.1:8000
```

- [ ] **Step 2: Write failing tests**

`frontend/src/lib/api.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setUnauthorizedHandler } from "./api";

const fetchMock = vi.fn();

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("posts JSON to the same-origin API with the session cookie", async () => {
    respond(200, { id: "u1", email: "a@b.com", role: "CLIENT" });
    const user = await api.login("a@b.com", "senha-forte-123");
    expect(user.role).toBe("CLIENT");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ email: "a@b.com", password: "senha-forte-123" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("resolves 204 responses to undefined", async () => {
    respond(204);
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("encodes ids in paths", async () => {
    respond(200, []);
    await api.getCase("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/a%2Fb");
  });

  it("turns error bodies into ApiError with the server message", async () => {
    respond(409, { detail: "Você já avaliou este caso." });
    const error = await api.submitReview("c1", { score_evidence: 5, score_jurisprudence: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Você já avaliou este caso.");
  });

  it("keeps field errors from 422 responses", async () => {
    respond(422, { detail: "Dados inválidos.", errors: [{ field: "text", message: "curto" }] });
    const error = await api.createCase("t", "x").catch((e) => e);
    expect(error.fieldErrors).toEqual([{ field: "text", message: "curto" }]);
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    const error = await api.me().catch((e) => e);
    expect(error.message).toBe("Não foi possível concluir a operação. Tente novamente.");
  });

  it("notifies the session when an authenticated call gets 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    respond(401, { detail: "Não autenticado." });
    await api.myCases().catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    respond(401, { detail: "Não autenticado." });
    await api.me().catch(() => undefined); // the session probe itself does not trigger it
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const error = await api.me().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe("Sem conexão com o servidor.");
  });
});
```

`frontend/src/lib/session.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { RoleGate, SessionProvider, useSession } from "./session";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

function WhoAmI() {
  const { state } = useSession();
  return <p>{state.status === "authenticated" ? state.user.email : state.status}</p>;
}

describe("SessionProvider", () => {
  it("loads the current user", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ id: "1", email: "a@b.com", role: "CLIENT" });
    render(<SessionProvider><WhoAmI /></SessionProvider>);
    expect(await screen.findByText("a@b.com")).toBeInTheDocument();
  });

  it("is anonymous when there is no session", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("401"));
    render(<SessionProvider><WhoAmI /></SessionProvider>);
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
  });
});

describe("RoleGate", () => {
  it("renders children for the right role", () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "j@b.com", role: "JUDGE" } }}>
        <RoleGate role="JUDGE"><p>painel do juiz</p></RoleGate>
      </SessionProvider>,
    );
    expect(screen.getByText("painel do juiz")).toBeInTheDocument();
  });

  it("sends anonymous visitors to /login", async () => {
    render(
      <SessionProvider initialState={{ status: "anonymous" }}>
        <RoleGate role="JUDGE"><p>painel do juiz</p></RoleGate>
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("painel do juiz")).not.toBeInTheDocument();
  });

  it("sends other roles to their own home", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "c@b.com", role: "CLIENT" } }}>
        <RoleGate role="LAWYER"><p>quadro</p></RoleGate>
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/client"));
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- src/lib` → FAIL (modules missing).

- [ ] **Step 4: Implement**

`frontend/src/lib/case-status.ts`:
```ts
export type CaseStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "READY_FOR_JUDGE"
  | "EVALUATED"
  | "IN_MEDIATION"
  | "RESOLVED";
```

`frontend/src/lib/api.ts`:
```ts
import type { CaseStatus } from "@/lib/case-status";

export type Role = "CLIENT" | "JUDGE" | "LAWYER" | "ADMIN";
export type User = { id: string; email: string; role: Role };
export type RedactionCount = { label: string; count: number };
export type CaseSummary = {
  id: string;
  title: string;
  status: CaseStatus;
  ai_probability_score: number | null;
  created_at: string;
};
export type CaseOwnerView = CaseSummary & { raw_text: string; anonymized_text: string };
export type CaseCreated = CaseOwnerView & { redactions: RedactionCount[] };
export type CaseForJudge = { id: string; title: string; anonymized_text: string; created_at: string };
export type CaseForLawyer = CaseSummary & { anonymized_text: string };
export type ReviewInput = { score_evidence: number; score_jurisprudence: number; notes?: string };
export type Review = {
  id: string;
  case_id: string;
  score_evidence: number;
  score_jurisprudence: number;
  notes: string | null;
  created_at: string;
};
export type FieldError = { field: string; message: string };

export const HOME_FOR_ROLE: Record<Role, string> = {
  CLIENT: "/client",
  JUDGE: "/judge",
  LAWYER: "/lawyer",
  ADMIN: "/",
};

const FALLBACK_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldError[];

  constructor(status: number, message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function parseError(status: number, body: unknown): ApiError {
  const data = (typeof body === "object" && body !== null ? body : {}) as {
    detail?: unknown;
    errors?: unknown;
  };
  const message = typeof data.detail === "string" ? data.detail : FALLBACK_MESSAGE;
  const fieldErrors = Array.isArray(data.errors) ? (data.errors as FieldError[]) : [];
  return new ApiError(status, message, fieldErrors);
}

// Called when an authenticated call answers 401 (session expired); the
// SessionProvider registers a handler that marks the session anonymous, which
// makes RoleGate redirect to /login.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const AUTH_PROBES = new Set(["/api/auth/me", "/api/auth/login", "/api/auth/register"]);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor.");
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !AUTH_PROBES.has(path)) unauthorizedHandler?.();
    throw parseError(response.status, body);
  }
  return body as T;
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

const caseUrl = (id: string, suffix = "") => `/api/cases/${encodeURIComponent(id)}${suffix}`;

export const api = {
  register: (email: string, password: string) => post<User>("/api/auth/register", { email, password }),
  login: (email: string, password: string) => post<User>("/api/auth/login", { email, password }),
  logout: () => post<void>("/api/auth/logout"),
  me: () => request<User>("/api/auth/me"),
  createCase: (title: string, text: string) => post<CaseCreated>("/api/cases", { title, text }),
  myCases: () => request<CaseSummary[]>("/api/cases/mine"),
  getCase: (id: string) => request<CaseOwnerView>(caseUrl(id)),
  approveCase: (id: string) => post<CaseOwnerView>(caseUrl(id, "/approve")),
  deleteCase: (id: string) => request<void>(caseUrl(id), { method: "DELETE" }),
  judgeQueue: () => request<CaseForJudge[]>("/api/judge/queue"),
  submitReview: (id: string, review: ReviewInput) => post<Review>(caseUrl(id, "/reviews"), review),
  lawyerBoard: () => request<CaseForLawyer[]>("/api/lawyer/board"),
  matchCase: (id: string) => post<CaseForLawyer>(caseUrl(id, "/match")),
  resolveCase: (id: string) => post<CaseForLawyer>(caseUrl(id, "/resolve")),
};
```

`frontend/src/lib/session.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { HOME_FOR_ROLE, api, setUnauthorizedHandler, type Role, type User } from "@/lib/api";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User };

type SessionContextValue = {
  state: SessionState;
  setUser: (user: User | null) => void;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: SessionState;
}) {
  const [state, setState] = useState<SessionState>(initialState ?? { status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const user = await api.me();
      setState({ status: "authenticated", user });
    } catch {
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    if (!initialState) void refresh();
  }, [initialState, refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: "anonymous" }));
    return () => setUnauthorizedHandler(null);
  }, []);

  const setUser = useCallback((user: User | null) => {
    setState(user ? { status: "authenticated", user } : { status: "anonymous" });
  }, []);

  return <SessionContext value={{ state, setUser, refresh }}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const context = use(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  return context;
}

export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  const allowed = state.status === "authenticated" && state.user.role === role;

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    else if (state.status === "authenticated" && state.user.role !== role) {
      router.replace(HOME_FOR_ROLE[state.user.role]);
    }
  }, [state, role, router]);

  if (!allowed) {
    return (
      <p role="status" className="p-8 text-slate-600">
        Carregando…
      </p>
    );
  }
  return children;
}
```
If `eslint` (react-hooks) flags the effect in `SessionProvider`, keep the behavior and satisfy the rule with the smallest change it suggests; record it in the report.

- [ ] **Step 5: Mount the provider** — in `frontend/src/app/layout.tsx` wrap `{children}` with `<SessionProvider>…</SessionProvider>` (import from `@/lib/session`).

- [ ] **Step 6: Restyle the Button to the design reference** — in `frontend/src/components/ui/button.tsx` change only these cva entries:
  - `variant.default`: `"bg-primary text-primary-foreground hover:bg-primary-800"`
  - `variant.secondary`: `"bg-secondary text-secondary-foreground hover:bg-sage-700"`
  - `variant.destructive`: `"bg-destructive text-white hover:bg-danger-700 focus-visible:border-destructive/40 focus-visible:ring-destructive/30"`
  - `size.default`: `"h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3"`
  - `size.sm`: `"h-8 gap-1.5 rounded-[min(var(--radius-md),12px)] px-3 text-[13px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5"`
  - `size.lg`: `"h-12 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5"`
  - `size.icon`: `"size-10"`

- [ ] **Step 7: Verify** — `npm test`, `npm run lint`, `npm run build` all pass.

- [ ] **Step 8: Commit**
```bash
git add frontend/next.config.ts frontend/.env.example frontend/src/lib frontend/src/app/layout.tsx frontend/src/components/ui/button.tsx
git commit -m "feat(frontend): typed API client, session context, /api rewrite and button sizes"
```

---

### Task 2: Design-system alignment with the business rules

**Files:**
- Modify: `frontend/src/components/design-system/StatusBadge.tsx` (+ test), `ProbabilityCard.tsx` (+ test), `index.ts`, `frontend/src/app/design-system/page.tsx` (+ test)

**Interfaces:**
- Consumes: `CaseStatus` from `@/lib/case-status` (remove the local `CaseStatus` type from StatusBadge; re-export the type from `index.ts` as before).
- Produces:
  - `BadgeStatus = "draft" | "awaiting_approval" | "awaiting_judge" | "ready_for_agreement" | "in_mediation" | "resolved" | "anonymized"`; `badgeForCaseStatus(status: CaseStatus): BadgeStatus` mapping `DRAFT→draft, AWAITING_APPROVAL→awaiting_approval, READY_FOR_JUDGE→awaiting_judge, EVALUATED→ready_for_agreement, IN_MEDIATION→in_mediation, RESOLVED→resolved`.
  - `tierFor(score)`: `high` ≥ 80, `mid` ≥ 60, else `low` (Probabilidade source).
  - `ProbabilityCard({ score, caseLabel?, factors?, audience?: "client" | "professional", className? })`.

- [ ] **Step 1: StatusBadge** — badge specs (exact labels/icons/classes):

| key | label | icon (lucide) | subtle | solid |
|---|---|---|---|---|
| draft | Rascunho | `FilePen` | `border-slate-200 bg-slate-100 text-slate-700` | `border-slate-700 bg-slate-700 text-white` |
| awaiting_approval | Aguardando sua aprovação | `ShieldAlert` | `border-primary-100 bg-primary-50 text-primary-800` | `border-primary-700 bg-primary-700 text-white` |
| awaiting_judge | Aguardando Juiz | `Clock` | (unchanged) | (unchanged) |
| ready_for_agreement | Pronto para Acordo | `Check` | (unchanged) | (unchanged) |
| in_mediation | Em mediação | `Handshake` | `border-primary-200 bg-primary-50 text-primary-700` | `border-primary-600 bg-primary-600 text-white` |
| resolved | Acordo fechado | `Archive` | `border-slate-200 bg-slate-100 text-slate-700` | `border-slate-700 bg-slate-700 text-white` |
| anonymized | Anonimizado | `EyeOff` / solid `ShieldCheck` | (unchanged) | (unchanged) |

Update `StatusBadge.test.tsx`: the label test covers all seven keys; the mapper test covers all six `CaseStatus` values (table above); keep the icon-swap and tone tests. Remove the old `closed` key everywhere (showcase included).

- [ ] **Step 2: ProbabilityCard** — tests first (`ProbabilityCard.test.tsx`):
  - `tierFor`: `[0,"low"], [59,"low"], [60,"mid"], [79,"mid"], [80,"high"], [100,"high"]`.
  - `score={85}` → `getByRole("img", { name: "Score 85 por cento, probabilidade alta" })` and headline `"Seu caso tem boas chances"`.
  - `score={70}` → `"Score 70 por cento, probabilidade média"`.
  - `score={40}` → headline `"Seu caso tem risco alto"`.
  - `audience="professional"` with `score={85}` → headline `"Alta probabilidade de êxito no Judiciário"` and the client headline absent.
  - keep the clamp, factors (two cards, distinct ids), repeated-label and disclaimer tests.

  Implementation changes: `tierFor` thresholds 80/60; legend markers at `left-[60%]` and `left-[80%]` and legend grid `grid-cols-[60fr_20fr_20fr]`; replace the per-tier `headline`/`copy` with an `audience`-keyed copy table (default `"client"`):

| tier | client headline | client copy | professional headline | professional copy |
|---|---|---|---|---|
| high | Seu caso tem boas chances | Mesmo com boas chances, um processo pode levar anos. Um acordo mediado tende a ser a via mais rápida para receber. | Alta probabilidade de êxito no Judiciário | Avaliadores consideram as provas e a jurisprudência favoráveis. Bom cenário para propor acordo rápido. |
| mid | Seu caso tem chances moderadas | Há pontos em aberto. Um acordo mediado reduz o risco de perda e as custas do processo. | Probabilidade moderada de êxito | Resultado incerto no Judiciário; a mediação reduz risco para as duas partes. |
| low | Seu caso tem risco alto | Há risco relevante de perda e de arcar com custas processuais. A mediação com um advogado é o caminho de menor risco. | Baixa probabilidade de êxito | Alto risco de perda no Judiciário; priorize um acordo mediado. |

- [ ] **Step 3: Showcase** — `app/design-system/page.tsx`: scores `85`, `70`, `40` (high/mid/low) and badges for all seven keys; update `page.test.tsx` accordingly (`"Score 70 por cento, probabilidade média"`, `"Score 40 por cento, probabilidade baixa"`).

- [ ] **Step 4: Verify and commit** — all tests/lint/build pass.
```bash
git add frontend/src/components/design-system frontend/src/app/design-system
git commit -m "feat(design-system): lifecycle badges and business score tiers with audience copy"
```

---

### Task 3: Home, login, sign-up and app header

**Files:**
- Create: `frontend/src/features/auth/LoginForm.tsx`, `RegisterForm.tsx`, `frontend/src/components/AppHeader.tsx`, `frontend/src/app/login/page.tsx`, `frontend/src/app/register/page.tsx`
- Replace: `frontend/src/app/page.tsx` (create-next-app boilerplate → role picker)
- Test: `frontend/src/features/auth/auth.test.tsx`, `frontend/src/app/home.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, `HOME_FOR_ROLE`, `useSession`, `Button`/`buttonVariants`.
- Produces: routes `/` (role picker; authenticated users are redirected to their home), `/login`, `/register`; `AppHeader({ title })` showing "PeaceLaw", the page title, the user's e-mail and a "Sair" button (logout → `setUser(null)` → `router.replace("/")`).

**Behavior contract (tests below are the acceptance criteria):**
- Home: heading "PeaceLaw"; three cards — "Sou cliente" (links "Entrar" → `/login`, "Criar conta" → `/register`), "Sou juiz avaliador" ("Entrar" → `/login`), "Sou advogado mediador" ("Entrar" → `/login`); a line explaining that judge and lawyer accounts are created by the platform. If `state.status === "authenticated"` and `HOME_FOR_ROLE[role] !== "/"`, `router.replace(HOME_FOR_ROLE[role])`; an authenticated ADMIN instead sees `role="status"` "A área administrativa ainda não está disponível." (no redirect loop).
- Login: labelled inputs "E-mail" (type email) and "Senha" (type password, `autoComplete="current-password"`); button "Entrar" disabled while submitting; on success `setUser(user)` and `router.replace(HOME_FOR_ROLE[user.role])`; on `ApiError` show its message in `role="alert"`; link "Criar conta de cliente" → `/register`.
- Register: "E-mail", "Senha" (hint "Mínimo de 12 caracteres.", `minLength={12}`, `autoComplete="new-password"`); submit disabled until password ≥ 12 chars; success → `setUser`, `router.replace("/client")`; errors (incl. 409 "E-mail já cadastrado.") in `role="alert"`.
- Pages `login/page.tsx` and `register/page.tsx` are thin `"use client"` wrappers centering the form (layout like the design system cards).

- [ ] **Step 1: Write failing tests**

`frontend/src/features/auth/auth.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

function renderAnon(ui: React.ReactNode) {
  return render(<SessionProvider initialState={{ status: "anonymous" }}>{ui}</SessionProvider>);
}

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

describe("LoginForm", () => {
  it("logs in and goes to the role's home", async () => {
    const user = userEvent.setup();
    const login = vi.spyOn(api, "login").mockResolvedValue({ id: "1", email: "j@b.com", role: "JUDGE" });
    renderAnon(<LoginForm />);
    await user.type(screen.getByLabelText("E-mail"), "j@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(login).toHaveBeenCalledWith("j@b.com", "senha-forte-123");
    expect(replace).toHaveBeenCalledWith("/judge");
  });

  it("shows the server message on failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, "E-mail ou senha inválidos."));
    renderAnon(<LoginForm />);
    await user.type(screen.getByLabelText("E-mail"), "x@b.com");
    await user.type(screen.getByLabelText("Senha"), "errada");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos.");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("RegisterForm", () => {
  it("requires 12 characters before enabling sign-up", async () => {
    const user = userEvent.setup();
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.type(screen.getByLabelText("Senha"), "curta");
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeDisabled();
  });

  it("creates the account and opens the client area", async () => {
    const user = userEvent.setup();
    const register = vi.spyOn(api, "register").mockResolvedValue({ id: "1", email: "novo@b.com", role: "CLIENT" });
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(register).toHaveBeenCalledWith("novo@b.com", "senha-forte-123");
    expect(replace).toHaveBeenCalledWith("/client");
  });

  it("shows duplicate e-mail errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "register").mockRejectedValue(new ApiError(409, "E-mail já cadastrado."));
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "dup@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail já cadastrado.");
  });
});
```

`frontend/src/app/home.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/lib/session";

import HomePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => replace.mockReset());

describe("/", () => {
  it("offers the three actor entry points", () => {
    render(<SessionProvider initialState={{ status: "anonymous" }}><HomePage /></SessionProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "PeaceLaw" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou cliente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou juiz avaliador" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou advogado mediador" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute("href", "/register");
  });

  it("redirects a signed-in user to their area", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "l@b.com", role: "LAWYER" } }}>
        <HomePage />
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/lawyer"));
  });
});
```

- [ ] **Step 2: RED** — `npm test -- src/features/auth src/app/home.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the components/pages to the behavior contract, styled with tokens like the design-system showcase (cards `rounded-xl border border-slate-200 bg-white shadow-sm`, serif `font-serif` headings, `Button`). Use `next/link` for links (`<Link className={buttonVariants({ variant: "outline" })}>`). `AppHeader` is used by Tasks 4–6.
- [ ] **Step 4: GREEN** — full `npm test`, `npm run lint`, `npm run build`.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/features/auth frontend/src/components/AppHeader.tsx frontend/src/app/page.tsx frontend/src/app/home.test.tsx frontend/src/app/login frontend/src/app/register
git commit -m "feat(frontend): role picker home, login, client sign-up and app header"
```

---

### Task 4: `/client` — wizard and own cases

**Files:**
- Create: `frontend/src/app/client/page.tsx`, `frontend/src/features/client/{ClientWorkspace,CaseList,NewCaseWizard,CaseDetail,AnonymizedText}.tsx`
- Test: `frontend/src/features/client/client.test.tsx`

**Interfaces:**
- Consumes: `api.myCases/createCase/approveCase/deleteCase/getCase`, `ApiError`, `RoleGate`, `AppHeader`, `StatusBadge`, `badgeForCaseStatus`, `ProbabilityCard`, `tierFor`, `UploadZone` (controlled `files`/`onFilesChange`).
- Produces: `/client` = `<RoleGate role="CLIENT"><ClientWorkspace /></RoleGate>`; `AnonymizedText({ text })` renders `[LABEL]` tokens as `<mark data-token="LABEL">` chips (exported for reuse by judge/lawyer views).

**Behavior contract:**
- `ClientWorkspace` view state: `{ kind: "list" } | { kind: "new" } | { kind: "case"; id: string }`; header via `AppHeader title="Meus casos"`.
- **List**: loads `api.myCases()`; loading `role="status"` "Carregando casos…"; empty: "Você ainda não enviou nenhum caso."; each item is a button with the title, `StatusBadge` (`badgeForCaseStatus`), date (`toLocaleDateString("pt-BR")`) and, when `ai_probability_score !== null`, "Chance de êxito: NN%"; "Novo caso" button opens the wizard.
- **Wizard** (port the look of `VisaoDemandante.jsx`; stepper "Relato · Privacidade · Enviado"):
  1. *Relato*: inputs "Título do caso" (3–200) and "Relato" (textarea; counter `"{n}/40 caracteres mínimos"` until 40); `UploadZone` controlled with local state (files stay in the browser — its default note says so; do not send files); button "Anonimizar relato" disabled until title ≥ 3 and text ≥ 40 (trimmed) → `api.createCase(title.trim(), text.trim())`.
  2. *Privacidade*: heading "Confira o que juízes e advogados vão ver"; anonymized title and `AnonymizedText`; a list of redaction counts ("NOME: 2", …); a `<details>` "Seu relato original (somente você vê)" with `raw_text`; buttons "Aprovar e enviar aos juízes" (`api.approveCase`) and "Excluir caso" which first turns into "Confirmar exclusão" (second click → `api.deleteCase` → list).
  3. *Enviado*: `role="status"` "Caso enviado para avaliação." and "Você verá o score aqui quando um juiz avaliar." + button "Ver meus casos".
- **Detail** (`api.getCase`): title, `StatusBadge`, `AnonymizedText`, raw `<details>` as above; actions by status — `AWAITING_APPROVAL`: approve + delete (with confirmation); `READY_FOR_JUDGE`: delete (with confirmation) + "Aguardando avaliação dos juízes."; when `ai_probability_score !== null`: `ProbabilityCard score=… audience="client"` and a call-to-action box: high tier → "Um acordo agora tende a ser a via mais rápida para receber.", other tiers → `role="alert"` "Atenção: há risco de perda e de custas processuais." followed by "Seu caso está disponível para advogados mediadores."; `IN_MEDIATION`: "Um advogado mediador assumiu seu caso."; `RESOLVED`: "Acordo registrado."; "Voltar" returns to the list.
- Any `ApiError` → its message in `role="alert"`; buttons disabled while a request is in flight.

- [ ] **Step 1: Write failing tests** — `frontend/src/features/client/client.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseCreated, type CaseOwnerView } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { AnonymizedText } from "./AnonymizedText";
import { ClientWorkspace } from "./ClientWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const RAW = "O responsável, Carlos Menezes, abandonou a obra. Meu CPF é 123.456.789-00.";
const created: CaseCreated = {
  id: "c1",
  title: "Obra abandonada por [NOME]",
  status: "AWAITING_APPROVAL",
  ai_probability_score: null,
  created_at: "2026-10-14T12:00:00Z",
  raw_text: RAW,
  anonymized_text: "O responsável, [NOME], abandonou a obra. Meu CPF é [CPF].",
  redactions: [{ label: "NOME", count: 2 }, { label: "CPF", count: 1 }],
};

function renderClient() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "u1", email: "c@b.com", role: "CLIENT" } }}>
      <ClientWorkspace />
    </SessionProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("AnonymizedText", () => {
  it("marks redaction tokens", () => {
    render(<AnonymizedText text="Falei com [NOME], CPF [CPF]." />);
    expect(screen.getByText("[NOME]")).toHaveAttribute("data-token", "NOME");
    expect(screen.getByText("[CPF]").tagName).toBe("MARK");
  });
});

describe("ClientWorkspace", () => {
  it("lists own cases with status and score", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([
      { id: "c9", title: "Contrato de aluguel", status: "EVALUATED", ai_probability_score: 85, created_at: "2026-10-14T12:00:00Z" },
    ]);
    renderClient();
    const item = await screen.findByRole("button", { name: /Contrato de aluguel/ });
    expect(within(item).getByText("Pronto para Acordo")).toBeInTheDocument();
    expect(within(item).getByText("Chance de êxito: 85%")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    renderClient();
    expect(await screen.findByText("Você ainda não enviou nenhum caso.")).toBeInTheDocument();
  });

  it("anonymizes, lets the client review, and sends to judges", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    const createCase = vi.spyOn(api, "createCase").mockResolvedValue(created);
    const approve = vi.spyOn(api, "approveCase").mockResolvedValue({ ...created, status: "READY_FOR_JUDGE" });
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));

    const submit = screen.getByRole("button", { name: "Anonimizar relato" });
    await user.type(screen.getByLabelText("Título do caso"), "  Obra abandonada por Carlos Menezes ");
    await user.type(screen.getByLabelText("Relato"), "curto");
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Relato"));
    await user.type(screen.getByLabelText("Relato"), RAW);
    await user.click(submit);

    expect(createCase).toHaveBeenCalledWith("Obra abandonada por Carlos Menezes", RAW);
    expect(await screen.findByRole("heading", { name: "Confira o que juízes e advogados vão ver" })).toBeInTheDocument();
    expect(screen.getByText("NOME: 2")).toBeInTheDocument();
    expect(screen.getByText(RAW)).toBeInTheDocument(); // inside the owner-only <details>

    await user.click(screen.getByRole("button", { name: "Aprovar e enviar aos juízes" }));
    expect(approve).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("status")).toHaveTextContent("Caso enviado para avaliação.");
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    const remove = vi.spyOn(api, "deleteCase").mockResolvedValue(undefined);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await user.type(screen.getByLabelText("Relato"), RAW);
    await user.click(screen.getByRole("button", { name: "Anonimizar relato" }));

    await user.click(await screen.findByRole("button", { name: "Excluir caso" }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(remove).toHaveBeenCalledWith("c1");
  });

  it("shows the score and a risk call-to-action for low scores", async () => {
    const user = userEvent.setup();
    const evaluated: CaseOwnerView = { ...created, status: "EVALUATED", ai_probability_score: 40 };
    vi.spyOn(api, "myCases").mockResolvedValue([evaluated]);
    vi.spyOn(api, "getCase").mockResolvedValue(evaluated);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    expect(await screen.findByRole("img", { name: "Score 40 por cento, probabilidade baixa" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Atenção: há risco de perda e de custas processuais.");
  });

  it("shows API errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockRejectedValue(new ApiError(422, "Dados inválidos."));
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await user.type(screen.getByLabelText("Relato"), RAW);
    await user.click(screen.getByRole("button", { name: "Anonimizar relato" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dados inválidos.");
  });
});
```
- [ ] **Step 2: RED** → **Step 3: implement to the contract** → **Step 4: GREEN** (`npm test`, `npm run lint`, `npm run build`).
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/client frontend/src/features/client
git commit -m "feat(client): case wizard with anonymization review, own cases and score"
```

---

### Task 5: `/judge` — accessible split-view scoring

**Files:**
- Create: `frontend/src/app/judge/page.tsx`, `frontend/src/features/judge/{JudgeWorkspace,ScoreSlider}.tsx`
- Test: `frontend/src/features/judge/judge.test.tsx`

**Interfaces:**
- Consumes: `api.judgeQueue/submitReview`, `ApiError`, `RoleGate`, `AppHeader`, `AnonymizedText`, `StatusBadge` (`anonymized`).
- Produces: `/judge` = `<RoleGate role="JUDGE"><JudgeWorkspace /></RoleGate>`; `ScoreSlider({ id, label, value, onChange })`.

**Behavior contract** (port the look of `VisaoAvaliador.jsx`: high-contrast, large type, 3px focus rings, WCAG AAA target):
- Loads `api.judgeQueue()`; loading `role="status"` "Carregando fila…"; empty → "Nenhum caso aguardando avaliação."
- Left rail: list of queued cases (button per case, title + date; selected has `aria-current="true"`); the first case is selected initially.
- Split view for the selected case: left panel heading = case title, `StatusBadge status="anonymized"`, `AnonymizedText` in `font-serif`, with text-size buttons "Diminuir texto" / "Aumentar texto" stepping through `[18, 20, 22, 24, 26, 28, 32]` px (start 20; the text container exposes `data-font-size`); right panel form:
  - `ScoreSlider` "Provas" and "Jurisprudência": native `<input type="range" min=0 max=10 step=1>` (default 5) with a visible label, `aria-valuetext="{v} de 10"`, large thumb/track, and the current value shown next to the label.
  - Live line (`aria-live="polite"`): `"Nota do avaliador: {avg}"` with one decimal and comma (e.g. `7,0`).
  - Textarea "Observações (opcional)", hint "Não inclua dados pessoais.", `maxLength={2000}`.
  - Submit "Enviar avaliação" → `api.submitReview(id, { score_evidence, score_jurisprudence, notes: notes.trim() || undefined })`; on success remove the case from the queue, select the next one, reset the form, and show `role="status"` "Avaliação registrada.". On `ApiError` show its message in `role="alert"`; on 404 or 409 also remove the case from the queue (it was deleted by its owner, reviewed already, or moved on).
- Judges never see scores of other judges (the API does not send them; do not add any).

- [ ] **Step 1: Write failing tests** — `frontend/src/features/judge/judge.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseForJudge } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { JudgeWorkspace } from "./JudgeWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const queue: CaseForJudge[] = [
  { id: "a", title: "Obra abandonada", anonymized_text: "O responsável, [NOME], abandonou a obra.", created_at: "2026-10-14T12:00:00Z" },
  { id: "b", title: "Cobrança indevida", anonymized_text: "A empresa [EMPRESA] cobrou [VALOR].", created_at: "2026-10-14T13:00:00Z" },
];

function renderJudge() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "j", email: "j@b.com", role: "JUDGE" } }}>
      <JudgeWorkspace />
    </SessionProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("JudgeWorkspace", () => {
  it("shows the first queued case in the reading panel", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    expect(await screen.findByRole("heading", { name: "Obra abandonada" })).toBeInTheDocument();
    expect(screen.getByText("[NOME]")).toBeInTheDocument();
  });

  it("computes the evaluator score from both sliders", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    fireEvent.change(await screen.findByLabelText("Provas"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Jurisprudência"), { target: { value: "6" } });
    expect(screen.getByText("Nota do avaliador: 7,0")).toBeInTheDocument();
    expect(screen.getByLabelText("Provas")).toHaveAttribute("aria-valuetext", "8 de 10");
  });

  it("submits the review and moves to the next case", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    const submit = vi.spyOn(api, "submitReview").mockResolvedValue({
      id: "r", case_id: "a", score_evidence: 9, score_jurisprudence: 7, notes: null, created_at: "",
    });
    renderJudge();
    fireEvent.change(await screen.findByLabelText("Provas"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Jurisprudência"), { target: { value: "7" } });
    await user.type(screen.getByLabelText("Observações (opcional)"), "  Prova robusta.  ");
    await user.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    expect(submit).toHaveBeenCalledWith("a", { score_evidence: 9, score_jurisprudence: 7, notes: "Prova robusta." });
    expect(await screen.findByRole("heading", { name: "Cobrança indevida" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Avaliação registrada.");
    expect(screen.getByLabelText("Provas")).toHaveValue("5");
  });

  it("changes the reading size", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    const text = (await screen.findByText("[NOME]")).closest("[data-font-size]");
    expect(text).toHaveAttribute("data-font-size", "20");
    await user.click(screen.getByRole("button", { name: "Aumentar texto" }));
    expect(text).toHaveAttribute("data-font-size", "22");
  });

  it("shows an empty queue", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue([]);
    renderJudge();
    expect(await screen.findByText("Nenhum caso aguardando avaliação.")).toBeInTheDocument();
  });

  it("drops a case already reviewed elsewhere", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    vi.spyOn(api, "submitReview").mockRejectedValue(new ApiError(409, "Você já avaliou este caso."));
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Enviar avaliação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você já avaliou este caso.");
    expect(screen.getByRole("heading", { name: "Cobrança indevida" })).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: RED** → **Step 3: implement** → **Step 4: GREEN** (test/lint/build).
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/judge frontend/src/features/judge
git commit -m "feat(judge): accessible split-view with evidence and jurisprudence scoring"
```

---

### Task 6: `/lawyer` — mediation Kanban

**Files:**
- Create: `frontend/src/app/lawyer/page.tsx`, `frontend/src/features/lawyer/{LawyerBoard,CaseCard,CaseDrawer}.tsx`
- Test: `frontend/src/features/lawyer/lawyer.test.tsx`

**Interfaces:**
- Consumes: `api.lawyerBoard/matchCase/resolveCase`, `ApiError`, `RoleGate`, `AppHeader`, `AnonymizedText`, `ProbabilityCard` (`audience="professional"`), `tierFor`.
- Produces: `/lawyer` = `<RoleGate role="LAWYER"><LawyerBoard /></RoleGate>`.

**Behavior contract** (port the look of `VisaoSolucionador.jsx`; no drag-and-drop — explicit buttons are accessible):
- Loads `api.lawyerBoard()`; loading `role="status"` "Carregando quadro…".
- Three columns, each `<section aria-labelledby>` with a heading and count: "Oportunidades" (`EVALUATED`), "Em mediação" (`IN_MEDIATION`), "Acordos fechados" (`RESOLVED`); empty column text "Nenhum caso aqui.".
- Card: title, chip "Chance de êxito: NN%" coloured by `tierFor` (sage/warning/danger tokens), date; actions: Oportunidades → "Assumir mediação" (`api.matchCase` → card moves to "Em mediação"); Em mediação → "Registrar acordo" (`api.resolveCase` → card moves to "Acordos fechados"); every card → "Ver caso" opens the drawer.
- Drawer: `role="dialog"` `aria-modal="true"` labelled by the case title; shows `AnonymizedText` and `ProbabilityCard audience="professional"` (no factors); closes with "Fechar" and `Escape`; returns focus to the "Ver caso" button.
- `ApiError` → message in `role="alert"`; on 409 reload the board (`api.lawyerBoard()` again) so stale cards disappear.

- [ ] **Step 1: Write failing tests** — `frontend/src/features/lawyer/lawyer.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseForLawyer } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LawyerBoard } from "./LawyerBoard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const base = { anonymized_text: "O responsável, [NOME], abandonou a obra.", created_at: "2026-10-14T12:00:00Z" };
const board: CaseForLawyer[] = [
  { ...base, id: "o1", title: "Obra abandonada", status: "EVALUATED", ai_probability_score: 85 },
  { ...base, id: "m1", title: "Cobrança indevida", status: "IN_MEDIATION", ai_probability_score: 55 },
  { ...base, id: "r1", title: "Aluguel atrasado", status: "RESOLVED", ai_probability_score: 70 },
];

function column(name: string) {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

function renderLawyer() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "l", email: "l@b.com", role: "LAWYER" } }}>
      <LawyerBoard />
    </SessionProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("LawyerBoard", () => {
  it("groups cases by stage", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    await screen.findByText("Obra abandonada");
    expect(within(column("Oportunidades")).getByText("Obra abandonada")).toBeInTheDocument();
    expect(within(column("Em mediação")).getByText("Cobrança indevida")).toBeInTheDocument();
    expect(within(column("Acordos fechados")).getByText("Aluguel atrasado")).toBeInTheDocument();
    expect(within(column("Oportunidades")).getByText("Chance de êxito: 85%")).toBeInTheDocument();
  });

  it("takes an opportunity into mediation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    const match = vi.spyOn(api, "matchCase").mockResolvedValue({ ...board[0], status: "IN_MEDIATION" });
    renderLawyer();
    await user.click(await screen.findByRole("button", { name: "Assumir mediação" }));
    expect(match).toHaveBeenCalledWith("o1");
    expect(within(column("Em mediação")).getByText("Obra abandonada")).toBeInTheDocument();
  });

  it("registers an agreement", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    vi.spyOn(api, "resolveCase").mockResolvedValue({ ...board[1], status: "RESOLVED" });
    renderLawyer();
    await user.click(await screen.findByRole("button", { name: "Registrar acordo" }));
    expect(within(column("Acordos fechados")).getByText("Cobrança indevida")).toBeInTheDocument();
  });

  it("reloads the board when another lawyer was faster", async () => {
    const user = userEvent.setup();
    const load = vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce(board).mockResolvedValueOnce(board.slice(1));
    vi.spyOn(api, "matchCase").mockRejectedValue(new ApiError(409, "Este caso já está em mediação."));
    renderLawyer();
    await user.click(await screen.findByRole("button", { name: "Assumir mediação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este caso já está em mediação.");
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Obra abandonada")).not.toBeInTheDocument();
  });

  it("opens the case drawer with the anonymized text and professional score", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    await user.click((await screen.findAllByRole("button", { name: "Ver caso" }))[0]);
    const dialog = screen.getByRole("dialog", { name: "Obra abandonada" });
    expect(within(dialog).getByText("[NOME]")).toBeInTheDocument();
    expect(within(dialog).getByText("Alta probabilidade de êxito no Judiciário")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```
- [ ] **Step 2: RED** → **Step 3: implement** → **Step 4: GREEN** (test/lint/build).
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/lawyer frontend/src/features/lawyer
git commit -m "feat(lawyer): mediation Kanban with match, agreement and case drawer"
```

---

## STOP — Milestone 3 gate (controller)

Run both dev servers (`uvicorn` on :8000, `npm run dev` on :3000), seed demo accounts, drive the full flow in a browser (client creates + approves → judge scores → client sees score → lawyer matches + resolves), and hand the user the URLs and demo credentials.
