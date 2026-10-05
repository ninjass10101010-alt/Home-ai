// F2 (continued) + Task 11 — POST /api/tasks/sync used to let any session
// overwrite the shared snapshot blob. Every browser snapshot write is retired:
// `tasks`/`weekData` → 410 LEGACY_SYNC_WRITE_ERROR, malformed JSON → 400
// `invalid_body`, and any other valid object → 400 `invalid_body` too. No
// rejection reaches PocketBase.
//
// The GET leg changed contract too, deliberately: it is now
// `GET(request: NextRequest)` and authorizes itself with `requireLiveSession`
// BEFORE its three write legs (rollover, day sweep, projection repair), and an
// unreconciled read answers 503 with the full body retained instead of 200 with
// `ok:false`. So every GET below passes a genuinely signed session request
// (`getSync`) and asserts the honest status.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const db = {
  rows: [] as any[],
  updates: [] as any[],
  creates: [] as any[],
};

// The live roster row `requireLiveSession` re-reads. `GET` is session-level, so
// this file drives the REAL gate: the signed cookie is HMAC-verified and the
// LIVE role is compared against it, exactly as `money-mountain-write-gate.test.ts`
// does for the same reason (only the PocketBase seam is a mock).
const LIVE_MEMBER = { id: "m1", name: "Alex", role: "parent", emoji: "🦊" };

