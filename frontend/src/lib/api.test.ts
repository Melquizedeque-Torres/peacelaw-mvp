import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setUnauthorizedHandler } from "./api";

const fetchMock = vi.fn();

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("fetches the public consent text", async () => {
    respond(200, { version: "2026-10-15", text: "Autorizo" });
    expect(await api.consent()).toEqual({ version: "2026-10-15", text: "Autorizo" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/consent");
  });

  it("posts JSON to the same-origin API with the session cookie", async () => {
    respond(200, { id: "u1", email: "a@b.com", role: "CLIENT" });
    const user = await api.login("a@b.com", "senha-forte-123");
    expect(user.role).toBe("CLIENT");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ email: "a@b.com", password: "senha-forte-123" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("resolves 204 responses to undefined", async () => {
    respond(204);
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("posts to the erase-original endpoint", async () => {
    respond(200, { id: "a/b", raw_text: "", raw_text_erased_at: "2026-10-15T15:00:00Z" });
    await api.eraseOriginal("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/a%2Fb/erase-original");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("calls the admin and password endpoints", async () => {
    respond(200, { cases_by_status: {}, users_by_role: {}, last_24h: { audit_events: 0, stepup_failures: 0, rate_limit_hits: 0 } });
    await api.adminStats();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/stats");

    respond(200, []);
    await api.adminUsers({ limit: 5, offset: 10 });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/users?limit=5&offset=10");

    respond(200, []);
    await api.adminUsers({ limit: 50, offset: 50 }, "JUDGE");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/admin/users?limit=50&offset=50&role=JUDGE");
    respond(200, []);
    await api.adminUsers(undefined, "CLIENT");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/admin/users?role=CLIENT");

    respond(201, { id: "u", email: "j@b.com", role: "JUDGE" });
    await api.adminCreateUser("j@b.com", "JUDGE", "senha-forte-123");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/admin/users");
    expect((fetchMock.mock.calls[4][1] as RequestInit).body).toBe(
      JSON.stringify({ email: "j@b.com", role: "JUDGE", password: "senha-forte-123" }),
    );

    respond(204);
    await api.adminRevokeSessions("a/b");
    expect(fetchMock.mock.calls[5][0]).toBe("/api/admin/users/a%2Fb/revoke-sessions");

    respond(204);
    await api.changePassword("antiga-12345", "nova-senha-123");
    expect(fetchMock.mock.calls[6][0]).toBe("/api/auth/change-password");
    expect((fetchMock.mock.calls[6][1] as RequestInit).body).toBe(
      JSON.stringify({ current_password: "antiga-12345", new_password: "nova-senha-123" }),
    );
  });

  it("calls the account control endpoints", async () => {
    respond(204);
    await api.adminDeactivate("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/users/a%2Fb/deactivate");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    respond(204);
    await api.adminReactivate("a/b");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/users/a%2Fb/reactivate");
    respond(204);
    await api.adminResetPassword("a/b", "nova-senha-forte", "minha-senha");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/admin/users/a%2Fb/reset-password");
    expect((fetchMock.mock.calls[2][1] as RequestInit).body).toBe(
      JSON.stringify({ new_password: "nova-senha-forte", admin_password: "minha-senha" }),
    );
    respond(201, { id: "u", email: "a@b.com", role: "ADMIN" });
    await api.adminCreateUser("a@b.com", "ADMIN", "senha-forte-123", "minha-senha");
    expect((fetchMock.mock.calls[3][1] as RequestInit).body).toBe(
      JSON.stringify({ email: "a@b.com", role: "ADMIN", password: "senha-forte-123", admin_password: "minha-senha" }),
    );
  });

  it("sends admin_password to deactivate/reactivate only when given", async () => {
    respond(204);
    await api.adminDeactivate("a/b");
    respond(204);
    await api.adminReactivate("a/b");
    respond(204);
    await api.adminDeactivate("a/b", "minha-senha");
    respond(204);
    await api.adminReactivate("a/b", "minha-senha");
    const body = (i: number) => (fetchMock.mock.calls[i][1] as RequestInit).body;
    expect(body(0)).toBeUndefined();
    expect(body(1)).toBeUndefined();
    expect(body(2)).toBe(JSON.stringify({ admin_password: "minha-senha" }));
    expect(body(3)).toBe(JSON.stringify({ admin_password: "minha-senha" }));
    expect(fetchMock.mock.calls[3][0]).toBe("/api/admin/users/a%2Fb/reactivate");
  });

  it("encodes ids in paths", async () => {
    respond(200, []);
    await api.getCase("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/a%2Fb");
  });

  it("turns error bodies into ApiError with the server message", async () => {
    respond(409, { detail: "Você já avaliou este caso." });
    const error = await api.submitReview("c1", { score_evidence: 5, score_jurisprudence: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Você já avaliou este caso.");
  });

  it("sends the LGPD consent flag and displayed version when creating a case", async () => {
    respond(201, {});
    await api.createCase("Título", "Relato", true, "2026-10-15");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ title: "Título", text: "Relato", lgpd_consent: true, consent_version: "2026-10-15" });
  });

  it("sends optional limit/offset on list endpoints and nothing by default", async () => {
    respond(200, []);
    await api.myCases();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cases/mine");
    respond(200, []);
    await api.myCases({ limit: 10, offset: 20 });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/cases/mine?limit=10&offset=20");
    respond(200, []);
    await api.judgeQueue({ limit: 5 });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/judge/queue?limit=5");
    respond(200, []);
    await api.lawyerBoard({ offset: 0 });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/lawyer/board?offset=0");
  });

  it("keeps field errors from 422 responses", async () => {
    respond(422, { detail: "Dados inválidos.", errors: [{ field: "text", message: "curto" }] });
    const error = await api.createCase("t", "x", true, "2026-10-15").catch((e) => e);
    expect(error.fieldErrors).toEqual([{ field: "text", message: "curto" }]);
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    const error = await api.me().catch((e) => e);
    expect(error.message).toBe("Não foi possível concluir a operação. Tente novamente.");
  });

  it("notifies the session when an authenticated call gets 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    respond(401, { detail: "Não autenticado." });
    await api.myCases().catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    respond(401, { detail: "Não autenticado." });
    await api.me().catch(() => undefined); // the session probe itself does not trigger it
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const error = await api.me().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe("Sem conexão com o servidor.");
  });
});
