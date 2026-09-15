// @vitest-environment node
//
// MUSE settings + rotation + audit read (Task 11 / B5). All five handlers are
// adult-gated via authorizeAdminRequest (child/pet → 403 adult_only, guest →
// 401). The real store runs against a stateful @/lib/pb-auth mock, so rotation
// and revocation are exercised end-to-end (a pre-rotation token really dies).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const pbState = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, seq: 0 }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: any) => {
    const db = {
      collection: (name: string) => {
        if (!pbState.rows[name]) pbState.rows[name] = [];
        const list = pbState.rows[name];
        return {
          getFullList: async (opts: any = {}) => {
            const copy = [...list];
            const sort = String(opts?.sort || "");
            if (sort.startsWith("-")) {
              const k = sort.slice(1);
              copy.sort((a, b) => String(b?.[k] ?? "").localeCompare(String(a?.[k] ?? "")));
            } else if (sort) {
              copy.sort((a, b) => String(a?.[sort] ?? "").localeCompare(String(b?.[sort] ?? "")));
            }
            return copy;
          },
          getFirstListItem: async () => {
            throw new Error("404");
          },
          create: async (d: any) => {
            const rec = { id: `rec${++pbState.seq}`, created: d.createdAt || new Date().toISOString(), ...d };
            list.push(rec);
            return rec;
          },
          update: async (id: string, d: any) => {
            const rec = list.find((r) => r.id === id);
            if (!rec) throw new Error("404");
            Object.assign(rec, d);
            return rec;
          },
          delete: async (id: string) => {
            const i = list.findIndex((r) => r.id === id);
            if (i >= 0) list.splice(i, 1);
            return true;
          },
        };
      },
    };
    return fn(db);
  },
}));

const mocks = vi.hoisted(() => ({ verifyPin: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({
  verifyPinAgainstAnyMember: (...args: any[]) => mocks.verifyPin(...args),
}));

import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/muse/settings/route";
import { POST as rotatePOST } from "@/app/api/muse/settings/rotate/route";
import { POST as revokePOST } from "@/app/api/muse/settings/revoke-tokens/route";
import { GET as logGET } from "@/app/api/muse/log/route";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import { signMuseToken, verifyMuseToken } from "@/lib/muse/token";
import { generateKey, readMuseRow, hashMuseKey } from "@/lib/muse/store";
import { __resetMuseLimits } from "@/lib/muse/ratelimit";

const SECRET = "test-secret-0123456789";
const PIN = "1234";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  __resetMuseLimits();
  for (const k of Object.keys(pbState.rows)) delete pbState.rows[k];
  mocks.verifyPin.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

function seedRow(overrides: Record<string, unknown> = {}) {
  const g = generateKey();
  const row = {
    id: "muse1",
    created: "2026-01-01T00:00:00.000Z",
    keyHash: g.keyHash,
    keyPrefix: g.keyPrefix,
    version: 1,
    enabled: true,
    adminEnabled: false,
    rateLimitPerMin: 120,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  pbState.rows.consuela_muse = [row];
  return { row, key: g.key };
}

function adminReq(method: string, body?: unknown, pin?: string) {
  const headers: Record<string, string> = {};
  if (pin) headers["x-admin-pin"] = pin;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new NextRequest("http://localhost/api/muse/settings", init);
}

function bearerReq(token: string) {
  return new NextRequest("http://localhost/api/muse/context", {
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "1.2.3.4" },
  });
}

// --- Gate matrix -----------------------------------------------------------

const HANDLERS: Array<{ name: string; call: (req: NextRequest) => Promise<Response> }> = [
  { name: "GET /settings", call: (req) => settingsGET(req) },
  { name: "PUT /settings", call: (req) => settingsPUT(req) },
  { name: "POST /settings/rotate", call: (req) => rotatePOST(req) },
  { name: "POST /settings/revoke-tokens", call: (req) => revokePOST(req) },
  { name: "GET /log", call: (req) => logGET(req) },
];

const ROLES: Array<{ role: string | null; ok: boolean; status: number }> = [
  { role: null, ok: false, status: 401 }, // guest
  { role: "child", ok: false, status: 403 },
  { role: "pet", ok: false, status: 403 },
  { role: "parent", ok: true, status: 200 },
];

describe("muse settings/log gate matrix (adult allowlist)", () => {
  for (const handler of HANDLERS) {
    for (const { role, ok, status } of ROLES) {
      const label = role ?? "guest";
      it(`${handler.name} → ${label} ${status}`, async () => {
        if (role) mocks.verifyPin.mockResolvedValue({ name: "T", role });
        // GET/PUT/POST bodies: PUT needs a valid body for the parent path.
        const body = handler.name.startsWith("PUT") && ok ? { enabled: true } : undefined;
        const res = await handler.call(adminReq(handler.name.startsWith("PUT") ? "PUT" : handler.name.startsWith("POST") ? "POST" : "GET", body, role ? PIN : undefined));
        expect(res.status).toBe(status);
        const json = await res.json();
        if (!ok) expect(json.ok).toBe(false);
        else expect(json.ok).toBe(true);
      });
    }
  }

  it("child gets the adult_only error body", async () => {
    mocks.verifyPin.mockResolvedValue({ name: "Kid", role: "child" });
    const res = await settingsGET(adminReq("GET", undefined, PIN));
    expect(await res.json()).toEqual({ ok: false, error: "adult_only" });
  });
});

// --- GET defaults + PUT -----------------------------------------------------

describe("GET/PUT /api/muse/settings", () => {
  it("GET returns a default envelope before any row exists", async () => {
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });
    const res = await settingsGET(adminReq("GET", undefined, PIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      enabled: false,
      adminEnabled: false,
      hasKey: false,
      rateLimitPerMin: 120,
      version: 0,
    });
  });

  it("PUT toggles settings, clamps the rate, and returns the full GET shape", async () => {
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });
    const put = await settingsPUT(
      adminReq("PUT", { enabled: true, adminEnabled: true, rateLimitPerMin: 5 }, PIN)
    );
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body).toMatchObject({
      ok: true,
      enabled: true,
      adminEnabled: true,
      hasKey: true,
      rateLimitPerMin: 10, // clamped up to MIN_RATE
      version: 1,
    });
    expect(typeof body.keyPrefix).toBe("string");

    const get = await settingsGET(adminReq("GET", undefined, PIN));
    expect(await get.json()).toMatchObject({ enabled: true, adminEnabled: true, rateLimitPerMin: 10 });
  });

  it("PUT rejects a non-object body", async () => {
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });
    const res = await settingsPUT(adminReq("PUT", { enabled: "yes" }, PIN));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });
});

