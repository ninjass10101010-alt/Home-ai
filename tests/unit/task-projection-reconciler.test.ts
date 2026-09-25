import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

import { approvalCommandFingerprint } from "@/lib/task-approval";
import { replaceSnapshotWeekData } from "@/lib/snapshot-tasks";
import { reconcileTaskProjection, reconcileTaskProjectionLocked } from "@/lib/task-projection-reconciler";

const WEEK = "2026-09-21";
const PARENT_ID = "parent-test";
const PARENT_NAME = "Parent Test";
const CHILD_NAME = "Child Test";
const PHOTO = `data:image/webp;base64,${"a".repeat(6000)}`;

function task(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    assignee: CHILD_NAME,
    assigneeEmoji: PHOTO,
    assigned: CHILD_NAME,
    due: WEEK,
    points: 5,
    recurring: null,
    category: "chores",
    priority: "medium",
    universal: false,
    stealable: false,
    completed: false,
    completedBy: null,
    completedAt: null,
    completedInWeek: null,
    pendingApproval: null,
    sentBackAt: null,
    crewSize: null,
    crew: null,
    speedBonus: null,
    ...extra,
  };
}

function transaction(
  id: number,
  member: string,
  amount: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    timestamp: `${WEEK}T12:00:0${id % 10}.000Z`,
    member,
    type: "earn",
    amount,
    description: `Completed: Task ${id}`,
    taskId: id,
    ...extra,
  };
}

type Row = Record<string, any>;

function clone(value: unknown): any {
  return structuredClone(value);
}

