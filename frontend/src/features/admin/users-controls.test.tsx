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

const T = "2026-10-01T12:00:00Z";
const USERS: AdminUser[] = [
  { id: "u1", email: "juiz@b.com", role: "JUDGE", created_at: T, is_active: true },
  { id: "u2", email: "adv@b.com", role: "LAWYER", created_at: T, is_active: false },
  { id: "admin-self", email: "adm@b.com", role: "ADMIN", created_at: T, is_active: true },
  { id: "u4", email: "outro@b.com", role: "ADMIN", created_at: T, is_active: true },
  { id: "u5", email: "velho@b.com", role: "ADMIN", created_at: T, is_active: false },
];

const row = (email: string) => screen.getByText(email).closest("li") as HTMLElement;

describe("UsersAdmin account status", () => {
  it("shows Inativa badge and Reativar only on inactive rows", async () => {
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(within(row("adv@b.com")).getByText("Inativa")).toBeInTheDocument();
    expect(within(row("adv@b.com")).getByRole("button", { name: /Reativar/ })).toBeInTheDocument();
    expect(within(row("adv@b.com")).queryByRole("button", { name: /Desativar/ })).not.toBeInTheDocument();
    expect(within(row("juiz@b.com")).queryByText("Inativa")).not.toBeInTheDocument();
    expect(within(row("juiz@b.com")).queryByRole("button", { name: /Reativar/ })).not.toBeInTheDocument();
  });

  it("gives your own row no deactivate or reset buttons", async () => {
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    const own = within(row("adm@b.com"));
    expect(own.queryByRole("button", { name: /Desativar/ })).not.toBeInTheDocument();
    expect(own.queryByRole("button", { name: /Redefinir senha/ })).not.toBeInTheDocument();
  });

  it("deactivates in two steps, announces and refetches", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const deactivate = vi.spyOn(api, "adminDeactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    expect(deactivate).not.toHaveBeenCalled();
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ }));
    expect(deactivate).toHaveBeenCalledWith("u1");
    expect(await screen.findByText("Conta desativada.")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("cancels a deactivation and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    expect(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ })).toHaveFocus();
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: "Cancelar" }));
    expect(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ })).toHaveFocus();
  });

  it("refetches on a 404 when deactivating", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminDeactivate").mockRejectedValue(new ApiError(404, "Usuário não encontrado."));
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Desativar/ }));
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("Usuário não encontrado.");
  });

  it("reactivates, announces and refetches", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const reactivate = vi.spyOn(api, "adminReactivate").mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("adv@b.com")).getByRole("button", { name: /Reativar/ }));
    expect(reactivate).toHaveBeenCalledWith("u2");
    expect(await screen.findByText("Conta reativada.")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("UsersAdmin reset password", () => {
  async function openReset() {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Redefinir senha/ }));
    return user;
  }

  it("opens an inline form with hardened password fields", async () => {
    await openReset();
    const next = screen.getByLabelText("Nova senha");
    const mine = screen.getByLabelText("Sua senha");
    for (const el of [next, mine]) {
      expect(el).toHaveAttribute("type", "password");
      expect(el).toHaveAttribute("maxlength", "128");
    }
    expect(next).toHaveAttribute("autocomplete", "off");
    expect(next).toHaveAttribute("minlength", "12");
    expect(mine).toHaveAttribute("autocomplete", "current-password");
  });

  it("submits, clears both fields, announces and returns focus to the trigger", async () => {
    const reset = vi.spyOn(api, "adminResetPassword").mockResolvedValue(undefined);
    const user = await openReset();
    await user.type(screen.getByLabelText("Nova senha"), "nova-senha-forte");
    await user.type(screen.getByLabelText("Sua senha"), "minha-senha");
    await user.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(reset).toHaveBeenCalledWith("u1", "nova-senha-forte", "minha-senha");
    expect(await screen.findByText("Senha redefinida.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(within(row("juiz@b.com")).getByRole("button", { name: /Redefinir senha/ })).toHaveFocus();
  });

  it.each([
    [400, "Senha atual incorreta."],
    [409, 'Use "Alterar senha" para a própria conta.'],
    [429, "Muitas tentativas. Tente novamente mais tarde."],
  ])("shows a %s error in the alert and clears both fields", async (status, message) => {
    vi.spyOn(api, "adminResetPassword").mockRejectedValue(new ApiError(status, message));
    const user = await openReset();
    await user.type(screen.getByLabelText("Nova senha"), "nova-senha-forte");
    await user.type(screen.getByLabelText("Sua senha"), "minha-senha");
    await user.click(screen.getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
    expect(screen.getByLabelText("Sua senha")).toHaveValue("");
  });

  it("shows 422 field errors", async () => {
    vi.spyOn(api, "adminResetPassword").mockRejectedValue(
      new ApiError(422, "Dados inválidos.", [{ field: "new_password", message: "Senha muito curta." }]),
    );
    const user = await openReset();
    await user.type(screen.getByLabelText("Nova senha"), "nova-senha-forte");
    await user.type(screen.getByLabelText("Sua senha"), "minha-senha");
    await user.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(await screen.findByText("Senha muito curta.")).toBeInTheDocument();
  });

  it("ignores a second submit while in flight", async () => {
    let finish!: () => void;
    const reset = vi.spyOn(api, "adminResetPassword").mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = await openReset();
    await user.type(screen.getByLabelText("Nova senha"), "nova-senha-forte");
    await user.type(screen.getByLabelText("Sua senha"), "minha-senha");
    const form = screen.getByLabelText("Nova senha").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(reset).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText("Senha redefinida.")).toBeInTheDocument();
  });

  it("drops typed passwords when the form is cancelled and reopened", async () => {
    const user = await openReset();
    await user.type(screen.getByLabelText("Nova senha"), "nova-senha-forte");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    await user.click(within(row("juiz@b.com")).getByRole("button", { name: /Redefinir senha/ }));
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
  });
});

