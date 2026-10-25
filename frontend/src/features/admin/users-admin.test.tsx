import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type AdminUser } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { UsersAdmin } from "./UsersAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

beforeEach(() => vi.restoreAllMocks());

function renderUsers() {
  return render(
    <SessionProvider
      initialState={{ status: "authenticated", user: { id: "admin-self", email: "adm@b.com", role: "ADMIN" } }}
    >
      <UsersAdmin />
    </SessionProvider>,
  );
}

const USERS: AdminUser[] = [
  { id: "u1", email: "juiz@b.com", role: "JUDGE", created_at: "2026-10-01T12:00:00Z", is_active: true },
  { id: "u2", email: "adv@b.com", role: "LAWYER", created_at: "2026-10-02T12:00:00Z", is_active: true },
];

const many = (n: number, start = 0): AdminUser[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${start + i}`,
    email: `user${start + i}@b.com`,
    role: "CLIENT" as const,
    created_at: "2026-10-01T12:00:00Z",
    is_active: true,
  }));

describe("UsersAdmin list controls", () => {
  it("shows the count hint and marks the signed-in admin", async () => {
    vi.spyOn(api, "adminUsers").mockResolvedValue([
      ...USERS,
      { id: "admin-self", email: "adm@b.com", role: "ADMIN", created_at: "2026-10-03T12:00:00Z", is_active: true },
    ]);
    renderUsers();
    expect(await screen.findByText("Mostrando 3 usuários.")).toBeInTheDocument();
    expect(screen.getByText("adm@b.com").closest("li")).toHaveTextContent("(você)");
    expect(screen.getByText("juiz@b.com").closest("li")).not.toHaveTextContent("(você)");
  });

  it("filters by role through the API", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(list).toHaveBeenLastCalledWith({ limit: 50, offset: 0 }, undefined);
    const select = screen.getByLabelText("Filtrar por perfil");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos os perfis",
      "Juízes",
      "Advogados",
      "Administradores",
      "Clientes",
    ]);
    list.mockResolvedValue([USERS[0]]);
    await user.selectOptions(select, "JUDGE");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ limit: 50, offset: 0 }, "JUDGE"));
    await waitFor(() => expect(screen.queryByText("adv@b.com")).not.toBeInTheDocument());
    expect(screen.getByText("Mostrando 1 usuários.")).toBeInTheDocument();
  });

  it("loads more pages with offset until a short page", async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(api, "adminUsers")
      .mockResolvedValueOnce(many(50))
      .mockResolvedValueOnce(many(3, 50));
    renderUsers();
    expect(await screen.findByText("Mostrando 50 usuários.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(list).toHaveBeenLastCalledWith({ limit: 50, offset: 50 }, undefined);
    expect(await screen.findByText("Mostrando 53 usuários.")).toBeInTheDocument();
    expect(screen.getByText("user52@b.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("hides load more when the first page is short", async () => {
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });
});

describe("UsersAdmin create and revoke", () => {
  it("shows field errors from a 422 on create", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminCreateUser").mockRejectedValue(
      new ApiError(422, "Dados inválidos.", [{ field: "email", message: "E-mail inválido." }]),
    );
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.type(screen.getByLabelText("E-mail"), "ruim@b.com");
    await user.type(screen.getByLabelText("Senha inicial"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByText(/E-mail inválido\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Senha inicial")).toHaveValue("");
  });

  it("ignores a second submit while creating and caps the password length", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    let finish!: (u: { id: string; email: string; role: "ADMIN" }) => void;
    const create = vi.spyOn(api, "adminCreateUser").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(screen.getByLabelText("Senha inicial")).toHaveAttribute("maxlength", "128");
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.type(screen.getByLabelText("Senha inicial"), "senha-forte-123");
    const form = screen.getByRole("button", { name: "Criar conta" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    finish({ id: "u9", email: "novo@b.com", role: "ADMIN" });
    expect(await screen.findByText("Conta criada.")).toBeInTheDocument();
  });

  it("moves focus to the confirm button, and back to the trigger on cancel", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    const row = screen.getByText("juiz@b.com").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Encerrar sessões/ }));
    expect(within(row).getByRole("button", { name: /Confirmar/ })).toHaveFocus();
    await user.click(within(row).getByRole("button", { name: "Cancelar" }));
    expect(within(row).getByRole("button", { name: /Encerrar sessões/ })).toHaveFocus();
  });

  it("refetches the list after a 404 on revoke", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminRevokeSessions").mockRejectedValue(new ApiError(404, "Usuário não encontrado."));
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue([USERS[1]]);
    const row = screen.getByText("juiz@b.com").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Encerrar sessões/ }));
    await user.click(within(row).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(screen.queryByText("juiz@b.com")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Usuário não encontrado.");
  });
});
