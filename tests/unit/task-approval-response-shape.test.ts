// B1a D2 — an approve-all names EVERY row it cleared.
//
// Symptom (a) second half: the response carried only the first row
// (`readProjectedTask(pb, active[0].id)` in both arms), so N−1 device rows
// could never be cleared by their own acknowledgement. The response now
// carries `clearedTasks` (one SnapshotTask leg per active row); `task` keeps
// its old single-row meaning and `cleared` stays the numeric count.
//
// The harness drives the REAL route + service + ledger with only PocketBase,
// the roster and the locks faked — the same seam
// task-approval-cleared-count-honesty.test.ts uses.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  keyedTails: new Map<string, Promise<void>>(),
  weekTails: new Map<string, Promise<void>>(),
  localWeekStartISO: vi.fn(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    return date.toISOString().split("T")[0];
  }),
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

vi.mock("@/lib/local-date", () => ({
  localWeekStartISO: mocks.localWeekStartISO,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

vi.mock("@/lib/keyed-lock", () => ({
  withKeyedLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = mocks.keyedTails.get(key) ?? Promise.resolve();
    const current = previous.then(() => fn());
    const tail = current.then(() => undefined, () => undefined);
    mocks.keyedTails.set(key, tail);
    try {
      return await current;
    } finally {
      if (mocks.keyedTails.get(key) === tail) mocks.keyedTails.delete(key);
    }
  },
  __resetKeyedLockForTests: vi.fn(),
}));

vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: async <T>(week: string, fn: () => Promise<T>): Promise<T> => {
    const previous = mocks.weekTails.get(week) ?? Promise.resolve();
    const current = previous.then(() => fn());
    const tail = current.then(() => undefined, () => undefined);
    mocks.weekTails.set(week, tail);
    try {
      return await current;
    } finally {
      if (mocks.weekTails.get(week) === tail) mocks.weekTails.delete(week);
    }
  },
}));

import { POST } from "@/app/api/tasks/approve/route";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const MEMBER_NAME = "Rebecca (Mom)";

function pendingTaskRow(id: number, title: string) {
  return {
    id,
    title,
    assignee: "Caspian Garcia",
    points: 8,
    completed: true,
    completedBy: "Caspian Garcia",
    completedInWeek: mondayISO(),
    pendingApproval: { byName: "Caspian Garcia", at: "2026-09-19T18:00:00.000Z", points: 8 },
  };
}

function makePb(tasks: any[]) {
  const weekStart = mondayISO();
  let history: any[] = [];
  let snapData: any = {
    tasks,
    deletedTaskIds: [],
    weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] as any[] },
  };
  const weekRow: any = {
    id: "w1",
    weekStart,
    points: JSON.stringify({}),
    streak: "{}",
    lastActive: "{}",
    history,
  };
  const taskRows: any[] = [];

  return {
    history: () => history,
    snapshotTask: (id: number) => snapData.tasks.find((task: any) => Number(task.id) === id),
    pb: {
      collection: (name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => [{
              id: "snap-1",
              key: "tasks-snapshot",
              data: JSON.stringify(snapData),
            }],
            update: async (_id: string, payload: any) => {
              snapData = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
              return { id: "snap-1", ...payload };
            },
            create: async (payload: any) => ({ id: "snap-2", ...payload }),
          };
        }
        if (name === "week_data") {
          return {
            getFullList: async () => [weekRow],
            getOne: async () => weekRow,
            update: async (_id: string, payload: any) => {
              if (payload.history) history = payload.history;
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              if (payload.history) history = payload.history;
              Object.assign(weekRow, payload);
              return weekRow;
            },
          };
        }
        if (name === "week_archive") {
          return { getFullList: async () => [], create: async (payload: any) => payload };
        }
        if (name === "tasks") {
          return {
            getFullList: async () => structuredClone(taskRows),
            create: async (payload: any) => {
              const row = { id: `pb-${taskRows.length + 1}`, ...payload };
              taskRows.push(row);
              return row;
            },
            update: async (id: string, payload: any) => {
              const row = taskRows.find((candidate: any) => String(candidate.id) === id);
              if (row) Object.assign(row, payload);
              return row ?? { id, ...payload };
            },
            delete: async (id: string) => {
              const index = taskRows.findIndex((candidate: any) => String(candidate.id) === id);
              if (index >= 0) taskRows.splice(index, 1);
              return true;
            },
          };
        }
        return { getFullList: async () => [] };
      },
    },
  };
}

function approveRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationId: "op-response-shape",
      memberName: MEMBER_NAME,
      pin: "0202",
      ...body,
    }),
  });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyPinFromPB.mockReset();
  mocks.getLiveMemberById.mockReset();
  mocks.getLiveMembers.mockReset();
  mocks.ensureCurrentTaskWeek.mockReset();
  mocks.keyedTails.clear();
  mocks.weekTails.clear();

  mocks.ensureCurrentTaskWeek.mockResolvedValue({ weekStart: mondayISO(), reconciled: true });
  mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-rebecca", name: MEMBER_NAME, role: "parent", emoji: "👩" });
  mocks.getLiveMembers.mockResolvedValue([
    { id: "parent-rebecca", name: MEMBER_NAME, role: "parent", emoji: "👩" },
    { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" },
  ]);
  mocks.getLiveMemberById.mockImplementation(async (id: string) =>
    id === "parent-rebecca" ? { id, name: MEMBER_NAME, role: "parent", emoji: "👩" } : null);
});

describe("approve responses name every row they cleared", () => {
  it("approve-all returns clearedTasks for BOTH rows", async () => {
    const harness = makePb([pendingTaskRow(101, "Dishes"), pendingTaskRow(102, "Trash")]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const res = await POST(approveRequest({ action: "approve-all", taskIds: [101, 102] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cleared).toBe(2);
    expect(body.clearedTasks.map((task: any) => task.id)).toEqual([101, 102]);
    // The old single-row field keeps its meaning (regression pin).
    expect(body.task.id).toBe(101);
  });

  it("keeps task absent and clearedTasks empty when nothing was active", async () => {
    const alreadyPaid = {
      ...pendingTaskRow(101, "Dishes"),
      pendingApproval: null,
    };
    const harness = makePb([alreadyPaid]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const res = await POST(approveRequest({ action: "approve-all", taskIds: [101] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cleared).toBe(0);
    expect(body.paid).toBe(0);
    expect(body.task).toBeUndefined();
    expect(body.clearedTasks).toEqual([]);
  });

  it("send-back returns one cleared row with a valid sentBackAt", async () => {
    const harness = makePb([pendingTaskRow(101, "Dishes")]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const res = await POST(approveRequest({ action: "send-back", taskId: 101 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cleared).toBe(1);
    expect(body.clearedTasks).toHaveLength(1);
    expect(typeof body.clearedTasks[0].sentBackAt).toBe("string");
    expect(body.clearedTasks[0].completed).toBe(false);
  });
});
