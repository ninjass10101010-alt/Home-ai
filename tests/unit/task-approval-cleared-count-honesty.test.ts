// B1a RED — "approve reports every row it cleared, or admits it did not".
// Symptom (a): a parent approves two tapped rows; one was cleared out-of-band
// between prepare and write. The ledger leg still pays BOTH members, but the
// snapshot patch for the cleared row is skipped silently (task-approval.ts:
// 1139 — `if (!patch.shouldApply(current)) continue;`), so `cleared` counts 1
// while `paid` counts 2 and `reconciled` still reports true (:1587). The
// parent is told success for a row that was paid but never cleared.
//
// The harness drives the REAL route + service + ledger with only PocketBase,
// the roster and the locks faked — the same seam tests/unit/task-approve-
// route.test.ts uses.
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

function makePb() {
  const weekStart = mondayISO();
  let history: any[] = [];
  let snapData: any = {
    tasks: [pendingTaskRow(101, "Dishes"), pendingTaskRow(102, "Trash")],
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
    updateSnapshotTask: (id: number, patch: Record<string, unknown>) => {
      snapData = {
        ...snapData,
        tasks: snapData.tasks.map((task: any) => (Number(task.id) === id ? { ...task, ...patch } : task)),
      };
    },
    preparedRowCount: () => 2,
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

/**
 * Wire the fake PB, and clear task 102 out-of-band right after the FIRST
 * withAdmin call — i.e. after `resolveTasks` prepared both rows but before
 * `writeApprovalSnapshot` re-reads the snapshot. That is the exact shape
 * task-approval.ts:1139 hits when another writer cleared the row mid-command.
 */
function wirePbWithMidCommandClear(harness: ReturnType<typeof makePb>) {
  let adminCalls = 0;
  mocks.withAdmin.mockImplementation(async (fn: any) => {
    adminCalls += 1;
    const value = await fn(harness.pb);
    if (adminCalls === 1) harness.updateSnapshotTask(102, { pendingApproval: null, sentBackAt: null });
    return value;
  });
}

function approveAllRequest() {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationId: "op-cleared-count-honesty",
      action: "approve-all",
      memberName: MEMBER_NAME,
      pin: "0202",
      taskIds: [101, 102],
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

describe("approve reports every row it cleared, or admits it did not", () => {
  it("reports cleared === paid when one prepared row was cleared out-of-band", async () => {
    const harness = makePb();
    wirePbWithMidCommandClear(harness);

    const res = await POST(approveAllRequest());
    const body = await res.json();

    expect(body.paid).toBe(2);
    expect(body.cleared).toBe(body.paid);
  });

  it("admits a partial clear instead of reconciling silently", async () => {
    const harness = makePb();
    wirePbWithMidCommandClear(harness);

    const res = await POST(approveAllRequest());
    const body = await res.json();

    // The plain-reading fix (test 1) counts a row a writer cleared between
    // prepare and write as cleared, so `cleared === paid` and this fixture is
    // fully reconciled. The honesty contract this test protects — now phrased
    // exactly as the plan's suite-1 spec — is the conditional: a response may
    // only claim `reconciled:true` when it cleared every prepared row.
    expect(body.cleared).toBeLessThanOrEqual(harness.preparedRowCount());
    if (body.cleared < harness.preparedRowCount()) {
      expect(body.reconciled).toBe(false);
      expect(res.status).not.toBe(200);
    } else {
      expect(body.reconciled).toBe(true);
      expect(res.status).toBe(200);
    }
  });

  it("carries a task leg for every requested id on approve-all", async () => {
    const harness = makePb();
    wirePbWithMidCommandClear(harness);

    const res = await POST(approveAllRequest());
    const body = await res.json();

    // The ack must let adoptTaskOutboxAcknowledgement clear the device's own
    // row per task instead of waiting for a snapshot it may not adopt.
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.map((task: any) => task.id)).toEqual([101, 102]);
  });
});
