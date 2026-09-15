/**
 * F8e — middleware-level proof of the recipes split: a guest can search the
 * public catalog but cannot reach the ingest scrape without a session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { signSession, SESSION_COOKIE } from "@/lib/session";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("middleware recipes split (F8e)", () => {
  it("lets a guest reach /api/recipes/search", async () => {
    const res = await middleware(req("/api/recipes/search"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("401s a guest on /api/recipes/ingest", async () => {
    const res = await middleware(req("/api/recipes/ingest"));
    expect(res?.status ?? 0).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("lets a signed-in session through to /api/recipes/ingest", async () => {
    const token = await signSession({ memberId: "m1", name: "R", role: "parent" });
    const res = await middleware(req("/api/recipes/ingest", `${SESSION_COOKIE}=${token}`));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
