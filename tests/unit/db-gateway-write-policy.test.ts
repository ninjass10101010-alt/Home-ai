// F2 — the /api/db/[collection] gateway was session-gated but not role-gated,
// so any signed-in child or pet could POST/PATCH/DELETE any allowlisted
// collection (week_data points, rewards, penalties, emergency_contacts…).
// The per-collection write policy below is enforced INSIDE the gateway routes
// (middleware is not a substitute for in-route authorization).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn(), authorizeCurrentMemberRequest: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/server-auth", () => ({ authorizeCurrentMemberRequest: mocks.authorizeCurrentMemberRequest }));

import { WRITE_POLICY, canWrite, isValidSort } from "@/lib/db-gateway";
import { POST as createPOST } from "@/app/api/db/[collection]/route";
import { PATCH as patchOne, DELETE as deleteOne } from "@/app/api/db/[collection]/[id]/route";
import { GET as listGET } from "@/app/api/db/[collection]/route";

const SESSION = ["parent", "child", "pet"];
it("parent-only collections reject children and pets", () => {
  for (const c of ["week_data", "rewards", "penalties", "hall_of_fame", "weekly_prizes", "family_goals", "emergency_contacts", "events", "schedules", "meal_plan_entries", "recipes", "meal_week_archive", "chat_messages", "morning_briefing", "proactive_suggestions", "consuela_state", "week_archive"]) {
    expect(WRITE_POLICY[c]).toBe("parent");
    expect(canWrite(c, "parent")).toBe(true);
    expect(canWrite(c, "child")).toBe(false);
    expect(canWrite(c, "pet")).toBe(false);
    expect(canWrite(c, undefined)).toBe(false);
  }
});
it("shared household collections allow any signed-in session", () => {
  for (const c of ["tasks", "grocery_list_items", "pantry_items"]) {
    expect(WRITE_POLICY[c]).toBe("session");
    for (const r of SESSION) expect(canWrite(c, r)).toBe(true);
    expect(canWrite(c, undefined)).toBe(false);
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

async function req(url: string, role: string | undefined, init?: RequestInit): Promise<NextRequest> {
  // Cookies must be present at construction — NextRequest.cookies is parsed
  // from the initial headers; a later headers.set() does not update it.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) || {}) };
  if (role) {
    const token = await signSession({ memberId: "m1", name: "N", role });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  headers["x-test-current-role"] = role || "";
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
    mocks.authorizeCurrentMemberRequest.mockReset();
    mocks.authorizeCurrentMemberRequest.mockImplementation(async (request: Request) => {
      const role = request.headers.get("x-test-current-role");
      if (!role) return { ok: false, status: 401, error: "unauthorized" };
      return { ok: true, member: { id: "m1", role } };
    });
  });

  it("guest POST → 401 unauthorized, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/tasks", undefined, jsonInit("POST", { title: "x" })), ctx("tasks"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("child POST a parent collection → 403 adult_only, PB untouched", async () => {
    const res = await createPOST(await req("http://x/api/db/week_data", "child", jsonInit("POST", { weekStart: "2026-09-14", points: 999 })), ctx("week_data"));
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
    const res = await createPOST(await req("http://x/api/db/tasks", "child", jsonInit("POST", { title: "Dishes" })), ctx("tasks"));
    expect(res.status).toBe(200);
    expect(col.create).toHaveBeenCalled();
  });

  it("parent POST a parent collection → 200", async () => {
    const res = await createPOST(await req("http://x/api/db/week_data", "parent", jsonInit("POST", { weekStart: "2026-09-14", points: 5 })), ctx("week_data"));
    expect(res.status).toBe(200);
    expect(col.create).toHaveBeenCalled();
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
    const p = ctx("tasks", "r1");
    expect((await patchOne(await req("http://x/api/db/tasks/r1", undefined, jsonInit("PATCH", { done: true })), p)).status).toBe(401);
    expect((await deleteOne(await req("http://x/api/db/tasks/r1", undefined), p)).status).toBe(401);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("child PATCH/DELETE a parent collection → 403; a session collection → 200", async () => {
    const parentCtx = ctx("rewards", "r1");
    expect((await patchOne(await req("http://x/api/db/rewards/r1", "child", jsonInit("PATCH", { cost: 1 })), parentCtx)).status).toBe(403);
    expect((await deleteOne(await req("http://x/api/db/rewards/r1", "child"), parentCtx)).status).toBe(403);

    const sessionCtx = ctx("tasks", "r1");
    expect((await patchOne(await req("http://x/api/db/tasks/r1", "child", jsonInit("PATCH", { done: true })), sessionCtx)).status).toBe(200);
    expect((await deleteOne(await req("http://x/api/db/tasks/r1", "child"), sessionCtx)).status).toBe(200);
  });

  it("parent PATCH/DELETE a parent collection → 200", async () => {
    const p = ctx("rewards", "r1");
    expect((await patchOne(await req("http://x/api/db/rewards/r1", "parent", jsonInit("PATCH", { cost: 1 })), p)).status).toBe(200);
    expect((await deleteOne(await req("http://x/api/db/rewards/r1", "parent"), p)).status).toBe(200);
  });

  it("uses the current PB role for every generic write handler", async () => {
    mocks.authorizeCurrentMemberRequest.mockImplementation(async (request: Request) => {
      const role = request.headers.get("x-test-current-role");
      return role ? { ok: true, member: { id: "m1", role } } : { ok: false, status: 401, error: "unauthorized" };
    });
    const parentRequest = await req("http://x/api/db/rewards", "parent", jsonInit("POST", { cost: 1 }));
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: true, member: { id: "m1", role: "child" } });
    expect((await createPOST(parentRequest, ctx("rewards"))).status).toBe(403);

    const childPatch = await req("http://x/api/db/rewards/r1", "parent", jsonInit("PATCH", { cost: 1 }));
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: true, member: { id: "m1", role: "child" } });
    expect((await patchOne(childPatch, ctx("rewards", "r1"))).status).toBe(403);

    const childDelete = await req("http://x/api/db/rewards/r1", "parent");
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: true, member: { id: "m1", role: "child" } });
    expect((await deleteOne(childDelete, ctx("rewards", "r1"))).status).toBe(403);

    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: true, member: { id: "m1", role: "child" } });
    expect((await createPOST(await req("http://x/api/db/tasks", "parent", jsonInit("POST", { title: "x" })), ctx("tasks"))).status).toBe(200);
  });

  it("returns 401 for a deleted current member and 503 for PB identity outage", async () => {
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: false, status: 401, error: "unauthorized" });
    expect((await createPOST(await req("http://x/api/db/tasks", "parent", jsonInit("POST", { title: "x" })), ctx("tasks"))).status).toBe(401);
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: false, status: 503, error: "identity_unavailable" });
    expect((await patchOne(await req("http://x/api/db/tasks/r1", "parent", jsonInit("PATCH", { done: true })), ctx("tasks", "r1"))).status).toBe(503);
    expect(col.create).not.toHaveBeenCalled();
    expect(col.update).not.toHaveBeenCalled();
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