function makeHarness(options: {
  snapshot?: Row;
  weekRows?: Row[];
  archiveRows?: Row[];
  taskRows?: Row[];
  failTaskWriteAt?: number;
  failTaskDeleteAt?: number;
  failTaskDeleteAlways?: boolean;
  failSnapshotWriteAt?: number;
  failWeekWriteAt?: number;
  silentWeekUpdateIds?: string[];
} = {}) {
  const snapshot: Row = {
    id: "snapshot-test",
    key: "tasks-snapshot",
    data: options.snapshot ?? {
      revision: "1",
      taskWeekStart: WEEK,
      tasks: [],
      deletedTaskIds: [],
      weekData: {
        weekStart: WEEK,
        points: {},
        streak: {},
        lastActive: {},
        history: [],
      },
    },
  };
  const weekRows: Row[] = options.weekRows ? clone(options.weekRows) : [{
    id: "week-current",
    weekStart: WEEK,
    points: {},
    streak: {},
    lastActive: {},
    history: [],
  }];
  const archiveRows: Row[] = options.archiveRows ? clone(options.archiveRows) : [];
  const taskRows: Row[] = options.taskRows ? clone(options.taskRows) : [];
  const members = [
    { id: PARENT_ID, name: PARENT_NAME, role: "parent", emoji: "🧑" },
    { id: "child-test", name: CHILD_NAME, role: "child", emoji: "🧒" },
  ];
  const state = {
    snapshotWrites: 0,
    weekWrites: 0,
    taskWrites: 0,
    activeTaskReads: 0,
    maxTaskReads: 0,
    taskCollectionReads: 0,
  };
  const fail = (kind: "task" | "snapshot" | "week", at?: number) => {
    if (!at) return;
    if (kind === "task" && state.taskWrites === at) throw new Error("injected task failure");
    if (kind === "snapshot" && state.snapshotWrites === at) throw new Error("injected snapshot failure");
    if (kind === "week" && state.weekWrites === at) throw new Error("injected week failure");
  };
  const collection = (name: string) => ({
    getFullList: async () => {
      if (name === "consuela_data_snapshots") return [clone(snapshot)];
      if (name === "week_data") return clone(weekRows);
      if (name === "week_archive") return clone(archiveRows);
      if (name === "tasks") {
        state.taskCollectionReads += 1;
        state.activeTaskReads += 1;
        state.maxTaskReads = Math.max(state.maxTaskReads, state.activeTaskReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        state.activeTaskReads -= 1;
        return clone(taskRows);
      }
      if (name === "members") return clone(members);
      return [];
    },
    getOne: async (id: string) => {
      if (name === "members") return clone(members.find((row) => row.id === id));
      if (name === "consuela_data_snapshots" && id === snapshot.id) return clone(snapshot);
      return null;
    },
    create: async (payload: Row) => {
      if (name === "consuela_data_snapshots") {
        state.snapshotWrites += 1;
        fail("snapshot", options.failSnapshotWriteAt);
        Object.assign(snapshot, { id: "snapshot-test", ...clone(payload) });
        return clone(snapshot);
      }
      if (name === "week_data") {
        state.weekWrites += 1;
        fail("week", options.failWeekWriteAt);
        const row = { id: `week-${weekRows.length + 1}`, ...clone(payload) };
        weekRows.push(row);
        return clone(row);
      }
      if (name === "tasks") {
        state.taskWrites += 1;
        fail("task", options.failTaskWriteAt);
        const row = { id: `task-row-${taskRows.length + 1}`, ...clone(payload) };
        taskRows.push(row);
        return clone(row);
      }
      return clone(payload);
    },
    update: async (id: string, payload: Row) => {
      if (name === "consuela_data_snapshots") {
        state.snapshotWrites += 1;
        fail("snapshot", options.failSnapshotWriteAt);
        Object.assign(snapshot, clone(payload));
        return clone(snapshot);
      }
      if (name === "week_data") {
        state.weekWrites += 1;
        fail("week", options.failWeekWriteAt);
        if (options.silentWeekUpdateIds?.includes(String(id))) return { id, ...clone(payload) };
        const row = weekRows.find((candidate) => candidate.id === id);
        if (row) Object.assign(row, clone(payload));
        return clone(row ?? payload);
      }
      if (name === "tasks") {
        state.taskWrites += 1;
        fail("task", options.failTaskWriteAt);
        const row = taskRows.find((candidate) => candidate.id === id);
        if (row) Object.assign(row, clone(payload));
        return clone(row ?? payload);
      }
      return clone(payload);
    },
    delete: async (id: string) => {
      if (name === "tasks") {
        state.taskWrites += 1;
        if (options.failTaskDeleteAlways || options.failTaskDeleteAt === state.taskWrites) throw new Error("injected task delete failure");
        fail("task", options.failTaskWriteAt);
        const index = taskRows.findIndex((candidate) => candidate.id === id);
        if (index >= 0) taskRows.splice(index, 1);
        return true;
      }
      if (name === "week_archive") {
        const index = archiveRows.findIndex((candidate) => candidate.id === id);
        if (index >= 0) archiveRows.splice(index, 1);
      }
      return true;
    },
  });
  const pb = { collection };
  return {
    pb,
    snapshot,
    weekRows,
    archiveRows,
    taskRows,
    state,
  };
}

beforeEach(() => {
  __resetKeyedLockForTests();
  __resetWeekLedgerLockForTests();
  mocks.withAdmin.mockReset();
  mocks.ensureCurrentTaskWeek.mockReset();
  mocks.ensureCurrentTaskWeek.mockResolvedValue({
    weekStart: WEEK,
    previousWeekStart: null,
    archived: false,
    tasksReset: false,
    hallOfFameRecorded: false,
    currentWeekData: {
      weekStart: WEEK,
      points: {},
      streak: {},
      lastActive: {},
      history: [],
    },
    revision: { revision: "1", updatedAt: "" },
    reconciled: true,
  });
});

describe("task projection reconciler", () => {
  it("repairs stale PB completion from the canonical snapshot", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(42)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(42), id: "pb-42", taskId: 42, completed: true, completedBy: CHILD_NAME }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.repaired).toContain("task:42:completion");
    expect(harness.taskRows[0]).toMatchObject({ completed: false, completedBy: null });
  });

  it("projects photo-containing snapshot state while sanitizing PB and preserving crew data", async () => {
    const snapshotCrew = {
      members: [
        { name: CHILD_NAME, emoji: PHOTO, joinedAt: `${WEEK}T08:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` },
      ],
      removed: [CHILD_NAME],
    };
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(43, { crewSize: 2, crew: snapshotCrew })],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(43, { crewSize: 2, crew: snapshotCrew }), id: "pb-43", taskId: 43 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.ok).toBe(true);
    expect(harness.snapshot.data.tasks[0].assigneeEmoji).toBe(PHOTO);
    expect(harness.snapshot.data.tasks[0].crew.members[0].emoji).toBe(PHOTO);
    expect(harness.taskRows[0].assigneeEmoji).toBe("👤");
    expect(harness.taskRows[0].crew.members).toEqual([]);
    expect(harness.taskRows[0].crew.removed).toEqual([CHILD_NAME]);
  });

  it("applies tombstones and removes PB rows absent from the canonical snapshot", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(44)],
        deletedTaskIds: [77],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [
        { ...task(44), id: "pb-44", taskId: 44 },
        { id: "pb-77", taskId: 77, title: "Deleted" },
        { id: "pb-88", taskId: 88, title: "Stale" },
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.repaired).toEqual(expect.arrayContaining([
      "task:77:tombstone",
      "task:88:tombstone",
    ]));
    expect(harness.taskRows.map((row) => Number(row.taskId))).toEqual([44]);
  });

  it("recomputes and persists the complete canonical current week", async () => {
    const history = [
      transaction(1, "Parent Test", 5),
      transaction(2, "Parent Test", -2, { type: "redeem", description: "Reward" }),
    ];
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [],
        deletedTaskIds: [],
        weekData: {
          weekStart: WEEK,
           points: { "Parent Test": 999 },
           streak: { "Parent Test": 99 },
           lastActive: { "Parent Test": "wrong" },
           history,

        },
      },
      weekRows: [{
        id: "week-current",
        weekStart: WEEK,
        points: { "Parent Test": 999 },
        streak: { "Parent Test": 4 },
        lastActive: { "Parent Test": "2026-09-21T12:00:02.000Z" },
        history,
      }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.weekData).toEqual({
      weekStart: WEEK,
      points: { "Parent Test": 3 },
      streak: { "Parent Test": 4 },
      lastActive: { "Parent Test": "2026-09-21T12:00:02.000Z" },
      history,
    });
    expect(harness.snapshot.data.weekData).toEqual(result.weekData);
    expect(harness.snapshot.data.weekData.history).toEqual(history);
    expect(harness.weekRows[0].points).toEqual({ "Parent Test": 3 });
  });

  it("leaves an approval marker pending when canonical history does not prove payment", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(45, {
          completed: true,
          completedBy: CHILD_NAME,
          pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
        })],
        deletedTaskIds: [],
        pendingProjectionRepairs: [{ operationId: "op-unproven", taskIds: [45], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(45, { completed: true }), id: "pb-45", taskId: 45 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("approval:unproven");
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
    expect(harness.weekRows[0].history).toHaveLength(0);
  });

  it("replays an approved operation from archive and consumes its marker only after projection verifies", async () => {
    const operationId = "op-archived-approval";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 46 },
      PARENT_ID,
    );
    const archived = transaction(46, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [46],
      },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [],
        deletedTaskIds: [46],
        pendingProjectionRepairs: [{ operationId, taskIds: [46], action: "approve", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ id: "pb-46", taskId: 46, title: "Approved" }],
      archiveRows: [{ id: "archive-46", weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [archived] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.ok).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(harness.taskRows).toHaveLength(0);
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(0);
    expect(harness.weekRows[0].history).toHaveLength(0);
  });

  it("preloads the task collection once for approval marker replay and verification", async () => {
    const taskIds = [81, 82, 83];
    const operationId = "op-marker-replay-read-cost";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve-all", taskIds },
      PARENT_ID,
    );
    const paid = taskIds.map((id, index) => transaction(id, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve-all",
        taskIds,
      },
      id: index + 1,
    }));
    const pendingTasks = taskIds.map((taskId) => task(taskId, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    }));
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: pendingTasks,
        deletedTaskIds: [],
        pendingProjectionRepairs: [{ operationId, taskIds, action: "approve-all", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: paid },
      },
      taskRows: pendingTasks.map((current) => ({ ...current, id: `pb-${current.id}`, taskId: current.id })),
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: paid }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(true);
    expect(harness.state.taskCollectionReads).toBeLessThanOrEqual(4);
  });

  it("retries a mid-sequence task projection failure and becomes idempotent", async () => {
    const snapshot = {
      revision: "1",
      taskWeekStart: WEEK,
      tasks: [task(50), task(51)],
      deletedTaskIds: [],
      weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const first = makeHarness({
      snapshot,
      taskRows: [
        { ...task(50), id: "pb-50", taskId: 50, completed: true },
        { ...task(51), id: "pb-51", taskId: 51, completed: true },
      ],
      failTaskWriteAt: 2,
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(first.pb));

    const failed = await reconcileTaskProjection({ pb: first.pb as any, weekStart: WEEK });
    expect(failed.reconciled).toBe(false);
    expect(failed.failed.length).toBeGreaterThan(0);

    const second = makeHarness({
      snapshot: clone(first.snapshot.data),
      taskRows: clone(first.taskRows),
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(second.pb));

    const repaired = await reconcileTaskProjection({ pb: second.pb as any, weekStart: WEEK });
    expect(repaired.reconciled).toBe(true);
    expect(repaired.failed).toEqual([]);
    const repeat = await reconcileTaskProjection({ pb: second.pb as any, weekStart: WEEK });
    expect(repeat.repaired).toEqual([]);
    expect(repeat.failed).toEqual([]);
  });

  it("serializes concurrent repairs with the actual keyed locks", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(53)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(53), id: "pb-53", taskId: 53, completed: true }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const [first, second] = await Promise.all([
      reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK }),
      reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK }),
    ]);

    expect(first.reconciled).toBe(true);
    expect(second.reconciled).toBe(true);
    expect(harness.taskRows).toHaveLength(1);
    expect(harness.taskRows[0].completed).toBe(false);
    expect(harness.state.maxTaskReads).toBe(1);
  });

  it("detects a raw week-row change under the final task locks", async () => {
    const history = [transaction(1, "Parent Test", 2)];
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(68)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history },
      },
      taskRows: [{ ...task(68), id: "pb-68", taskId: 68 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history }],
    });
    const originalCollection = harness.pb.collection;
    let weekReads = 0;
    harness.pb.collection = ((name: string) => {
      const collection = originalCollection(name);
      if (name !== "week_data") return collection;
      return {
        ...collection,
        getFullList: async () => {
          const rows = await collection.getFullList();
          weekReads += 1;
          if (weekReads === 2) rows[0].points = { "Parent Test": 999 };
          return rows;
        },
      };
    }) as any;
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, taskIds: [68] });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("tasks:changed");
  });

  it("does not expand a scoped lock set for an unrelated approval intent", async () => {
    const unrelatedOperation = "op-unrelated-intent";
    const unrelatedFingerprint = "b".repeat(64);
    const unrelated = transaction(67, CHILD_NAME, 1, {
      meta: {
        operationId: unrelatedOperation,
        source: "task-approval",
        fingerprint: unrelatedFingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [67],
      },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(66), task(67)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [unrelated] },
      },
      taskRows: [
        { ...task(66), id: "pb-66", taskId: 66 },
        { ...task(67), id: "pb-67", taskId: 67 },
      ],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [unrelated] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));
    let release!: () => void;
    const held = withTaskCommandLock(67, () => new Promise<void>((resolve) => { release = resolve; }));

    const result = await Promise.race([
      reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, taskIds: [66] }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
    ]);
    release();
    await held;

    expect(result).not.toBeNull();
    expect(result?.reconciled).toBe(true);
  });

  it("does not perform a full task collection read for every task", async () => {
    const tasks = [task(70), task(71), task(72)];
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks,
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: tasks.map((current) => ({ ...current, id: `pb-${current.id}`, taskId: current.id, completed: true })),
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(true);
    expect(harness.state.taskCollectionReads).toBeLessThanOrEqual(6);
  });

  it("keeps a verified approval marker pending when its first snapshot write fails", async () => {
    const operationId = "op-snapshot-retry";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 54 },
      PARENT_ID,
    );
    const paid = transaction(54, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [54],
      },
    });
    const pending = task(54, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const snapshot = {
      revision: "1",
      taskWeekStart: WEEK,
      tasks: [pending],
      deletedTaskIds: [],
      pendingProjectionRepairs: [{ operationId, taskIds: [54], action: "approve", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
      weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] },
    };
    const first = makeHarness({
      snapshot,
      taskRows: [{ ...pending, id: "pb-54", taskId: 54 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] }],
      failSnapshotWriteAt: 2,
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(first.pb));

    const failed = await reconcileTaskProjection({ pb: first.pb as any, weekStart: WEEK });
    expect(failed.reconciled).toBe(false);
    expect(first.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      weekStart: WEEK,
      previousWeekStart: null,
      archived: false,
      tasksReset: false,
      hallOfFameRecorded: false,
      currentWeekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      revision: { revision: "3", updatedAt: "" },
      reconciled: true,
    });

    const second = makeHarness({
      snapshot: clone(first.snapshot.data),
      taskRows: clone(first.taskRows),
      weekRows: clone(first.weekRows),
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(second.pb));
    const repaired = await reconcileTaskProjection({ pb: second.pb as any, weekStart: WEEK });
    expect(repaired.reconciled).toBe(true);
    expect(second.snapshot.data.pendingProjectionRepairs).toHaveLength(0);
  });

  it("is idempotent when the same approval operation is reconciled twice", async () => {
    const operationId = "op-approve-idempotent";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 56 },
      PARENT_ID,
    );
    const paid = transaction(56, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [56],
      },
    });
    const pendingTask = task(56, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        pendingProjectionRepairs: [{ operationId, taskIds: [56], action: "approve", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] },
      },
      taskRows: [{ ...pendingTask, id: "pb-56", taskId: 56 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const first = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, operationId });
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      weekStart: WEEK,
      previousWeekStart: null,
      archived: false,
      tasksReset: false,
      hallOfFameRecorded: false,
      currentWeekData: {
        weekStart: WEEK,
        points: {},
        streak: {},
        lastActive: {},
        history: [],
      },
      revision: { revision: "3", updatedAt: "" },
      reconciled: true,
    });
    const second = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, operationId });

    expect(first.repaired.length).toBeGreaterThan(0);
    expect(second.repaired).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(harness.weekRows[0].history).toHaveLength(1);
  });

  it("replays a send-back marker through approval repair without a ledger transaction", async () => {
    const operationId = "op-sendback-replay";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "send-back", taskId: 55 },
      PARENT_ID,
    );
    const pendingTask = task(55, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
      crewSize: 2,
      crew: {
        members: [{ name: CHILD_NAME, emoji: PHOTO, joinedAt: `${WEEK}T08:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` }],
        removed: [],
      },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        operationReceipts: {
          [operationId]: [{ operationId, action: "send-back", taskId: 55, actorId: PARENT_ID, taskIds: [55], fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        },
        pendingProjectionRepairs: [{ operationId, taskIds: [55], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...pendingTask, id: "pb-55", taskId: 55 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(true);
    expect(harness.snapshot.data.tasks[0]).toMatchObject({
      completed: false,
      pendingApproval: null,
      crew: { members: [{ name: CHILD_NAME, joinedAt: `${WEEK}T08:00:00.000Z` }] },
    });
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(0);
  });

  it("does not append a missing crew payee during replay repair", async () => {
    const operationId = "op-crew-missing-proof";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 57 },
      PARENT_ID,
    );
    const memberA = `${CHILD_NAME} A`;
    const memberB = `${CHILD_NAME} B`;
    const crewTask = task(57, {
      completed: true,
      completedBy: "Crew",
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      crewSize: 2,
      crew: {
        members: [
          { name: memberA, emoji: "🧒", joinedAt: `${WEEK}T08:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` },
          { name: memberB, emoji: "🧒", joinedAt: `${WEEK}T08:00:00.000Z`, checkedInAt: `${WEEK}T09:00:00.000Z` },
        ],
        removed: [],
      },
      pendingApproval: {
        byName: "Crew",
        at: `${WEEK}T10:00:00.000Z`,
        points: 5,
        crew: [memberA, memberB],
      },
    });
    const paidA = transaction(57, memberA, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [57],
      },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [crewTask],
        deletedTaskIds: [],
        pendingProjectionRepairs: [{ operationId, taskIds: [57], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paidA] },
      },
      taskRows: [{ ...crewTask, id: "pb-57", taskId: 57 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paidA] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.weekRows[0].history).toHaveLength(1);
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
  });

  it("recovers approval intent from canonical metadata when the marker is lost", async () => {
    const operationId = "op-marker-loss";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 58 },
      PARENT_ID,
    );
    const paid = transaction(58, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [58],
      },
    });
    const pendingTask = task(58, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] },
      },
      taskRows: [{ ...pendingTask, id: "pb-58", taskId: 58 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(true);
    expect(harness.snapshot.data.tasks[0].pendingApproval).toBeNull();
    expect(harness.weekRows[0].history).toHaveLength(1);
  });

  it("rejects duplicate live snapshot task ids as ambiguous", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(59, { title: "First" }), task(59, { title: "Second" })],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(59), id: "pb-59", taskId: 59 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("task:59:ambiguous");
    expect(harness.taskRows).toHaveLength(1);
  });

  it("fails closed when rollover revision changes before the locked reread", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(61)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(61), id: "pb-61", taskId: 61 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));
    mocks.ensureCurrentTaskWeek.mockImplementation(async () => {
      harness.snapshot.data.revision = "2";
      return {
        weekStart: WEEK,
        previousWeekStart: null,
        archived: false,
        tasksReset: false,
        hallOfFameRecorded: false,
        currentWeekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
        revision: { revision: "1", updatedAt: "" },
        reconciled: true,
      };
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("rollover:changed");
    expect(harness.taskRows[0].completed).toBe(false);
  });

  it("skips invalid unrelated week_data rows as warnings instead of failing", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(73)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(73), id: "pb-73", taskId: 73 }],
      weekRows: [
        { id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
        { id: "week-junk", weekStart: "not-a-week", points: {}, streak: {}, lastActive: {}, history: [] },
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.warnings).toContain("week:unrelated_row");
    expect(harness.weekRows.some((row: any) => row.id === "week-junk")).toBe(true);
  });

  it("fails reconciliation when a current week row is malformed", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(74)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(74), id: "pb-74", taskId: 74 }],
      weekRows: [
        { id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
        { id: "week-broken", weekStart: WEEK, points: "not-json", streak: 7, lastActive: null, history: null },
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("week:read");
    expect(harness.taskRows[0].completed).toBe(false);
  });

  it("fails with week:changed when the expected week no longer matches raw canonical rows", async () => {
    const history = [transaction(1, "Parent Test", 2)];
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(75)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history },
      },
      taskRows: [{ ...task(75), id: "pb-75", taskId: 75 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history }],
    });
    const originalCollection = harness.pb.collection;
    let weekReads = 0;
    harness.pb.collection = ((name: string) => {
      const collection = originalCollection(name);
      if (name !== "week_data") return collection;
      return {
        ...collection,
        getFullList: async () => {
          const rows = await collection.getFullList();
          weekReads += 1;
          if (weekReads === 2) rows[0].points = { "Parent Test": 999 };
          return rows;
        },
      };
    }) as any;

    const result = await reconcileTaskProjectionLocked(harness.pb as any, {
      weekStart: WEEK,
      expectedWeekData: {
        weekStart: WEEK,
        points: { "Parent Test": 2 },
        streak: {},
        lastActive: {},
        history: history as any,
      },
    });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("week:changed");
    expect(result.failed).not.toContain("tasks:changed");
    expect(harness.taskRows[0].completed).toBe(false);
  });

  it("reconciles against the expected rollover week instead of failing closed on it", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [task(62)],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...task(62), id: "pb-62", taskId: 62 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjectionLocked(harness.pb as any, {
      weekStart: WEEK,
      expectedWeekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
    });

    expect(result.reconciled).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it("returns an explicit failure when task discovery cannot be read", async () => {
    const harness = makeHarness();
    const originalCollection = harness.pb.collection;
    harness.pb.collection = ((name: string) => {
      if (name === "tasks") return { getFullList: async () => { throw new Error("task read failed"); } };
      return originalCollection(name);
    }) as any;
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("tasks:read");
  });

  it("fails closed for malformed snapshot tasks instead of treating them as empty", async () => {
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: {},
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("snapshot:read");
    expect(harness.state.snapshotWrites).toBe(0);
  });

  it("returns explicit failures for snapshot and ledger discovery read errors", async () => {
    const snapshotHarness = makeHarness();
    const originalSnapshotCollection = snapshotHarness.pb.collection;
    snapshotHarness.pb.collection = ((name: string) => {
      if (name === "consuela_data_snapshots") return { getFullList: async () => { throw new Error("snapshot read failed"); } };
      return originalSnapshotCollection(name);
    }) as any;
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(snapshotHarness.pb));
    const snapshotResult = await reconcileTaskProjection({ pb: snapshotHarness.pb as any, weekStart: WEEK });
    expect(snapshotResult.failed).toContain("snapshot:read");

    const ledgerHarness = makeHarness();
    const originalLedgerCollection = ledgerHarness.pb.collection;
    ledgerHarness.pb.collection = ((name: string) => {
      if (name === "week_data") return { getFullList: async () => { throw new Error("ledger read failed"); } };
      return originalLedgerCollection(name);
    }) as any;
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(ledgerHarness.pb));
    const ledgerResult = await reconcileTaskProjection({ pb: ledgerHarness.pb as any, weekStart: WEEK });
    expect(ledgerResult.failed).toContain("week:read");
  });

  it("refuses to replace a newer snapshot week with an older canonical week", async () => {
    const newer = "2026-09-28";
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: newer,
        tasks: [],
        deletedTaskIds: [],
        weekData: { weekStart: newer, points: {}, streak: {}, lastActive: {}, history: [] },
      },
    });

    const result = await replaceSnapshotWeekData(harness.pb as any, {
      weekStart: WEEK,
      points: {},
      streak: {},
      lastActive: {},
      history: [],
    });

    expect(result.ok).toBe(false);
    expect(harness.state.snapshotWrites).toBe(0);
  });

  it("surfaces invalid approval metadata as a repair failure", async () => {
    const operationId = "op-invalid-metadata";
    const pendingTask = task(63, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const invalidTransaction = {
      ...transaction(63, CHILD_NAME, 5),
      meta: { operationId, source: "task-approval" },
    };
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [invalidTransaction] },
      },
      taskRows: [{ ...pendingTask, id: "pb-63", taskId: 63 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [invalidTransaction] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("approval:metadata");
    expect(harness.snapshot.data.tasks[0].pendingApproval).not.toBeNull();
  });

  it("rejects an explicitly supplied week that is not the current rollover week", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));
    mocks.ensureCurrentTaskWeek.mockResolvedValue({
      weekStart: "2026-09-28",
      previousWeekStart: WEEK,
      archived: false,
      tasksReset: false,
      hallOfFameRecorded: false,
      currentWeekData: { weekStart: "2026-09-28", points: {}, streak: {}, lastActive: {}, history: [] },
      revision: { revision: "1", updatedAt: "" },
      reconciled: true,
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("week_mismatch");
  });

  it("isolates a poison approval operation while repairing a valid one", async () => {
    const validOperation = "op-valid-isolation";
    const poisonOperation = "op-poison-isolation";
    const validFingerprint = approvalCommandFingerprint(
      { operationId: validOperation, action: "approve", taskId: 73 },
      PARENT_ID,
    );
    const validTask = task(73, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const poisonTask = task(74, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const validTx = transaction(73, CHILD_NAME, 5, {
      meta: { operationId: validOperation, source: "task-approval", fingerprint: validFingerprint, actorId: PARENT_ID, action: "approve", taskIds: [73] },
    });
    const poisonTx = transaction(74, CHILD_NAME, 5, {
      meta: { operationId: poisonOperation, source: "task-approval" },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [validTask, poisonTask],
        deletedTaskIds: [],
        pendingProjectionRepairs: [
          { operationId: validOperation, taskIds: [73], action: "approve", actorId: PARENT_ID, fingerprint: validFingerprint, createdAt: `${WEEK}T10:01:00.000Z` },
          { operationId: poisonOperation, taskIds: [74], createdAt: `${WEEK}T10:01:00.000Z` },
        ],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [validTx, poisonTx] },
      },
      taskRows: [
        { ...validTask, id: "pb-73", taskId: 73 },
        { ...poisonTask, id: "pb-74", taskId: 74 },
      ],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [validTx, poisonTx] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("approval:metadata");
    expect(harness.snapshot.data.tasks.find((row: any) => row.id === 73).pendingApproval).toBeNull();
  });

  it("does not replay fingerprintless approval evidence", async () => {
    const operationId = "op-fingerprintless";
    const pendingTask = task(62, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        pendingProjectionRepairs: [{ operationId, taskIds: [62], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: {
          weekStart: WEEK,
          points: {},
          streak: {},
          lastActive: {},
          history: [{ ...transaction(62, CHILD_NAME, 5), meta: { operationId, source: "task-approval" } }],
        },
      },
      taskRows: [{ ...pendingTask, id: "pb-62", taskId: 62 }],
      weekRows: [{
        id: "week-current",
        weekStart: WEEK,
        points: {},
        streak: {},
        lastActive: {},
        history: [{ ...transaction(62, CHILD_NAME, 5), meta: { operationId, source: "task-approval" } }],
      }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, operationId });

    expect(result.reconciled).toBe(false);
    expect(harness.snapshot.data.tasks[0].pendingApproval).not.toBeNull();
    expect(harness.weekRows[0].history).toHaveLength(1);
  });

  it("does not delete duplicate week rows when raw points verification fails", async () => {
    const history = [transaction(1, "Parent Test", 2)];
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history },
      },
      weekRows: [
        { id: "week-primary", weekStart: WEEK, points: { "Parent Test": 999 }, streak: {}, lastActive: {}, history },
        { id: "week-duplicate", weekStart: WEEK, points: { "Parent Test": 2 }, streak: {}, lastActive: {}, history },
      ],
      silentWeekUpdateIds: ["week-primary"],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.weekRows).toHaveLength(2);
  });

  it("labels repair-time PB read failures without a generic projection error", async () => {
    const operationId = "op-repair-read-failure";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "send-back", taskId: 69 },
      PARENT_ID,
    );
    const pendingTask = task(69, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        operationReceipts: {
          [operationId]: [{ operationId, action: "send-back", taskId: 69, actorId: PARENT_ID, taskIds: [69], fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        },
        pendingProjectionRepairs: [{ operationId, taskIds: [69], action: "send-back", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...pendingTask, id: "pb-69", taskId: 69 }],
    });
    const originalCollection = harness.pb.collection;
    let taskReads = 0;
    harness.pb.collection = ((name: string) => {
      const collection = originalCollection(name);
      if (name !== "consuela_data_snapshots") return collection;
      return {
        ...collection,
        getFullList: async () => {
          taskReads += 1;
          if (taskReads >= 3) throw new Error("injected repair read failure");
          return collection.getFullList();
        },
      };
    }) as any;
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(result.failed.some((category) => category.startsWith("approval:"))).toBe(true);
    expect(result.failed).not.toContain("projection:unavailable");
  });

  it("keeps duplicate week_data rows when primary verification fails", async () => {
    const harness = makeHarness({
      weekRows: [
        { id: "week-primary", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [transaction(1, "Parent Test", 2)] },
        { id: "week-duplicate", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      ],
      silentWeekUpdateIds: ["week-primary"],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.weekRows).toHaveLength(2);
  });

  it("rejects send-back repair with a mismatched fingerprint", async () => {
    const operationId = "op-sendback-mismatch";
    const pendingTask = task(60, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        operationReceipts: {
          [operationId]: [{ operationId, action: "send-back", taskId: 60, actorId: PARENT_ID, taskIds: [60], fingerprint: "a".repeat(64), createdAt: `${WEEK}T10:01:00.000Z` }],
        },
        pendingProjectionRepairs: [{ operationId, taskIds: [60], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...pendingTask, id: "pb-60", taskId: 60 }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.snapshot.data.tasks[0].pendingApproval).not.toBeNull();
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
  });

  it("rejects a send-back operation when any current/archive transaction shares its id", async () => {
    const operationId = "op-sendback-collision";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "send-back", taskId: 64 },
      PARENT_ID,
    );
    const pendingTask = task(64, {
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const collision = transaction(64, CHILD_NAME, 5, {
      meta: { operationId, source: "task-approval", fingerprint, actorId: PARENT_ID, action: "approve", taskIds: [64] },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [pendingTask],
        deletedTaskIds: [],
        operationReceipts: {
          [operationId]: [{ operationId, action: "send-back", taskId: 64, actorId: PARENT_ID, taskIds: [64], fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        },
        pendingProjectionRepairs: [{ operationId, taskIds: [64], action: "send-back", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ ...pendingTask, id: "pb-64", taskId: 64 }],
      archiveRows: [{ id: "archive-64", weekStart: "2026-09-14", points: {}, streak: {}, lastActive: {}, history: [collision] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.snapshot.data.tasks[0].pendingApproval).not.toBeNull();
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
  });

  it("keeps a tombstone marker when PB deletion fails", async () => {
    const operationId = "op-tombstone-delete-failure";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "send-back", taskId: 65 },
      PARENT_ID,
    );
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [],
        deletedTaskIds: [65],
        operationReceipts: {
          [operationId]: [{ operationId, action: "send-back", taskId: 65, actorId: PARENT_ID, taskIds: [65], fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        },
        pendingProjectionRepairs: [{ operationId, taskIds: [65], action: "send-back", actorId: PARENT_ID, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
      },
      taskRows: [{ id: "pb-65", taskId: 65, title: "Deleted" }],
      failTaskDeleteAlways: true,
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.reconciled).toBe(false);
    expect(harness.snapshot.data.pendingProjectionRepairs).toHaveLength(1);
    expect(harness.taskRows).toHaveLength(1);
  });

  it("keeps the current snapshot row when an approval replay repairs an edited task", async () => {
    const operationId = "op-edit-replay";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 52 },
      PARENT_ID,
    );
    const paid = transaction(52, CHILD_NAME, 5, {
      meta: {
        operationId,
        source: "task-approval",
        fingerprint,
        actorId: PARENT_ID,
        action: "approve",
        taskIds: [52],
      },
    });
    const edited = task(52, {
      title: "Edited title",
      points: 9,
      completed: true,
      completedBy: CHILD_NAME,
      completedAt: `${WEEK}T10:00:00.000Z`,
      completedInWeek: WEEK,
      pendingApproval: { byName: CHILD_NAME, at: `${WEEK}T10:00:00.000Z`, points: 5 },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [edited],
        deletedTaskIds: [],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] },
      },
      taskRows: [{ ...edited, id: "pb-52", taskId: 52 }],
      weekRows: [{
        id: "week-current",
        weekStart: WEEK,
        points: {},
        streak: {},
        lastActive: {},
        history: [paid],
      }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const result = await reconcileTaskProjection({
      pb: harness.pb as any,
      weekStart: WEEK,
      operationId,
    });

    expect(result.reconciled).toBe(true);
    expect(harness.snapshot.data.tasks[0]).toMatchObject({ title: "Edited title", points: 9, pendingApproval: null });
    expect(harness.taskRows[0]).toMatchObject({ title: "Edited title", points: 9, pendingApproval: null });
    expect(harness.weekRows[0].history).toHaveLength(1);
  });
});