// --- Rotation / revocation --------------------------------------------------

describe("rotation + token revocation", () => {
  it("rotate returns a muse_ key exactly once and kills a live pre-rotation token", async () => {
    seedRow();
    const { token: preToken } = signMuseToken({ ver: 1, adm: false });
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });

    const res = await rotatePOST(adminReq("POST", undefined, PIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key.startsWith("muse_")).toBe(true);
    expect(body.version).toBe(2);
    expect(body.keyPrefix).toBe(body.key.slice(0, 8));
    // The plaintext key appears EXACTLY once in the response.
    expect(JSON.stringify(body).split(body.key).length - 1).toBe(1);
    // Only the hash is stored.
    const stored = await readMuseRow();
    expect(stored?.keyHash).toBe(hashMuseKey(body.key));
    expect(JSON.stringify(stored)).not.toContain(body.key);

    // The pre-rotation token is now revoked.
    expect(verifyMuseToken(preToken, { currentVersion: 2, enabled: true })).toEqual({
      ok: false,
      reason: "revoked",
    });
    const auth = await authorizeMuseRequest(bearerReq(preToken));
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(401);
  });

  it("revoke-tokens invalidates live tokens WITHOUT changing keyPrefix", async () => {
    const { row } = seedRow();
    const { token: preToken } = signMuseToken({ ver: 1, adm: false });
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });

    const res = await revokePOST(adminReq("POST", undefined, PIN));
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);

    const stored = await readMuseRow();
    expect(stored?.keyPrefix).toBe(row.keyPrefix);
    expect(stored?.version).toBe(2);

    const auth = await authorizeMuseRequest(bearerReq(preToken));
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(401);
  });
});

// --- Audit read -------------------------------------------------------------

describe("GET /api/muse/log", () => {
  function seedLog(count: number) {
    pbState.rows.consuela_muse_log = Array.from({ length: count }, (_, i) => ({
      id: `log${i}`,
      kind: "tool",
      ok: true,
      tool: `tool_${i}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
  }

  it("returns the newest 20 by default", async () => {
    seedLog(25);
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });
    const res = await logGET(adminReq("GET", undefined, PIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entries).toHaveLength(20);
    // Newest-first ordering.
    const ats = body.entries.map((e: any) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(body.entries[0].tool).toBe("tool_24");
  });

  it("clamps ?limit into 1..100", async () => {
    seedLog(120);
    mocks.verifyPin.mockResolvedValue({ name: "T", role: "parent" });
    const high = await logGET(new NextRequest(`http://localhost/api/muse/log?limit=500`, { headers: { "x-admin-pin": PIN } }));
    expect((await high.json()).entries).toHaveLength(100);
    const low = await logGET(new NextRequest(`http://localhost/api/muse/log?limit=0`, { headers: { "x-admin-pin": PIN } }));
    expect((await low.json()).entries).toHaveLength(1);
    const five = await logGET(new NextRequest(`http://localhost/api/muse/log?limit=5`, { headers: { "x-admin-pin": PIN } }));
    expect((await five.json()).entries).toHaveLength(5);
  });
});
