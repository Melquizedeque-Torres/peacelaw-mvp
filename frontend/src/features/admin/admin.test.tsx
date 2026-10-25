import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, HOME_FOR_ROLE, api } from "@/lib/api";

import { PitchView } from "./PitchView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

beforeEach(() => vi.restoreAllMocks());

describe("PitchView", () => {
  it("mounts the admin-only markup inside a shadow root", async () => {
    vi.spyOn(api, "adminPitch").mockResolvedValue({
      html: "<style>h1{color:red}</style><h1>Roteiro</h1>",
    });
    render(<PitchView />);
    const host = screen.getByTestId("pitch-host");
    await waitFor(() => expect(host.shadowRoot?.querySelector("h1")?.textContent).toBe("Roteiro"));
    // Not in the light DOM, so its styles cannot reach the app.
    expect(screen.queryByRole("heading", { name: "Roteiro" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the server's message when access is refused", async () => {
    vi.spyOn(api, "adminPitch").mockRejectedValue(new ApiError(403, "Acesso negado."));
    render(<PitchView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Acesso negado.");
  });
});

describe("admin home", () => {
  it("sends admins to the console", () => {
    expect(HOME_FOR_ROLE.ADMIN).toBe("/admin");
  });
});
