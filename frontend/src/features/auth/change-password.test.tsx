import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

import { ChangePasswordForm } from "./ChangePasswordForm";

beforeEach(() => vi.restoreAllMocks());

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) {
  await user.type(screen.getByLabelText("Senha atual"), current);
  await user.type(screen.getByLabelText("Nova senha"), next);
  await user.type(screen.getByLabelText("Confirmar nova senha"), confirm);
}

describe("ChangePasswordForm", () => {
  it("uses the right autocomplete hints", () => {
    render(<ChangePasswordForm />);
    expect(screen.getByLabelText("Senha atual")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Nova senha")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirmar nova senha")).toHaveAttribute("autocomplete", "new-password");
  });

  it("blocks a mismatch without calling the API", async () => {
    const user = userEvent.setup();
    const change = vi.spyOn(api, "changePassword").mockResolvedValue(undefined);
    render(<ChangePasswordForm />);
    await fill(user, "antiga-12345", "nova-senha-123", "nova-senha-124");
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("As senhas não conferem.");
    expect(change).not.toHaveBeenCalled();
  });

  it("changes the password and clears every field", async () => {
    const user = userEvent.setup();
    const change = vi.spyOn(api, "changePassword").mockResolvedValue(undefined);
    render(<ChangePasswordForm />);
    await fill(user, "antiga-12345", "nova-senha-123", "nova-senha-123");
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));
    expect(change).toHaveBeenCalledWith("antiga-12345", "nova-senha-123");
    expect(await screen.findByText("Senha alterada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha atual")).toHaveValue("");
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
    expect(screen.getByLabelText("Confirmar nova senha")).toHaveValue("");
  });

  it("shows the server message on failure and clears the fields", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "changePassword").mockRejectedValue(new ApiError(400, "Senha atual incorreta."));
    render(<ChangePasswordForm />);
    await fill(user, "errada-12345", "nova-senha-123", "nova-senha-123");
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Senha atual incorreta.");
    expect(screen.getByLabelText("Senha atual")).toHaveValue("");
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
  });
});
