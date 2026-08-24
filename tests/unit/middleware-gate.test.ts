import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";
import { signSession, SESSION_COOKIE } from "../../src/lib/session";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("middleware /api gate", () => {
  it("401s anonymous /api/tasks", async () => {
    const res = await middleware(req("/api/tasks"));
    expect(res?.status ?? 0).toBe(401);
  });

  it("401s a tampered session cookie on /api/tasks", async () => {
    const res = await middleware(req("/api/tasks", `${SESSION_COOKIE}=v1.bogus.sig`));
    expect(res?.status ?? 0).toBe(401);
  });

  it("allows valid session through", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    const res = await middleware(req("/api/tasks", `${SESSION_COOKIE}=${token}`));
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    "/api/cron/consuela/briefing",
    "/api/admin/version",
    "/api/ha/alarm",
    "/api/emergency",
    "/api/auth/login",
  ])("exempts %s (own gate)", async (path) => {
    const res = await middleware(req(path));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("gates /api/db/ like any other API route", async () => {
    const res = await middleware(req("/api/db/query"));
    expect(res?.status ?? 0).toBe(401);
  });

  it("does not touch non-API routes", async () => {
    expect((await middleware(req("/settings"))).headers.get("x-middleware-next")).toBe(
      "1"
    );

    // Preserved legacy behavior: /_design-system is rewritten to /design-system.
    const rewritten = await middleware(req("/_design-system"));
    expect(rewritten.headers.get("x-middleware-rewrite")).toContain("/design-system");
  });
});
