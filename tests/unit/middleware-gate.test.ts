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

  // /api/auth/* is prefix-exempt so an expired-cookie user can still reach
  // POST /api/auth/logout and get the httpOnly cookie cleared; login enforces
  // its own validation, whoami its own 401 (tests/unit/auth-routes.test.ts).
  it.each([
    "/api/cron/consuela/briefing",
    "/api/admin/version",
    "/api/ha/alarm",
    "/api/emergency",
    "/api/auth/login",
    "/api/auth/logout",
  ])("exempts %s (own gate)", async (path) => {
    const res = await middleware(req(path));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("exempts /api/auth/* (route-level 401 protects whoami)", async () => {
    const res = await middleware(req("/api/auth/whoami"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("gates /api/db/ like any other API route", async () => {
    const res = await middleware(req("/api/db/query"));
    expect(res?.status ?? 0).toBe(401);
  });

  // Task 8 controller mandate: the browser data path itself is blocked
  // without a session, not just the /api/db/ prefix in the abstract.
  it("401s anonymous /api/db/tasks (no session)", async () => {
    const res = await middleware(req("/api/db/tasks"));
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
