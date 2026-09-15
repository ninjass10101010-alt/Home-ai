// @vitest-environment node
//
// MUSE tools + tool execution routes (Task 9 / B3), plus the fold-in from
// Task 8's review: every /api/muse/* route that handles family data must
// self-gate under the broad middleware exemption. A future route that forgets
// its gate (or a new unclassified route file) fails this suite.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  readMuseRow: vi.fn(),
  touchMuseUsage: vi.fn().mockResolvedValue(undefined),
  writeMuseLog: vi.fn().mockResolvedValue(undefined),
}));

const rows: Record<string, any[]> = {};

vi.mock("@/lib/muse/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/muse/store")>();
  return {
    ...actual,
    readMuseRow: mocks.readMuseRow,
    touchMuseUsage: mocks.touchMuseUsage,
  };
});
vi.mock("@/lib/muse/log", () => ({ writeMuseLog: mocks.writeMuseLog }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () => rows[name] ?? [],
        getFirstListItem: async () => {
          throw new Error("404");
        },
        create: async (d: any) => ({ id: "new", ...d }),
        update: async (_id: string, d: any) => ({ id: _id, ...d }),
        delete: async () => true,
      }),
    })
  ),
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => [],
    selectPendingTasks: () => [],
    selectTodaysSchedulesRaw: () => [],
    selectMeals: async () => [],
    selectPantry: async () => [],
    selectGrocery: async () => [],
    selectMembers: () => [],
    selectRecipes: () => [],
  },
}));

import { GET as toolsGET } from "@/app/api/muse/tools/route";
import { POST as toolPOST } from "@/app/api/muse/tool/route";
import { GET as whoamiGET } from "@/app/api/muse/whoami/route";
import { ADMIN_TOOLS } from "@/lib/muse/execute";
import { signMuseToken } from "@/lib/muse/token";
import { generateKey } from "@/lib/muse/store";
import { __resetMuseLimits } from "@/lib/muse/ratelimit";

const SECRET = "test-secret-0123456789";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  __resetMuseLimits();
  mocks.readMuseRow.mockReset();
  mocks.touchMuseUsage.mockReset();
  mocks.touchMuseUsage.mockResolvedValue(undefined);
  mocks.writeMuseLog.mockReset();
  mocks.writeMuseLog.mockResolvedValue(undefined);
  for (const k of Object.keys(rows)) delete rows[k];
});

afterEach(() => vi.unstubAllEnvs());

/** Install a mock MUSE row AND register it on the store mock; returns it. */
function makeRow(overrides: Record<string, unknown> = {}) {
  const g = generateKey();
  const row = {
    id: "muse1",
    keyHash: g.keyHash,
    keyPrefix: g.keyPrefix,
    version: 1,
    enabled: true,
    adminEnabled: false,
    rateLimitPerMin: 120,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as any;
  mocks.readMuseRow.mockResolvedValue(row);
  return row;
}

function museReq(
  pathname: string,
  opts: { token?: string; method?: string; body?: unknown; ip?: string } = {}
) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "1.2.3.4" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: opts.method ?? "GET",
    headers,
  };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new NextRequest(`http://localhost${pathname}`, init);
}

