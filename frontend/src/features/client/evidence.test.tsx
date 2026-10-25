import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setUnauthorizedHandler, type CaseCreated, type CaseForJudge, type CaseForLawyer, type Evidence } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { CaseDetail } from "./CaseDetail";
import { ClientWorkspace } from "./ClientWorkspace";
import { EvidenceList } from "./EvidenceList";
import { JudgeWorkspace } from "../judge/JudgeWorkspace";
import { LawyerBoard } from "../lawyer/LawyerBoard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const RAW = "O responsável, Carlos Menezes, abandonou a obra. Meu CPF é 123.456.789-00.";
const created: CaseCreated = {
  id: "c1",
  title: "Obra abandonada por [NOME]",
  status: "AWAITING_APPROVAL",
  ai_probability_score: null,
  created_at: "2026-10-14T12:00:00Z",
  raw_text: RAW,
  anonymized_text: "O responsável, [NOME], abandonou a obra.",
  redactions: [],
  consent_at: "2026-10-14T12:00:00Z",
  consent_version: "2026-10-15",
  raw_text_erased_at: null,
  evidence_count: 0,
  area: "OUTROS",
};

const ev = (id: string, filename: string, size_bytes: number): Evidence => ({
  id,
  filename,
  content_type: "application/pdf",
  size_bytes,
  created_at: "2026-10-14T12:00:00Z",
});

function makeFile(name: string, type = "application/pdf") {
  return new File(["x"], name, { type });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "consent").mockRejectedValue(new ApiError(0, "offline"));
});

describe("api.uploadEvidence", () => {
  it("posts the raw file with the octet-stream type and the encoded filename header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(ev("e1", "ação.pdf", 1)), { status: 201 }));
    const file = makeFile("ação final.pdf");

    const result = await api.uploadEvidence("c 1", file);

    expect(result.id).toBe("e1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cases/c%201/evidence");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(headers.get("X-Filename")).toBe(encodeURIComponent("ação final.pdf"));
    expect(String(url)).not.toContain("final");
  });

  it("notifies the session when the upload gets 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Não autenticado." }), { status: 401 }),
    );
    await api.uploadEvidence("c1", makeFile("a.pdf")).catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });

  it("surfaces the pt-BR detail from an error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Arquivo acima de 2,5 MB." }), { status: 413 }),
    );
    await expect(api.uploadEvidence("c1", makeFile("a.pdf"))).rejects.toMatchObject({
      status: 413,
      message: "Arquivo acima de 2,5 MB.",
    });
  });
});

