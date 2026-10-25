import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type CaseCreated, type CaseForJudge, type CaseForLawyer } from "@/lib/api";
import type { CaseArea } from "@/lib/case-area";
import { SessionProvider } from "@/lib/session";

import { JudgeWorkspace } from "../judge/JudgeWorkspace";
import { CaseDetail } from "../client/CaseDetail";
import { NewCaseWizard } from "../client/NewCaseWizard";
import { AreasPicker } from "./AreasPicker";
import { CaseCard } from "./CaseCard";
import { LawyerBoard } from "./LawyerBoard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const item: CaseForLawyer = {
  id: "o1",
  title: "Obra abandonada",
  status: "EVALUATED",
  ai_probability_score: 85,
  created_at: "2026-10-14T12:00:00Z",
  anonymized_text: "Texto.",
  evidence_count: 0,
  area: "ALUGUEL",
  suggested: false,
};

beforeEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const owned: CaseCreated = {
  id: "c1",
  title: "Obra abandonada",
  status: "AWAITING_APPROVAL",
  ai_probability_score: null,
  created_at: "2026-10-14T12:00:00Z",
  raw_text: "Relato bruto.",
  anonymized_text: "Relato anonimizado.",
  redactions: [],
  consent_at: "2026-10-14T12:00:00Z",
  consent_version: "2026-10-15",
  raw_text_erased_at: null,
  evidence_count: 0,
  area: "TRABALHISTA",
};

function lawyerBoard() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "l", email: "l@b.com", role: "LAWYER" } }}>
      <LawyerBoard />
    </SessionProvider>,
  );
}

function card(props: Partial<CaseForLawyer>) {
  render(
    <ul>
      <CaseCard item={{ ...item, ...props }} busy={false} onAssume={vi.fn()} onResolve={vi.fn()} onView={vi.fn()} />
    </ul>,
  );
}

describe("CaseCard area and suggestion", () => {
  it("always shows the area label and the badge only when suggested", () => {
    card({ suggested: false });
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.queryByText("Indicado para você")).not.toBeInTheDocument();
  });

  it("shows the badge when suggested", () => {
    card({ suggested: true });
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.getByText("Indicado para você")).toBeInTheDocument();
  });
});

describe("JudgeWorkspace area", () => {
  it("shows the area label of the queue item", async () => {
    const queue: CaseForJudge[] = [
      { id: "a", title: "Obra", anonymized_text: "x", created_at: "2026-10-14T12:00:00Z", evidence_count: 0, area: "FAMILIA" },
    ];
    vi.spyOn(api, "judgeQueue").mockResolvedValue(queue);
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "j", email: "j@b.com", role: "JUDGE" } }}>
        <JudgeWorkspace />
      </SessionProvider>,
    );
    const nav = await screen.findByRole("navigation", { name: "Fila de casos" });
    expect(within(nav).getByText("Família")).toBeInTheDocument();
  });
});

describe("NewCaseWizard area", () => {
  it("offers the seven areas defaulting to Outros and passes the chosen one", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "consent").mockResolvedValue({ version: "v1", text: "Autorizo o tratamento." });
    const createCase = vi.spyOn(api, "createCase").mockRejectedValue(new ApiError(422, "x"));
    render(<NewCaseWizard onExit={vi.fn()} />);
    const select = screen.getByLabelText("Área do caso") as HTMLSelectElement;
    expect(select).toHaveValue("OUTROS");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Consumidor", "Civil", "Trabalhista", "Família", "Aluguel", "Empresarial", "Outros",
    ]);
    await user.selectOptions(select, "TRABALHISTA");
    await user.type(screen.getByLabelText("Título do caso"), "Demissão");
    await user.click(screen.getByLabelText("Relato"));
    await user.paste("O responsável abandonou a obra e não devolveu o dinheiro pago.");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("checkbox", { name: /Autorizo/ }));
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(createCase.mock.calls[0][4]).toBe("TRABALHISTA");
  });
});