describe("GET /api/muse/tools", () => {
  it("401s without a bearer token", async () => {
    makeRow();
    const res = await toolsGET(museReq("/api/muse/tools"));
    expect(res.status).toBe(401);
  });

  it("200s with a token and omits admin tools for a non-admin caller", async () => {
    makeRow({ adminEnabled: false });
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await toolsGET(museReq("/api/muse/tools", { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    const names = new Set<string>(body.tools.map((t: any) => t.function.name));
    for (const n of ADMIN_TOOLS) expect(names.has(n)).toBe(false);
  });

  it("includes admin tools for an admin token (admin delta respected)", async () => {
    makeRow({ adminEnabled: true });
    const { token } = signMuseToken({ ver: 1, adm: true });
    const res = await toolsGET(museReq("/api/muse/tools", { token }));
    const body = await res.json();
    const names = new Set<string>(body.tools.map((t: any) => t.function.name));
    for (const n of ADMIN_TOOLS) expect(names.has(n)).toBe(true);
  });
});

describe("POST /api/muse/tool", () => {
  it("401s without a bearer token", async () => {
    makeRow();
    const res = await toolPOST(
      museReq("/api/muse/tool", { method: "POST", body: { name: "get_weather", args: {} } })
    );
    expect(res.status).toBe(401);
  });

  it("400s invalid_body on malformed payloads", async () => {
    makeRow();
    const { token } = signMuseToken({ ver: 1, adm: false });
    for (const body of [
      {},
      { name: 1 },
      { name: "" },
      { name: "get_weather", args: [] },
      { name: "get_weather", args: null },
      "not json",
    ]) {
      const res = await toolPOST(museReq("/api/muse/tool", { token, method: "POST", body }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
  });

  it("400s payload_too_large on an oversized body", async () => {
    makeRow();
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await toolPOST(
      museReq("/api/muse/tool", {
        token,
        method: "POST",
        body: { name: "get_family_members", args: { q: "x".repeat(20_000) } },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("payload_too_large");
  });

  it("403s an admin tool for a non-admin token and audits ok:false", async () => {
    makeRow({ adminEnabled: false });
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await toolPOST(
      museReq("/api/muse/tool", {
        token,
        method: "POST",
        body: { name: "trigger_update", args: {} },
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "tool not allowed" });
    expect(mocks.writeMuseLog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool",
        tool: "trigger_update",
        ok: false,
        tokenAdmin: false,
      })
    );
  });

  it("200s a read tool with a parsed result and a redacted audit preview", async () => {
    rows.members = [
      { id: "m1", name: "Rebecca", fullName: "Rebecca G", role: "parent", emoji: "🐱" },
    ];
    const row = makeRow({ adminEnabled: false });
    const { token } = signMuseToken({ ver: 1, adm: false });
    const res = await toolPOST(
      museReq("/api/muse/tool", {
        token,
        method: "POST",
        body: { name: "get_family_members", args: { pin: "1234" } },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result).toBeTypeOf("object");

    expect(mocks.writeMuseLog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool",
        tool: "get_family_members",
        ok: true,
        tokenAdmin: false,
        keyPrefix: row.keyPrefix,
      })
    );
    const logged = JSON.stringify(mocks.writeMuseLog.mock.calls);
    expect(logged).not.toContain("1234");
    expect(logged).toContain("[redacted]");
  });
});

// Fold-in (Task 8 review): the middleware exempts the whole `/api/muse/`
// prefix, so each route must self-gate. Family-data routes 401 without a
// bearer; the route inventory is pinned so a newly added route must be
// explicitly classified (and gated) before this suite goes green again.
describe("muse route self-gating under the middleware exemption", () => {
  it("family-data routes 401 without a bearer token", async () => {
    makeRow();
    const toolsRes = await toolsGET(museReq("/api/muse/tools"));
    const toolRes = await toolPOST(
      museReq("/api/muse/tool", { method: "POST", body: { name: "get_weather", args: {} } })
    );
    const whoamiRes = await whoamiGET(museReq("/api/muse/whoami"));
    expect(toolsRes.status).toBe(401);
    expect(toolRes.status).toBe(401);
    expect(whoamiRes.status).toBe(401);
  });

  it("has an explicitly classified route inventory", () => {
    const root = path.join(process.cwd(), "src/app/api/muse");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts")
          found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    };
    walk(root);
    // login/logout self-authenticate; tools/tool/whoami assert a MUSE bearer.
    // Task 10 (context/docs) and Task 11 (settings/log) MUST extend this list.
    expect(new Set(found)).toEqual(
      new Set([
        "auth/login/route.ts",
        "auth/logout/route.ts",
        "tools/route.ts",
        "tool/route.ts",
        "whoami/route.ts",
      ])
    );
  });
});
