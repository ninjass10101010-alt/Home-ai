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

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn(), ensureCurrentTaskWeek: vi.fn() }));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

import { GET, POST } from "@/app/api/tasks/sync/route";

async function post(body: unknown, role?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    const token = await signSession({ memberId: "m1", name: "Kid", role });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
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
  penaltiesUpdatedAt: "2026-09-15T00:00:00.000Z",
  weeklyPrizes: [{ rank: 1, emoji: "🥇", text: "evil prize" }],
  weeklyPrizesStamp: "2026-09-15T00:00:00.000Z",
  revision: "999",
  operationReceipts: { evil: [] },
  configOperationReceipts: { evil: {} },
  pendingProjectionRepairs: [{ operationId: "evil", taskIds: [1], createdAt: "2026-09-15T00:00:00.000Z" }],
};

const EXISTING = {
  tasks: [{ id: "old" }],
  weekData: { weekStart: "2026-09-14", points: 5, history: [] },
  rewards: [{ id: "good-reward" }],
  rewardsUpdatedAt: "2026-09-24T10:00:00.000Z",
  penalties: [{ id: "good-penalty" }],
  penaltiesUpdatedAt: "2026-09-24T10:00:00.000Z",
  weeklyPrizes: [{ id: "p1", rank: 1, emoji: "🥇", text: "good prize" }],
  weeklyPrizesStamp: "2026-09-24T10:00:00.000Z",
  revision: "17",
  operationReceipts: {
    canonical: [{
      operationId: "canonical",
      action: "approve",
      taskId: 1,
      createdAt: "2026-09-24T09:00:00.000Z",
    }],
  },
  configOperationReceipts: {
    canonical: {
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T09:00:00.000Z",
      fingerprint: "a".repeat(64),
    },
  },
  pendingProjectionRepairs: [{
    operationId: "canonical-repair",
    taskIds: [2],
    createdAt: "2026-09-24T09:00:00.000Z",
  }],
  taskWeekStart: "2026-09-21",
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  db.rows = [];
  db.updates = [];
  db.creates = [];
  mocks.withAdmin.mockReset();
  mocks.withAdmin.mockImplementation((fn: any) => fn(makePb()));
  mocks.ensureCurrentTaskWeek.mockReset();
  mocks.ensureCurrentTaskWeek.mockResolvedValue({ reconciled: true });
});

describe("tasks/sync leg gating", () => {
  it("child task/week POST is retired without touching PB", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "child");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: "task_snapshot_write_retired" });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("pet task/week POST is retired without touching PB", async () => {
    const res = await post(POISONED, "pet");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: "task_snapshot_write_retired" });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("parent task/week POST is retired without touching PB", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: "task_snapshot_write_retired" });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("config compatibility fields remain accepted but ignored", async () => {
    const res = await post({
      rewards: POISONED.rewards,
      rewardsUpdatedAt: POISONED.rewardsUpdatedAt,
      penalties: POISONED.penalties,
      penaltiesUpdatedAt: POISONED.penaltiesUpdatedAt,
      weeklyPrizes: POISONED.weeklyPrizes,
      weeklyPrizesStamp: POISONED.weeklyPrizesStamp,
    }, "parent");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, saved: false });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("guest POST → 401 unauthorized, PB untouched", async () => {
    const res = await post(POISONED);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("GET returns the snapshot (unchanged)", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, snapshot: { tasks: [{ id: "t1" }] }, reconciled: true });
    expect(mocks.ensureCurrentTaskWeek).toHaveBeenCalledOnce();
  });
});
