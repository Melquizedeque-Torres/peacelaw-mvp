import { render, screen, waitFor, within } from "@testing-library/react";
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

const T = "2026-10-01T12:00:00Z";
const USERS: AdminUser[] = [
  { id: "u1", email: "juiz@b.com", role: "JUDGE", created_at: T, is_active: true },
  { id: "u2", email: "adv@b.com", role: "LAWYER", created_at: T, is_active: false },
  { id: "admin-self", email: "adm@b.com", role: "ADMIN", created_at: T, is_active: true },
  { id: "u4", email: "outro@b.com", role: "ADMIN", created_at: T, is_active: true },
  { id: "u5", email: "velho@b.com", role: "ADMIN", created_at: T, is_active: false },
];

const row = (email: string) => screen.getByText(email).closest("li") as HTMLElement;

describe("UsersAdmin ADMIN target step-up", () => {
  it("collects the acting admin's password inside the deactivate confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const deactivate = vi.spyOn(api, "adminDeactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("outro@b.com")).getByRole("button", { name: /Desativar/ }));
    const mine = within(row("outro@b.com")).getByLabelText("Sua senha");
    expect(mine).toHaveAttribute("type", "password");
    expect(mine).toHaveAttribute("autocomplete", "current-password");
    expect(mine).toHaveAttribute("maxlength", "128");
    expect(mine).toHaveFocus();
    const confirm = within(row("outro@b.com")).getByRole("button", { name: /Confirmar desativação/ });
    expect(confirm).toBeDisabled();
    await user.type(mine, "minha-senha");
    await user.click(confirm);
    expect(deactivate).toHaveBeenCalledWith("u4", "minha-senha");
    expect(await screen.findByText("Conta desativada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sua senha")).not.toBeInTheDocument();
  });

  it("reactivating an ADMIN needs the two-step confirmation with the password", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const reactivate = vi.spyOn(api, "adminReactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("velho@b.com")).getByRole("button", { name: /Reativar/ }));
    expect(reactivate).not.toHaveBeenCalled();
    await user.type(within(row("velho@b.com")).getByLabelText("Sua senha"), "minha-senha");
    await user.click(within(row("velho@b.com")).getByRole("button", { name: /Confirmar reativação/ }));
    expect(reactivate).toHaveBeenCalledWith("u5", "minha-senha");
    expect(await screen.findByText("Conta reativada.")).toBeInTheDocument();
  });

  it("non-ADMIN rows keep the bodyless flow with no password field", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const deactivate = vi.spyOn(api, "adminDeactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    expect(within(row("juiz@b.com")).queryByLabelText("Sua senha")).not.toBeInTheDocument();
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ }));
    expect(deactivate).toHaveBeenCalledWith("u1");
  });

  it.each([
    [400, "Senha atual incorreta."],
    [429, "Muitas tentativas. Tente novamente mais tarde."],
  ])("shows a %s in the alert and drops the typed password", async (status, message) => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminDeactivate").mockRejectedValue(new ApiError(status, message));
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("outro@b.com")).getByRole("button", { name: /Desativar/ }));
    await user.type(within(row("outro@b.com")).getByLabelText("Sua senha"), "errada");
    await user.click(within(row("outro@b.com")).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(screen.queryByLabelText("Sua senha")).not.toBeInTheDocument();
    await user.click(within(row("outro@b.com")).getByRole("button", { name: /Desativar/ }));
    expect(within(row("outro@b.com")).getByLabelText("Sua senha")).toHaveValue("");
  });

  it("maps a 422 to field errors on the row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminReactivate").mockRejectedValue(
      new ApiError(422, "Dados inválidos.", [
        { field: "admin_password", message: "Informe sua senha para alterar um administrador." },
      ]),
    );
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("velho@b.com")).getByRole("button", { name: /Reativar/ }));
    await user.type(within(row("velho@b.com")).getByLabelText("Sua senha"), "x");
    await user.click(within(row("velho@b.com")).getByRole("button", { name: /Confirmar/ }));
    expect(await screen.findByText("Informe sua senha para alterar um administrador.")).toBeInTheDocument();
  });
});

describe("UsersAdmin password-manager hints", () => {
  it("the reset form carries a hidden read-only username input with the session e-mail", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Redefinir senha/ }));
    const form = screen.getByRole("form", { name: /Redefinir senha de juiz@b.com/ });
    const hidden = form.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(hidden).toHaveValue("adm@b.com");
    expect(hidden).toHaveAttribute("aria-hidden", "true");
    expect(hidden).toHaveAttribute("tabindex", "-1");
    expect(hidden).toHaveAttribute("readonly");
  });

  it("the create form has the hidden username input only for the ADMIN role", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    const createForm = screen.getByLabelText("Senha inicial").closest("form") as HTMLFormElement;
    expect(createForm.querySelector('input[autocomplete="username"]')).toBeNull();
    await user.selectOptions(screen.getByLabelText("Perfil"), "ADMIN");
    const hidden = createForm.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(hidden).toHaveValue("adm@b.com");
    expect(hidden).toHaveAttribute("aria-hidden", "true");
  });
});

describe("UsersAdmin reload guards", () => {
  it("ignores a pending reload that belongs to a filter that is no longer selected", async () => {
    const user = userEvent.setup();
    let finishStale!: (v: AdminUser[]) => void;
    const list = vi
      .spyOn(api, "adminUsers")
      .mockResolvedValueOnce(USERS)
      .mockReturnValueOnce(new Promise<AdminUser[]>((resolve) => (finishStale = resolve)))
      .mockResolvedValueOnce([USERS[0]]);
    vi.spyOn(api, "adminDeactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2)); // the pending reload
    await user.selectOptions(screen.getByLabelText("Filtrar por perfil"), "JUDGE");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2][1]).toBe("JUDGE");
    await waitFor(() => expect(screen.getByText("Mostrando 1 usuários.")).toBeInTheDocument());
    finishStale(USERS);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("adv@b.com")).not.toBeInTheDocument();
    expect(screen.getByText("Mostrando 1 usuários.")).toBeInTheDocument();
  });

  it("closes the reset form when its row is deactivated", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminDeactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Redefinir senha/ }));
    expect(screen.getByLabelText("Nova senha")).toBeInTheDocument();
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ }));
    await screen.findByText("Conta desativada.");
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
  });
});