describe("EvidenceList", () => {
  it("lists names, sizes and download links, and removes a row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "contrato.pdf", 2_621_440), ev("e2", "foto.png", 842_000)]);
    const del = vi.spyOn(api, "deleteEvidence").mockResolvedValue(undefined);
    render(<EvidenceList caseId="c1" editable />);

    expect(await screen.findByText("contrato.pdf")).toBeInTheDocument();
    expect(screen.getByText("2,5 MB")).toBeInTheDocument();
    expect(screen.getByText("822 KB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /contrato\.pdf/ })).toHaveAttribute("href", api.evidenceDownloadUrl("c1", "e1"));

    await user.click(screen.getByRole("button", { name: "Remover contrato.pdf" }));
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar remoção" }));

    expect(del).toHaveBeenCalledWith("c1", "e1");
    await waitFor(() => expect(screen.queryByText("contrato.pdf")).not.toBeInTheDocument());
    expect(screen.getByText("foto.png")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Anexo removido.");
    expect(screen.getByRole("heading", { name: "Anexos" })).toHaveFocus();
  });

  it("cancels the confirmation without calling the API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "contrato.pdf", 10)]);
    const del = vi.spyOn(api, "deleteEvidence").mockResolvedValue(undefined);
    render(<EvidenceList caseId="c1" editable />);
    await user.click(await screen.findByRole("button", { name: "Remover contrato.pdf" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remover contrato.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar remoção" })).not.toBeInTheDocument();
  });

  it("keeps the row and shows the error when removal fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "contrato.pdf", 10)]);
    vi.spyOn(api, "deleteEvidence").mockRejectedValue(new ApiError(409, "Este caso não aceita mais anexos."));
    render(<EvidenceList caseId="c1" editable />);
    await user.click(await screen.findByRole("button", { name: "Remover contrato.pdf" }));
    await user.click(screen.getByRole("button", { name: "Confirmar remoção" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este caso não aceita mais anexos.");
    expect(screen.getByText("contrato.pdf")).toBeInTheDocument();
  });

  it("hides the remove button when not editable", async () => {
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "contrato.pdf", 10)]);
    render(<EvidenceList caseId="c1" editable={false} />);
    await screen.findByText("contrato.pdf");
    expect(screen.queryByRole("button", { name: /Remover/ })).not.toBeInTheDocument();
  });
});

describe("CaseDetail evidence section", () => {
  it("renders the evidence list for the owner", async () => {
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "contrato.pdf", 10)]);
    render(<CaseDetail id="c1" onBack={() => {}} />);
    expect(await screen.findByText("contrato.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover contrato.pdf" })).toBeInTheDocument();
  });

  it("hides the section when the original was erased and nothing is attached", async () => {
    vi.spyOn(api, "getCase").mockResolvedValue({ ...created, raw_text_erased_at: "2026-10-15T12:00:00Z" });
    const list = vi.spyOn(api, "listEvidence").mockResolvedValue([]);
    render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByRole("heading", { name: created.title });
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByText("Anexos")).not.toBeInTheDocument();
  });
});

describe("CaseDetail add evidence", () => {
  const picker = () => screen.getByLabelText("Selecionar arquivos");

  it("uploads a file, refreshes the list and shows per-file errors in an alert", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    const list = vi.spyOn(api, "listEvidence").mockResolvedValueOnce([]).mockResolvedValue([ev("e1", "a.pdf", 1)]);
    const upload = vi.spyOn(api, "uploadEvidence").mockImplementation(async (_id, file) => {
      if (file.name === "x.pdf") throw new ApiError(413, "Arquivo acima de 2,5 MB.");
      return ev("e1", file.name, 1);
    });
    render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByText("Nenhum anexo.");

    await user.upload(picker(), [makeFile("a.pdf"), makeFile("x.pdf")]);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "a.pdf" }));
    expect(await screen.findByRole("link", { name: /a\.pdf/ })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Não foi possível enviar x\.pdf: Arquivo acima de 2,5 MB\./)).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((el) => /enviar x\.pdf/.test(el.textContent ?? ""))).toBe(true);
  });

  it("hides the control at 5 files, when locked and when the original was erased", async () => {
    const five = [1, 2, 3, 4, 5].map((n) => ev(`e${n}`, `f${n}.pdf`, 1));
    vi.spyOn(api, "listEvidence").mockResolvedValue(five);
    const getCase = vi.spyOn(api, "getCase").mockResolvedValue(created);
    const { unmount } = render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByText("f5.pdf");
    expect(screen.queryByLabelText("Selecionar arquivos")).not.toBeInTheDocument();
    unmount();

    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "a.pdf", 1)]);
    getCase.mockResolvedValue({ ...created, status: "IN_MEDIATION" });
    const second = render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByText("a.pdf");
    expect(screen.queryByLabelText("Selecionar arquivos")).not.toBeInTheDocument();
    second.unmount();

    getCase.mockResolvedValue({ ...created, raw_text_erased_at: "2026-10-15T12:00:00Z" });
    render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByText("a.pdf");
    expect(screen.queryByLabelText("Selecionar arquivos")).not.toBeInTheDocument();
  });

  it("shows the control while the case is still editable", async () => {
    vi.spyOn(api, "getCase").mockResolvedValue(created);
    vi.spyOn(api, "listEvidence").mockResolvedValue([ev("e1", "a.pdf", 1)]);
    render(<CaseDetail id="c1" onBack={() => {}} />);
    await screen.findByText("a.pdf");
    expect(picker()).toBeInTheDocument();
  });
});

