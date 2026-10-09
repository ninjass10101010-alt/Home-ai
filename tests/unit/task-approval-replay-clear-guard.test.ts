// B1a RED — "an approval replay whose timestamp gate fails still clears the
// row". Symptom (a), the timestamp-skew variant of the fault line: the row's
// `pendingApproval.at` is stamped by the tapping DEVICE while the approval's
// proof timestamp is server time. A device clock one second fast makes
// `approvalPatch`'s replay gate (task-approval.ts:1276-1285:
// `pendingAt <= proofAt`) return false, so `writeApprovalSnapshot` skips the
// row silently at :1139 — a row THIS command already paid stays pending and
// the caller is told success. This is the single most likely cause of "it
// worked but the row never went away".
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

vi.mock("@/lib/live-member", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLiveMemberById: mocks.getLiveMemberById, getLiveMembers: mocks.getLiveMembers };
});

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
import { approvalCommandFingerprint } from "@/lib/task-approval";

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const MEMBER_NAME = "Rebecca (Mom)";
const OPERATION_ID = "op-replay-timestamp-skew";
const PROOF_AT = new Date(Date.now() - 60_000).toISOString();
const SKEWED_PENDING_AT = new Date(Date.parse(PROOF_AT) + 1000).toISOString();

function makePb(pendingAt: string = SKEWED_PENDING_AT) {
  const weekStart = mondayISO();
  const fingerprint = approvalCommandFingerprint(
    { operationId: OPERATION_ID, action: "approve", taskId: 101 },
    "parent-rebecca",
  );
  const seededEarn = {
    id: 9001,
    timestamp: PROOF_AT,
    member: "Caspian Garcia",
    type: "earn",
    amount: 5,
    description: "Completed: Sweep the kitchen floor (+5pts)",
    taskId: 101,
    meta: { operationId: OPERATION_ID, source: "task-approval", fingerprint },
  };
  let history: any[] = [seededEarn];
  let snapData: any = {
    tasks: [{
      id: 101,
      title: "Sweep the kitchen floor",
      assignee: "Caspian Garcia",
      points: 5,
      completed: true,
      completedBy: "Caspian Garcia",
      completedInWeek: weekStart,
      // The tapping device's clock ran one second ahead of the server's proof.
      pendingApproval: { byName: "Caspian Garcia", at: pendingAt, points: 5 },
    }],
    deletedTaskIds: [],
    weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] as any[] },
  };
  const weekRow: any = {
    id: "w1",
    weekStart,
    points: JSON.stringify({ "Caspian Garcia": 5 }),
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

describe("an approval replay whose timestamp gate fails still clears the row", () => {
  async function approve(harness: ReturnType<typeof makePb>) {
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    return POST(new NextRequest("http://localhost/api/tasks/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: OPERATION_ID,
        action: "approve",
        memberName: MEMBER_NAME,
        pin: "0202",
        taskId: 101,
      }),
    }));
  }

  it("clears a still-pending row whose tap stamp is one second after the proof", async () => {
    const harness = makePb();
    const res = await approve(harness);
    const body = await res.json();

    expect(body.cleared).toBe(1);
    expect(body.reconciled).toBe(true);
    expect(harness.snapshotTask(101)?.pendingApproval ?? null).toBeNull();
  });

  it("clears a tap at the exact edge of the skew window", async () => {
    // APPROVAL_PROOF_SKEW_MS = 5000; the boundary is INCLUSIVE (a tie is the
    // same tap, not a newer one).
    const harness = makePb(new Date(Date.parse(PROOF_AT) + 5_000).toISOString());
    const res = await approve(harness);
    const body = await res.json();

    expect(body.cleared).toBe(1);
    expect(body.reconciled).toBe(true);
    expect(harness.snapshotTask(101)?.pendingApproval ?? null).toBeNull();
  });

  it("refuses to clear a re-tap one millisecond outside the window and leaves it standing", async () => {
    const reTapAt = new Date(Date.parse(PROOF_AT) + 5_001).toISOString();
    const harness = makePb(reTapAt);
    const res = await approve(harness);
    const body = await res.json();

    expect(body.cleared).toBe(0);
    expect(body.reconciled).toBe(false);
    expect(harness.snapshotTask(101)?.pendingApproval?.at ?? null).toBe(reTapAt);
  });
});
