import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { AuthGate, RoleGate, SessionProvider, useSession } from "./session";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  vi.restoreAllMocks();
});

function WhoAmI() {
  const { state } = useSession();
  return <p>{state.status === "authenticated" ? state.user.email : state.status}</p>;
}

describe("SessionProvider", () => {
  it("loads the current user", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ id: "1", email: "a@b.com", role: "CLIENT" });
    render(<SessionProvider><WhoAmI /></SessionProvider>);
    expect(await screen.findByText("a@b.com")).toBeInTheDocument();
  });

  it("is anonymous when there is no session", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("401"));
    render(<SessionProvider><WhoAmI /></SessionProvider>);
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
  });
});

describe("RoleGate", () => {
  it("renders children for the right role", () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "j@b.com", role: "JUDGE" } }}>
        <RoleGate role="JUDGE"><p>painel do juiz</p></RoleGate>
      </SessionProvider>,
    );
    expect(screen.getByText("painel do juiz")).toBeInTheDocument();
  });

  it("sends anonymous visitors to /login", async () => {
    render(
      <SessionProvider initialState={{ status: "anonymous" }}>
        <RoleGate role="JUDGE"><p>painel do juiz</p></RoleGate>
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("painel do juiz")).not.toBeInTheDocument();
  });

  it("sends other roles to their own home", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "c@b.com", role: "CLIENT" } }}>
        <RoleGate role="LAWYER"><p>quadro</p></RoleGate>
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/client"));
  });
});

describe("AuthGate", () => {
  it("renders children for any authenticated user", () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "c@b.com", role: "CLIENT" } }}>
        <AuthGate><p>conta</p></AuthGate>
      </SessionProvider>,
    );
    expect(screen.getByText("conta")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends anonymous visitors to /login", async () => {
    render(
      <SessionProvider initialState={{ status: "anonymous" }}>
        <AuthGate><p>conta</p></AuthGate>
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("conta")).not.toBeInTheDocument();
  });

  it("shows a loading placeholder while the session loads", () => {
    render(
      <SessionProvider initialState={{ status: "loading" }}>
        <AuthGate><p>conta</p></AuthGate>
      </SessionProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
    expect(screen.queryByText("conta")).not.toBeInTheDocument();
  });
});