describe("AreasPicker", () => {
  it("reflects the loaded areas and saves on change", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: ["CIVIL"] });
    const save = vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["CIVIL", "FAMILIA"] });
    const onSaved = vi.fn();
    render(<AreasPicker onSaved={onSaved} />);
    const group = await screen.findByRole("group", { name: "Áreas em que atuo" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(7);
    await waitFor(() => expect(within(group).getByRole("checkbox", { name: "Civil" })).toBeChecked());
    expect(within(group).getByRole("checkbox", { name: "Família" })).not.toBeChecked();
    await user.click(within(group).getByRole("checkbox", { name: "Família" }));
    expect(save).toHaveBeenCalledWith(["CIVIL", "FAMILIA"]);
    expect(await screen.findByText("Áreas salvas.")).toBeInTheDocument();
    expect(screen.getByText("Áreas salvas.").closest("[role=status]")).not.toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("rolls back and alerts on error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockRejectedValue(new ApiError(409, "Atualização simultânea. Tente novamente."));
    const onSaved = vi.fn();
    render(<AreasPicker onSaved={onSaved} />);
    const box = await screen.findByRole("checkbox", { name: "Civil" });
    await user.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Atualização simultânea. Tente novamente.");
    expect(screen.getByRole("checkbox", { name: "Civil" })).not.toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("LawyerBoard areas", () => {
  it("refetches the board after saving areas", async () => {
    const user = userEvent.setup();
    const board = vi.spyOn(api, "lawyerBoard").mockResolvedValue([item]);
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "l", email: "l@b.com", role: "LAWYER" } }}>
        <LawyerBoard />
      </SessionProvider>,
    );
    await screen.findByText("Obra abandonada");
    expect(board).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole("checkbox", { name: "Aluguel" }));
    await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
  });
});

describe("AreasPicker queued saves", () => {
  it("keeps two quick clicks: second PUT carries both and the UI ends on its response", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    const first = deferred<{ areas: CaseArea[] }>();
    const second = deferred<{ areas: CaseArea[] }>();
    const save = vi
      .spyOn(api, "setLawyerAreas")
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<AreasPicker onSaved={vi.fn()} />);
    const civil = await screen.findByRole("checkbox", { name: "Civil" });
    await waitFor(() => expect(civil).toBeEnabled());
    await user.click(civil);
    await user.click(screen.getByRole("checkbox", { name: "Família" }));
    expect(screen.getByRole("checkbox", { name: "Civil" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Família" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Salvando…");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, ["CIVIL"]);
    first.resolve({ areas: ["CIVIL"] });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(2, ["CIVIL", "FAMILIA"]);
    // The stale first response must not overwrite the newer selection.
    expect(screen.getByRole("checkbox", { name: "Família" })).toBeChecked();
    second.resolve({ areas: ["CIVIL", "FAMILIA"] });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Áreas salvas."));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("checkbox", { name: "Civil" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Família" })).toBeChecked();
  });

  it("rolls back to the last confirmed set when the follow-up save fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    const first = deferred<{ areas: CaseArea[] }>();
    const save = vi
      .spyOn(api, "setLawyerAreas")
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(new ApiError(500, "Falhou."));
    render(<AreasPicker onSaved={vi.fn()} />);
    const civil = await screen.findByRole("checkbox", { name: "Civil" });
    await waitFor(() => expect(civil).toBeEnabled());
    await user.click(civil);
    await user.click(screen.getByRole("checkbox", { name: "Família" }));
    first.resolve({ areas: ["CIVIL"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou.");
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("checkbox", { name: "Civil" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Família" })).not.toBeChecked();
  });

  it("says the board could not refresh when the reload fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["CIVIL"] });
    render(<AreasPicker onSaved={() => Promise.resolve(false)} />);
    const civil = await screen.findByRole("checkbox", { name: "Civil" });
    await waitFor(() => expect(civil).toBeEnabled());
    await user.click(civil);
    expect(await screen.findByRole("alert")).toHaveTextContent("Áreas salvas, mas não foi possível atualizar o quadro.");
    expect(screen.getByRole("status")).not.toHaveTextContent("Áreas salvas.");
  });

  it("announces saved only after the reload resolves", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["CIVIL"] });
    const reload = deferred<boolean>();
    render(<AreasPicker onSaved={() => reload.promise} />);
    const civil = await screen.findByRole("checkbox", { name: "Civil" });
    await waitFor(() => expect(civil).toBeEnabled());
    await user.click(civil);
    expect(screen.getByRole("status")).toHaveTextContent("Salvando…");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("status")).not.toHaveTextContent("Áreas salvas.");
    reload.resolve(true);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Áreas salvas."));
  });
});

