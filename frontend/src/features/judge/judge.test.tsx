import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseForJudge } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { JudgeWorkspace } from "./JudgeWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const queue: CaseForJudge[] = [
  { id: "a", title: "Obra abandonada", anonymized_text: "O responsável, [NOME], abandonou a obra.", created_at: "2026-10-14T12:00:00Z", evidence_count: 0, area: "CIVIL" },
  { id: "b", title: "Cobrança indevida", anonymized_text: "A empresa [EMPRESA] cobrou [VALOR].", created_at: "2026-10-14T13:00:00Z", evidence_count: 0, area: "CIVIL" },
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
  it("has a page-level h1", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    expect(await screen.findByRole("heading", { level: 1, name: "Avaliação de casos" })).toBeInTheDocument();
  });

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

  it("moves focus to the next case heading after submit", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    vi.spyOn(api, "submitReview").mockResolvedValue({
      id: "r", case_id: "a", score_evidence: 5, score_jurisprudence: 5, notes: null, created_at: "",
    });
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Enviar avaliação" }));
    const heading = await screen.findByRole("heading", { name: "Cobrança indevida" });
    expect(document.activeElement).toBe(heading);
  });

  it("focuses the empty message when the queue empties", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue([queue[0]]);
    vi.spyOn(api, "submitReview").mockResolvedValue({
      id: "r", case_id: "a", score_evidence: 5, score_jurisprudence: 5, notes: null, created_at: "",
    });
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Enviar avaliação" }));
    const empty = await screen.findByText("Nenhum caso aguardando avaliação.");
    expect(document.activeElement).toBe(empty);
  });

  it("keeps the draft when the selected case is clicked again", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    fireEvent.change(await screen.findByLabelText("Provas"), { target: { value: "9" } });
    await user.click(screen.getByRole("button", { name: /Obra abandonada/ }));
    expect(screen.getByLabelText("Provas")).toHaveValue("9");
  });

  it("locks the rail while a submit is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    vi.spyOn(api, "submitReview").mockReturnValue(new Promise(() => {}));
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Enviar avaliação" }));
    expect(screen.getByRole("button", { name: /Cobrança indevida/ })).toBeDisabled();
  });

  it("keeps focus on the size button at the limit and announces sizes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    const bigger = await screen.findByRole("button", { name: "Aumentar texto" });
    for (let i = 0; i < 6; i++) await user.click(bigger);
    expect(bigger).toHaveAttribute("aria-disabled", "true");
    expect(bigger).not.toBeDisabled();
    expect(bigger).toHaveFocus();
    expect(screen.getByText("Tamanho do texto: 32 px")).toBeInTheDocument();
  });

  it("drops a deleted case on 404 and names it in the alert", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    vi.spyOn(api, "submitReview").mockRejectedValue(new ApiError(404, "Caso não encontrado."));
    renderJudge();
    await user.click(await screen.findByRole("button", { name: "Enviar avaliação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("«Obra abandonada» foi removido da fila: Caso não encontrado.");
    expect(screen.queryByRole("button", { name: /Obra abandonada/ })).not.toBeInTheDocument();
  });

  it("previews only the judge's own draft score in the probability card", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    expect(await screen.findByRole("img", { name: /^Score 50 por cento/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Provas"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Jurisprudência"), { target: { value: "8" } });
    expect(screen.getByRole("img", { name: "Score 85 por cento, probabilidade alta" })).toBeInTheDocument();
    expect(screen.getByText("Prévia da sua avaliação — não inclui notas de outros avaliadores.")).toBeInTheDocument();
    expect(screen.getByText("Prévia calculada a partir das suas notas.")).toBeInTheDocument();
    expect(screen.queryByText(/Estimativa estatística/)).not.toBeInTheDocument();
  });

  it("keeps the sticky panel scrollable on short viewports and wraps the queue", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    renderJudge();
    const panel = (await screen.findByRole("button", { name: "Enviar avaliação" })).closest("form")?.parentElement;
    expect(panel).toHaveClass("lg:sticky", "lg:max-h-[calc(100vh-3rem)]", "lg:overflow-y-auto");
    expect(screen.getByRole("navigation", { name: "Fila de casos" }).querySelector("ul")).toHaveClass("flex-wrap");
  });
});
