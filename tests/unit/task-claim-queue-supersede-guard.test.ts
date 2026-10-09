import { describe, it, expect, vi, beforeEach } from "vitest";

// B1b — the drain-time supersede guard. A claim queued on a ledger outage is a
// DEFERRED INTENT: it may only apply while the row still carries the state it
// was written against. `sentBackAt` is the durable retraction stamp; the queue
// row's `created` is when the intent was captured. A retraction at or after
// that instant means the intent is gone — refuse with the existing
// `already_undone` duplicate reason, never pay.
//
// Three cases:
//   absent      -> replay pays
//   older       -> replay pays
//   at/after    -> terminal refusal, no earn

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  getLiveMembers: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMembers: mocks.getLiveMembers,
}));

import { ensureTaskClaimHandlersRegistered } from "@/lib/task-claim";
import { drainDueTaskCommandQueue } from "@/lib/task-command-queue-server";

const WEEK = "week_data";
const SNAP = "consuela_data_snapshots";
const QUEUE = "task_command_queue";

const liveMembers = [
  { id: "parent-alex", name: "Alex", role: "parent", emoji: "🦊", age: 40 },
  { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 },
];

function mondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
}

const T_BEFORE_RETRACT = "2026-10-08T15:00:00.000Z";
const T_RETRACT = "2026-10-08T15:20:00.000Z";
const T_AFTER_RETRACT = "2026-10-08T15:30:00.000Z";

function makePb(options: {
  completedTask?: boolean;
  pendingApproval?: boolean;
  sentBackAt?: string;
}) {
  const weekStart = mondayISO();
  const task: Record<string, any> = {
    id: 101,
    title: "Take out the bins",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    points: 7,
    universal: false,
    completed: options.completedTask === true,
    ...(options.pendingApproval
      ? { pendingApproval: { byName: "Alex", at: T_BEFORE_RETRACT, points: 7 } }
      : {}),
    ...(options.sentBackAt ? { sentBackAt: options.sentBackAt } : {}),
  };
  let snapshotRow: Record<string, any> = {
    id: "snap-1",
    key: "tasks-snapshot",
    data: JSON.stringify({
      tasks: [task],
      deletedTaskIds: [],
      weekData: { weekStart, points: {}, streak: {}, lastActive: {}, history: [] },
    }),
  };
  let weekRow: Record<string, any> | null = null;
  const weekWrites: unknown[] = [];
  const taskRows: Record<string, any>[] = [{ ...task, id: "task-row-1" }];

  const queueRow: Record<string, any> = {
    id: "queue-1",
    operationId: "op-supersede",
    route: "/api/tasks/claim",
    action: "complete",
    payload: { taskId: 101 },
    actorMemberId: "parent-alex",
    actorName: "Alex",
    actorRole: "parent",
    actorAuthentication: "pin",
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: T_BEFORE_RETRACT,
    displayTarget: { kind: "claim", taskId: 101, title: "Take out the bins" },
    created: T_BEFORE_RETRACT,
  };

  const collection = (name: string) => {
    if (name === QUEUE) {
      return {
        getFullList: async () => [structuredClone(queueRow)],
        update: async (_id: string, payload: any) => {
          Object.assign(queueRow, payload);
          return structuredClone(queueRow);
        },
      };
    }
    if (name === SNAP) {
      return {
        getFullList: async () => [structuredClone(snapshotRow)],
        update: async (_id: string, payload: any) => {
          snapshotRow = { ...snapshotRow, ...payload };
          return snapshotRow;
        },
        create: async (payload: any) => {
          snapshotRow = { ...snapshotRow, ...payload };
          return snapshotRow;
        },
      };
    }
    if (name === WEEK) {
      return {
        getFullList: async () => (weekRow ? [structuredClone(weekRow)] : []),
        update: async (_id: string, payload: any) => {
          weekWrites.push(payload);
          weekRow = { id: "week-1", ...weekRow, ...payload };
          return weekRow;
        },
        create: async (payload: any) => {
          weekWrites.push(payload);
          weekRow = { id: "week-1", ...payload };
          return weekRow;
        },
      };
    }
    if (name === "week_archive") {
      return { getFullList: async () => [] };
    }
    return {
      getFullList: async () => structuredClone(taskRows),
      update: async (id: string, payload: any) => {
        const index = taskRows.findIndex((row) => row.id === id);
        if (index >= 0) taskRows[index] = { ...taskRows[index], ...payload };
        return taskRows[index] ?? { id };
      },
      create: async (payload: any) => {
        const created = { id: `task-row-${taskRows.length + 1}`, ...payload };
        taskRows.push(created);
        return created;
      },
    };
  };

  return {
    pb: { collection },
    weekWrites,
    queueRow,
    snapshotTask: () => {
      const data = typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : snapshotRow.data;
      return (data.tasks ?? []).find((row: any) => Number(row.id) === 101);
    },
    earned: () =>
      weekWrites.some((write: any) =>
        Array.isArray(write?.history) &&
        write.history.some((tx: any) => tx.type === "earn" && Number(tx.taskId) === 101),
      ),
  };
}

