import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";
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
import { reconcileTaskProjection } from "@/lib/task-projection-reconciler";

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
  failSnapshotWriteAt?: number;
  failWeekWriteAt?: number;
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
      if (name === "tasks") return clone(taskRows);
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
      meta: { operationId, source: "task-approval", fingerprint },
    });
    const harness = makeHarness({
      snapshot: {
        revision: "1",
        taskWeekStart: WEEK,
        tasks: [],
        deletedTaskIds: [46],
        pendingProjectionRepairs: [{ operationId, taskIds: [46], createdAt: `${WEEK}T10:01:00.000Z` }],
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
  });

  it("keeps a verified approval marker pending when its first snapshot write fails", async () => {
    const operationId = "op-snapshot-retry";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 54 },
      PARENT_ID,
    );
    const paid = transaction(54, CHILD_NAME, 5, {
      meta: { operationId, source: "task-approval", fingerprint },
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
      pendingProjectionRepairs: [{ operationId, taskIds: [54], createdAt: `${WEEK}T10:01:00.000Z` }],
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
      meta: { operationId, source: "task-approval", fingerprint },
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
        pendingProjectionRepairs: [{ operationId, taskIds: [56], createdAt: `${WEEK}T10:01:00.000Z` }],
        weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] },
      },
      taskRows: [{ ...pendingTask, id: "pb-56", taskId: 56 }],
      weekRows: [{ id: "week-current", weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [paid] }],
    });
    mocks.withAdmin.mockImplementation(async (fn: any) => fn(harness.pb));

    const first = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK, operationId });
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
          [operationId]: [{ operationId, action: "send-back", taskId: 55, fingerprint, createdAt: `${WEEK}T10:01:00.000Z` }],
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

  it("keeps the current snapshot row when an approval replay repairs an edited task", async () => {
    const operationId = "op-edit-replay";
    const fingerprint = approvalCommandFingerprint(
      { operationId, action: "approve", taskId: 52 },
      PARENT_ID,
    );
    const paid = transaction(52, CHILD_NAME, 5, {
      meta: { operationId, source: "task-approval", fingerprint },
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
