import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/lib/session";

import HomePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

beforeEach(() => replace.mockReset());

describe("/", () => {
  it("offers the three actor entry points", () => {
    render(<SessionProvider initialState={{ status: "anonymous" }}><HomePage /></SessionProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "Resolva a disputa antes que ela vire processo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou cliente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou juiz avaliador" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sou advogado mediador" })).toBeInTheDocument();
    screen.getAllByRole("link", { name: "Criar conta" }).forEach((l) => expect(l).toHaveAttribute("href", "/register"));
  });

  it("links to the privacy notice", () => {
    render(<SessionProvider initialState={{ status: "anonymous" }}><HomePage /></SessionProvider>);
    screen.getAllByRole("link", { name: "Política de privacidade" }).forEach((l) => expect(l).toHaveAttribute("href", "/privacidade"));
  });

  it("redirects a signed-in user to their area", async () => {
    render(
      <SessionProvider initialState={{ status: "authenticated", user: { id: "1", email: "l@b.com", role: "LAWYER" } }}>
        <HomePage />
      </SessionProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/lawyer"));
  });
});
