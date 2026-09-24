import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  lockOrder: [] as string[],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));

vi.mock("@/lib/keyed-lock", () => ({
  withKeyedLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    mocks.lockOrder.push(`acquire:${key}`);
    try {
      return await fn();
    } finally {
      mocks.lockOrder.push(`release:${key}`);
    }
  },
  __resetKeyedLockForTests: vi.fn(),
}));

vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: async <T>(_week: string, fn: () => Promise<T>): Promise<T> => {
    mocks.lockOrder.push("acquire:week-ledger");
    try {
      return await fn();
    } finally {
      mocks.lockOrder.push("release:week-ledger");
    }
  },
}));

import { POST } from "@/app/api/tasks/approve/route";
import { approvalCommandFingerprint } from "@/lib/task-approval";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

function jsonReq(body: unknown): NextRequest {
  const payload = body && typeof body === "object" && !Array.isArray(body) &&
    !("operationId" in (body as Record<string, unknown>))
    ? { operationId: "op-approval-test", ...(body as Record<string, unknown>) }
    : body;
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function pendingTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: "Dishes",
    assignee: "Caspian Garcia",
    points: 6,
    completed: true,
    completedBy: "Caspian Garcia",
    completedInWeek: mondayISO(),
    pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 8 },
    ...overrides,
  };
}