describe("UsersAdmin create admin step-up", () => {
  it("shows Sua senha only for the Administrador role and sends it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    const create = vi.spyOn(api, "adminCreateUser").mockResolvedValue({ id: "n", email: "n@b.com", role: "ADMIN" });
    renderUsers();
    await screen.findByText("juiz@b.com");
    expect(screen.queryByLabelText("Sua senha")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Perfil"), "ADMIN");
    const mine = screen.getByLabelText("Sua senha");
    expect(mine).toBeRequired();
    expect(mine).toHaveAttribute("autocomplete", "current-password");
    await user.type(screen.getByLabelText("E-mail"), "n@b.com");
    await user.type(screen.getByLabelText("Senha inicial"), "senha-forte-123");
    await user.type(mine, "minha-senha");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(create).toHaveBeenCalledWith("n@b.com", "ADMIN", "senha-forte-123", "minha-senha");
    expect(await screen.findByText("Conta criada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Sua senha")).toHaveValue("");
  });

  it("clears Sua senha after a failure and maps a 422 to it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminUsers").mockResolvedValue(USERS);
    vi.spyOn(api, "adminCreateUser").mockRejectedValue(
      new ApiError(422, "Dados inválidos.", [
        { field: "admin_password", message: "Informe sua senha para criar um administrador." },
      ]),
    );
    renderUsers();
    await screen.findByText("juiz@b.com");
    await user.selectOptions(screen.getByLabelText("Perfil"), "ADMIN");
    await user.type(screen.getByLabelText("E-mail"), "n@b.com");
    await user.type(screen.getByLabelText("Senha inicial"), "senha-forte-123");
    await user.type(screen.getByLabelText("Sua senha"), "x");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByText("Informe sua senha para criar um administrador.")).toBeInTheDocument();
    expect(screen.getByLabelText("Sua senha")).toHaveValue("");
  });
});
