import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import { SessionProvider } from "@/lib/session";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => replace.mockReset());

function anonymous({ children }: { children: ReactNode }) {
  return <SessionProvider initialState={{ status: "anonymous" }}>{children}</SessionProvider>;
}

describe("landing page", () => {
  it("has one h1 and the three-step explanation in order", () => {
    render(<HomePage />, { wrapper: anonymous });
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Resolva a disputa antes que ela vire processo");
    const steps = screen.getAllByRole("listitem", { name: /passo/i });
    expect(steps.map((s) => s.getAttribute("aria-label"))).toEqual(["Passo 1", "Passo 2", "Passo 3"]);
    expect(within(steps[0]).getByRole("heading", { name: "Conte o seu caso" })).toBeInTheDocument();
    expect(within(steps[1]).getByRole("heading", { name: "Aprove a versão anonimizada" })).toBeInTheDocument();
    expect(within(steps[2]).getByRole("heading", { name: "Veja a chance e feche acordo" })).toBeInTheDocument();
  });

  it("never skips a heading level", () => {
    render(<HomePage />, { wrapper: anonymous });
    const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
  });

  it("links the calls to action", () => {
    render(<HomePage />, { wrapper: anonymous });
    expect(screen.getAllByRole("link", { name: /criar conta/i })[0]).toHaveAttribute("href", "/register");
    expect(screen.getAllByRole("link", { name: /entrar/i })[0]).toHaveAttribute("href", "/login");
    const privacy = screen.getAllByRole("link", { name: "Política de privacidade" });
    expect(privacy.length).toBeGreaterThanOrEqual(2);
    privacy.forEach((l) => expect(l).toHaveAttribute("href", "/privacidade"));
  });

  it("states the privacy promises that the system really implements", () => {
    render(<HomePage />, { wrapper: anonymous });
    for (const text of [/anonimiz/i, /criptograf/i, /180 dias/i]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("heading", { name: "Anonimização antes de terceiros" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Relato original criptografado e só seu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Apagado a pedido ou após 180 dias" })).toBeInTheDocument();
  });

  it("does not promise features that do not exist", () => {
    const { container } = render(<HomePage />, { wrapper: anonymous });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/pagamento/i);
    expect(text).not.toMatch(/homologa/i);
    expect(text).not.toMatch(/intelig[êe]ncia artificial/i);
    expect(text).not.toMatch(/lan[çc]ado/i);
    expect(text).not.toMatch(/\bIA\b/);
    expect(text).toMatch(/versão de demonstração \(MVP\)/);
  });

  it("keeps the role entry points and the sign-up restriction", () => {
    render(<HomePage />, { wrapper: anonymous });
    for (const name of ["Sou cliente", "Sou juiz avaliador", "Sou advogado mediador"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("Contas de juiz e advogado são criadas pela plataforma; apenas clientes podem se cadastrar."),
    ).toBeInTheDocument();
  });

  it("answers the FAQ inside native details", async () => {
    render(<HomePage />, { wrapper: anonymous });
    const summary = screen.getByText("Quem vê o meu relato?");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    expect(
      within(details).getByText("Só você. Juízes e advogados recebem apenas o texto anonimizado que você aprovou."),
    ).toBeVisible();
    expect(document.querySelectorAll("details")).toHaveLength(4);
  });

  it("redirects signed-in judges to their workspace", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "2", email: "j@b.com", role: "JUDGE" } }}>
        <HomePage />
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/judge"));
  });

  it("redirects signed-in clients to their area", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "4", email: "c@b.com", role: "CLIENT" } }}>
        <HomePage />
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/client"));
  });

  it("shows a status while an admin is sent to the admin area", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "3", email: "a@b.com", role: "ADMIN" } }}>
        <HomePage />
      </SessionProvider>,
    );
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveTextContent("Abrindo a área administrativa…");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });

  it("does not redirect anonymous visitors", () => {
    render(<HomePage />, { wrapper: anonymous });
    expect(replace).not.toHaveBeenCalled();
  });
});
