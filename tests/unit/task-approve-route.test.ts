import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

import { POST } from "@/app/api/tasks/approve/route";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
  let collectionUpdated: any = null;

  const collectionTask = opts?.collectionTask === undefined
    ? { id: "pb-1", taskId: 101, title: "Dishes", points: 6, completed: true, pendingApproval: pendingTaskRow().pendingApproval }
    : opts.collectionTask;

  return {
    weekWritten: () => weekWritten,
    snapshotUpdates: () => snapshotWritten,
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
              data: JSON.stringify({ tasks: snapTasks, weekData: snapWeek }),
            }],
            update: async (_id: string, payload: any) => {
              snapshotWritten = payload;
              const data = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
              snapTasks = data.tasks ?? snapTasks;
              snapWeek = data.weekData ?? snapWeek;
              return { id: "snap-1", ...payload };
            },
            create: async (payload: any) => {
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
              weekWritten = payload;
              if (payload.history) history = payload.history;
              if (payload.points) points = payload.points;
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
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
            getFullList: async () => (collectionTask ? [collectionTask] : []),
            update: async (_id: string, payload: any) => {
              collectionUpdated = payload;
              return { id: "pb-1", ...payload };
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
  mocks.verifyPinFromPB.mockResolvedValue({ name: "Rebecca (Mom)", role: "parent", emoji: "👩" });
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

  it("403s when the verified member is not a parent", async () => {
    mocks.verifyPinFromPB.mockResolvedValue({ name: "Caspian Garcia", role: "child", emoji: "🧒" });
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
    expect(collectionUpdated()?.pendingApproval).toBeNull();
    expect(body.weekData?.points?.["Caspian Garcia"]).toBe(8);
  });

  it("second approve after pay is an idempotent 200 no-op (no double-pay)", async () => {
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
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(0);
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(history().filter((t: any) => t.type === "earn" && t.taskId === 101)).toHaveLength(1);
  });

  it("snapshot-primary: approves from the snapshot blob even when the collection row is missing", async () => {
    const { pb, points } = makePb({ collectionTask: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "approve", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    expect(points()["Caspian Garcia"]).toBe(8);
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
    const { pb, collectionUpdated, snapshotUpdates } = makePb({
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
    expect(collectionUpdated()?.crew?.removed).toEqual(["Emily Johnson"]);
    const data = typeof snapshotUpdates()?.data === "string"
      ? JSON.parse(snapshotUpdates().data)
      : snapshotUpdates()?.data;
    const snapMembers = data.tasks.find((t: any) => t.id === 101)?.crew?.members ?? [];
    expect(snapMembers.every((m: any) => !m.checkedInAt)).toBe(true);
  });

  it("no-ops with 200 when nothing is pending", async () => {
    const { pb, collectionUpdated } = makePb({
      snapshotTasks: [pendingTaskRow({ pendingApproval: undefined, completed: false })],
      collectionTask: { id: "pb-1", taskId: 101, completed: false, pendingApproval: null },
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const res = await POST(jsonReq({ action: "send-back", memberName: "Rebecca (Mom)", pin: "0202", taskId: 101 }));
    expect(res.status).toBe(200);
    expect(collectionUpdated()).toBeNull();
  });
});

describe("POST /api/tasks/approve — action:approve-all", () => {
  it("pays every listed pending id under one call and aggregates counts", async () => {
    const t1 = pendingTaskRow();
    const t2 = pendingTaskRow({
      id: 102,
      assignee: "Aurora Garcia",
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

  it("skips already-paid rows without double-paying", async () => {
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
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(0);
    expect(body.skipped).toBe(1);
    expect(points()["Caspian Garcia"]).toBe(8);
    expect(history().filter((t: any) => t.type === "earn" && t.taskId === 101)).toHaveLength(1);
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