function makePb(member: Record<string, any> = LIVE_MEMBER, snapshotRead?: () => Promise<any[]>) {
  return {
    collection: (name: string) => {
      if (name === "members") {
        return {
          getOne: async (id: string) => {
            if (id !== member.id) throw { status: 404 };
            return { ...member };
          },
        };
      }
      return {
        getFullList: async () => (snapshotRead ? snapshotRead() : db.rows),
        update: async (id: string, payload: any) => {
          db.updates.push({ id, payload });
          return { id, ...payload };
        },
        create: async (payload: any) => {
          db.creates.push(payload);
          return { id: "new", ...payload };
        },
      };
    },
  };
}

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  ensureCurrentTaskDay: vi.fn(),
  reconcileTaskProjectionLocked: vi.fn(),
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));
vi.mock("@/lib/task-day-sweep", () => ({
  ensureCurrentTaskDay: mocks.ensureCurrentTaskDay,
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

// The GET leg takes the request and authorizes itself with `requireLiveSession`
// as its FIRST statement, so it needs the same signed-session request the POST
// leg above already builds — a real HMAC cookie in the real cookie header,
// verified by the REAL gate. Nothing about the session is stubbed, which is the
// point: `task-route-auth-and-honesty.test.ts` replaces `requireLiveSession`
// with a mock that DROPS its options, so it cannot catch this route being
// hardened into `{ requireRole: "parent" }` (which would lock kids out of their
// own chores). Only the PocketBase identity read is mocked.
async function getSync(member: { id: string; name: string; role: string; emoji?: string } = LIVE_MEMBER) {
  const token = await signSession({ memberId: member.id, name: member.name, role: member.role });
  return GET(new NextRequest("http://x/api/tasks/sync", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  }));
}

// The unauthenticated shape: a real request with no cookie at all.
function getSyncAnonymous() {
  return GET(new NextRequest("http://x/api/tasks/sync"));
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
  mocks.ensureCurrentTaskDay.mockReset();
  mocks.ensureCurrentTaskDay.mockResolvedValue({
    day: "2026-09-28",
    swept: false,
    closedTaskIds: [],
    reconciled: true,
    failed: [],
  });
  mocks.reconcileTaskProjectionLocked.mockReset();
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
  it("child task/week POST is retired without touching PB", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "child");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("pet task/week POST is retired without touching PB", async () => {
    const res = await post(POISONED, "pet");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("parent task/week POST is retired without touching PB", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post(POISONED, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a tasks-only body is 410 before any PB access or partial import", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ tasks: [{ id: 42, title: "Forged" }] }, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a weekData-only body is 410 before any PB access or partial import", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ weekData: { points: { Alex: 9999 } } }, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a body that merely OWNS tasks — even set to null — is 410, not 400", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    for (const role of ["parent", "child", "pet"] as const) {
      const res = await post({ tasks: null }, role);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    }
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a body that merely OWNS weekData — even set to null — is 410, not 400", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    for (const role of ["parent", "child", "pet"] as const) {
      const res = await post({ weekData: null }, role);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    }
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("null task/week keys beside other legs are still 410 with no partial import", async () => {
    db.rows = [{ id: "row1", data: EXISTING }];
    const res = await post({ tasks: null, weekData: null, rewards: POISONED.rewards }, "parent");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ ok: false, error: LEGACY_SYNC_WRITE_ERROR });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });

  it("a live session is still required before the legacy leg is judged", async () => {
    const res = await post({ tasks: null }, undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
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

  it("a non-object body is 400 invalid_body with zero PB access", async () => {
    const res = await post([{ tasks: [] }], "parent");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("guest POST → 401 unauthorized, PB untouched", async () => {
    const res = await post(POISONED);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("GET returns the snapshot after successful reconciliation", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    const res = await getSync();
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

  it("GET still returns the snapshot with a repair-level pending state — on a 503, never a 200", async () => {
    // The guarantee this title claims is that the SNAPSHOT survives a
    // repair-level pending state, and it is still true — the route retains the
    // full body on the non-200 precisely so a caller that wants the partial
    // truth can read it. What changed is that the STATUS no longer claims the
    // read was good: `src/db/index.ts:220` and `src/app/tasks/page.tsx:558`
    // both branch on the status alone, so a 200 here applied a snapshot the
    // handler had just declared unreconciled.
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: ["task:1:completion"],
      failed: ["approval:pending", "secret:raw-row"],
      weekData: null,
    });
    const res = await getSync();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "projection_reconcile_pending",
      retryable: true,
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
    const res = await getSync();
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
    const res = await getSync();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "rollover_unavailable",
      failed: ["rollover:unavailable"],
    });
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("503 projection_reconcile_unavailable when the locked reconciler throws", async () => {
    mocks.reconcileTaskProjectionLocked.mockRejectedValue(new Error("lock timeout"));
    const res = await getSync();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "projection_reconcile_unavailable",
      failed: ["projection:unavailable"],
      snapshot: null,
    });
  });

  it("503 snapshot_unavailable when the snapshot leg cannot be read", async () => {
    db.rows = [];
    // The identity read must still succeed — only the SNAPSHOT read fails, so
    // this stays a snapshot failure and not an auth failure.
    mocks.withAdmin.mockImplementation((fn: any) => fn(makePb(LIVE_MEMBER, async () => {
      throw new Error("snapshot read failed");
    })));
    const res = await getSync();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "snapshot_unavailable",
      failed: ["snapshot:read"],
      snapshot: null,
    });
  });

  it("repair-level: a task collection read failure still serves the snapshot — on a 503, never a 200", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: [],
      failed: ["tasks:read"],
      weekData: null,
    });
    const res = await getSync();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    // `toEqual`, not `toMatchObject`: the exact body IS the contract here — the
    // full partial truth still ships on the non-200, and it carries no `error`
    // beyond the pending reason plus the retry hint both consumers need.
    expect(await res.json()).toEqual({
      ok: false,
      error: "projection_reconcile_pending",
      retryable: true,
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: [],
      failed: ["tasks:read"],
      warnings: [],
    });
  });

  it("repair-level: a concurrent task change is reported as tasks:changed", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: false,
      reconciled: false,
      repaired: ["approval:projection"],
      failed: ["tasks:changed"],
      weekData: null,
    });
    const res = await getSync();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: "projection_reconcile_pending",
      retryable: true,
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      repaired: ["approval:projection"],
      failed: ["tasks:changed"],
      warnings: [],
    });
  });

  it("repair-level: an unreconciled rollover leg is surfaced with its own category, not as rollover_unavailable", async () => {
    // Old title said "not a 503" — that WAS the bug. The distinction this test
    // actually protects is between an unreconciled rollover (the snapshot is
    // real, the rollover's own `rollover:pending` category rides out with it)
    // and a rollover that could not run at all (`rollover_unavailable`, a
    // snapshot-less 503). Both are 503 now; the CATEGORY is what separates them.
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      reconciled: false,
      weekStart: "2026-09-21",
      revision: { revision: "1", updatedAt: "" },
      currentWeekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    });
    const res = await getSync();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "projection_reconcile_pending",
      snapshot: { tasks: [{ id: "t1" }] },
      reconciled: false,
      failed: ["rollover:pending"],
    });
    expect(mocks.reconcileTaskProjectionLocked).toHaveBeenCalledOnce();
  });

  it("isolated week warnings keep the snapshot available at 200", async () => {
    // Warnings alone are NOT unreconciled — `reconciled` stays true, so this
    // arm is genuinely still 200 and must keep answering 200. Renamed only to
    // drop the retired "200 repair-level:" prefix, which grouped it with the
    // arms above; the guarantee is unchanged and now states its own status.
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.reconcileTaskProjectionLocked.mockResolvedValue({
      ok: true,
      reconciled: true,
      repaired: [],
      failed: [],
      warnings: ["week:unrelated_row"],
      weekData: null,
    });
    const res = await getSync();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      reconciled: true,
      warnings: ["week:unrelated_row"],
    });
  });

  it("503 daysweep_unavailable when the daily sweep leg throws", async () => {
    mocks.ensureCurrentTaskDay.mockRejectedValue(new Error("pb down"));
    const res = await getSync();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "daysweep_unavailable",
      reconciled: false,
      failed: ["tasks:daysweep:unavailable"],
      snapshot: null,
    });
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("repair-level: an unverified day sweep keeps the snapshot and its own category, not daysweep_unavailable", async () => {
    // Old title said "not a 503" — that WAS the bug. The guarantee worth keeping
    // is the CATEGORY, not the status: a sweep that ran but could not verify
    // itself still returns the real snapshot with `tasks:daysweep:verify`, which
    // is a different failure from a sweep that could not run at all
    // (`daysweep_unavailable`, `failed:["tasks:daysweep:unavailable"]`,
    // snapshot null).
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.ensureCurrentTaskDay.mockResolvedValue({
      day: "2026-09-28",
      swept: true,
      closedTaskIds: [11],
      reconciled: false,
      failed: ["tasks:daysweep:verify"],
    });
    const res = await getSync();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: "projection_reconcile_pending",
      retryable: true,
      reconciled: false,
      snapshot: { tasks: [{ id: "t1" }] },
    });
    expect(body.error).not.toBe("daysweep_unavailable");
    expect(body.failed).toContain("tasks:daysweep:verify");
  });

  it("hands the reconciler the post-sweep revision, so the sweep's own write is not read as a concurrent one", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.ensureCurrentTaskDay.mockResolvedValue({
      day: "2026-09-28",
      swept: true,
      closedTaskIds: [11],
      reconciled: true,
      failed: [],
      revision: "42",
    });
    await getSync();
    expect(mocks.reconcileTaskProjectionLocked).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedRevision: "42" }),
    );
  });

  it("falls back to the rollover revision when the sweep reports none", async () => {
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];
    mocks.ensureCurrentTaskDay.mockResolvedValue({
      day: "2026-09-28",
      swept: false,
      closedTaskIds: [],
      reconciled: false,
      failed: ["tasks:daysweep:snapshot"],
    });
    await getSync();
    expect(mocks.reconcileTaskProjectionLocked).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedRevision: "1" }),
    );
  });
});

