import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

function renderAnon(ui: React.ReactNode) {
  return render(<SessionProvider initialState={{ status: "anonymous" }}>{ui}</SessionProvider>);
}

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

describe("LoginForm", () => {
  it("logs in and goes to the role's home", async () => {
    const user = userEvent.setup();
    const login = vi.spyOn(api, "login").mockResolvedValue({ id: "1", email: "j@b.com", role: "JUDGE" });
    renderAnon(<LoginForm />);
    await user.type(screen.getByLabelText("E-mail"), "j@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(login).toHaveBeenCalledWith("j@b.com", "senha-forte-123");
    expect(replace).toHaveBeenCalledWith("/judge");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
    expect(screen.getByLabelText("E-mail")).toHaveValue("j@b.com");
  });

  it("shows the server message on failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, "E-mail ou senha inválidos."));
    renderAnon(<LoginForm />);
    await user.type(screen.getByLabelText("E-mail"), "x@b.com");
    await user.type(screen.getByLabelText("Senha"), "errada");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos.");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("RegisterForm", () => {
  it("requires 12 characters before enabling sign-up", async () => {
    const user = userEvent.setup();
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.type(screen.getByLabelText("Senha"), "curta");
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeDisabled();
  });

  it("creates the account and opens the client area", async () => {
    const user = userEvent.setup();
    const register = vi.spyOn(api, "register").mockResolvedValue({ id: "1", email: "novo@b.com", role: "CLIENT" });
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "novo@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(register).toHaveBeenCalledWith("novo@b.com", "senha-forte-123");
    expect(replace).toHaveBeenCalledWith("/client");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });

  it("shows duplicate e-mail errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "register").mockRejectedValue(new ApiError(409, "E-mail já cadastrado."));
    renderAnon(<RegisterForm />);
    await user.type(screen.getByLabelText("E-mail"), "dup@b.com");
    await user.type(screen.getByLabelText("Senha"), "senha-forte-123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail já cadastrado.");
  });
});
