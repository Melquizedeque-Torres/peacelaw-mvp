import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type AdminUser } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { AdminDashboard } from "./AdminDashboard";
import { UsersAdmin } from "./UsersAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

beforeEach(() => vi.restoreAllMocks());

const STATS = {
  cases_by_status: { DRAFT: 1, AWAITING_APPROVAL: 2, READY_FOR_JUDGE: 3, EVALUATED: 4, IN_MEDIATION: 5, RESOLVED: 6 },
  users_by_role: { CLIENT: 10, JUDGE: 7, LAWYER: 8, ADMIN: 9 },
  last_24h: { audit_events: 5, stepup_failures: 2, rate_limit_hits: 11 },
};

describe("AdminDashboard", () => {
  it("shows the six status counts and the role counts", async () => {
    vi.spyOn(api, "adminStats").mockResolvedValue(STATS);
    render(<AdminDashboard />);
    const cases = await screen.findByRole("region", { name: "Casos por status" });
    for (const [label, n] of [
      ["Rascunho", "1"],
      ["Aguardando aprovação do cliente", "2"],
      ["Aguardando Juiz", "3"],
      ["Pronto para Acordo", "4"],
      ["Em mediação", "5"],
      ["Acordo fechado", "6"],
    ]) {
      const item = within(cases).getByText(label).closest("li") as HTMLElement;
      expect(item).toHaveTextContent(n);
    }
    const roles = screen.getByRole("region", { name: "Usuários por perfil" });
    for (const [label, n] of [
      ["Clientes", "10"],
      ["Juízes", "7"],
      ["Advogados", "8"],
      ["Administradores", "9"],
    ]) {
      expect(within(roles).getByText(label).closest("li")).toHaveTextContent(n);
    }
    const activity = screen.getByRole("region", { name: "Atividade nas últimas 24 horas" });
    for (const [label, n] of [
      ["Ações administrativas", "5"],
      ["Senhas de admin erradas", "2"],
      ["Tentativas contadas pelo limite", "11"],
    ]) {
      expect(within(activity).getByText(label).closest("li")).toHaveTextContent(n);
    }
  });

  it("links to users and pitch", async () => {
    vi.spyOn(api, "adminStats").mockResolvedValue(STATS);
    render(<AdminDashboard />);
    expect(await screen.findByRole("link", { name: "Gerenciar usuários" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: "Kit de pitch" })).toHaveAttribute("href", "/admin/pitch");
  });

  it("shows the server error", async () => {
    vi.spyOn(api, "adminStats").mockRejectedValue(new ApiError(403, "Acesso negado."));
    render(<AdminDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Acesso negado.");
  });
});

const USERS: AdminUser[] = [
  { id: "u1", email: "juiz@b.com", role: "JUDGE", created_at: "2026-10-01T12:00:00Z", is_active: true },
  { id: "u2", email: "adv@b.com", role: "LAWYER", created_at: "2026-10-02T12:00:00Z", is_active: true },
];

function renderUsers() {
  return render(
    <SessionProvider
      initialState={{ status: "authenticated", user: { id: "admin-self", email: "adm@b.com", role: "ADMIN" } }}
    >
      <UsersAdmin />
    </SessionProvider>,
  );
}

describe("UsersAdmin", () => {
  it("lists users with their role", async () => {
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    expect(await screen.findByText("juiz@b.com")).toBeInTheDocument();
    expect(screen.getByText("adv@b.com")).toBeInTheDocument();
    const row = screen.getByText("adv@b.com").closest("li") as HTMLElement;
    expect(within(row).getByText("Advogado")).toBeInTheDocument();
  });

  it("creates an account, clears the password, announces and refetches", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const create = vi
      .spyOn(api, "adminCreateUser")
      .mockResolvedValue({ id: "u3", email: "novo@b.com", role: "ADMIN" });
    renderUsers();
    await screen.findByText("juiz@b.com");
    const password = screen.getByLabelText("Senha inicial");
    expect(password).toHaveAttribute("minlength", "12");
    expect(password).toHaveAttribute("autocomplete", "off");
    const role = screen.getByLabelText("Perfil");
    expect(within(role).getAllByRole("option").map((o) => o.textContent)).toEqual(["Juiz", "Advogado", "Administrador"]);
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.selectOptions(role, "ADMIN");
    await user.type(password, "senha-forte-123");
    await user.type(screen.getByLabelText("Sua senha"), "minha-senha");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(create).toHaveBeenCalledWith("novo@b.com", "ADMIN", "senha-forte-123", "minha-senha");
    expect(await screen.findByText("Conta criada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha inicial")).toHaveValue("");
    expect(screen.getByLabelText("E-mail")).toHaveValue("");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("shows the server error in an alert and clears the password", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminCreateUser").mockRejectedValue(new ApiError(409, "E-mail já cadastrado."));
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.type(screen.getByLabelText("E-mail"), "juiz@b.com");
    await user.type(screen.getByLabelText("Senha inicial"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail já cadastrado.");
    expect(screen.getByLabelText("Senha inicial")).toHaveValue("");
  });

  it("asks a second click before revoking sessions", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const revoke = vi.spyOn(api, "adminRevokeSessions").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    const row = screen.getByText("juiz@b.com").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Encerrar sessões/ }));
    expect(revoke).not.toHaveBeenCalled();
    await user.click(within(row).getByRole("button", { name: /Confirmar/ }));
    expect(revoke).toHaveBeenCalledWith("u1");
    expect(await screen.findByText("Sessões de juiz@b.com encerradas.")).toBeInTheDocument();
  });

  it("can cancel the confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const revoke = vi.spyOn(api, "adminRevokeSessions").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    const row = screen.getByText("juiz@b.com").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Encerrar sessões/ }));
    await user.click(within(row).getByRole("button", { name: "Cancelar" }));
    expect(within(row).getByRole("button", { name: /Encerrar sessões/ })).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("shows revoke errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminRevokeSessions").mockRejectedValue(new ApiError(404, "Usuário não encontrado."));
    renderUsers();
    await screen.findByText("juiz@b.com");
    const row = screen.getByText("juiz@b.com").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Encerrar sessões/ }));
    await user.click(within(row).getByRole("button", { name: /Confirmar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Usuário não encontrado.");
  });
});
