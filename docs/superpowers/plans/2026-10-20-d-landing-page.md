# D — Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder home page with a complete pt-BR landing page (value proposition, how it works, privacy promises, judge/lawyer sections, FAQ, footer) that keeps the role-based redirect for signed-in users.

**Architecture:** Server-rendered static sections as small components under `frontend/src/features/landing/`, composed by `app/page.tsx`. The existing client-side redirect logic moves into a small client component so the rest of the page stays static and fast. No new dependencies.

**Tech Stack:** Next.js (Cache Components), Tailwind v4 tokens, shadcn `Button`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-site-completion-design.md` (section D).

## Global Constraints
- Frontend from `frontend/`. Token classes only (no hex). pt-BR copy. No claims the product cannot back: do not say "launched", do not promise features marked planned (payments, AI matching, chamber homologation). The 180-day erasure, encryption at rest, anonymization before third parties, and score logic are real and may be stated.
- Never state legal guarantees. The page links to `/privacidade` (draft) and says the privacy notice is the reference.
- WCAG AA contrast, one `h1`, ordered headings, visible focus, keyboard-operable FAQ (native `<details>`).
- The existing `home.test.tsx` expectations (links to `/login` and `/register`, ADMIN redirect via `HOME_FOR_ROLE`) must keep passing or be updated deliberately in the same task.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Update `CONTINUE.md` at the end.

---

### Task 1: Landing sections and composition

**Files:**
- Create: `frontend/src/features/landing/Hero.tsx`, `HowItWorks.tsx`, `PrivacyPromises.tsx`, `ForProfessionals.tsx`, `Faq.tsx`, `Footer.tsx`, `RoleRedirect.tsx`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/features/landing/landing.test.tsx`; update `frontend/src/app/home.test.tsx`

**Interfaces:** `RoleRedirect` is a client component (`useSession`, `useRouter`, `HOME_FOR_ROLE`) that renders nothing and calls `router.replace(target)` when authenticated and `target !== "/"`; `app/page.tsx` renders `<RoleRedirect />` plus the sections.

- [ ] **Step 1: Failing tests** (`landing.test.tsx`, render `<HomePage />` inside `SessionProvider initialState={{status:"anonymous"}}` with `next/navigation` mocked as in other tests):

```tsx
it("has one h1 and the three-step explanation in order", () => {
  render(<HomePage />, { wrapper });
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  const steps = screen.getAllByRole("listitem", { name: /passo/i });
  expect(steps).toHaveLength(3);
});
it("links the calls to action", () => {
  render(<HomePage />, { wrapper });
  expect(screen.getAllByRole("link", { name: /criar conta/i })[0]).toHaveAttribute("href", "/register");
  expect(screen.getAllByRole("link", { name: /entrar/i })[0]).toHaveAttribute("href", "/login");
  expect(screen.getByRole("link", { name: /aviso de privacidade/i })).toHaveAttribute("href", "/privacidade");
});
it("states the privacy promises that the system really implements", () => {
  render(<HomePage />, { wrapper });
  for (const text of [/anonimiz/i, /criptograf/i, /180 dias/i]) expect(screen.getByText(text)).toBeInTheDocument();
});
it("does not promise features that do not exist", () => {
  const { container } = render(<HomePage />, { wrapper });
  expect(container.textContent).not.toMatch(/pagamento|homologa|inteligência artificial|IA /i);
});
it("redirects signed-in judges to their workspace", () => { /* authenticated JUDGE → router.replace("/judge") */ });
```

Write the last test fully (spy on the mocked `replace`). The FAQ test opens a `<details>` by clicking its `<summary>` and finds the answer.

- [ ] **Step 2: Implement sections.** Content (final copy, pt-BR):
  - `Hero`: `h1` "Resolva a disputa antes que ela vire processo"; lede "O PeaceLaw anonimiza o seu caso, mostra a chance de êxito segundo juízes avaliadores e conecta você a um advogado mediador."; buttons `Criar conta` (`/register`, default variant) and `Entrar` (`/login`, outline).
  - `HowItWorks` (`<ol>` of three `<li aria-label="Passo n">`): "Conte o seu caso" (três passos curtos, com consentimento e anexos), "Aprove a versão anonimizada" (nomes, CPF, telefones, endereços e valores são removidos antes de qualquer pessoa ler), "Veja a chance e feche acordo" (juízes avaliam provas e jurisprudência; um advogado mediador conduz o acordo).
  - `PrivacyPromises` (three items): "Anonimização antes de terceiros", "Relato original criptografado e só seu", "Apagado a pedido ou após 180 dias". Link `Aviso de privacidade` → `/privacidade`.
  - `ForProfessionals`: card "Sou juiz avaliador" ("Avalie casos anonimizados e contribua para a chance de êxito."), card "Sou advogado mediador" ("Escolha casos avaliados e conduza o acordo."), both with `Entrar` → `/login`; note "Contas de juiz e advogado são criadas pela equipe PeaceLaw." (true: public sign-up is CLIENT-only).
  - `Faq` (4 `<details>`): "O PeaceLaw substitui um advogado?" → "Não. Ele estima a chance de êxito e ajuda a negociar; um advogado mediador conduz o acordo."; "Quem vê o meu relato?" → "Só você. Juízes e advogados recebem apenas o texto anonimizado que você aprovou."; "A chance de êxito é uma garantia?" → "Não. É uma estimativa baseada nas notas dos juízes avaliadores e não garante o resultado."; "Posso apagar meus dados?" → "Sim. Você pode apagar o relato original a qualquer momento e ele também é apagado após 180 dias do encerramento."
  - `Footer`: "PeaceLaw · versão de demonstração (MVP)", link `Aviso de privacidade`.
  Use `font-serif` headings as in the existing pages, `max-w-5xl px-4` containers, `bg-white border-slate-200` cards like current `cardClass`.
- [ ] **Step 3:** `app/page.tsx` becomes a server component (remove `"use client"`) composing the sections plus `<RoleRedirect />`; for ADMIN the redirect target is `/admin` (set by plan C) or `/admin/pitch` if C is not merged; the "Abrindo a área administrativa…" status is shown by `RoleRedirect` only while `role === "ADMIN"`.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `BACKEND_URL=http://127.0.0.1:8000 npm run build` green. Verify the build output marks `/` as static/prerendered.
- [ ] **Step 5: Commit** `feat(landing): complete pt-BR landing page`.

### Task 2: Deploy and visual check

- [ ] `vercel deploy --prod --scope <seu-time-vercel>`; with the protection bypass open the production URL in agent-browser at 1280 px and 400 px, screenshot both themes' light mode, confirm no horizontal scroll, no console/CSP errors, tab order reaches every link and the FAQ.
- [ ] Update `CONTINUE.md`; commit and push.

## Self-review
- Spec D coverage: value proposition, how it works, privacy promises, judge/lawyer sections, FAQ, footer with `/privacidade`, redirect kept (T1), production check (T2).
