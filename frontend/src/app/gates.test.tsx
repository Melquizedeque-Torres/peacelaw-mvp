import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Role } from "@/lib/api";
import { SessionProvider } from "@/lib/session";

import AdminPage from "./admin/page";
import AdminPitchPage from "./admin/pitch/page";
import AdminUsersPage from "./admin/users/page";
import ChangePasswordPage from "./conta/senha/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

beforeEach(() => vi.restoreAllMocks());

function renderAs(role: Role | null, page: React.ReactNode) {
  return render(
    <SessionProvider
      initialState={
        role
          ? { status: "authenticated", user: { id: "1", email: "x@b.com", role } }
          : { status: "anonymous" }
      }
    >
      {page}
    </SessionProvider>,
  );
}

describe("admin pages are role gated", () => {
  it.each([
    ["dashboard", <AdminPage key="a" />],
    ["users", <AdminUsersPage key="u" />],
    ["pitch", <AdminPitchPage key="p" />],
  ])("%s shows only the placeholder to a non-admin and calls no API", (_name, page) => {
    const stats = vi.spyOn(api, "adminStats");
    const users = vi.spyOn(api, "adminUsers");
    const pitch = vi.spyOn(api, "adminPitch");
    renderAs("JUDGE", page);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(stats).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
    expect(pitch).not.toHaveBeenCalled();
  });
});

describe("password page is auth gated", () => {
  it("shows only the placeholder to an anonymous visitor", () => {
    renderAs(null, <ChangePasswordPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByLabelText("Senha atual")).not.toBeInTheDocument();
  });

  it("shows the form to any signed-in role", () => {
    renderAs("LAWYER", <ChangePasswordPage />);
    expect(screen.getByLabelText("Senha atual")).toBeInTheDocument();
  });
});
