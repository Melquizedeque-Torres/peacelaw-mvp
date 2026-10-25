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
  consent_at: "2026-10-14T12:00:00Z",
  consent_version: "2026-10-15",
  raw_text_erased_at: null,
  evidence_count: 0,
  area: "OUTROS",
};

async function pasteRaw(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Relato"));
  await user.paste(RAW);
}

const CONSENT = /Autorizo o tratamento/;

async function submitFromFacts(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(screen.getByRole("checkbox", { name: CONSENT }));
  await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
}

function renderClient() {
  return render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "u1", email: "c@b.com", role: "CLIENT" } }}>
      <ClientWorkspace />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "consent").mockRejectedValue(new ApiError(0, "offline"));
  vi.spyOn(api, "listEvidence").mockResolvedValue([]);
});

describe("AnonymizedText", () => {
  it("marks redaction tokens", () => {
    render(<AnonymizedText text="Falei com [NOME], CPF [CPF]." />);
    expect(screen.getByText("[NOME]")).toHaveAttribute("data-token", "NOME");
    expect(screen.getByText("[CPF]").tagName).toBe("MARK");
  });

  it("marks labels with hyphens", () => {
    render(<AnonymizedText text="Contato [E-MAIL]." />);
    expect(screen.getByText("[E-MAIL]")).toHaveAttribute("data-token", "E-MAIL");
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

    const next = screen.getByRole("button", { name: "Continuar" });
    await user.type(screen.getByLabelText("Título do caso"), "  Obra abandonada por Carlos Menezes ");
    await user.type(screen.getByLabelText("Relato"), "curto");
    expect(next).toBeDisabled();
    await user.clear(screen.getByLabelText("Relato"));
    await pasteRaw(user);
    expect(createCase).not.toHaveBeenCalled();
    await user.click(next);
    expect(await screen.findByRole("heading", { name: "Anexe suas provas" })).toHaveFocus();

    const submit = screen.getByRole("button", { name: "Enviar para anonimização" });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: CONSENT }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(createCase).toHaveBeenCalledWith("Obra abandonada por Carlos Menezes", RAW, true, "2026-10-20", "OUTROS");
    expect(await screen.findByRole("heading", { name: "Confira o que juízes e advogados vão ver" })).toHaveFocus();
    expect(screen.getByText("NOME: 2")).toBeInTheDocument();
    expect(screen.getByText(RAW)).toBeInTheDocument(); // inside the owner-only <details>

    await user.click(screen.getByRole("button", { name: "Aprovar e enviar aos juízes" }));
    expect(approve).toHaveBeenCalledWith("c1");
    const sentHeading = await screen.findByRole("heading", { name: "Caso enviado para avaliação." });
    expect(sentHeading).toHaveFocus();
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    const remove = vi.spyOn(api, "deleteCase").mockResolvedValue(undefined);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await submitFromFacts(user);

    await user.click(await screen.findByRole("button", { name: "Excluir caso" }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(remove).toHaveBeenCalledWith("c1");
  });

  it("disarms the delete confirmation when another action runs", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([created]);
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    vi.spyOn(api, "approveCase").mockResolvedValue({ ...created, status: "READY_FOR_JUDGE" });
    const remove = vi.spyOn(api, "deleteCase").mockResolvedValue(undefined);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    await user.click(await screen.findByRole("button", { name: "Excluir caso" }));
    await user.click(screen.getByRole("button", { name: "Aprovar e enviar aos juízes" }));
    expect(await screen.findByText("Aguardando avaliação dos juízes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir caso" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirmar exclusão" })).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it("lets the client cancel a pending delete confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([created]);
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    await user.click(await screen.findByRole("button", { name: "Excluir caso" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Excluir caso" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar exclusão" })).not.toBeInTheDocument();
  });

  it("disarms the confirmation after a failed delete", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    vi.spyOn(api, "deleteCase").mockRejectedValue(new ApiError(500, "Falha ao excluir."));
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await submitFromFacts(user);
    await user.click(await screen.findByRole("button", { name: "Excluir caso" }));
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao excluir.");
    expect(screen.getByRole("button", { name: "Excluir caso" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirmar exclusão" })).not.toBeInTheDocument();
  });

  it("lets the client leave the privacy step and decide later", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await user.type(screen.getByLabelText("Relato"), "curto");
    expect(screen.getByLabelText("Relato")).toHaveAccessibleDescription("5/40 caracteres mínimos");
    await user.clear(screen.getByLabelText("Relato"));
    await pasteRaw(user);
    await submitFromFacts(user);
    await user.click(await screen.findByRole("button", { name: "Decidir depois" }));
    expect(await screen.findByRole("button", { name: "Novo caso" })).toBeInTheDocument();
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
    await pasteRaw(user);
    await submitFromFacts(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Dados inválidos.");
  });

  it("keeps typed values when going back from the evidence step", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("heading", { name: "Conte o que aconteceu" })).toHaveFocus();
    expect(screen.getByLabelText("Título do caso")).toHaveValue("Obra abandonada");
    expect(screen.getByLabelText("Relato")).toHaveValue(RAW);
  });

  it("re-asks LGPD consent after the facts change", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("checkbox", { name: CONSENT }));
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    await user.type(screen.getByLabelText("Relato"), " Acréscimo.");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("checkbox", { name: CONSENT })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Enviar para anonimização" })).toBeDisabled();
  });

  it("labels the stepper Fatos, Provas and Revisão", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    const steps = within(screen.getByRole("list", { name: "Etapas" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent?.replace(/[\d·]/g, "").trim())).toEqual(["Fatos", "Provas", "Revisão"]);
  });

  it("shows the recorded LGPD consent date on the owner detail", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([created]);
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    expect(await screen.findByText("Consentimento LGPD (versão 2026-10-15) registrado em 14/10/2026")).toBeInTheDocument();
  });

  it("omits the consent line when no consent is recorded", async () => {
    const user = userEvent.setup();
    const legacy: CaseOwnerView = { ...created, consent_at: null };
    vi.spyOn(api, "myCases").mockResolvedValue([legacy]);
    vi.spyOn(api, "getCase").mockResolvedValue(legacy);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    await screen.findByRole("heading", { name: created.title });
    expect(screen.queryByText(/Consentimento LGPD/)).not.toBeInTheDocument();
  });

  it("limits the story length", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    expect(screen.getByLabelText("Relato")).toHaveAttribute("maxlength", "20000");
  });

  it("lists 422 field errors under the alert", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "createCase").mockRejectedValue(
      new ApiError(422, "Dados inválidos.", [{ field: "title", message: "Título longo demais após a anonimização." }]),
    );
    renderClient();
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await submitFromFacts(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Dados inválidos.");
    expect(screen.getByText("Título longo demais após a anonimização.").tagName).toBe("LI");
  });

  it("returns focus to the list heading when leaving a case", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "myCases").mockResolvedValue([created]);
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    expect(await screen.findByRole("heading", { name: created.title })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("heading", { name: "Meus casos" })).toHaveFocus();
  });

  it("shows one decimal and keeps the tier consistent with the raw score", async () => {
    const user = userEvent.setup();
    const evaluated: CaseOwnerView = { ...created, status: "EVALUATED", ai_probability_score: 79.6 };
    vi.spyOn(api, "myCases").mockResolvedValue([evaluated]);
    vi.spyOn(api, "getCase").mockResolvedValue(evaluated);
    renderClient();
    const item = await screen.findByRole("button", { name: /Obra abandonada/ });
    expect(within(item).getByText("Chance de êxito: 79,6%")).toBeInTheDocument();
    await user.click(item);
    expect(await screen.findByRole("img", { name: "Score 79,6 por cento, probabilidade média" })).toBeInTheDocument();
    expect(screen.queryByText("Um acordo agora tende a ser a via mais rápida para receber.")).not.toBeInTheDocument();
  });

  it.each([
    ["EVALUATED", true],
    ["IN_MEDIATION", false],
    ["RESOLVED", false],
  ] as const)("mediator availability copy for %s is %s", async (status, shown) => {
    const user = userEvent.setup();
    const item: CaseOwnerView = { ...created, status, ai_probability_score: 40 };
    vi.spyOn(api, "myCases").mockResolvedValue([item]);
    vi.spyOn(api, "getCase").mockResolvedValue(item);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Seu caso está disponível para advogados mediadores.") !== null).toBe(shown);
  });
});

