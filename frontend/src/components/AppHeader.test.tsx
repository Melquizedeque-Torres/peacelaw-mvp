import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import { useState } from "react";

import { RoleGate, SessionProvider, useSession } from "@/lib/session";

import { AppHeader } from "./AppHeader";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

function Extras() {
  const [visit, setVisit] = useState(false);
  const { setUser } = useSession();
  return (
    <>
      <button onClick={() => setVisit(true)}>Visitar</button>
      <button onClick={() => setUser({ id: "1", email: "c@b.com", role: "CLIENT" })}>Entrar de novo</button>
      {visit && (
        <RoleGate role="CLIENT">
          <p>área protegida</p>
        </RoleGate>
      )}
    </>
  );
}

function setup() {
  render(
    <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "c@b.com", role: "CLIENT" } }}>
      <RoleGate role="CLIENT">
        <AppHeader title="Meus casos" />
      </RoleGate>
      <Extras />
    </SessionProvider>,
  );
  return userEvent.setup();
}

describe("AppHeader account link", () => {
  it("links to the password change page", () => {
    setup();
    expect(screen.getByRole("link", { name: "Alterar senha" })).toHaveAttribute("href", "/conta/senha");
  });
});

describe("AppHeader account link for other roles", () => {
  it("shows Alterar senha for a judge too", () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "2", email: "j@b.com", role: "JUDGE" } }}>
        <AppHeader title="Fila" />
      </SessionProvider>,
    );
    expect(screen.getByRole("link", { name: "Alterar senha" })).toHaveAttribute("href", "/conta/senha");
  });
});

describe("AppHeader logout", () => {
  it("clears the session and lands on / (never /login) after success", async () => {
    vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("c@b.com")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith("/login");
  });

  it("treats a 401 as already logged out", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError(401, "Sessão expirada."));
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(replace).not.toHaveBeenCalledWith("/login");
  });

  it("keeps the session and warns when logout fails", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError(0, "Sem conexão com o servidor."));
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair. Tente novamente.");
    expect(screen.getByText("c@b.com")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("never strands a later RoleGate visit on the loading state", async () => {
    vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    replace.mockClear();
    await user.click(screen.getByRole("button", { name: "Visitar" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("ends on / with an anonymous session when logout answers 401 through fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Sessão expirada." }), { status: 401 })),
    );
    try {
      const user = setup();
      await user.click(screen.getByRole("button", { name: "Sair" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      await act(async () => {});
      expect(screen.queryByText("c@b.com")).not.toBeInTheDocument();
      expect(replace).not.toHaveBeenCalledWith("/login");
      await user.click(screen.getByRole("button", { name: "Visitar" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets the user sign in again after logout", async () => {
    vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    await user.click(screen.getByRole("button", { name: "Entrar de novo" }));
    await user.click(screen.getByRole("button", { name: "Visitar" }));
    expect(await screen.findByText("área protegida")).toBeInTheDocument();
  });
});
