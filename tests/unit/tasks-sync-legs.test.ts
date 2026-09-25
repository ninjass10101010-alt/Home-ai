// F2 (continued) — POST /api/tasks/sync shares the same hole: any session
// could overwrite the shared snapshot blob, whose `weekData` leg carries the
// family's weekly points. Non-parent sessions may sync the tasks leg ONLY;
// the weekData/rewards/penalties legs are ignored (not merged) and the
// response says so via `ignoredLegs`. Parent behavior is unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const db = {
  rows: [] as any[],
  updates: [] as any[],
  creates: [] as any[],
};

function makePb() {
  return {
    collection: () => ({
      getFullList: async () => db.rows,
      update: async (id: string, payload: any) => {
        db.updates.push({ id, payload });
        return { id, ...payload };
      },
      create: async (payload: any) => {
        db.creates.push(payload);
        return { id: "new", ...payload };
      },
    }),
  };
}

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn(), authorizeCurrentMemberRequest: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/server-auth", () => ({ authorizeCurrentMemberRequest: mocks.authorizeCurrentMemberRequest }));

import { GET, POST } from "@/app/api/tasks/sync/route";

async function post(body: unknown, role?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    const token = await signSession({ memberId: "m1", name: "Kid", role });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  headers["x-test-current-role"] = role || "";
  const r = new NextRequest("http://x/api/tasks/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST(r);
}

const POISONED = {
  tasks: [{ id: "t1", title: "Dishes" }],
  weekData: { weekStart: "2026-09-14", points: 999, history: [{ type: "earn", points: 999 }] },
  rewards: [{ id: "evil-reward" }],
  penalties: [{ id: "evil-penalty" }],
  rewardsUpdatedAt: "2026-09-15T00:00:00.000Z",
  weeklyPrizes: [{ rank: 1, emoji: "🥇", text: "evil prize" }],
  weeklyPrizesStamp: "2026-09-15T00:00:00.000Z",
};

const EXISTING = {
  tasks: [{ id: "old" }],
  weekData: { weekStart: "2026-09-14", points: 5, history: [] },
  rewards: [{ id: "good-reward" }],
  penalties: [{ id: "good-penalty" }],
  rewardsUpdatedAt: "old-stamp",
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  db.rows = [];
  db.updates = [];
  db.creates = [];
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: any) => fn(makePb()));
  mocks.authorizeCurrentMemberRequest.mockReset();
  mocks.authorizeCurrentMemberRequest.mockImplementation(async (request: Request) => {
    const role = request.headers.get("x-test-current-role");
    if (!role) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, member: { id: "m1", role } };
  });
});

describe("tasks/sync leg gating", () => {
  it("child POST: ignores weekData/rewards/penalties, keeps the stored parent legs", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "child");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      saved: true,
      ignoredLegs: ["weekData", "rewards", "penalties", "weeklyPrizes", "weeklyPrizesStamp"],
    });

    expect(db.updates).toHaveLength(1);
    const stored = db.updates[0].payload.data;
    expect(stored.tasks).toEqual(POISONED.tasks);
    // The parent-owned legs survive verbatim — a kid sync can never move points.
    expect(stored.weekData).toEqual(EXISTING.weekData);
    expect(stored.rewards).toEqual(EXISTING.rewards);
    expect(stored.penalties).toEqual(EXISTING.penalties);
    expect(stored.rewardsUpdatedAt).toBe(EXISTING.rewardsUpdatedAt);
    // Weekly prize legs are not applied from a non-parent body either.
    expect(stored.weeklyPrizes).toBeUndefined();
    expect(stored.weeklyPrizesStamp).toBeUndefined();
  });

  it("pet POST with no prior snapshot stores the tasks leg only", async () => {
    const res = await post(POISONED, "pet");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      saved: true,
      ignoredLegs: ["weekData", "rewards", "penalties", "weeklyPrizes", "weeklyPrizesStamp"],
    });
    expect(db.creates).toHaveLength(1);
    // Non-tasks legs — including weekly prizes — are never written.
    expect(db.creates[0].data).toEqual({ tasks: POISONED.tasks });
  });

  it("parent POST is byte-identical: full body stored verbatim, response unchanged", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "parent");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, saved: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload.data).toEqual(POISONED);
  });

  it("guest POST → 401 unauthorized, PB untouched", async () => {
    const res = await post(POISONED);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("uses the current PB role for the privileged branch", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: true, member: { id: "m1", role: "child" } });
    const child = await post(POISONED, "parent");
    expect(child.status).toBe(200);
    expect(db.updates[0].payload.data.weekData).toEqual(EXISTING.weekData);
  });

  it("returns 401 for a deleted current member and 503 for identity outage", async () => {
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: false, status: 401, error: "unauthorized" });
    expect((await post(POISONED, "parent")).status).toBe(401);
    mocks.authorizeCurrentMemberRequest.mockResolvedValueOnce({ ok: false, status: 503, error: "identity_unavailable" });
    expect((await post(POISONED, "parent")).status).toBe(503);
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("GET returns the snapshot (unchanged)", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, snapshot: { tasks: [{ id: "t1" }] } });
  });
});