// `task-route-auth-and-honesty.test.ts` covers these two through a STUBBED
// `requireLiveSession`, whose mock signature drops its options — so it proves
// the route reads the gate result but cannot prove the gate accepts a real
// signed session of each role. These two drive the REAL helper (only the PB
// identity read is mocked), which is the only place that catches the route
// being "hardened" into `requireLiveSession(request, { requireRole: "parent" })`.
describe("GET /api/tasks/sync session scope, through the real live-session gate", () => {
  it("a signed parent, child and pet session all get the snapshot — the gate is session-level, not parent-only", async () => {
    // This is the family-wide read EVERY device polls (kid home, the tasks
    // page, the screensaver, the 60s refresher in `src/db/index.ts`), so a
    // parent-only gate would lock children out of their own chores. The signed
    // cookie role and the LIVE roster role must both be honoured per role.
    for (const role of ["parent", "child", "pet"] as const) {
      const member = { id: `m-${role}`, name: `${role} Person`, role, emoji: "🦊" };
      mocks.withAdmin.mockImplementation((fn: any) => fn(makePb(member)));
      db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];

      const res = await getSync(member);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        reconciled: true,
        snapshot: { tasks: [{ id: "t1" }] },
      });
    }
    expect(mocks.ensureCurrentTaskWeek).toHaveBeenCalledTimes(3);
  });

  it("a signed session whose LIVE role drifted from its cookie is refused 403, and no write leg runs", async () => {
    // A child who was promoted to parent, or vice versa: the cookie's 7-day HMAC
    // proof is still valid, so only the LIVE re-read catches the drift. This is
    // the whole reason B1 needed LIVE identity rather than `verifySession`.
    mocks.withAdmin.mockImplementation((fn: any) => fn(makePb({ id: "m1", name: "Alex", role: "parent", emoji: "🦊" })));
    db.rows = [{ id: "row1", data: { tasks: [{ id: "t1" }] } }];

    const res = await getSync({ id: "m1", name: "Alex", role: "child", emoji: "🦊" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "session_role_changed" });
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
    expect(mocks.ensureCurrentTaskDay).not.toHaveBeenCalled();
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
  });

  it("no session is refused 401 and NOT ONE of the three write legs runs", async () => {
    // Behavioural, not source-order: a gate that ran after the writes, or whose
    // result the route ignored, would let the rollover, the day sweep or the
    // projection repair fire for a guest — this handler performs three
    // server-side WRITES, so an unauthorized caller reaching even one of them
    // is the defect.
    const res = await getSyncAnonymous();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "unauthorized", snapshot: null });
    expect(mocks.ensureCurrentTaskWeek).not.toHaveBeenCalled();
    expect(mocks.ensureCurrentTaskDay).not.toHaveBeenCalled();
    expect(mocks.reconcileTaskProjectionLocked).not.toHaveBeenCalled();
    // The gate refuses before it even reaches PocketBase, so no leg could have
    // written through any other path either.
    expect(mocks.withAdmin).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.creates).toHaveLength(0);
  });
});
