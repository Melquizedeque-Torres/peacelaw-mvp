import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

async function headerMap() {
  const rules = await nextConfig.headers!();
  const all = rules.find((rule) => rule.source === "/:path*");
  expect(all).toBeDefined();
  return Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
}

describe("next.config security headers", () => {
  it("hides X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sets the baseline headers on every route", async () => {
    const headers = await headerMap();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(self), geolocation=()");
  });

  it("ships a strict CSP without unsafe-eval outside development", async () => {
    const csp = (await headerMap())["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' blob:");
  });

  it("sends HSTS only in production", async () => {
    // vitest runs with NODE_ENV=test
    expect((await headerMap())["Strict-Transport-Security"]).toBeUndefined();
  });

  describe("api rewrite", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("is empty when BACKEND_URL is unset (Vercel routes /api itself)", async () => {
      vi.stubEnv("BACKEND_URL", "");
      expect(await nextConfig.rewrites!()).toEqual([]);
    });

    it("proxies /api to BACKEND_URL when set", async () => {
      vi.stubEnv("BACKEND_URL", "http://127.0.0.1:8000");
      expect(await nextConfig.rewrites!()).toEqual([
        { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
      ]);
    });
  });

  describe("per environment", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("sends HSTS only in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      expect((await headerMap())["Strict-Transport-Security"]).toContain("max-age=");
      vi.stubEnv("NODE_ENV", "development");
      expect((await headerMap())["Strict-Transport-Security"]).toBeUndefined();
    });

    it("allows 'unsafe-eval' only in development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      expect((await headerMap())["Content-Security-Policy"]).toContain("'unsafe-eval'");
      vi.stubEnv("NODE_ENV", "production");
      expect((await headerMap())["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    });

    it("forbids plugins via object-src", async () => {
      expect((await headerMap())["Content-Security-Policy"]).toContain("object-src 'none'");
    });
  });
});