/** Fake pb: snapshot blob carries the pending task; week_data reflects writes. */
function makePb(opts?: {
  snapshotTasks?: any[];
  weekHistory?: any[];
  weekPoints?: Record<string, number>;
  collectionTask?: Record<string, unknown> | null;
  failWeekUpdate?: boolean;
  failSnapshotWriteAfter?: number;
  failTaskWriteOnce?: boolean;
  deletedTaskIds?: number[];
}) {
  const weekStart = mondayISO();
  let history = opts?.weekHistory ? [...opts.weekHistory] : [];
  let points: Record<string, number> = { ...(opts?.weekPoints || {}) };
  const weekRow = {
    id: "w1",
    weekStart,
    points: JSON.stringify(points),
    streak: "{}",
    lastActive: "{}",
    history: "[]",
    // Seed prior earns into week_data the same way task-claim.test.ts does —
    // the route's reversal-aware idempotency reads weekRow.history.
    ...(opts?.weekHistory !== undefined ? { history: opts.weekHistory } : {}),
  };
  let weekWritten: any = null;
  let snapshotWritten: any = null;
  const snapshotTasks = opts?.snapshotTasks ?? [pendingTaskRow()];
  let snapTasks = [...snapshotTasks];
  let snapWeek = { weekStart, points: {}, streak: {}, lastActive: {}, history: [] as any[] };
  let snapDeletedTaskIds = [...(opts?.deletedTaskIds ?? [])];
  let snapOperationReceipts: any;
  let snapProjectionRepairs: any;
  let collectionUpdated: any = null;
  let snapshotWrites = 0;
  let failTaskWrite = Boolean(opts?.failTaskWriteOnce);

  const collectionTask = opts?.collectionTask === undefined
    ? { id: "pb-1", taskId: 101, title: "Dishes", points: 6, completed: true, pendingApproval: pendingTaskRow().pendingApproval }
    : opts.collectionTask;
  const collectionRows = collectionTask ? [collectionTask] : [];

  return {
    weekWritten: () => weekWritten,
    snapshotUpdates: () => snapshotWritten,
    snapshotWrites: () => snapshotWrites,
    snapshotTask: (id: number) => snapTasks.find((task: any) => Number(task.id) === id),
    collectionUpdated: () => collectionUpdated,
    history: () => history,
    points: () => points,
    pb: {
      collection: (name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => [{
              id: "snap-1",
              key: "tasks-snapshot",
              data: JSON.stringify({
                tasks: snapTasks,
                deletedTaskIds: snapDeletedTaskIds,
                weekData: snapWeek,
                ...(snapOperationReceipts === undefined ? {} : { operationReceipts: snapOperationReceipts }),
                ...(snapProjectionRepairs === undefined ? {} : { pendingProjectionRepairs: snapProjectionRepairs }),
              }),
            }],
            update: async (_id: string, payload: any) => {
              snapshotWrites += 1;
              if (opts?.failSnapshotWriteAfter === snapshotWrites) throw new Error("snapshot write failed");
              snapshotWritten = payload;
              const data = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
              snapTasks = data.tasks ?? snapTasks;
              snapWeek = data.weekData ?? snapWeek;
              snapDeletedTaskIds = data.deletedTaskIds ?? snapDeletedTaskIds;
              snapOperationReceipts = data.operationReceipts;
              snapProjectionRepairs = data.pendingProjectionRepairs;
              return { id: "snap-1", ...payload };
            },
            create: async (payload: any) => {
              snapshotWrites += 1;
              if (opts?.failSnapshotWriteAfter === snapshotWrites) throw new Error("snapshot write failed");
              snapshotWritten = payload;
              return { id: "snap-2", ...payload };
            },
          };
        }
        if (name === "week_data") {
          return {
            getFullList: async () => [weekRow],
            getOne: async () => weekRow,
            update: async (_id: string, payload: any) => {
              if (opts?.failWeekUpdate) throw new Error("week write failed");
              weekWritten = payload;
              if (payload.history) history = payload.history;
              if (payload.points) points = payload.points;
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              if (opts?.failWeekUpdate) throw new Error("week write failed");
              weekWritten = payload;
              if (payload.history) history = payload.history;
              if (payload.points) points = payload.points;
              Object.assign(weekRow, payload);
              return weekRow;
            },
          };
        }
        if (name === "tasks") {
          return {
            getFullList: async () => collectionRows,
            create: async (payload: any) => {
              if (failTaskWrite) {
                failTaskWrite = false;
                throw new Error("task projection failed");
              }
              const row = { id: `pb-${collectionRows.length + 1}`, ...payload };
              collectionRows.push(row);
              return row;
            },
            update: async (id: string, payload: any) => {
              if (failTaskWrite) {
                failTaskWrite = false;
                throw new Error("task projection failed");
              }
              collectionUpdated = payload;
              const row = collectionRows.find((candidate: any) => String(candidate.id) === id);
              if (row) Object.assign(row, payload);
              return row ?? { id, ...payload };
            },
            delete: async (id: string) => {
              const index = collectionRows.findIndex((candidate: any) => String(candidate.id) === id);
              if (index >= 0) collectionRows.splice(index, 1);
              return true;
            },
          };
        }
        return { getFullList: async () => [] };
      },
    },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.getLiveMemberById.mockReset();
  mocks.getLiveMembers.mockReset();
  mocks.lockOrder.length = 0;
  mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" });
  mocks.getLiveMembers.mockResolvedValue([
    { id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" },
    { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" },
    { id: "child-aurora", name: "Aurora Garcia", role: "child", emoji: "🌈" },
  ]);
  mocks.getLiveMemberById.mockImplementation(async (id: string) =>
    id === "parent-rebecca"
      ? { id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" }
      : null,
  );
});

describe("approval command fingerprint", () => {
  it("binds the stable parent id and action/task ids but not role, PIN, or member name", () => {
    const command = { operationId: "op-fingerprint", action: "approve" as const, taskId: 101 };
    const first = approvalCommandFingerprint(command, "parent-live");
    expect(approvalCommandFingerprint({ ...command, memberName: "Renamed", pin: "different" } as any, "parent-live")).toBe(first);
    expect(approvalCommandFingerprint({ ...command, role: "child" } as any, "parent-live")).toBe(first);
    expect(approvalCommandFingerprint(command, "other-parent")).not.toBe(first);
    expect(approvalCommandFingerprint({ ...command, taskId: 102 }, "parent-live")).not.toBe(first);
  });
});

describe("POST /api/tasks/approve — action:approve", () => {
  it("rejects a missing/invalid action with 400", async () => {
    const res = await POST(jsonReq({ action: "nope", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(400);
  });

  it("401s when the PIN is wrong", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "9999", taskId: 101 }));
    expect(res.status).toBe(401);
  });

  it("rejects a fallback-shaped identity without a live PB id", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: 1, name: "Rebecca (Mom)", role: "parent" });
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(401);
    expect(mocks.getLiveMemberById).not.toHaveBeenCalled();
  });

  it("403s when the verified member is not a parent", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    mocks.getLiveMemberById.mockResolvedValue({ id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" });
    const { pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Caspian Garcia", pin: "1234", taskId: 101 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "adult_only" });
  });

  it("404s for an unknown taskId", async () => {
    const { pb } = makePb({ snapshotTasks: [], collectionTask: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 999999 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "unknown-task" });
  });

  it("never falls back to PB for a tombstoned task id", async () => {
    const { pb, points, collectionUpdated } = makePb({
      snapshotTasks: [pendingTaskRow()],
      collectionTask: { id: "pb-1", taskId: 101, pendingApproval: pendingTaskRow().pendingApproval },
      deletedTaskIds: [101],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve",
      operationId: "op-tombstoned-approval",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "unknown-task" });
    expect(points()["Caspian Garcia"]).toBeUndefined();
    expect(collectionUpdated()).toBeNull();
  });

  it("does not clear pending state when the ledger write fails", async () => {
    const { pb, collectionUpdated, snapshotTask } = makePb({ failWeekUpdate: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve",
      operationId: "op-ledger-failure",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "ledger_unavailable" });
    expect(snapshotTask(101)?.pendingApproval).toBeTruthy();
    expect(collectionUpdated()).toBeNull();
  });

  it("returns 202 after ledger success when snapshot projection fails and repairs on the same operation", async () => {
    const { pb, history, snapshotTask, snapshotUpdates } = makePb({ failSnapshotWriteAfter: 1 });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const request = {
      action: "approve",
      operationId: "op-snapshot-repair",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    };
    const first = await POST(jsonReq(request));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      success: true,
      reconciled: false,
      operationId: "op-snapshot-repair",
    });
    expect(firstBody.weekData.history).toHaveLength(1);
    expect(snapshotTask(101)?.pendingApproval).toBeTruthy();
    const markerData = typeof snapshotUpdates()?.data === "string"
      ? JSON.parse(snapshotUpdates().data)
      : snapshotUpdates()?.data;
    expect(markerData.pendingProjectionRepairs).toEqual([
      expect.objectContaining({ operationId: "op-snapshot-repair", taskIds: [101] }),
    ]);

    const second = await POST(jsonReq(request));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({ success: true, reconciled: true, paid: 0 });
    expect(history()).toHaveLength(1);
    expect(snapshotTask(101)?.pendingApproval).toBeNull();
  });

  it("returns 202 after ledger success when PB projection fails and repairs without replaying", async () => {
    const { pb, history, snapshotTask } = makePb({ failTaskWriteOnce: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const request = {
      action: "approve",
      operationId: "op-pb-repair",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    };
    const first = await POST(jsonReq(request));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ success: true, reconciled: false, paid: 1 });
    expect(firstBody.projectionFailures).toEqual([101]);
    expect(history()).toHaveLength(1);
    expect(snapshotTask(101)?.pendingApproval).toBeNull();

    const second = await POST(jsonReq(request));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({ success: true, reconciled: true, paid: 0 });
    expect(history()).toHaveLength(1);
  });

  it("pays pendingApproval.points (speed bonus) and clears the pending row", async () => {
    const { pb, history, points, collectionUpdated } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.paid).toBe(1);
    expect(points()["Caspian Garcia"]).toBe(8);
    const earn = history().find((t: any) => t.type === "earn" && t.taskId === 101);
    expect(earn?.amount).toBe(8);
    expect(earn?.meta).toMatchObject({ operationId: "op-approval-test", source: "task-approval" });
    expect(earn?.meta?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(earn)).not.toContain("0202");
    expect(collectionUpdated()?.pendingApproval).toBeNull();
    expect(body.weekData?.points?.["Caspian Garcia"]).toBe(8);
  });

  it("does not rewrite canonical state on an exact same-operation replay", async () => {
    const { pb, snapshotWrites, history } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const request = {
      action: "approve",
      operationId: "op-exact-replay",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    };
    expect((await POST(jsonReq(request))).status).toBe(200);
    const writes = snapshotWrites();
    const second = await POST(jsonReq(request));
    expect(second.status).toBe(200);
    expect((await second.json()).paid).toBe(0);
    expect(snapshotWrites()).toBe(writes);
    expect(history()).toHaveLength(1);
  });

  it("maps a semantic duplicate to a stable 409 without double-paying", async () => {
    const already = {
      id: 9,
      timestamp: "2026-09-20T10:00:00.000Z",
      member: "Caspian Garcia",
      type: "earn",
      amount: 8,
      description: "Completed: Dishes (+8pts)",
      taskId: 101,
    };
    const { pb, points, history } = makePb({ weekHistory: [already], weekPoints: { "Caspian Garcia": 8 } });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "semantic_duplicate" });
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(history().filter((t: any) => t.type === "earn" && t.taskId === 101)).toHaveLength(1);
  });

  it("counts crew payees separately from the cleared task row", async () => {
    const crewTask = pendingTaskRow({
      crewSize: 2,
      assignee: "Crew",
      completedBy: "Crew",
      crew: {
        members: [
          { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-19T17:00:00.000Z", checkedInAt: "2026-09-19T17:30:00.000Z" },
          { name: "Aurora Garcia", emoji: "🌈", joinedAt: "2026-09-19T17:05:00.000Z", checkedInAt: "2026-09-19T17:35:00.000Z" },
        ],
      },
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-19T18:00:00.000Z",
        points: 10,
        crew: ["Caspian Garcia", "Aurora Garcia"],
      },
    });
    const { pb, history, points, collectionUpdated } = makePb({
      snapshotTasks: [crewTask],
      collectionTask: { id: "pb-1", taskId: 101, crewSize: 2, crew: (crewTask as any).crew, pendingApproval: crewTask.pendingApproval, completed: true },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve",
      operationId: "op-crew-approval",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ paid: 2, cleared: 1 });
    expect(points()).toMatchObject({ "Caspian Garcia": 10, "Aurora Garcia": 10 });
    expect(history().filter((transaction: any) => transaction.type === "earn")).toHaveLength(2);
    expect(collectionUpdated()?.pendingApproval).toBeNull();
  });

  it("re-pays after a same-member earn was later reversed (reversal-aware idempotency)", async () => {
    const reversed = [
      { id: 9, timestamp: "2026-09-19T10:00:00.000Z", member: "Caspian Garcia", type: "earn", amount: 8, description: "Completed: Dishes (+8pts)", taskId: 101 },
      { id: 10, timestamp: "2026-09-20T10:00:00.000Z", member: "Caspian Garcia", type: "adjust", amount: -8, description: "Undo: Dishes (-8pts)", taskId: 101 },
    ];
    const { pb, history, points } = makePb({
      weekHistory: reversed,
      weekPoints: { "Caspian Garcia": 0 },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(1);
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(history().filter((t: any) => t.type === "earn" && t.taskId === 101)).toHaveLength(2);
  });

  it("400s a malformed JSON body instead of falling into the 500 catch", async () => {
    const req = new NextRequest("http://localhost/api/tasks/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, reason: "invalid_body" });
  });

  it("snapshot-primary: approves from the snapshot blob even when the collection row is missing", async () => {
    const { pb, points } = makePb({ collectionTask: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    expect(points()["Caspian Garcia"]).toBe(8);
  });

  it("uses the PB task only when the snapshot has no task row", async () => {
    const { pb, points } = makePb({
      snapshotTasks: [],
      collectionTask: {
        id: "pb-1",
        taskId: 101,
        title: "Dishes",
        assignee: "Caspian Garcia",
        points: 6,
        completed: true,
        completedBy: "Caspian Garcia",
        completedInWeek: mondayISO(),
        pendingApproval: pendingTaskRow().pendingApproval,
      },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve",
      operationId: "op-pb-fallback",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));
    expect(res.status).toBe(200);
    expect(points()["Caspian Garcia"]).toBe(8);
  });

  it("does not fall back to PB when the snapshot row is authoritative and non-pending", async () => {
    const { pb, points, history, collectionUpdated } = makePb({
      snapshotTasks: [pendingTaskRow({ pendingApproval: undefined })],
      collectionTask: {
        id: "pb-1",
        taskId: 101,
        title: "Dishes",
        points: 6,
        completed: true,
        pendingApproval: pendingTaskRow().pendingApproval,
      },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(0);
    expect(points()["Caspian Garcia"]).toBeUndefined();
    expect(history()).toHaveLength(0);
    expect(collectionUpdated()).toBeNull();
  });

  it("no-ops with 200 when the row is no longer pending (already approved elsewhere)", async () => {
    const { pb, points } = makePb({
      snapshotTasks: [pendingTaskRow({ pendingApproval: undefined, completed: true })],
      collectionTask: { id: "pb-1", taskId: 101, completed: true, pendingApproval: null },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(0);
    expect(body.cleared).toBe(0);
    expect(points()["Caspian Garcia"]).toBeUndefined();
  });
});

describe("POST /api/tasks/approve — action:send-back", () => {
  it("reopens a solo pending row with sentBackAt and no ledger write", async () => {
    const { pb, history, points, collectionUpdated, snapshotUpdates } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "send-back", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    expect(collectionUpdated()?.completed).toBe(false);
    expect(collectionUpdated()?.pendingApproval).toBeNull();
    expect(typeof collectionUpdated()?.sentBackAt).toBe("string");
    expect(history()).toHaveLength(0);
    expect(points()["Caspian Garcia"]).toBeUndefined();
    const data = typeof snapshotUpdates()?.data === "string"
      ? JSON.parse(snapshotUpdates().data)
      : snapshotUpdates()?.data;
    expect(data.tasks.find((t: any) => t.id === 101)?.completed).toBe(false);
    expect(data.tasks.find((t: any) => t.id === 101)?.sentBackAt).toBeTruthy();
  });

  it("crew send-back strips checkedInAt from every member (B4)", async () => {
    const crewTask: any = pendingTaskRow({
      crewSize: 3,
      crew: {
        members: [
          { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-19T17:00:00.000Z", checkedInAt: "2026-09-19T17:30:00.000Z" },
          { name: "Aurora Garcia", emoji: "🌈", joinedAt: "2026-09-19T17:05:00.000Z", checkedInAt: "2026-09-19T17:35:00.000Z" },
        ],
        removed: ["Emily Johnson"],
      },
      pendingApproval: { byName: "Crew", at: "2026-09-19T18:00:00.000Z", points: 10, crew: ["Caspian Garcia", "Aurora Garcia"] },
    });
    const { pb, collectionUpdated, snapshotUpdates, history, points } = makePb({
      snapshotTasks: [crewTask],
      collectionTask: { id: "pb-1", taskId: 101, crewSize: 3, crew: crewTask.crew, pendingApproval: crewTask.pendingApproval, completed: true },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "send-back", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    const members = collectionUpdated()?.crew?.members ?? [];
    expect(members).toHaveLength(2);
    expect(members.every((m: any) => !m.checkedInAt)).toBe(true);
    expect(members.map((m: any) => m.name)).toEqual(["Caspian Garcia", "Aurora Garcia"]);
    // Strip checkedInAt only — joinedAt/emoji survive on both stores.
    expect(members.map((m: any) => m.joinedAt)).toEqual(["2026-09-19T17:00:00.000Z", "2026-09-19T17:05:00.000Z"]);
    expect(members.map((m: any) => m.emoji)).toEqual(["🧒", "🌈"]);
    expect(collectionUpdated()?.crew?.removed).toEqual(["Emily Johnson"]);
    // Send-back never touches the ledger.
    expect(history()).toHaveLength(0);
    expect(points()["Caspian Garcia"]).toBeUndefined();
    const data = typeof snapshotUpdates()?.data === "string"
      ? JSON.parse(snapshotUpdates().data)
      : snapshotUpdates()?.data;
    const snapMembers = data.tasks.find((t: any) => t.id === 101)?.crew?.members ?? [];
    expect(snapMembers.every((m: any) => !m.checkedInAt)).toBe(true);
    expect(snapMembers.map((m: any) => m.joinedAt)).toEqual(["2026-09-19T17:00:00.000Z", "2026-09-19T17:05:00.000Z"]);
  });

  it("returns 202 when send-back snapshot projection fails and repairs the same operation", async () => {
    const { pb, history, weekWritten, snapshotTask } = makePb({ failSnapshotWriteAfter: 1 });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const request = {
      action: "send-back",
      operationId: "op-sendback-snapshot-repair",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    };
    const first = await POST(jsonReq(request));
    expect(first.status).toBe(202);
    expect((await first.json()).reconciled).toBe(false);
    expect(snapshotTask(101)?.pendingApproval).toBeTruthy();
    expect(history()).toHaveLength(0);
    expect(weekWritten()).toBeNull();

    const second = await POST(jsonReq(request));
    expect(second.status).toBe(200);
    expect((await second.json()).reconciled).toBe(true);
    expect(snapshotTask(101)?.pendingApproval).toBeNull();
    expect(history()).toHaveLength(0);
  });

  it("returns 202 when send-back PB projection fails and repairs without a ledger write", async () => {
    const { pb, history, snapshotTask } = makePb({ failTaskWriteOnce: true });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const request = {
      action: "send-back",
      operationId: "op-sendback-pb-repair",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    };
    const first = await POST(jsonReq(request));
    expect(first.status).toBe(202);
    expect((await first.json()).projectionFailures).toEqual([101]);
    expect(snapshotTask(101)?.pendingApproval).toBeNull();
    expect(history()).toHaveLength(0);

    const second = await POST(jsonReq(request));
    expect(second.status).toBe(200);
    expect((await second.json()).reconciled).toBe(true);
    expect(history()).toHaveLength(0);
  });

  it("no-ops with 200 when nothing is pending (no row write, no snapshot write)", async () => {
    const { pb, collectionUpdated, snapshotUpdates } = makePb({
      snapshotTasks: [pendingTaskRow({ pendingApproval: undefined, completed: false })],
      collectionTask: { id: "pb-1", taskId: 101, completed: false, pendingApproval: null },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "send-back", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    expect(collectionUpdated()).toBeNull();
    expect(snapshotUpdates()).toBeNull();
  });
});

describe("POST /api/tasks/approve — action:approve-all", () => {
  it("pays every listed pending id under one call and aggregates counts", async () => {
    const t1 = pendingTaskRow();
    const t2 = pendingTaskRow({
      id: 102,
      assignee: "Aurora Garcia",
      completedBy: "Aurora Garcia",
      pendingApproval: { byName: "Aurora Garcia", at: "2026-09-19T18:30:00.000Z", points: 5 },
    });
    const { pb, points, history } = makePb({
      snapshotTasks: [t1, t2],
      collectionTask: null,
    });
    // makePb's collection task is only for single-row mirrors; both live in snapshot.
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve-all",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskIds: [101, 102],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(2);
    expect(body.cleared).toBe(2);
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(points()["Aurora Garcia"]).toBe(5);
    expect(history().filter((t: any) => t.type === "earn")).toHaveLength(2);
  });

  it("acquires week then requested task locks in ascending order", async () => {
    const t1 = pendingTaskRow();
    const t2 = pendingTaskRow({
      id: 102,
      assignee: "Aurora Garcia",
      completedBy: "Aurora Garcia",
      pendingApproval: { byName: "Aurora Garcia", at: "2026-09-19T18:30:00.000Z", points: 5 },
    });
    const { pb } = makePb({ snapshotTasks: [t1, t2], collectionTask: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    mocks.lockOrder.length = 0;
    const res = await POST(jsonReq({
      action: "approve-all",
      operationId: "op-lock-order-approval",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskIds: [102, 101],
    }));
    expect(res.status).toBe(200);
    expect(mocks.lockOrder).toEqual([
      "acquire:week-ledger",
      "acquire:task-command:101",
      "acquire:task-command:102",
      "acquire:snapshot:tasks-snapshot",
      "release:snapshot:tasks-snapshot",
      "release:task-command:102",
      "release:task-command:101",
      "release:week-ledger",
    ]);
  });

  it("maps an already-paid approve-all row to 409 without double-paying", async () => {
    const already = {
      id: 9,
      timestamp: "2026-09-20T10:00:00.000Z",
      member: "Caspian Garcia",
      type: "earn",
      amount: 8,
      description: "Completed: Dishes (+8pts)",
      taskId: 101,
    };
    const { pb, points, history } = makePb({
      weekHistory: [already],
      weekPoints: { "Caspian Garcia": 8 },
      // still pending in snapshot (cleared only after approve) — simulates
      // another device that paid but hasn't cleared the row yet.
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve-all",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskIds: [101],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "semantic_duplicate" });
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(history().filter((t: any) => t.type === "earn" && t.taskId === 101)).toHaveLength(1);
  });

  it("does not partially pay an approve-all batch when one payee is a semantic duplicate", async () => {
    const already = {
      id: 9,
      timestamp: "2026-09-20T10:00:00.000Z",
      member: "Caspian Garcia",
      type: "earn",
      amount: 8,
      description: "Completed: Dishes (+8pts)",
      taskId: 101,
    };
    const t1 = pendingTaskRow();
    const t2 = pendingTaskRow({
      id: 102,
      assignee: "Aurora Garcia",
      completedBy: "Aurora Garcia",
      pendingApproval: { byName: "Aurora Garcia", at: "2026-09-19T18:30:00.000Z", points: 5 },
    });
    const { pb, history, points } = makePb({
      snapshotTasks: [t1, t2],
      collectionTask: null,
      weekHistory: [already],
      weekPoints: { "Caspian Garcia": 8 },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve-all",
      operationId: "op-partial-semantic-approval",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskIds: [101, 102],
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "semantic_duplicate" });
    expect(history()).toHaveLength(1);
    expect(points()["Aurora Garcia"]).toBeUndefined();
  });

  it("fails closed: any unknown id → 404 and pays nothing", async () => {
    const { pb, points } = makePb({ snapshotTasks: [pendingTaskRow()], collectionTask: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({
      action: "approve-all",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskIds: [101, 999999],
    }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "unknown-task" });
    expect(points()["Caspian Garcia"]).toBeUndefined();
  });

  it("400s when taskIds is missing or empty", async () => {
    const res = await POST(jsonReq({ action: "approve-all", memberName: "Rebecca (Mom)", pin: "0202" }));
    expect(res.status).toBe(400);
    const res2 = await POST(jsonReq({ action: "approve-all", memberName: "Rebecca (Mom)", pin: "0202", taskIds: [] }));
    expect(res2.status).toBe(400);
  });
});
