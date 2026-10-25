# M2 — Frontend & Design System Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js 16 + Tailwind v4 + shadcn frontend whose theme is the PeaceLaw design system (Sapphire/Sage tokens, Inter/Lora), with typed, tested `StatusBadge`, `ProbabilityCard` and `UploadZone` components and a `/design-system` showcase page — compiling, linting and testing clean.

**Architecture:** `frontend/` is created by `create-next-app` (App Router, `src/`, `@/*` alias) and initialized by shadcn. Design tokens live only in `src/app/globals.css` (Tailwind v4 `@theme` scales + shadcn semantic variables); components use token utility classes (`bg-sage-50`, `text-primary-700`…), never hard-coded hex. Each component is one file in `src/components/design-system/` with a co-located Vitest + Testing Library test. The original design source is kept as read-only reference in `docs/design-system/`.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS v4, shadcn/ui, lucide-react, Vitest 5 + @testing-library/react + user-event 14 + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md` (decision 2: port, don't rewrite)

## Global Constraints

- Repo root `c:\Users\mellq\PeaceLaw`; frontend lives in `frontend/`; run frontend commands from `frontend/`. Windows + Git Bash.
- Design source (read-only): `C:/Users/mellq/Downloads/design-system/` — never modify it.
- No hard-coded hex colors in components; use the token utilities defined in Task 2. Exact hex values live only in `globals.css`.
- All user-facing copy is pt-BR.
- Security microcopy must be truthful: nothing in the UI may claim end-to-end encryption while none exists. `UploadZone`'s note is a prop with a truthful default (see Task 5).
- `UploadZone` must not simulate encryption/anonymization progress (no fake timers). It only validates and lists files.
- Test output must be pristine (no warnings). `npm run build`, `npm run lint` and `npm test` all pass at the end of every task that touches code.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: Scaffold Next.js + shadcn + Vitest, keep design reference

**Files:**
- Create (generated): `frontend/**` via `create-next-app` and `shadcn init`
- Create: `frontend/vitest.config.mts`, `frontend/vitest.setup.ts`, `frontend/src/lib/smoke.test.ts`
- Modify: `frontend/package.json` (add `"test": "vitest run"` script)
- Create: `docs/design-system/` (copies of `DesignSystemShowcase.jsx`, `VisaoDemandante.jsx`, `VisaoAvaliador.jsx`, `VisaoSolucionador.jsx`, `assets/peacelaw-logo.jpeg`) + `docs/design-system/README.md`

**Interfaces:**
- Produces: a building Next.js app at `frontend/` with `@/*` → `src/*`, `@/lib/utils` exporting `cn(...)` (from shadcn init), `lucide-react` installed, `npm test` running Vitest in jsdom with jest-dom matchers and auto-cleanup.

- [ ] **Step 1: Create the app** (from repo root)

```bash
npx create-next-app@latest frontend --typescript --eslint --tailwind --app --use-npm --src-dir --import-alias "@/*" --yes
```
Expected: `frontend/` created; because the repo root is already a git repo, no nested `.git` is created (verify `ls frontend/.git` fails; if it exists, delete `frontend/.git`).

- [ ] **Step 2: Initialize shadcn** (from `frontend/`)

```bash
npx shadcn@latest init -d
npm install lucide-react
```
Expected: `components.json`, `src/lib/utils.ts` (with `cn`), and shadcn CSS variables in `src/app/globals.css`. If the CLI still prompts, re-run with `--yes`.

- [ ] **Step 3: Install and configure Vitest** (from `frontend/`)

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
```

`frontend/vitest.config.mts`:
```ts
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

`frontend/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

In `frontend/package.json` `"scripts"`, add: `"test": "vitest run"`.

- [ ] **Step 4: Smoke test the toolchain**

`frontend/src/lib/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

Run: `npm test`
Expected: 1 passed, no warnings.

- [ ] **Step 5: Copy the design reference** (from repo root)

```bash
mkdir -p docs/design-system/assets
cp "/c/Users/mellq/Downloads/design-system/DesignSystemShowcase.jsx" "/c/Users/mellq/Downloads/design-system/VisaoDemandante.jsx" "/c/Users/mellq/Downloads/design-system/VisaoAvaliador.jsx" "/c/Users/mellq/Downloads/design-system/VisaoSolucionador.jsx" docs/design-system/
cp "/c/Users/mellq/Downloads/design-system/assets/peacelaw-logo.jpeg" docs/design-system/assets/
```

`docs/design-system/README.md`:
```markdown
# Design system — reference source

Original PeaceLaw design-system files (React/JSX prototypes with hard-coded
hex colors). **Reference only — not part of the build.**

- `DesignSystemShowcase.jsx` — tokens, buttons, `StatusBadge`, `ProbabilityCard`, `SecureUpload`
- `VisaoDemandante.jsx` — client wizard (Milestone 3: `/client`)
- `VisaoAvaliador.jsx` — judge split-view (Milestone 3: `/judge`)
- `VisaoSolucionador.jsx` — lawyer Kanban (Milestone 3: `/lawyer`)

The production components live in `frontend/src/components/design-system/` and
use the Tailwind tokens defined in `frontend/src/app/globals.css`.
```

- [ ] **Step 6: Verify build and lint** (from `frontend/`)

Run: `npm run build` then `npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 7: Commit** (from repo root)

```bash
git add frontend docs/design-system
git status --short | grep -E "node_modules|\.next" && echo "STOP: build output staged" || true
git commit -m "chore(frontend): scaffold Next.js, shadcn and Vitest; keep design reference"
```
Expected: no `node_modules/` or `.next/` paths staged.

---

### Task 2: Design tokens, fonts and theming

**Files:**
- Modify: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`
- Create (generated): `frontend/src/components/ui/button.tsx` via `npx shadcn@latest add button`
- Test: `frontend/src/app/theme.test.ts`

**Interfaces:**
- Produces Tailwind utilities used by every later task:
  - Scales `primary-{50..950}`, `sage-{50..900}`, `danger-{50..900}`, `warning-{50..900}` (e.g. `bg-primary-50`, `text-sage-800`, `stroke-sage-600`, `border-warning-100`). `slate-*` is Tailwind's default.
  - shadcn semantic colors themed: `bg-primary` = Sapphire 700, `bg-secondary` = Sage 600, plus new `success` and `warning` semantic colors (`text-success`, `bg-warning`).
  - Note: `--color-warning` (semantic) and `--color-warning-50…900` (scale) are distinct variables; `bg-warning` and `bg-warning-600` both work.
  - Fonts: `font-sans` = Inter, `font-serif` = Lora.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/theme.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("design tokens", () => {
  it.each([
    ["--color-primary-700", "#183A6E"],
    ["--color-primary-50", "#EEF3FB"],
    ["--color-sage-600", "#4A7556"],
    ["--color-danger-600", "#9A3A34"],
    ["--color-warning-600", "#946A1E"],
  ])("defines %s as %s", (token, hex) => {
    expect(css).toMatch(new RegExp(`${token}:\\s*${hex};`, "i"));
  });

  it.each([
    ["--primary", "#183A6E"],
    ["--secondary", "#4A7556"],
    ["--ring", "#4A78C0"],
    ["--destructive", "#9A3A34"],
  ])("maps shadcn %s to %s in :root", (variable, value) => {
    const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    expect(root).toContain(`${variable}: ${value};`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/app/theme.test.ts`
Expected: FAIL (tokens not defined).

- [ ] **Step 3: Add the palette scales**

In `frontend/src/app/globals.css`, directly after the `@import` lines at the top, add:
```css
@theme {
  --color-primary-50: #EEF3FB;
  --color-primary-100: #D5E1F4;
  --color-primary-200: #ABC3E8;
  --color-primary-300: #7A9FD6;
  --color-primary-400: #4A78C0;
  --color-primary-500: #2B5BA6;
  --color-primary-600: #1F4787;
  --color-primary-700: #183A6E;
  --color-primary-800: #132D56;
  --color-primary-900: #0E2140;
  --color-primary-950: #091629;

  --color-sage-50: #F1F6F2;
  --color-sage-100: #DDEBE0;
  --color-sage-200: #BFD8C5;
  --color-sage-300: #9DC2A6;
  --color-sage-400: #79A784;
  --color-sage-500: #5E8F6B;
  --color-sage-600: #4A7556;
  --color-sage-700: #3B5E45;
  --color-sage-800: #2F4A37;
  --color-sage-900: #243829;

  --color-danger-50: #FBF1F0;
  --color-danger-100: #F5DCDA;
  --color-danger-200: #EBBAB6;
  --color-danger-300: #DC918B;
  --color-danger-400: #C9665F;
  --color-danger-500: #B54740;
  --color-danger-600: #9A3A34;
  --color-danger-700: #7E302B;
  --color-danger-800: #632723;
  --color-danger-900: #4A1E1B;

  --color-warning-50: #FBF6EA;
  --color-warning-100: #F4E6C2;
  --color-warning-200: #EACF8C;
  --color-warning-300: #DDB45A;
  --color-warning-400: #CC9C3A;
  --color-warning-500: #B7862A;
  --color-warning-600: #946A1E;
  --color-warning-700: #75531A;
  --color-warning-800: #5A4016;
  --color-warning-900: #422F11;
}
```

- [ ] **Step 4: Map the shadcn semantic variables (light theme)**

In the `:root { ... }` block that shadcn generated, set these variables to exactly these values (replace the existing value where the variable exists, add it where it does not; leave every other variable untouched):
```css
  --background: #F8FAFC;
  --foreground: #0F172A;
  --card: #FFFFFF;
  --card-foreground: #0F172A;
  --popover: #FFFFFF;
  --popover-foreground: #0F172A;
  --primary: #183A6E;
  --primary-foreground: #FFFFFF;
  --secondary: #4A7556;
  --secondary-foreground: #FFFFFF;
  --muted: #F1F5F9;
  --muted-foreground: #475569;
  --accent: #EEF3FB;
  --accent-foreground: #132D56;
  --destructive: #9A3A34;
  --border: #E2E8F0;
  --input: #CBD5E1;
  --ring: #4A78C0;
  --success: #4A7556;
  --warning: #946A1E;
```
(Literal hex on purpose: Tailwind v4 may tree-shake theme variables it does not see used, so `:root` must not depend on `var(--color-…)`.)
In the `@theme inline { ... }` block shadcn generated, add:
```css
  --color-success: var(--success);
  --color-warning: var(--warning);
  --font-sans: var(--font-inter);
  --font-serif: var(--font-lora);
```
(If `@theme inline` already defines `--font-sans`/`--font-mono` from the Geist template, replace `--font-sans` and keep `--font-mono`.) Leave the `.dark` block untouched — the MVP ships the light theme only.

- [ ] **Step 5: Load Inter and Lora, set language and metadata**

Replace `frontend/src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "PeaceLaw",
  description: "Resolução online de disputas com análise preditiva e anonimização de dados.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${lora.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Add the shadcn Button** (from `frontend/`)

Run: `npx shadcn@latest add button --yes`
Expected: `src/components/ui/button.tsx` created; its `default` variant uses `bg-primary` (now Sapphire 700) and `secondary` uses `bg-secondary` (now Sage 600). Do not edit it.

- [ ] **Step 7: Verify**

Run: `npm test` (expect theme tests + smoke pass), `npm run build`, `npm run lint`.
Expected: all pass, no warnings.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/layout.tsx frontend/src/app/theme.test.ts frontend/src/components/ui/button.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): PeaceLaw design tokens, fonts and shadcn theme"
```

---

### Task 3: StatusBadge

**Files:**
- Create: `frontend/src/components/design-system/StatusBadge.tsx`
- Test: `frontend/src/components/design-system/StatusBadge.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2, `cn` from `@/lib/utils`.
- Produces: `StatusBadge({ status, tone?, size?, className? })`, types `BadgeStatus = "awaiting_judge" | "ready_for_agreement" | "anonymized"`, `BadgeTone = "subtle" | "solid"`. Renders `data-status` and `data-tone` attributes.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/design-system/StatusBadge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["awaiting_judge", "Aguardando Juiz"],
    ["ready_for_agreement", "Pronto para Acordo"],
    ["anonymized", "Anonimizado"],
  ] as const)("renders the %s label", (status, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge).toHaveAttribute("data-tone", "subtle");
  });

  it("hides the icon from assistive technology", () => {
    render(<StatusBadge status="anonymized" tone="solid" />);
    const svg = screen.getByText("Anonimizado").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the requested tone", () => {
    render(<StatusBadge status="ready_for_agreement" tone="solid" size="sm" />);
    expect(screen.getByText("Pronto para Acordo")).toHaveAttribute("data-tone", "solid");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/components/design-system/StatusBadge.test.tsx`
Expected: FAIL — cannot resolve `./StatusBadge`.

- [ ] **Step 3: Implement**

`frontend/src/components/design-system/StatusBadge.tsx`:
```tsx
import { Check, Clock, EyeOff, ShieldCheck, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type BadgeStatus = "awaiting_judge" | "ready_for_agreement" | "anonymized";
export type BadgeTone = "subtle" | "solid";

type BadgeSpec = {
  label: string;
  icon: LucideIcon;
  solidIcon?: LucideIcon;
  subtle: string;
  solid: string;
};

const BADGES: Record<BadgeStatus, BadgeSpec> = {
  awaiting_judge: {
    label: "Aguardando Juiz",
    icon: Clock,
    subtle: "border-warning-100 bg-warning-50 text-warning-700",
    solid: "border-warning-600 bg-warning-600 text-white",
  },
  ready_for_agreement: {
    label: "Pronto para Acordo",
    icon: Check,
    subtle: "border-sage-100 bg-sage-50 text-sage-800",
    solid: "border-sage-700 bg-sage-700 text-white shadow-[0_2px_8px_rgb(59_94_69/0.25)]",
  },
  anonymized: {
    label: "Anonimizado",
    icon: EyeOff,
    solidIcon: ShieldCheck,
    subtle: "border-primary-100 bg-primary-50 text-primary-800",
    solid: "border-primary-800 bg-primary-800 text-white",
  },
};

type StatusBadgeProps = {
  status: BadgeStatus;
  tone?: BadgeTone;
  size?: "sm" | "md";
  className?: string;
};

export function StatusBadge({ status, tone = "subtle", size = "md", className }: StatusBadgeProps) {
  const badge = BADGES[status];
  const Icon = tone === "solid" && badge.solidIcon ? badge.solidIcon : badge.icon;

  return (
    <span
      data-status={status}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
        badge[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {badge.label}
    </span>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm test`, `npm run lint`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/design-system/StatusBadge.tsx frontend/src/components/design-system/StatusBadge.test.tsx
git commit -m "feat(design-system): StatusBadge"
```

---

### Task 4: ProbabilityCard

**Files:**
- Create: `frontend/src/components/design-system/ProbabilityCard.tsx`
- Test: `frontend/src/components/design-system/ProbabilityCard.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2, `cn`.
- Produces: `ProbabilityCard({ score, caseLabel?, factors?, className? })`; `tierFor(score: number): Tier` (`"high"` ≥ 70, `"mid"` ≥ 40, else `"low"`); `clampScore(score: number): number` (rounds, clamps to 0–100, non-finite → 0); types `Tier`, `ProbabilityFactor = { direction: "up" | "down"; label: string }`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/design-system/ProbabilityCard.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProbabilityCard, clampScore, tierFor } from "./ProbabilityCard";

describe("tierFor", () => {
  it.each([
    [0, "low"],
    [39, "low"],
    [40, "mid"],
    [69, "mid"],
    [70, "high"],
    [100, "high"],
  ] as const)("score %d is %s", (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });
});

describe("clampScore", () => {
  it.each([
    [84.6, 85],
    [120, 100],
    [-5, 0],
    [Number.NaN, 0],
  ])("clamps %d to %d", (input, expected) => {
    expect(clampScore(input)).toBe(expected);
  });
});

describe("ProbabilityCard", () => {
  it("shows the score with an accessible description of the tier", () => {
    render(<ProbabilityCard score={85} />);
    expect(screen.getByRole("img", { name: "Score 85 por cento, probabilidade alta" })).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("Seu caso tem boas chances")).toBeInTheDocument();
  });

  it("uses the mid tier copy between 40 and 69", () => {
    render(<ProbabilityCard score={58} />);
    expect(screen.getByRole("img", { name: "Score 58 por cento, probabilidade média" })).toBeInTheDocument();
  });

  it("clamps out-of-range scores before rendering", () => {
    render(<ProbabilityCard score={140} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("lists the factors and the case label when provided", () => {
    render(
      <ProbabilityCard
        score={24}
        caseLabel="Caso nº 2026-0418 · Rescisão contratual"
        factors={[
          { direction: "up", label: "Contrato anexado" },
          { direction: "down", label: "Sem notificação formal" },
        ]}
      />,
    );
    expect(screen.getByText("Caso nº 2026-0418 · Rescisão contratual")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fatores considerados" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("omits the factors section when there are none", () => {
    render(<ProbabilityCard score={24} />);
    expect(screen.queryByRole("list", { name: "Fatores considerados" })).not.toBeInTheDocument();
  });

  it("always shows the non-binding disclaimer", () => {
    render(<ProbabilityCard score={70} />);
    expect(
      screen.getByText("Estimativa estatística baseada em decisões similares. Não constitui decisão judicial."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/components/design-system/ProbabilityCard.test.tsx`
Expected: FAIL — cannot resolve `./ProbabilityCard`.

- [ ] **Step 3: Implement**

`frontend/src/components/design-system/ProbabilityCard.tsx`:
```tsx
import { Info, Scale, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

export type Tier = "high" | "mid" | "low";
export type ProbabilityFactor = { direction: "up" | "down"; label: string };

type TierSpec = {
  label: string;
  headline: string;
  copy: string;
  chip: string;
  dot: string;
  text: string;
  stroke: string;
  bar: string;
};

const TIERS: Record<Tier, TierSpec> = {
  high: {
    label: "Alta",
    headline: "Seu caso tem boas chances",
    copy: "Casos com fatos e provas semelhantes tiveram decisão favorável na maioria das vezes. Um acordo agora tende a preservar valor e prazo.",
    chip: "border-sage-100 bg-sage-50 text-sage-800",
    dot: "bg-sage-600",
    text: "text-sage-800",
    stroke: "stroke-sage-600",
    bar: "bg-sage-600",
  },
  mid: {
    label: "Média",
    headline: "Seu caso tem chances moderadas",
    copy: "O resultado depende de pontos ainda em aberto. Reforçar a prova documental pode mudar a estimativa.",
    chip: "border-warning-100 bg-warning-50 text-warning-700",
    dot: "bg-warning-500",
    text: "text-warning-700",
    stroke: "stroke-warning-500",
    bar: "bg-warning-500",
  },
  low: {
    label: "Baixa",
    headline: "Seu caso tem chances reduzidas",
    copy: "Decisões em casos semelhantes foram majoritariamente desfavoráveis. A mediação costuma ser o caminho de menor risco.",
    chip: "border-danger-100 bg-danger-50 text-danger-700",
    dot: "bg-danger-500",
    text: "text-danger-700",
    stroke: "stroke-danger-500",
    bar: "bg-danger-500",
  },
};

const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function tierFor(score: number): Tier {
  return score >= 70 ? "high" : score >= 40 ? "mid" : "low";
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(100, Math.max(0, score)));
}

type ProbabilityCardProps = {
  score: number;
  caseLabel?: string;
  factors?: ProbabilityFactor[];
  className?: string;
};

export function ProbabilityCard({ score, caseLabel, factors = [], className }: ProbabilityCardProps) {
  const value = clampScore(score);
  const tier = TIERS[tierFor(value)];

  return (
    <section
      className={cn(
        "flex flex-col gap-[22px] rounded-xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-900/5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">
            <Scale aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[15px] font-semibold text-slate-900">Probabilidade de êxito</h3>
            {caseLabel && <span className="text-xs text-slate-500">{caseLabel}</span>}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-200",
            tier.chip,
          )}
        >
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", tier.dot)} />
          {tier.label}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div
          className="relative h-[132px] w-[132px] flex-none"
          role="img"
          aria-label={`Score ${value} por cento, probabilidade ${tier.label.toLowerCase()}`}
        >
          <svg width="132" height="132" className="-rotate-90" aria-hidden="true">
            <circle cx="66" cy="66" r={RADIUS} fill="none" strokeWidth="10" className="stroke-slate-100" />
            <circle
              cx="66"
              cy="66"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * value) / 100} 999`}
              className={cn("transition-all duration-300 ease-out", tier.stroke)}
            />
          </svg>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-[34px] leading-none font-semibold tracking-tight text-slate-900 tabular-nums">
              {value}%
            </span>
            <span className={cn("text-[11px] font-medium tracking-[.06em] uppercase", tier.text)}>{tier.label}</span>
          </div>
        </div>

        <div className="flex min-w-[200px] flex-1 flex-col gap-3.5">
          <p className="font-serif text-lg text-slate-900">{tier.headline}</p>
          <p className="text-sm leading-relaxed text-slate-700">{tier.copy}</p>
          <div className="flex flex-col gap-1.5" aria-hidden="true">
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all duration-300 ease-out", tier.bar)}
                style={{ width: `${value}%` }}
              />
              <span className="absolute inset-y-0 left-[40%] w-0.5 bg-white" />
              <span className="absolute inset-y-0 left-[70%] w-0.5 bg-white" />
            </div>
            <div className="grid grid-cols-[40fr_30fr_30fr] text-[11px] font-medium text-slate-500">
              <span>Baixa</span>
              <span>Média</span>
              <span>Alta</span>
            </div>
          </div>
        </div>
      </div>

      {factors.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-[18px]">
          <span id="probability-factors" className="text-xs font-medium text-slate-500">
            Fatores considerados
          </span>
          <ul aria-labelledby="probability-factors" className="flex flex-col gap-2.5">
            {factors.map((factor) => {
              const Icon = factor.direction === "up" ? TrendingUp : TrendingDown;
              return (
                <li key={factor.label} className="flex items-center gap-2.5 text-[13px] text-slate-700">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "h-[15px] w-[15px] flex-none",
                      factor.direction === "up" ? "text-sage-600" : "text-danger-600",
                    )}
                  />
                  {factor.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-normal text-slate-500">
        <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" />
        Estimativa estatística baseada em decisões similares. Não constitui decisão judicial.
      </p>
    </section>
  );
}
```

Note: the `id="probability-factors"` is static, so render at most one `ProbabilityCard` with factors per page; Task 6's showcase respects this.

- [ ] **Step 4: Verify**

Run: `npm test`, `npm run lint`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/design-system/ProbabilityCard.tsx frontend/src/components/design-system/ProbabilityCard.test.tsx
git commit -m "feat(design-system): ProbabilityCard"
```

---

### Task 5: UploadZone

**Files:**
- Create: `frontend/src/components/design-system/UploadZone.tsx`
- Test: `frontend/src/components/design-system/UploadZone.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2, `cn`.
- Produces: client component `UploadZone({ onFilesChange?, securityNote?, className? })` — `onFilesChange(validFiles: File[])` fires after every add/remove with the currently listed *valid* files; `validateFile(file: File): string | null`; `formatFileSize(bytes: number): string`; constants `MAX_FILE_BYTES = 25 * 1024 * 1024`, `DEFAULT_SECURITY_NOTE`.
- Truthful default note (exact): `"Envio por conexão criptografada. Dados pessoais são anonimizados antes de chegarem a juízes e advogados."`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/design-system/UploadZone.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SECURITY_NOTE, MAX_FILE_BYTES, UploadZone, formatFileSize, validateFile } from "./UploadZone";

function makeFile(name: string, type: string, size = 1024) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateFile", () => {
  it("accepts PDF, JPG and PNG", () => {
    expect(validateFile(makeFile("a.pdf", "application/pdf"))).toBeNull();
    expect(validateFile(makeFile("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateFile(makeFile("a.png", "image/png"))).toBeNull();
  });

  it("accepts a known extension when the browser reports no MIME type", () => {
    expect(validateFile(makeFile("contrato.PDF", ""))).toBeNull();
  });

  it("rejects other formats", () => {
    expect(validateFile(makeFile("virus.exe", "application/x-msdownload"))).toBe(
      "Formato não aceito. Envie PDF, JPG ou PNG.",
    );
  });

  it("rejects files above 25 MB", () => {
    expect(validateFile(makeFile("grande.pdf", "application/pdf", MAX_FILE_BYTES + 1))).toBe(
      "Arquivo acima de 25 MB.",
    );
  });
});

describe("formatFileSize", () => {
  it.each([
    [500, "1 KB"],
    [842_000, "822 KB"],
    [2_621_440, "2,5 MB"],
  ])("formats %d bytes as %s", (bytes, label) => {
    expect(formatFileSize(bytes)).toBe(label);
  });
});

describe("UploadZone", () => {
  it("shows the truthful security note by default", () => {
    render(<UploadZone />);
    expect(screen.getByText(DEFAULT_SECURITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/ponta a ponta/i)).not.toBeInTheDocument();
  });

  it("lists a valid file and reports it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const file = makeFile("contrato.pdf", "application/pdf");

    await user.upload(screen.getByLabelText("Selecionar arquivos"), file);

    expect(screen.getByText("contrato.pdf")).toBeInTheDocument();
    expect(screen.getByText("Pronto para envio")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([file]);
  });

  it("lists an invalid file with its error and does not report it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);

    await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("virus.exe", "application/x-msdownload"));

    expect(screen.getByText("Formato não aceito. Envie PDF, JPG ou PNG.")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
  });

  it("removes a file", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("contrato.pdf", "application/pdf"));

    await user.click(screen.getByRole("button", { name: "Remover contrato.pdf" }));

    expect(screen.queryByText("contrato.pdf")).not.toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
  });

  it("accepts dropped files", () => {
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const file = makeFile("prova.png", "image/png");

    fireEvent.drop(screen.getByTestId("upload-dropzone"), { dataTransfer: { files: [file] } });

    expect(screen.getByText("prova.png")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([file]);
  });

  it("renders a custom security note", () => {
    render(<UploadZone securityNote="Nota personalizada." />);
    expect(screen.getByText("Nota personalizada.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/components/design-system/UploadZone.test.tsx`
Expected: FAIL — cannot resolve `./UploadZone`.

- [ ] **Step 3: Implement**

`frontend/src/components/design-system/UploadZone.tsx`:
```tsx
"use client";

import { AlertTriangle, FileText, Lock, ShieldCheck, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_SECURITY_NOTE =
  "Envio por conexão criptografada. Dados pessoais são anonimizados antes de chegarem a juízes e advogados.";

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_EXTENSION = /\.(pdf|jpe?g|png)$/i;

export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSION.test(file.name)) {
    return "Formato não aceito. Envie PDF, JPG ou PNG.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Arquivo acima de 25 MB.";
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type UploadItem = { id: number; file: File; error: string | null };

type UploadZoneProps = {
  onFilesChange?: (files: File[]) => void;
  securityNote?: string;
  className?: string;
};

export function UploadZone({ onFilesChange, securityNote = DEFAULT_SECURITY_NOTE, className }: UploadZoneProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const nextId = useRef(1);

  const commit = (next: UploadItem[]) => {
    setItems(next);
    onFilesChange?.(next.filter((item) => !item.error).map((item) => item.file));
  };

  const addFiles = (list: FileList | File[] | null) => {
    const added = Array.from(list ?? []).map((file) => ({ id: nextId.current++, file, error: validateFile(file) }));
    if (added.length) commit([...added, ...items]);
  };

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
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
          "relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-9 text-center transition-colors duration-150",
          "focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-2",
          dragging
            ? "border-primary-500 bg-primary-50"
            : "border-slate-300 bg-slate-50 hover:border-primary-400 hover:bg-primary-50/60",
        )}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
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
          {dragging ? "Solte para enviar com segurança" : "Arraste PDFs ou provas para cá"}
        </span>
        <span className="text-sm text-slate-600">
          ou <span className="font-medium text-primary-600 underline underline-offset-[3px]">selecione do computador</span>
        </span>
        <span className="text-xs text-slate-500">PDF, JPG ou PNG · até 25 MB por arquivo</span>
      </label>

      <p className="flex items-start gap-2.5 rounded-lg bg-primary-50 px-3.5 py-3 text-[13px] leading-normal text-primary-800">
        <Lock aria-hidden="true" className="mt-px h-4 w-4 flex-none" />
        {securityNote}
      </p>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((item) => {
            const Icon = item.error ? AlertTriangle : FileText;
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-[10px] border border-slate-200 bg-white p-3">
                <span
                  className={cn(
                    "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
                    item.error ? "bg-danger-50 text-danger-600" : "bg-sage-50 text-sage-700",
                  )}
                >
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">{item.file.name}</span>
                    <span className="flex-none text-xs text-slate-500 tabular-nums">{formatFileSize(item.file.size)}</span>
                  </div>
                  <span className={cn("text-xs", item.error ? "text-danger-600" : "text-sage-700")}>
                    {item.error ?? "Pronto para envio"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Remover ${item.file.name}`}
                  onClick={() => commit(items.filter((other) => other.id !== item.id))}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none"
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
```

- [ ] **Step 4: Verify**

Run: `npm test`, `npm run lint`
Expected: all pass, no warnings (no `act(...)` warnings).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/design-system/UploadZone.tsx frontend/src/components/design-system/UploadZone.test.tsx
git commit -m "feat(design-system): UploadZone with validation and truthful security note"
```

---

### Task 6: `/design-system` showcase page and final verification

**Files:**
- Create: `frontend/src/components/design-system/index.ts`, `frontend/src/app/design-system/page.tsx`
- Test: `frontend/src/app/design-system/page.test.tsx`

**Interfaces:**
- Consumes: `StatusBadge`, `ProbabilityCard`, `UploadZone`, `Button` from `@/components/ui/button`.
- Produces: barrel `@/components/design-system` re-exporting all three components and their public helpers/types; route `/design-system`.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/design-system/page.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DesignSystemPage from "./page";

describe("/design-system", () => {
  it("renders every design-system component", () => {
    render(<DesignSystemPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Design System PeaceLaw" })).toBeInTheDocument();
    expect(screen.getByText("Aguardando Juiz")).toBeInTheDocument();
    expect(screen.getByText("Pronto para Acordo")).toBeInTheDocument();
    expect(screen.getAllByText("Anonimizado").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Score 85 por cento, probabilidade alta" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 58 por cento, probabilidade média" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 24 por cento, probabilidade baixa" })).toBeInTheDocument();
    expect(screen.getByLabelText("Selecionar arquivos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ação principal" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/app/design-system/page.test.tsx`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Implement the barrel**

`frontend/src/components/design-system/index.ts`:
```ts
export { ProbabilityCard, clampScore, tierFor, type ProbabilityFactor, type Tier } from "./ProbabilityCard";
export { StatusBadge, type BadgeStatus, type BadgeTone } from "./StatusBadge";
export { DEFAULT_SECURITY_NOTE, MAX_FILE_BYTES, UploadZone, formatFileSize, validateFile } from "./UploadZone";
```

- [ ] **Step 4: Implement the page**

`frontend/src/app/design-system/page.tsx`:
```tsx
import { ProbabilityCard, StatusBadge, UploadZone } from "@/components/design-system";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Design System · PeaceLaw" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[.08em] text-primary-500 uppercase">PeaceLaw</span>
        <h1 className="font-serif text-3xl text-slate-900">Design System PeaceLaw</h1>
        <p className="text-slate-600">Tokens Safira e Sálvia, tipografia Inter e Lora e os componentes base do MVP.</p>
      </header>

      <Section title="Botões">
        <div className="flex flex-wrap gap-3">
          <Button>Ação principal</Button>
          <Button variant="secondary">Confirmar acordo</Button>
          <Button variant="outline">Voltar</Button>
          <Button variant="destructive">Excluir</Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="awaiting_judge" />
          <StatusBadge status="ready_for_agreement" />
          <StatusBadge status="anonymized" />
          <StatusBadge status="anonymized" tone="solid" />
        </div>
      </Section>

      <Section title="Probabilidade de êxito">
        <ProbabilityCard
          score={85}
          caseLabel="Caso nº 2026-0418 · Rescisão contratual"
          factors={[
            { direction: "up", label: "Jurisprudência favorável em casos semelhantes" },
            { direction: "up", label: "Contrato e comprovantes de pagamento anexados" },
            { direction: "down", label: "Ausência de notificação formal por escrito" },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <ProbabilityCard score={58} />
          <ProbabilityCard score={24} />
        </div>
      </Section>

      <Section title="Upload seguro">
        <UploadZone />
      </Section>
    </main>
  );
}
```

- [ ] **Step 5: Final verification** (from `frontend/`)

Run, in order: `npm test`, `npm run lint`, `npm run build`.
Expected: all tests pass with no warnings; lint clean; build succeeds and lists the `/design-system` route.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/design-system/index.ts frontend/src/app/design-system
git commit -m "feat(frontend): design-system showcase page"
```

---

## STOP — Milestone 2 gate

Report `npm test` / `npm run lint` / `npm run build` output, the `/design-system` route, the truthful-microcopy decision, and ask for approval before planning Milestone 3.
