// F2 — the /api/db/[collection] gateway was session-gated but not role-gated,
// so any signed-in child or pet could POST/PATCH/DELETE any allowlisted
// collection (week_data points, rewards, penalties, emergency_contacts…).
// The per-collection write policy below is enforced INSIDE the gateway routes
// (middleware is not a substitute for in-route authorization).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";
import type { SessionRole } from "@/lib/session-policy";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn(), requireLiveSession: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));

vi.mock("@/lib/server-auth", () => ({ requireLiveSession: mocks.requireLiveSession }));

import { DB_GATEWAY_COLLECTIONS, WRITE_POLICY, canWrite, writePolicy, isValidSort } from "@/lib/db-gateway";
import { POST as createPOST } from "@/app/api/db/[collection]/route";
import { PATCH as patchOne, DELETE as deleteOne } from "@/app/api/db/[collection]/[id]/route";
import { GET as listGET } from "@/app/api/db/[collection]/route";

const SESSION: readonly SessionRole[] = ["parent", "child", "pet"];
it("parent-only collections reject children and pets", () => {
  for (const c of ["rewards", "penalties", "hall_of_fame", "weekly_prizes", "family_goals", "emergency_contacts", "events", "schedules", "meal_plan_entries", "recipes", "meal_week_archive", "chat_messages", "morning_briefing", "proactive_suggestions", "consuela_state"]) {
    expect(WRITE_POLICY[c]).toBe("parent");
    expect(canWrite(c, "parent")).toBe(true);
    expect(canWrite(c, "child")).toBe(false);
    expect(canWrite(c, "pet")).toBe(false);
    expect(canWrite(c, undefined)).toBe(false);
  }
});
it("shared household collections allow any signed-in session", () => {
  for (const c of ["grocery_list_items", "pantry_items"]) {
    expect(WRITE_POLICY[c]).toBe("session");
    for (const r of SESSION) expect(canWrite(c, r)).toBe(true);
    expect(canWrite(c, undefined)).toBe(false);
  }
});
it("keeps task and ledger collections command-only", () => {
  for (const collection of ["tasks", "week_data", "week_archive"]) {
    expect(WRITE_POLICY[collection]).toBe("command");
    for (const role of ["parent", "child", "pet"] as const) {
      expect(canWrite(collection, role)).toBe(false);
    }
  }
});
it("writePolicy answers the three tiers and undefined for anything unlisted", () => {
  expect(writePolicy("tasks")).toBe("command");
  expect(writePolicy("week_data")).toBe("command");
  expect(writePolicy("week_archive")).toBe("command");
  expect(writePolicy("rewards")).toBe("parent");
  expect(writePolicy("grocery_list_items")).toBe("session");
  expect(writePolicy("pantry_items")).toBe("session");
  expect(writePolicy("members")).toBeUndefined();
  expect(writePolicy("anything_else")).toBeUndefined();
  expect(writePolicy("")).toBeUndefined();
  expect(writePolicy("__proto__")).toBeUndefined();
  expect(writePolicy("constructor")).toBeUndefined();
  expect(writePolicy("toString")).toBeUndefined();
  expect(canWrite("__proto__", "child")).toBe(false);
  expect(canWrite("constructor", "parent")).toBe(false);
});
it("every read-allowlisted collection carries an explicit write policy", () => {
  for (const collection of DB_GATEWAY_COLLECTIONS) {
    expect(["command", "parent", "session"]).toContain(writePolicy(collection));
  }
});
it("unknown collections have no write policy", () => {
  expect(canWrite("members", "parent")).toBe(false);
  expect(canWrite("anything_else", "parent")).toBe(false);
});
it("sort whitelist accepts field lists only", () => {
  expect(isValidSort("-created")).toBe(true);
  expect(isValidSort("points,-updated")).toBe(true);
  expect(isValidSort("@random")).toBe(false);
  expect(isValidSort("created; DROP")).toBe(false);
  expect(isValidSort("a) || b")).toBe(false);
});

// ---------------------------------------------------------------------------
// Route enforcement — the policy must actually gate the handlers, PB untouched
// on a refusal.
// ---------------------------------------------------------------------------

