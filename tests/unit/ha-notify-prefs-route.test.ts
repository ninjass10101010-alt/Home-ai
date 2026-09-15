import { describe, it, expect, vi } from "vitest";

// Shared, mutable PB handle the mocked withAdmin hands to the route callback.
let currentHandle: unknown = null;
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: unknown) => Promise<unknown>) => fn(currentHandle),
}));

// F4 — POST is parent-gated. This suite covers storage behavior, so the gate
// is stubbed open; the role matrix lives in tests/unit/ha-role-gate.test.ts.
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminRequest: vi.fn(async () => ({ ok: true })),
}));

import { GET, POST } from "@/app/api/ha/notify-prefs/route";

function pbWith(rows: Array<{ key: string; enabled: boolean }>) {
  currentHandle = {
    collection: () => ({
      getFullList: async () => rows,
      getFirstListItem: async (f: string) => {
        const m = /key="([^"]+)"/.exec(f);
        const hit = rows.find((r) => r.key === m?.[1]);
        if (!hit) throw { status: 404 };
        return { id: `id-${hit.key}`, ...hit };
      },
      create: mocks.create,
      update: mocks.update,
    }),
  };
}
function postReq(body: unknown) {
  return new Request("http://localhost/api/ha/notify-prefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/ha/notify-prefs", () => {
  it("returns defaults for missing rows", async () => {
    pbWith([]);
    const body = await (await GET()).json();
    expect(body).toEqual({ ok: true, prefs: { briefing: false, weather: false, calendar: false } });
  });
  it("reflects stored enabled flags", async () => {
    pbWith([{ key: "weather", enabled: true }]);
    const body = await (await GET()).json();
    expect(body.prefs.weather).toBe(true);
  });
});

describe("POST /api/ha/notify-prefs", () => {
  it("creates a missing pref row", async () => {
    mocks.create.mockReset();
    pbWith([]);
    const res = await POST(postReq({ key: "weather", enabled: true }));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ key: "weather", enabled: true });
  });
  it("updates an existing pref row", async () => {
    mocks.update.mockReset();
    pbWith([{ key: "briefing", enabled: false }]);
    await POST(postReq({ key: "briefing", enabled: true }));
    expect(mocks.update).toHaveBeenCalledWith("id-briefing", { key: "briefing", enabled: true });
  });
  it("rejects an unknown key with 400", async () => {
    pbWith([]);
    const res = await POST(postReq({ key: "nonsense", enabled: true }));
    expect(res.status).toBe(400);
  });
  it("rejects a non-boolean enabled with 400", async () => {
    pbWith([]);
    const res = await POST(postReq({ key: "weather", enabled: "yes" }));
    expect(res.status).toBe(400);
  });
});
