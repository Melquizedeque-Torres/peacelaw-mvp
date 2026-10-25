import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

import { ChangePasswordForm } from "./ChangePasswordForm";

beforeEach(() => vi.restoreAllMocks());

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Senha atual"), "antiga-12345");
  await user.type(screen.getByLabelText("Nova senha"), "nova-senha-123");
  await user.type(screen.getByLabelText("Confirmar nova senha"), "nova-senha-123");
}

describe("ChangePasswordForm edge cases", () => {
  it("shows the rate limit message", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "changePassword").mockRejectedValue(
      new ApiError(429, "Muitas tentativas. Tente novamente mais tarde."),
    );
    render(<ChangePasswordForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitas tentativas. Tente novamente mais tarde.");
  });

  it("ignores a second submit while busy and caps the length", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const change = vi.spyOn(api, "changePassword").mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<ChangePasswordForm />);
    for (const label of ["Senha atual", "Nova senha", "Confirmar nova senha"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("maxlength", "128");
    }
    await fill(user);
    const form = screen.getByRole("button", { name: "Alterar senha" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(change).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText("Senha alterada.")).toBeInTheDocument();
  });
});
