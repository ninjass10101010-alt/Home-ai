// C — the middleware adult-only gate (the whole Ledger proxy + /memory) must
// re-read the LIVE PocketBase identity, not the cookie's role claim.
//
// The cookie is an HMAC-signed 7-day claim with NO revocation: a parent demoted
// to child kept the entire finance surface — the proxied app, its `/assets/*`
// bundles, `/api/data/*` and `/api/ofx/*` — until the cookie expired. The gate
// is a PARENT ALLOWLIST on the live role now, so a demotion takes effect on the
// next request and a PocketBase outage fails CLOSED (an unverifiable identity is
// never treated as a parent).
//
// Sibling idiom: `requireLiveSession(request, { requireRole: "parent" })` — the
// same helper /api/admin/*, /api/consuela/planner/apply and the chat planner use.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { middleware, config } from "@/middleware";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const PARENT = { id: "m1", name: "Rebecca", role: "parent" };
const DEMOTED = { id: "m1", name: "Rebecca", role: "child" };

function serveLiveRows(rows: Record<string, any>[], opts: { outage?: boolean } = {}) {
  mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => {
    if (opts.outage) throw new Error("PB unreachable");
    return fn({
      collection: () => ({
        getOne: async (id: string) => {
          const row = rows.find((r) => String(r.id) === String(id));
          if (!row) throw Object.assign(new Error("not found"), { status: 404 });
          return { ...row };
        },
      }),
    });
  });
}

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

async function parentCookie(role = "parent") {
  return `${SESSION_COOKIE}=${await signSession({ memberId: PARENT.id, name: PARENT.name, role })}`;
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  serveLiveRows([PARENT]);
});
afterEach(() => vi.unstubAllEnvs());

describe("middleware runs where the live-identity read can work", () => {
  it("is pinned to the Node.js runtime (the live PocketBase read is not edge-safe)", () => {
    // `requireLiveSession` reaches node:crypto + the PocketBase SDK; the edge
    // runtime cannot run it. Dropping this pin breaks the BUILD, not a test.
    expect((config as Record<string, unknown>).runtime).toBe("nodejs");
  });
});

describe("C — Ledger proxy + /memory follow the LIVE role", () => {
  it("lets a live parent through", async () => {
    for (const path of ["/ledger", "/ledger-app/", "/assets/index-x.css", "/api/data/dashboard", "/memory"]) {
      const res = await middleware(req(path, await parentCookie()));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("revokes a demoted parent: the cookie claim is not a live parent", async () => {
    serveLiveRows([DEMOTED]);
    const cookie = await parentCookie();
    // The page path bounces to Home exactly as it does for a child…
    expect((await middleware(req("/ledger", cookie))).status).toBe(307);
    expect((await middleware(req("/memory", cookie))).status).toBe(307);
    // …and every machine path is a flat 403, never a redirect.
    for (const path of ["/ledger-app/", "/assets/index-x.css", "/api/data/dashboard", "/api/ofx/discover/preview"]) {
      expect((await middleware(req(path, cookie))).status, path).toBe(403);
    }
  });

  it("reports an honest refusal reason on the data API for a demoted parent", async () => {
    serveLiveRows([DEMOTED]);
    const res = await middleware(req("/api/data/dashboard", await parentCookie()));
    // `session_role_changed`: the live row no longer says what the cookie
    // claims. Same reason the sibling privileged routes return.
    expect((await res.json()).error).toBe("session_role_changed");
  });

  it("still reports adult_only for a live non-parent (child/pet) cookie", async () => {
    serveLiveRows([{ id: "m2", name: "Rocco", role: "pet" }]);
    const cookie = `${SESSION_COOKIE}=${await signSession({ memberId: "m2", name: "Rocco", role: "pet" })}`;
    const res = await middleware(req("/api/data/dashboard", cookie));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
  });

  it("refuses a parent cookie whose live row is gone", async () => {
    serveLiveRows([]);
    const res = await middleware(req("/api/data/dashboard", await parentCookie()));
    expect(res.status).toBe(403);
  });

  it("fails CLOSED on a PocketBase outage — never treats 'unverified' as parent", async () => {
    serveLiveRows([], { outage: true });
    const cookie = await parentCookie();
    for (const path of ["/api/data/dashboard", "/assets/index-x.css", "/ledger-app/"]) {
      expect((await middleware(req(path, cookie))).status, path).not.toBe(200);
    }
    // And it says so honestly rather than implying the parent lost access.
    expect((await middleware(req("/api/data/dashboard", cookie))).status).toBe(503);
    expect((await middleware(req("/ledger", cookie))).status).toBe(307);
  });

  it("a non-adult cookie cannot be upgraded by a live row that drifted the other way", async () => {
    // A child cookie whose live row says parent: the sibling helper refuses a
    // role that no longer matches the signed claim (session_role_changed), so
    // a tampered/stale cookie never gains the ledger.
    const childCookie = `${SESSION_COOKIE}=${await signSession({ memberId: PARENT.id, name: PARENT.name, role: "child" })}`;
    const res = await middleware(req("/api/data/dashboard", childCookie));
    expect(res.status).toBe(403);
  });
});