function makeCollectionMocks() {
  return {
    getFullList: vi.fn(async () => [{ id: "r1" }]),
    create: vi.fn(async (row: any, _opts?: unknown) => ({ id: "new1", ...row })),
    getOne: vi.fn(async () => ({ id: "r1" })),
    update: vi.fn(async (id: string, row: any) => ({ id, ...row })),
    delete: vi.fn(async () => ({})),
  };
}
let col = makeCollectionMocks();
const pbOk = { collection: (_name?: string) => col };

async function req(url: string, role: SessionRole | undefined, init?: RequestInit): Promise<NextRequest> {
  // Cookies must be present at construction — NextRequest.cookies is parsed
  // from the initial headers; a later headers.set() does not update it.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) || {}) };
  if (role) {
    const token = await signSession({ memberId: "m1", name: "N", role });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  mocks.requireLiveSession.mockResolvedValue(
    role
      ? { ok: true, identity: { memberId: "m1", name: "N", role } }
      : { ok: false, status: 401, error: "unauthorized" },
  );
  return new NextRequest(url, { ...(init as any), headers }) as NextRequest;
}

function ctx(collection: string, id?: string) {
  return { params: Promise.resolve(id ? { collection, id } : { collection }) } as any;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("db gateway role enforcement", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
    col = makeCollectionMocks();
    mocks.withAdmin.mockReset();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pbOk));
    mocks.requireLiveSession.mockReset();
  });

  it("guest POST → 401 unauthorized, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/grocery_list_items", undefined, jsonInit("POST", { name: "Milk" })), ctx("grocery_list_items"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("child POST a parent collection → 403 adult_only, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/chat_messages", "child", jsonInit("POST", { content: "hi" })), ctx("chat_messages"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("pet POST a parent collection → 403 adult_only", async () => {
    const res = await createPOST(await req("http://x/api/db/rewards", "pet", jsonInit("POST", { text: "tv" })), ctx("rewards"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
  });

  it("child POST a session collection → 200", async () => {
    const res = await createPOST(await req("http://x/api/db/pantry_items", "child", jsonInit("POST", { name: "Rice" })), ctx("pantry_items"));
    expect(res.status).toBe(200);
    expect(col.create).toHaveBeenCalled();
  });

  it("parent POST a parent collection → 200", async () => {
    const res = await createPOST(await req("http://x/api/db/rewards", "parent", jsonInit("POST", { text: "tv" })), ctx("rewards"));
    expect(res.status).toBe(200);
    expect(col.create).toHaveBeenCalled();
  });

  it("a live parent POST to a command collection → 403 command_only, no PB call", async () => {
    const res = await createPOST(await req("http://x/api/db/tasks", "parent", jsonInit("POST", { title: "Dishes" })), ctx("tasks"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "command_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(col.create).not.toHaveBeenCalled();
  });

  it("a command-collection refusal precedes identity resolution and body parsing", async () => {
    const res = await createPOST(
      await req("http://x/api/db/week_archive", "parent", { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" }),
      ctx("week_archive"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "command_only" });
    expect(mocks.requireLiveSession).not.toHaveBeenCalled();
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("every command collection refuses every live role with 403 command_only", async () => {
    for (const collection of ["tasks", "week_data", "week_archive"]) {
      for (const role of ["parent", "child", "pet"] as const) {
        const res = await createPOST(await req(`http://x/api/db/${collection}`, role, jsonInit("POST", { weekStart: "2026-09-14", points: 999 })), ctx(collection));
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("command_only");
      }
    }
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("a guest write to a command collection is still 403 command_only, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/tasks", undefined, jsonInit("POST", { title: "Dishes" })), ctx("tasks"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("command_only");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("a write to an unlisted collection → 404 not_found, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/members", "parent", jsonInit("POST", { name: "Nova" })), ctx("members"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("an inherited object key is not a writable collection", async () => {
    const res = await createPOST(await req("http://x/api/db/__proto__", "parent", jsonInit("POST", { evil: true })), ctx("__proto__"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  // Weekly Prize Race — weekly_prizes mirrors rewards/penalties (parent-managed
  // catalog): a child/pet/guest write must 403/401 without touching PB, a
  // parent write must pass.
  it("weekly_prizes: child POST → 403 adult_only, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/weekly_prizes", "child", jsonInit("POST", { rank: 1, emoji: "🏆", text: "Movie night" })), ctx("weekly_prizes"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("adult_only");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("weekly_prizes: parent POST/PATCH → 200", async () => {
    const res = await createPOST(await req("http://x/api/db/weekly_prizes", "parent", jsonInit("POST", { rank: 1, emoji: "🏆", text: "Movie night" })), ctx("weekly_prizes"));
    expect(res.status).toBe(200);
    expect(col.create).toHaveBeenCalled();
    const p = ctx("weekly_prizes", "r1");
    expect((await patchOne(await req("http://x/api/db/weekly_prizes/r1", "parent", jsonInit("PATCH", { text: "Pizza night" })), p)).status).toBe(200);
  });

  it("guest PATCH/DELETE → 401, PB untouched", async () => {
    const p = ctx("pantry_items", "r1");
    expect((await patchOne(await req("http://x/api/db/pantry_items/r1", undefined, jsonInit("PATCH", { qty: 2 })), p)).status).toBe(401);
    expect((await deleteOne(await req("http://x/api/db/pantry_items/r1", undefined), p)).status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("child PATCH/DELETE a parent collection → 403; a session collection → 200", async () => {
    const parentCtx = ctx("rewards", "r1");
    expect((await patchOne(await req("http://x/api/db/rewards/r1", "child", jsonInit("PATCH", { cost: 1 })), parentCtx)).status).toBe(403);
    expect((await deleteOne(await req("http://x/api/db/rewards/r1", "child"), parentCtx)).status).toBe(403);

    const sessionCtx = ctx("grocery_list_items", "r1");
    expect((await patchOne(await req("http://x/api/db/grocery_list_items/r1", "child", jsonInit("PATCH", { needed: false })), sessionCtx)).status).toBe(200);
    expect((await deleteOne(await req("http://x/api/db/grocery_list_items/r1", "child"), sessionCtx)).status).toBe(200);
  });

  it("parent PATCH/DELETE a parent collection → 200", async () => {
    const p = ctx("rewards", "r1");
    expect((await patchOne(await req("http://x/api/db/rewards/r1", "parent", jsonInit("PATCH", { cost: 1 })), p)).status).toBe(200);
    expect((await deleteOne(await req("http://x/api/db/rewards/r1", "parent"), p)).status).toBe(200);
  });

  it("a command collection refuses PATCH and DELETE for every live role, PB untouched", async () => {
    for (const collection of ["tasks", "week_data", "week_archive"]) {
      const p = ctx(collection, "r1");
      for (const role of ["parent", "child", "pet"] as const) {
        const patch = await patchOne(await req(`http://x/api/db/${collection}/r1`, role, jsonInit("PATCH", { points: 999 })), p);
        expect(patch.status).toBe(403);
        expect(await patch.json()).toEqual({ error: "command_only" });
        const remove = await deleteOne(await req(`http://x/api/db/${collection}/r1`, role), p);
        expect(remove.status).toBe(403);
        expect(await remove.json()).toEqual({ error: "command_only" });
      }
    }
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(col.update).not.toHaveBeenCalled();
    expect(col.delete).not.toHaveBeenCalled();
  });

  it("a command-collection DELETE is refused without needing a body", async () => {
    const p = ctx("tasks", "r1");
    const res = await deleteOne(await req("http://x/api/db/tasks/r1", "parent"), p);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "command_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("GET rejects a non-field sort with 400 invalid_sort, PB untouched", async () => {
    const res = await listGET(await req("http://x/api/db/tasks?sort=@random", "parent"), ctx("tasks"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_sort");
    expect(col.getFullList).not.toHaveBeenCalled();
  });

  it("GET passes a whitelisted sort through", async () => {
    const res = await listGET(await req("http://x/api/db/tasks?sort=points,-updated", "parent"), ctx("tasks"));
    expect(res.status).toBe(200);
    expect(col.getFullList).toHaveBeenCalledWith(expect.objectContaining({ sort: "points,-updated" }));
  });
});