describe("LGPD erasure of the original report", () => {
  async function openCase(user: ReturnType<typeof userEvent.setup>, item: CaseOwnerView) {
    vi.spyOn(api, "myCases").mockResolvedValue([item]);
    vi.spyOn(api, "getCase").mockResolvedValue(item);
    renderClient();
    await user.click(await screen.findByRole("button", { name: /Obra abandonada/ }));
    await screen.findByRole("heading", { name: created.title });
  }

  it("needs a second click before erasing, and Cancelar backs out", async () => {
    const user = userEvent.setup();
    const erase = vi.spyOn(api, "eraseOriginal");
    await openCase(user, created);
    await user.click(screen.getByRole("button", { name: "Apagar meu relato original" }));
    expect(screen.getByText(/Seus anexos também serão apagados\./)).toBeInTheDocument();
    expect(erase).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Apagar meu relato original" })).toBeInTheDocument();
    expect(erase).not.toHaveBeenCalled();
  });

  it("erases after confirmation and replaces the text with the erasure date", async () => {
    const user = userEvent.setup();
    const erased: CaseOwnerView = { ...created, raw_text: "", raw_text_erased_at: "2026-10-15T15:00:00Z" };
    const erase = vi.spyOn(api, "eraseOriginal").mockResolvedValue(erased);
    await openCase(user, created);
    await user.click(screen.getByRole("button", { name: "Apagar meu relato original" }));
    await user.click(screen.getByRole("button", { name: "Confirmar apagamento" }));
    expect(erase).toHaveBeenCalledWith("c1");
    expect(await screen.findByText("Relato original apagado em 15/10/2026.")).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apagar meu relato original" })).not.toBeInTheDocument();
  });

  it("shows the erasure date and no button for an already erased case", async () => {
    const user = userEvent.setup();
    await openCase(user, { ...created, raw_text: "", raw_text_erased_at: "2026-10-15T15:00:00Z" });
    expect(screen.getByText("Relato original apagado em 15/10/2026.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apagar meu relato original" })).not.toBeInTheDocument();
  });

  it("offers erasure in any status", async () => {
    const user = userEvent.setup();
    await openCase(user, { ...created, status: "IN_MEDIATION" });
    expect(screen.getByRole("button", { name: "Apagar meu relato original" })).toBeInTheDocument();
  });

  it("surfaces an API failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "eraseOriginal").mockRejectedValue(new ApiError(404, "Caso não encontrado."));
    await openCase(user, created);
    await user.click(screen.getByRole("button", { name: "Apagar meu relato original" }));
    await user.click(screen.getByRole("button", { name: "Confirmar apagamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Caso não encontrado.");
  });

  it("disables case actions while the erasure is in flight", async () => {
    const user = userEvent.setup();
    let release!: (v: CaseOwnerView) => void;
    vi.spyOn(api, "eraseOriginal").mockReturnValue(new Promise((r) => (release = r)));
    await openCase(user, created);
    await user.click(screen.getByRole("button", { name: "Apagar meu relato original" }));
    await user.click(screen.getByRole("button", { name: "Confirmar apagamento" }));
    expect(screen.getByRole("button", { name: "Excluir caso" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aprovar e enviar aos juízes" })).toBeDisabled();
    release({ ...created, raw_text: "", raw_text_erased_at: "2026-10-15T15:00:00Z" });
    expect(await screen.findByRole("button", { name: "Excluir caso" })).toBeEnabled();
  });

  it("disables erasure while a case action is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "approveCase").mockReturnValue(new Promise(() => {}));
    await openCase(user, created);
    await user.click(screen.getByRole("button", { name: "Aprovar e enviar aos juízes" }));
    expect(screen.getByRole("button", { name: "Apagar meu relato original" })).toBeDisabled();
  });
});

describe("consent text", () => {
  async function toProofs() {
    const user = userEvent.setup();
    renderClient();
    await user.click(await screen.findByRole("button", { name: /novo caso|nova disputa|enviar/i }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await pasteRaw(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
  }

  it("renders the text served by the API", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "consent").mockResolvedValue({ version: "v9", text: "Autorizo o tratamento conforme o servidor." });
    await toProofs();
    expect(await screen.findByLabelText("Autorizo o tratamento conforme o servidor.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Política de privacidade" })).toHaveAttribute("href", "/privacidade");
  });

  it("falls back to the bundled text when the fetch fails", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    await toProofs();
    expect(screen.getByRole("checkbox", { name: /nos termos dos arts\. 7º, I, e 11, I, da LGPD/ })).toBeInTheDocument();
  });

  it("sends the version served by the API", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    vi.spyOn(api, "consent").mockResolvedValue({ version: "v9", text: "Autorizo o tratamento conforme o servidor." });
    const createCase = vi.spyOn(api, "createCase").mockResolvedValue(created);
    const user = userEvent.setup();
    await toProofs();
    await user.click(await screen.findByRole("checkbox", { name: "Autorizo o tratamento conforme o servidor." }));
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
    expect(createCase).toHaveBeenCalledWith("Obra abandonada", RAW, true, "v9", "OUTROS");
  });

  it("on 409 refetches the consent, unchecks and shows the message", async () => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
    const message = "O termo de consentimento foi atualizado. Revise e aceite novamente.";
    const createCase = vi.spyOn(api, "createCase").mockRejectedValueOnce(new ApiError(409, message));
    const user = userEvent.setup();
    await toProofs(); // consent fetch fails: bundled text and version
    await user.click(screen.getByRole("checkbox", { name: CONSENT }));
    vi.spyOn(api, "consent").mockResolvedValue({ version: "v10", text: "Autorizo o tratamento na versão nova." });
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const box = await screen.findByRole("checkbox", { name: "Autorizo o tratamento na versão nova." });
    expect(box).not.toBeChecked();
    expect(createCase).toHaveBeenCalledWith("Obra abandonada", RAW, true, "2026-10-20", "OUTROS");

    createCase.mockResolvedValue(created);
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
    expect(createCase).toHaveBeenLastCalledWith("Obra abandonada", RAW, true, "v10", "OUTROS");
  });
});
