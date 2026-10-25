import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LoginForm } from "./LoginForm";
import { TwoFactorSettings } from "./TwoFactorSettings";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

describe("LoginForm with a second factor", () => {
  it("asks for the code after the password is accepted and sends it", async () => {
    const user = userEvent.setup();
    const login = vi
      .spyOn(api, "login")
      .mockRejectedValueOnce(new ApiError(401, "Informe o código do aplicativo autenticador.", [], true))
      .mockResolvedValueOnce({ id: "1", email: "a@b.com", role: "ADMIN" });
    render(
      <SessionProvider initialState={{ status: "anonymous" }}>
        <LoginForm />
      </SessionProvider>,
    );
    expect(screen.queryByLabelText("Código de verificação")).toBeNull();
    await user.type(screen.getByLabelText("E-mail"), "a@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByLabelText("Código de verificação")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o código");
    await user.type(screen.getByLabelText("Senha"), "{Control>}a{/Control}");
    await user.clear(screen.getByLabelText("Senha"));
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.type(screen.getByLabelText("Código de verificação"), "123456");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(login).toHaveBeenLastCalledWith("a@b.com", "senha-forte-123", "123456");
    expect(replace).toHaveBeenCalledWith("/admin");
  });
});

describe("TwoFactorSettings", () => {
  it("walks through setup, shows the recovery codes once, then reports active", async () => {
    const user = userEvent.setup();
    const status = vi
      .spyOn(api, "totpStatus")
      .mockResolvedValueOnce({ enabled: false, recovery_codes_left: 0 })
      .mockResolvedValue({ enabled: true, recovery_codes_left: 8 });
    vi.spyOn(api, "totpSetup").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" });
    const enable = vi.spyOn(api, "totpEnable").mockResolvedValue({ recovery_codes: ["abcde-fghij", "klmno-pqrst"] });
    render(<TwoFactorSettings />);
    await user.type(await screen.findByLabelText("Sua senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Configurar" }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ativar" })).toBeDisabled();
    await user.type(screen.getByLabelText("Código do aplicativo"), "123456");
    await user.click(screen.getByRole("button", { name: "Ativar" }));
    expect(enable).toHaveBeenCalledWith("123456");
    expect(await screen.findByText("abcde-fghij")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardei os códigos" }));
    expect(screen.queryByText("abcde-fghij")).toBeNull();
    expect(await screen.findByText(/está/)).toHaveTextContent("ativa");
    expect(status).toHaveBeenCalled();
  });

  it("disables with password and code, and shows server errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "totpStatus").mockResolvedValue({ enabled: true, recovery_codes_left: 5 });
    const disable = vi
      .spyOn(api, "totpDisable")
      .mockRejectedValueOnce(new ApiError(400, "Código inválido ou já utilizado."))
      .mockResolvedValueOnce(undefined);
    render(<TwoFactorSettings />);
    await user.type(await screen.findByLabelText("Sua senha"), "senha-forte-123");
    await user.type(screen.getByLabelText("Código do aplicativo ou de recuperação"), "000000");
    await user.click(screen.getByRole("button", { name: "Desativar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Código inválido");
    await user.clear(screen.getByLabelText("Código do aplicativo ou de recuperação"));
    await user.type(screen.getByLabelText("Código do aplicativo ou de recuperação"), "abcde-fghij");
    await user.click(screen.getByRole("button", { name: "Desativar" }));
    expect(disable).toHaveBeenLastCalledWith("senha-forte-123", "abcde-fghij");
  });
});