describe("wizard evidence upload", () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, files: File[]) {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "u1", email: "c@b.com", role: "CLIENT" } }}>
        <ClientWorkspace />
      </SessionProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Novo caso" }));
    await user.type(screen.getByLabelText("Título do caso"), "Obra abandonada");
    await user.click(screen.getByLabelText("Relato"));
    await user.paste(RAW);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.upload(screen.getByLabelText("Selecionar arquivos"), files);
    await user.click(screen.getByRole("checkbox", { name: /Autorizo o tratamento/ }));
    await user.click(screen.getByRole("button", { name: "Enviar para anonimização" }));
  }

  beforeEach(() => {
    vi.spyOn(api, "myCases").mockResolvedValue([]);
  });

  it("uploads each file after the case is created and reports failures without blocking", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    const upload = vi
      .spyOn(api, "uploadEvidence")
      .mockImplementation(async (_id, file) => {
        if (file.name === "x.pdf") throw new ApiError(413, "Arquivo acima de 2,5 MB.");
        return ev("e", file.name, 1);
      });

    await fillAndSubmit(user, [makeFile("a.pdf"), makeFile("x.pdf")]);

    expect(await screen.findByRole("heading", { name: "Confira o que juízes e advogados vão ver" })).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "a.pdf" }));
    expect(screen.getByText(/Não foi possível enviar x\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível enviar a\.pdf/)).not.toBeInTheDocument();
  });

  it("does not upload when no file was selected", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.spyOn(api, "createCase").mockResolvedValue(created);
    const upload = vi.spyOn(api, "uploadEvidence");
    await fillAndSubmit(user, []);
    expect(await screen.findByRole("heading", { name: "Confira o que juízes e advogados vão ver" })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("third-party attachment counts", () => {
  const judgeQueue: CaseForJudge[] = [
    { id: "a", title: "Obra", anonymized_text: "t", created_at: "2026-10-14T12:00:00Z", evidence_count: 2, area: "CIVIL" },
    { id: "b", title: "Cobrança", anonymized_text: "t", created_at: "2026-10-14T13:00:00Z", evidence_count: 0, area: "CIVIL" },
  ];

  it("shows the count on judge queue items, nothing for zero", async () => {
    vi.spyOn(api, "judgeQueue").mockResolvedValue(judgeQueue);
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "j", email: "j@b.com", role: "JUDGE" } }}>
        <JudgeWorkspace />
      </SessionProvider>,
    );
    expect(await screen.findByText("2 anexos")).toBeInTheDocument();
    expect(screen.queryByText(/0 anexos/)).not.toBeInTheDocument();
  });

  it("shows singular and plural on lawyer cards, nothing for zero", async () => {
    const base = { anonymized_text: "t", created_at: "2026-10-14T12:00:00Z", area: "CIVIL" as const, suggested: false };
    const board: CaseForLawyer[] = [
      { ...base, id: "o1", title: "Um", status: "EVALUATED", ai_probability_score: 85, evidence_count: 1 },
      { ...base, id: "o2", title: "Dois", status: "EVALUATED", ai_probability_score: 85, evidence_count: 2, area: "CIVIL" },
      { ...base, id: "o3", title: "Zero", status: "EVALUATED", ai_probability_score: 85, evidence_count: 0, area: "CIVIL" },
    ];
    vi.spyOn(api, "lawyerBoard").mockResolvedValue(board);
    vi.spyOn(api, "lawyerAreas").mockResolvedValue({ areas: [] });
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "l", email: "l@b.com", role: "LAWYER" } }}>
        <LawyerBoard />
      </SessionProvider>,
    );
    expect(await screen.findByText("1 anexo")).toBeInTheDocument();
    expect(screen.getByText("2 anexos")).toBeInTheDocument();
    expect(screen.queryByText(/0 anexo/)).not.toBeInTheDocument();
  });
});