async function drain(fixture: ReturnType<typeof makePb>) {
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));
  return drainDueTaskCommandQueue();
}

beforeEach(() => {
  ensureTaskClaimHandlersRegistered();
  mocks.withAdmin.mockReset();
  mocks.getLiveMembers.mockReset().mockResolvedValue(liveMembers);
});

describe("the claim replay refuses an intent the row has already retracted", () => {
  it("refuses when sentBackAt is AT the queue row's creation: terminal already_undone, no earn", async () => {
    const fixture = makePb({ sentBackAt: T_RETRACT });

    await drain(fixture);

    expect(fixture.queueRow.status).toBe("resolved");
    expect(fixture.queueRow.result).toMatchObject({ duplicate: true, reason: "already_undone" });
    expect(fixture.weekWrites).toHaveLength(0);
    expect(fixture.snapshotTask()?.completed).toBe(false);
    expect(fixture.earned()).toBe(false);
  });

  it("refuses when sentBackAt is AFTER the queue row's creation: the retraction supersedes", async () => {
    const fixture = makePb({ sentBackAt: T_AFTER_RETRACT });

    await drain(fixture);

    expect(fixture.queueRow.status).toBe("resolved");
    expect(fixture.queueRow.result).toMatchObject({ duplicate: true, reason: "already_undone" });
    expect(fixture.earned()).toBe(false);
  });

  it("replays and pays when sentBackAt is OLDER than the queue row's creation", async () => {
    const fixture = makePb({ sentBackAt: T_BEFORE_RETRACT });
    // The queue row was created after the retraction: a genuine re-completion.
    fixture.queueRow.created = T_AFTER_RETRACT;

    const summary = await drain(fixture);

    expect(summary.acknowledged).toBe(1);
    expect(fixture.queueRow.status).toBe("resolved");
    expect(fixture.weekWrites.length).toBeGreaterThan(0);
    expect(fixture.earned()).toBe(true);
    expect(fixture.snapshotTask()?.completed).toBe(true);
  });

  it("replays and pays when the row carries no retraction stamp at all", async () => {
    const fixture = makePb({});

    await drain(fixture);

    expect(fixture.queueRow.status).toBe("resolved");
    expect(fixture.earned()).toBe(true);
  });

  it("does NOT guard the undo action: a queued retraction still replays", async () => {
    const fixture = makePb({
      completedTask: true,
      pendingApproval: true,
      sentBackAt: T_AFTER_RETRACT,
    });
    fixture.queueRow.action = "undo";
    fixture.queueRow.payload = { taskId: 101 };

    await drain(fixture);

    // The undo is the retraction itself — the guard names claim/complete only.
    expect(fixture.queueRow.status).toBe("resolved");
    expect(fixture.queueRow.result).not.toMatchObject({ reason: "already_undone" });
    expect(fixture.snapshotTask()?.completed).toBe(false);
  });
});
