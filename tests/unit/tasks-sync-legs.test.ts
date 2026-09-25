// F2 (continued) + Task 11 — POST /api/tasks/sync used to let any session
// overwrite the shared snapshot blob. Every browser snapshot write is retired:
// `tasks`/`weekData` → 410 LEGACY_SYNC_WRITE_ERROR, malformed JSON → 400
// `invalid_body`, and any other valid object → 400 `invalid_body` too. The
// handler itself is write-free: no rejection reaches the snapshot store. The
// live identity read the route's session gate performs is the ONLY PocketBase
// access on this path, and requireLiveSession is stubbed here, so
// `withAdmin` stays untouched — the property under test is the handler's.
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

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  reconcileTaskProjectionLocked: vi.fn(),
  requireLiveSession: vi.fn(),
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/server-auth", () => ({ requireLiveSession: mocks.requireLiveSession }));
vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));
vi.mock("@/lib/task-projection-reconciler", () => ({
  reconcileTaskProjectionLocked: mocks.reconcileTaskProjectionLocked,
}));

import { GET, LEGACY_SYNC_WRITE_ERROR, POST } from "@/app/api/tasks/sync/route";

async function post(body: unknown, role?: string) {
  return postRaw(JSON.stringify(body), role);
}

async function postRaw(rawBody: string, role?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    const token = await signSession({ memberId: "m1", name: "Kid", role });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  const r = new NextRequest("http://x/api/tasks/sync", {
    method: "POST",
    headers,
    body: rawBody,
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
  mocks.reconcileTaskProjectionLocked.mockReset();
  mocks.requireLiveSession.mockReset();
  mocks.requireLiveSession.mockImplementation(async (request: Request) => {
    const { verifySession } = await import("@/lib/session");
    const token = request.headers.get("cookie")?.match(/consuela_session=([^;]+)/)?.[1];
    const signed = await verifySession(token);
    if (!signed) return { ok: false as const, status: 401 as const, error: "unauthorized" as const };
    return {
      ok: true as const,
      identity: { memberId: signed.memberId, name: signed.name, role: signed.role },
    };
  });
  mocks.ensureCurrentTaskWeek.mockResolvedValue({
    reconciled: true,
    weekStart: "2026-09-21",
    revision: { revision: "1", updatedAt: "" },
    currentWeekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
  });
  mocks.reconcileTaskProjectionLocked.mockResolvedValue({
    ok: true,
    reconciled: true,
    repaired: [],
    failed: [],
    weekData: null,
  });
});

describe("tasks/sync leg gating", () => {
  it("child task/week POST is retired without touching the snapshot store", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "child");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("pet task/week POST is retired without touching the snapshot store", async () => {
    const res = await post(POISONED, "pet");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("parent task/week POST is retired without touching the snapshot store", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a tasks-only body is 410 before any snapshot read or partial import", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ tasks: [{ id: 42, title: "Forged" }] }, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a weekData-only body is 410 before any snapshot read or partial import", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ weekData: { points: { Alex: 9999 } } }, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("malformed sync JSON is 400 invalid_body with zero snapshot access", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await postRaw("not-json", "parent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a valid non-task body is 400 invalid_body — this route is not a migration endpoint", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ rewards: [] }, "parent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("the config compatibility legs are refused exactly like any other non-task body", async () => {
    const res = await post({
      rewards: POISONED.rewards,
      rewardsUpdatedAt: POISONED.rewardsUpdatedAt,
      penalties: POISONED.penalties,
      penaltiesUpdatedAt: POISONED.penaltiesUpdatedAt,
      weeklyPrizes: POISONED.weeklyPrizes,
      weeklyPrizesStamp: POISONED.weeklyPrizesStamp,
    }, "parent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("a non-object body is 400 invalid_body with zero snapshot access", async () => {
    const res = await post([{ tasks: [] }], "parent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("guest POST → 401 unauthorized, snapshot untouched", async () => {
    const res = await post(POISONED);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("GET returns the snapshot after successful reconciliation", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: true,
      repaired: [],
      failed: [],
      warnings: [],
    });
    expect(mocks.reconcileTaskProjectionLocked).toHaveBeenCalledOnce();
  });

  it("GET returns a verified snapshot with a repair-level pending state", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: ["task:1:completion"],
      failed: ["approval:pending", "secret:raw-row"],
      weekData: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: ["task:1:completion"],
      failed: ["approval:pending"],
    });
  });
});

describe("tasks/sync repair status contract", () => {
  it("503 rollover_unavailable when the rollover leg throws", async () => {
    mocks.ensureCurrentTaskWeek.mockRejectedValue(new Error("pb down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "rollover_unavailable",
      reconciled: false,
      failed: ["rollover:unavailable"],
      snapshot: null,
    });
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("503 rollover_unavailable when the rollover leg produces no current week", async () => {
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      reconciled: true,
      weekStart: "",
      revision: { revision: "1", updatedAt: "" },
      currentWeekData: null,
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "rollover_unavailable",
      failed: ["rollover:unavailable"],
    });
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("503 projection_reconcile_unavailable when the locked reconciler throws", async () => {
    mocks.reconcileTaskProjectionLocked.mockRejectedValue(new Error("lock timeout"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "projection_reconcile_unavailable",
      failed: ["projection:unavailable"],
      snapshot: null,
    });
  });

  it("503 snapshot_unavailable when the snapshot leg cannot be read", async () => {
    db.rows = [];
    mocks.withAdmin.mockImplementation((fn: any) => fn({
      collection: () => ({ getFullList: async () => { throw new Error("snapshot read failed"); } }),
    }));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "snapshot_unavailable",
      failed: ["snapshot:read"],
      snapshot: null,
    });
  });

  it("200 repair-level: a task collection read failure still serves the snapshot", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: [],
      failed: ["tasks:read"],
      weekData: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      error: "projection_reconcile_pending",
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: [],
      failed: ["tasks:read"],
      warnings: [],
    });
  });

  it("200 repair-level: a concurrent task change is reported as tasks:changed", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: ["approval:projection"],
      failed: ["tasks:changed"],
      weekData: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      error: "projection_reconcile_pending",
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: ["approval:projection"],
      failed: ["tasks:changed"],
      warnings: [],
    });
  });

  it("200 repair-level: an unreconciled rollover leg is surfaced, not a 503", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      reconciled: false,
      weekStart: "2026-09-21",
      revision: { revision: "1", updatedAt: "" },
      currentWeekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      reconciled: false,
      failed: ["rollover:pending"],
    });
    expect(mocks.reconcileTaskProjectionLocked).toHaveBeenCalledOnce();
  });

  it("200 repair-level: isolated week warnings keep the snapshot available", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: true,
      reconciled: true,
      repaired: [],
      failed: [],
      warnings: ["week:unrelated_row"],
      weekData: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      reconciled: true,
      warnings: ["week:unrelated_row"],
    });
  });
});
