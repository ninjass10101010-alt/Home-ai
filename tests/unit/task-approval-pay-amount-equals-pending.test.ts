// B1a RED/GREEN — "the server pays pendingApproval.points, never
// task.points". Symptom (b) control: `parsePending` reads
// `raw.points ?? task.points` (task-approval.ts:403) and `freshEntries`
// builds each earn with `amount: pending.amount` (:758-772), so the server's
// pay amount is already correct. This suite pins that against a future
// refactor (it may be green on arrival — a green suite commits immediately),
// and pins the reversal-aware idempotency of a same-operationId replay.
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

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MEMBER_NAME = "Rebecca (Mom)";
const OPERATION_ID = "op-pay-amount-equals-pending";

const SPEED_BONUS_TASK = {
  id: 103,
  title: "Unload the dishwasher",
  assignee: "Aurora Garcia",
  assigneeEmoji: "🌈",
  points: 6,
  universal: true,
  completed: true,
  completedBy: "Aurora Garcia",
  completedInWeek: mondayISO(),
  pendingApproval: { byName: "Aurora Garcia", at: "2026-09-19T18:00:00.000Z", points: 9 },
};

function makePb() {
  const weekStart = mondayISO();
  let history: any[] = [];
  let points: Record<string, number> = {};
  const weekRow: any = {
    id: "w1",
    weekStart,
    points: JSON.stringify(points),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify([]),
  };
  // The snapshot blob is persisted WHOLE (receipts and taskWeekStart
  // included): verifyApprovalSnapshot re-reads it after the write, and a fake
  // that drops fields makes every write look unverifiable.
  let snapData: any = {
    tasks: [structuredClone(SPEED_BONUS_TASK)],
    deletedTaskIds: [],
    weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] as any[] },
  };
  const taskRows: any[] = [];

  return {
    history: () => history,
    points: () => points,
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
              if (payload.points) points = payload.points;
              Object.assign(weekRow, payload);
              return weekRow;
            },
            create: async (payload: any) => {
              if (payload.history) history = payload.history;
              if (payload.points) points = payload.points;
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

async function approve(operationId = OPERATION_ID, taskId = SPEED_BONUS_TASK.id) {
  return POST(jsonReq({
    operationId,
    action: "approve",
    memberName: MEMBER_NAME,
    pin: "0202",
    taskId,
  }));
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
    { id: "child-aurora", name: "Aurora Garcia", role: "child", emoji: "🌈" },
    { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" },
  ]);
  mocks.getLiveMemberById.mockImplementation(async (id: string) =>
    id === "parent-rebecca" ? { id, name: MEMBER_NAME, role: "parent", emoji: "👩" } : null);
});

describe("the server pays pendingApproval.points, never task.points", () => {
  it("writes each earn at the pending amount (9), never the task's base (6)", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const res = await approve();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(1);

    const earns = harness.history().filter(
      (transaction: any) => transaction.taskId === SPEED_BONUS_TASK.id && transaction.type === "earn",
    );
    expect(earns).toHaveLength(1);
    expect(earns.every((transaction: any) => transaction.amount === 9)).toBe(true);
    expect(earns.some((transaction: any) => transaction.amount === 6)).toBe(false);
  });

  it("replays the same operationId as a duplicate with zero additional earns", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const first = await approve();
    expect(first.status).toBe(200);
    const historyAfterFirst = harness.history().length;

    const replay = await approve();
    const body = await replay.json();

    expect(body.duplicate).toBe(true);
    expect(harness.history()).toHaveLength(historyAfterFirst);
  });
});
