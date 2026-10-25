import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseForLawyer } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LawyerBoard } from "./LawyerBoard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const base = { anonymized_text: "O responsável, [NOME], abandonou a obra.", created_at: "2026-10-14T12:00:00Z", area: "CIVIL" as const, suggested: false };
const board: CaseForLawyer[] = [
  { ...base, id: "o1", title: "Obra abandonada", status: "EVALUATED", ai_probability_score: 85, evidence_count: 0 },
  { ...base, id: "m1", title: "Cobrança indevida", status: "IN_MEDIATION", ai_probability_score: 55, evidence_count: 0 },
  { ...base, id: "r1", title: "Aluguel atrasado", status: "RESOLVED", ai_probability_score: 70, evidence_count: 0 },
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
});

describe("LawyerBoard", () => {
  it("groups cases by stage", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    await screen.findByText("Obra abandonada");
    expect(within(column("Oportunidades")).getByText("Obra abandonada")).toBeInTheDocument();
    expect(within(column("Em contato")).getByText("Cobrança indevida")).toBeInTheDocument();
    expect(within(column("Acordos fechados")).getByText("Aluguel atrasado")).toBeInTheDocument();
    expect(within(column("Oportunidades")).getByText("Chance de êxito: 85%")).toBeInTheDocument();
  });

  it("shows an empty message in empty columns", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValue([board[0]]);
    renderLawyer();
    await screen.findByText("Obra abandonada");
    expect(within(column("Em contato")).getByText("Nenhum caso aqui.")).toBeInTheDocument();
  });

  it("takes an opportunity into mediation and focuses the moved card", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    const match = vi.spyOn(api, "matchCase").mockResolvedValue({ ...board[0], status: "IN_MEDIATION" });
    renderLawyer();
    await user.click(await screen.findByRole("button", { name: "Assumir mediação" }));
    expect(match).toHaveBeenCalledWith("o1");
    const moved = within(column("Em contato")).getByText("Obra abandonada");
    expect(moved).toBeInTheDocument();
    expect(screen.getByText("«Obra abandonada» movido para Em contato.")).toBeInTheDocument();
    await waitFor(() => expect(moved).toHaveFocus());
  });

  it("ignores a second click while a request is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    let finish: (c: CaseForLawyer) => void = () => {};
    const match = vi.spyOn(api, "matchCase").mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderLawyer();
    const button = await screen.findByRole("button", { name: "Assumir mediação" });
    await user.click(button);
    await user.click(button);
    expect(match).toHaveBeenCalledTimes(1);
    finish({ ...board[0], status: "IN_MEDIATION" });
    await waitFor(() => expect(within(column("Em contato")).getByText("Obra abandonada")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });

  it("opens the case drawer with the anonymized text and professional score", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    await user.click((await screen.findAllByRole("button", { name: "Ver caso" }))[0]);
    const dialog = screen.getByRole("dialog", { name: "Obra abandonada" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("[NOME]")).toBeInTheDocument();
    expect(within(dialog).getByText("Alta probabilidade de êxito no Judiciário")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the drawer, traps Tab and returns focus to the opener", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    const opener = (await screen.findAllByRole("button", { name: "Ver caso" }))[0];
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Fechar" });
    expect(close).toHaveFocus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("shows the status badge on each card", async () => {
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    renderLawyer();
    await screen.findByText("Obra abandonada");
    expect(within(column("Oportunidades")).getByText("Pronto para Acordo")).toBeInTheDocument();
    expect(within(column("Em contato")).getByText("Em mediação")).toBeInTheDocument();
    expect(within(column("Acordos fechados")).getByText("Acordo fechado")).toBeInTheDocument();
  });
});
