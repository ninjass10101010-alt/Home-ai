// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pb", () => ({
  getPB: vi.fn(() => { throw new Error("direct PB access is forbidden"); }),
  getAdminPB: vi.fn(() => { throw new Error("direct PB access is forbidden"); }),
}));

vi.mock("@/lib/pb-auth", () => ({
  ensureAuth: vi.fn(async () => { throw new Error("ensureAuth must not run"); }),
  withAdmin: vi.fn(async () => { throw new Error("withAdmin must not run"); }),
}));

vi.mock("@/db/pb-db", () => ({ db: {} }));

let membersResponse: { ok: boolean; members: unknown[] } = { ok: true, members: [] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  membersResponse = { ok: true, members: [] };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/members/admin")) {
      return {
        ok: membersResponse.ok,
        status: membersResponse.ok ? 200 : 500,
        json: async () => ({ members: membersResponse.members }),
      };
    }
    if (url.includes("/api/tasks/sync")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: null }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadDb() {
  const dbModule = await import("@/db/index");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dbModule.db;
}

describe("db.refreshMembersCache", () => {
  it("returns true only after replacing the roster and dispatching the update event", async () => {
    const db = await loadDb();
    let updates = 0;
    window.addEventListener("consuela-members-updated", () => { updates += 1; });
    membersResponse = {
      ok: true,
      members: [{ name: "Fresh Parent", role: "parent", emoji: "👩", age: 40, joined: "Sep 2026" }],
    };

    await expect(db.refreshMembersCache()).resolves.toBe(true);

    expect(updates).toBe(1);
    expect(db.selectMembersDetailed().some((member) => member.name === "Fresh Parent")).toBe(true);
  });

  it("preserves live PB IDs without promoting fallback ordinal IDs", async () => {
    const db = await loadDb();
    membersResponse = {
      ok: true,
      members: [{ id: "pb_live_123", name: "Live Parent", role: "parent", emoji: "👩", age: 40, joined: "Sep 2026" }],
    };
    await db.refreshMembersCache();
    const live = db.selectMembersDetailed().find((member) => member.name === "Live Parent");
    expect((live as any)?.pbId).toBe("pb_live_123");

    membersResponse = { ok: true, members: [] };
    await db.refreshMembersCache();
    expect(db.selectMembersDetailed().find((member) => member.name === "Rebecca (Mom)")).not.toHaveProperty("pbId");
  });

  it("returns false and preserves the prior roster when the refresh request fails", async () => {
    membersResponse = {
      ok: true,
      members: [{ name: "Cached Parent", role: "parent", emoji: "👩", age: 40, joined: "Sep 2026" }],
    };
    const db = await loadDb();
    let updates = 0;
    window.addEventListener("consuela-members-updated", () => { updates += 1; });
    membersResponse = { ok: false, members: [] };

    await expect(db.refreshMembersCache()).resolves.toBe(false);

    expect(updates).toBe(0);
    expect(db.selectMembersDetailed().some((member) => member.name === "Cached Parent")).toBe(true);
  });
});
