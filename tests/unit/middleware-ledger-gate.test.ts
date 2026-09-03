import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, isAdultOnlyPath } from "../../src/middleware";
import { signSession, SESSION_COOKIE } from "../../src/lib/session";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const parentCookie = async () =>
  `${SESSION_COOKIE}=${await signSession({ memberId: "m1", name: "Rebecca", role: "parent" })}`;
const childCookie = async () =>
  `${SESSION_COOKIE}=${await signSession({ memberId: "m2", name: "Emily", role: "child" })}`;

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("isAdultOnlyPath", () => {
  it("covers the ledger page, proxy root, assets, and both api prefixes", () => {
    expect(isAdultOnlyPath("/ledger")).toBe(true);
    expect(isAdultOnlyPath("/ledger-app/")).toBe(true);
    expect(isAdultOnlyPath("/assets/index-VdJbasLh.js")).toBe(true);
    expect(isAdultOnlyPath("/api/data/dashboard")).toBe(true);
    expect(isAdultOnlyPath("/api/ofx/discover/preview")).toBe(true);
  });
  it("does not leak onto lookalike siblings", () => {
    expect(isAdultOnlyPath("/ledger-nav")).toBe(false);
    expect(isAdultOnlyPath("/assetsx")).toBe(false);
    expect(isAdultOnlyPath("/api/databases")).toBe(false);
    expect(isAdultOnlyPath("/api/tasks")).toBe(false);
  });
});

describe("ledger adult gate", () => {
  it("lets a parent load /ledger (passes through)", async () => {
    const res = await middleware(req("/ledger", await parentCookie()));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a guest from /ledger to /", async () => {
    const res = await middleware(req("/ledger"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$/);
  });

  it("redirects a child from /ledger to /", async () => {
    const res = await middleware(req("/ledger", await childCookie()));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$/);
  });

  it("403s a child on /ledger-app/ (iframe root)", async () => {
    const res = await middleware(req("/ledger-app/", await childCookie()));
    expect(res.status).toBe(403);
  });

  it("403s a guest on /assets/ (ledger bundles)", async () => {
    const res = await middleware(req("/assets/index-VdJbasLh.js"));
    expect(res.status).toBe(403);
  });

  it("403s a child on /api/data/dashboard with adult_only body", async () => {
    const res = await middleware(req("/api/data/dashboard", await childCookie()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
  });

  it("403s a guest on /api/ofx/discover/preview", async () => {
    const res = await middleware(req("/api/ofx/discover/preview"));
    expect(res.status).toBe(403);
  });

  it("lets a parent reach /api/data/dashboard and /assets/*", async () => {
    const cookie = await parentCookie();
    for (const path of ["/api/data/dashboard", "/api/ofx/discover/confirm", "/assets/index-x.css"]) {
      const res = await middleware(req(path, cookie));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("leaves unrelated routes on the existing rules", async () => {
    // guest /api/tasks still 401s on the generic session gate
    expect((await middleware(req("/api/tasks"))).status).toBe(401);
    // parent passes as before
    expect(
      (await middleware(req("/api/tasks", await parentCookie()))).headers.get("x-middleware-next")
    ).toBe("1");
    // non-API routes untouched
    expect((await middleware(req("/settings"))).headers.get("x-middleware-next")).toBe("1");
  });
});