describe("AreasPicker initial load", () => {
  it("keeps checkboxes disabled until the areas load", async () => {
    const pending = deferred<{ areas: CaseArea[] }>();
    vi.spyOn(api, "lawyerAreas").mockImplementation(() => pending.promise);
    render(<AreasPicker onSaved={vi.fn()} />);
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    pending.resolve({ areas: ["CIVIL"] });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Civil" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "Civil" })).toBeChecked();
  });

  it("alerts on failure and retries the load", async () => {
    const user = userEvent.setup();
    const load = vi
      .spyOn(api, "lawyerAreas")
      .mockRejectedValueOnce(new ApiError(500, "Erro ao carregar."))
      .mockResolvedValueOnce({ areas: ["FAMILIA"] });
    render(<AreasPicker onSaved={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro ao carregar.");
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Família" })).toBeChecked());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("checkbox", { name: "Família" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
  });
});

describe("LawyerBoard request ordering", () => {
  it("ignores a slow stale board response that arrives after a newer reload", async () => {
    const user = userEvent.setup();
    const stale = deferred<CaseForLawyer[]>();
    const fresh: CaseForLawyer = { ...item, id: "o2", title: "Caso novo" };
    const board = vi
      .spyOn(api, "lawyerBoard")
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([fresh]);
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    lawyerBoard();
    const box = await screen.findByRole("checkbox", { name: "Aluguel" });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await screen.findByText("Caso novo");
    expect(board).toHaveBeenCalledTimes(2);
    stale.resolve([item]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Caso novo")).toBeInTheDocument();
    expect(screen.queryByText("Obra abandonada")).not.toBeInTheDocument();
  });

  it("shows the existing board and an alert when the reload after saving fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "lawyerBoard").mockResolvedValueOnce([item]).mockRejectedValueOnce(new ApiError(500, "x"));
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    vi.spyOn(api, "setLawyerAreas").mockResolvedValue({ areas: ["ALUGUEL"] });
    lawyerBoard();
    await screen.findByText("Obra abandonada");
    const box = await screen.findByRole("checkbox", { name: "Aluguel" });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(
        "Áreas salvas, mas não foi possível atualizar o quadro.",
      ),
    );
    expect(screen.getByText("Obra abandonada")).toBeInTheDocument();
    expect(screen.queryByText("Áreas salvas.")).not.toBeInTheDocument();
  });
});

describe("area transparency for the owner", () => {
  it("shows the chosen area on the review step", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "consent").mockResolvedValue({ version: "v1", text: "Autorizo o tratamento." });
    vi.spyOn(api, "listEvidence").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockResolvedValue(owned);
    render(<NewCaseWizard onExit={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Área do caso"), "TRABALHISTA");
    await user.type(screen.getByLabelText("Título do caso"), "Demissão");
    await user.click(screen.getByLabelText("Relato"));
    await user.paste("O responsável abandonou a obra e não devolveu o dinheiro pago.");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("checkbox", { name: /Autorizo/ }));
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
    expect(await screen.findByRole("heading", { name: "Confira o que juízes e advogados vão ver" })).toBeInTheDocument();
    expect(screen.getByText("Área: Trabalhista")).toBeInTheDocument();
  });

  it("shows the chosen area on the case detail", async () => {
    vi.spyOn(api, "getCase").mockResolvedValue({ ...owned, area: "FAMILIA" });
    vi.spyOn(api, "listEvidence").mockResolvedValue([]);
    render(<CaseDetail id="c1" onBack={vi.fn()} />);
    expect(await screen.findByText("Área: Família")).toBeInTheDocument();
  });
});
