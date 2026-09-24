import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotTask } from "@/lib/snapshot-tasks";

process.env.TZ = "America/Detroit";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { GET } from "@/app/api/tasks/sync/route";
import {
  ensureCurrentTaskWeek,
  familyWeekStart,
  resetRecurringTasksForWeek,
} from "@/lib/task-week-rollover";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

const PRIOR = "2026-09-21";
const CURRENT = "2026-09-28";
const NOW = new Date("2026-09-28T12:00:00-04:00");

type Row = Record<string, any>;

function priorWeek() {
  return {
    weekStart: PRIOR,
    points: { Alex: 999 },
    streak: { Alex: 2 },
    lastActive: { Alex: "2026-09-27T20:00:00.000Z" },
    history: [
      {
        id: 101,
        timestamp: "2026-09-27T20:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 5,
        description: "Completed: Dishes",
        taskId: 1,
      },
    ],
  };
}

function sourceTask(overrides: Partial<SnapshotTask>): SnapshotTask {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    due: "2026-09-27",
    points: 5,
    recurring: "weekly",
    category: "kitchen",
    completed: true,
    priority: "medium",
    universal: false,
    stealable: false,
    completedBy: "Alex",
    completedAt: "2026-09-27T20:00:00.000Z",
    completedInWeek: PRIOR,
    crewSize: null,
    crew: null,
    ...overrides,
  } as SnapshotTask;
}

function createHarness(options: { hallCreateFailures?: number; hallCreateDrops?: number } = {}) {
  const state: Record<string, Row[]> = {
    week_data: [],
    week_archive: [],
    consuela_data_snapshots: [],
    hall_of_fame: [],
    members: [{ id: "member-1", name: "Alex", emoji: "🦊" }],
    weekly_prizes: [{ id: "prize-1", rank: 1, emoji: "🥇", text: "Pick the movie" }],
  };
  const calls = {
    week_data: { create: [] as Row[], update: [] as Row[], deletes: [] as string[] },
    week_archive: { create: [] as Row[], update: [] as Row[], deletes: [] as string[] },
    consuela_data_snapshots: { create: [] as Row[], update: [] as Row[], deletes: [] as string[] },
    hall_of_fame: { create: [] as Row[], update: [] as Row[], deletes: [] as string[] },
  };
  let sequence = 0;
  let hallFailures = options.hallCreateFailures ?? 0;
  let hallDrops = options.hallCreateDrops ?? 0;
  const collections: Record<string, any> = {};
  const callLog = calls as Record<string, { create: Row[]; update: Row[]; deletes: string[] }>;

  for (const name of Object.keys(state)) {
    const collection = {
      getFullList: vi.fn(async () => structuredClone(state[name])),
      getOne: vi.fn(async (id: string) => {
        const row = state[name].find((candidate) => candidate.id === id);
        return row ? structuredClone(row) : null;
      }),
      create: vi.fn(async (payload: Row) => {
        if (name === "hall_of_fame" && hallFailures > 0) {
          hallFailures -= 1;
          throw new Error("hall projection failed");
        }
        const row = { id: `${name}-${++sequence}`, ...structuredClone(payload) };
        if (name === "hall_of_fame" && hallDrops > 0) {
          hallDrops -= 1;
          return structuredClone(row);
        }
        state[name].push(row);
        callLog[name]?.create.push(structuredClone(row));
        return structuredClone(row);
      }),
      update: vi.fn(async (id: string, payload: Row) => {
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index < 0) throw new Error("missing row");
        const row = { ...state[name][index], ...structuredClone(payload) };
        state[name][index] = row;
        callLog[name]?.update.push(structuredClone(row));
        return structuredClone(row);
      }),
      "delete": vi.fn(async (id: string) => {
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index >= 0) state[name].splice(index, 1);
        callLog[name]?.deletes.push(id);
        return { id };
      }),
    };
    collections[name] = collection;
  }

  const pb = {
    collection: vi.fn((name: string) => {
      if (!collections[name]) throw new Error(`unexpected collection ${name}`);
      return collections[name];
    }),
  };

  return {
    pb,
    state,
    calls,
    collections,
    snapshotData(): Row {
      return state.consuela_data_snapshots[0]?.data ?? {};
    },
    snapshotTasks(): SnapshotTask[] {
      const data = this.snapshotData();
      const dead = new Set((data.deletedTaskIds ?? []).map(Number));
      return (data.tasks ?? []).filter((task: SnapshotTask) => !dead.has(Number(task.id)));
    },
  };
}

function seedRollover(
  harness: ReturnType<typeof createHarness>,
  tasks: SnapshotTask[] = [sourceTask({ id: 1 })],
  options: { duplicatePrior?: boolean; duplicateArchive?: boolean } = {},
) {
  const week = priorWeek();
  const duplicateWeek = structuredClone(week);
  duplicateWeek.history[0].id = 102;
  if (options.duplicatePrior) {
    harness.state.week_data.push(
      { id: "prior-1", ...structuredClone(week) },
      { id: "prior-2", ...duplicateWeek },
    );
  } else {
    harness.state.week_data.push({ id: "prior-1", ...structuredClone(week) });
  }
  if (options.duplicateArchive) {
    harness.state.week_archive.push(
      { id: "archive-1", ...structuredClone(week) },
      { id: "archive-2", ...structuredClone(duplicateWeek) },
    );
  }
  harness.state.consuela_data_snapshots.push({
    id: "snapshot-1",
    data: {
      revision: "7",
      taskWeekStart: PRIOR,
      weekData: structuredClone(week),
      tasks: structuredClone(tasks),
      deletedTaskIds: [],
    },
    updated_at: "2026-09-27T21:00:00.000Z",
  });
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  __resetWeekLedgerLockForTests();
});

describe("familyWeekStart", () => {
  it("uses the America/Detroit Monday boundary", () => {
    expect(familyWeekStart(new Date("2026-09-28T03:59:59.999Z"))).toBe(PRIOR);
    expect(familyWeekStart(new Date("2026-09-28T04:00:00.000Z"))).toBe(CURRENT);
  });
});

describe("ensureCurrentTaskWeek", () => {
  it("archives the prior canonical week once and creates an empty current week", async () => {
    const harness = createHarness();
    seedRollover(harness, [sourceTask({ id: 1 })]);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const first = await ensureCurrentTaskWeek({ now: NOW });
    const snapshotRevision = first.revision.revision;
    const snapshotWrites = harness.calls.consuela_data_snapshots.update.length +
      harness.calls.consuela_data_snapshots.create.length;
    const second = await ensureCurrentTaskWeek({ now: NOW });

    expect(first.weekStart).toBe(CURRENT);
    expect(first.previousWeekStart).toBe(PRIOR);
    expect(first.archived).toBe(true);
    expect(first.tasksReset).toBe(true);
    expect(first.hallOfFameRecorded).toBe(true);
    expect(first.reconciled).toBe(true);
    expect(first.currentWeekData.points).toEqual({});
    expect(harness.calls.week_archive.create).toHaveLength(1);
    expect(harness.calls.week_archive.create[0].points).toEqual({ Alex: 5 });
    expect(harness.state.hall_of_fame).toHaveLength(1);
    expect(harness.state.hall_of_fame[0]).toMatchObject({
      member: "Alex",
      weekStart: PRIOR,
      points: 5,
      rank: 1,
      prize: "Pick the movie",
    });
    expect(harness.calls.week_data.create).toHaveLength(1);
    expect(harness.calls.week_data.create[0]).toMatchObject({
      weekStart: CURRENT,
      points: {},
      history: [],
    });
    expect(harness.snapshotData()).toMatchObject({
      taskWeekStart: CURRENT,
      weekData: { weekStart: CURRENT, points: {}, history: [] },
    });

    expect(second.archived).toBe(false);
    expect(second.tasksReset).toBe(false);
    expect(second.hallOfFameRecorded).toBe(false);
    expect(second.reconciled).toBe(true);
    expect(second.revision.revision).toBe(snapshotRevision);
    expect(
      harness.calls.consuela_data_snapshots.update.length +
      harness.calls.consuela_data_snapshots.create.length,
    ).toBe(snapshotWrites);
    expect(harness.calls.week_archive.create).toHaveLength(1);
    expect(harness.calls.week_data.create).toHaveLength(1);
    expect(harness.snapshotTasks().filter((task) => task.title === "Dishes")).toHaveLength(1);
  });

  it("clones recurring assigned, open, and crew tasks with fresh week state", async () => {
    const harness = createHarness();
    const tasks = [
      sourceTask({
        id: 1,
        title: "Dishes",
        points: 7,
        category: "kitchen",
        priority: "high",
        sentBackAt: "2026-09-27T20:30:00.000Z",
      }),
      sourceTask({
        id: 2,
        title: "Yard work",
        universal: true,
        assignee: "Alex",
        assigneeEmoji: "🦊",
        speedBonus: 3,
        due: "2026-09-27",
      }),
      sourceTask({
        id: 9,
        title: "Playroom clean",
        crewSize: 2,
        crew: {
          members: [
            { name: "Alex", emoji: "🦊", joinedAt: "2026-09-27T18:00:00.000Z", checkedInAt: "2026-09-27T19:00:00.000Z" },
          ],
          removed: ["Lily"],
        },
        speedBonus: 4,
      }),
      sourceTask({ id: 3, title: "Still open", completed: false, completedBy: undefined, completedAt: undefined, completedInWeek: undefined }),
      sourceTask({ id: 4, title: "Done this week", completedInWeek: CURRENT, completedAt: "2026-09-28T10:00:00.000Z" }),
      sourceTask({ id: 5, title: "Pending prior", pendingApproval: { byName: "Alex", at: "2026-09-27T20:00:00.000Z", points: 5 } }),
    ];
    seedRollover(harness, tasks);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await ensureCurrentTaskWeek({ now: NOW });
    const live = harness.snapshotTasks();
    const assigned = live.find((task) => task.title === "Dishes")!;
    const open = live.find((task) => task.title === "Yard work")!;
    const crew = live.find((task) => task.title === "Playroom clean")!;

    expect(result.tasksReset).toBe(true);
    expect(assigned).toMatchObject({
      assignee: "Alex",
      points: 7,
      category: "kitchen",
      priority: "high",
      completed: false,
      due: CURRENT,
    });
    expect(assigned.completedBy).toBeUndefined();
    expect(assigned.completedAt).toBeUndefined();
    expect(assigned.completedInWeek).toBeUndefined();
    expect(assigned.pendingApproval).toBeUndefined();
    expect(assigned.sentBackAt).toBeUndefined();
    expect(open).toMatchObject({ universal: true, assignee: "All", assigneeEmoji: "🤝", speedBonus: 3 });
    expect(crew).toMatchObject({ crewSize: 2, speedBonus: 4, crew: { members: [], removed: [] } });
    expect(crew.id).not.toBe(9);
    expect(live.some((task) => task.id === 1 || task.id === 2 || task.id === 9)).toBe(false);
    expect(live.some((task) => task.title === "Still open" && task.id === 3)).toBe(true);
    expect(live.some((task) => task.title === "Done this week" && task.id === 4)).toBe(true);
    expect(live.some((task) => task.title === "Pending prior" && task.id === 5)).toBe(true);
    expect(harness.snapshotData().deletedTaskIds).toEqual(expect.arrayContaining([1, 2, 9]));
  });

  it("merges duplicate prior week and archive rows without creating another week", async () => {
    const harness = createHarness();
    seedRollover(harness, [sourceTask({ id: 1 })], {
      duplicatePrior: true,
      duplicateArchive: true,
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await ensureCurrentTaskWeek({ now: NOW });

    expect(result.previousWeekStart).toBe(PRIOR);
    expect(result.reconciled).toBe(true);
    expect(harness.state.week_data.filter((row) => row.weekStart === PRIOR)).toHaveLength(1);
    expect(harness.state.week_data.filter((row) => row.weekStart === CURRENT)).toHaveLength(1);
    expect(harness.state.week_archive).toHaveLength(1);
    expect(harness.state.week_archive[0]).toMatchObject({
      weekStart: PRIOR,
      points: { Alex: 5 },
    });
    expect(harness.calls.week_data.create).toHaveLength(1);
    expect(harness.calls.week_archive.create).toHaveLength(0);
  });

  it("returns reconciled false on HOF projection failure and repairs without a second week", async () => {
    const harness = createHarness({ hallCreateFailures: 1 });
    seedRollover(harness, [sourceTask({ id: 1 })]);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const first = await ensureCurrentTaskWeek({ now: NOW });
    const second = await ensureCurrentTaskWeek({ now: NOW });

    expect(first.reconciled).toBe(false);
    expect(first.hallOfFameRecorded).toBe(false);
    expect(first.currentWeekData.weekStart).toBe(CURRENT);
    expect(second.reconciled).toBe(true);
    expect(second.hallOfFameRecorded).toBe(true);
    expect(second.tasksReset).toBe(false);
    expect(harness.calls.week_data.create).toHaveLength(1);
    expect(harness.calls.week_archive.create).toHaveLength(1);
    expect(harness.collections.hall_of_fame.create).toHaveBeenCalledTimes(2);
    expect(harness.snapshotTasks().filter((task) => task.title === "Dishes")).toHaveLength(1);
  });

  it("returns reconciled false when a HOF create does not persist", async () => {
    const harness = createHarness({ hallCreateDrops: 1 });
    seedRollover(harness, [sourceTask({ id: 1 })]);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const first = await ensureCurrentTaskWeek({ now: NOW });
    const second = await ensureCurrentTaskWeek({ now: NOW });

    expect(first.reconciled).toBe(false);
    expect(first.hallOfFameRecorded).toBe(false);
    expect(second.reconciled).toBe(true);
    expect(second.hallOfFameRecorded).toBe(true);
    expect(harness.state.hall_of_fame).toHaveLength(1);
    expect(harness.calls.week_data.create).toHaveLength(1);
  });

  it("serializes process-local calls so recurring rows clone only once", async () => {
    const harness = createHarness();
    seedRollover(harness, [sourceTask({ id: 1 })]);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const results = await Promise.all([
      ensureCurrentTaskWeek({ now: NOW }),
      ensureCurrentTaskWeek({ now: NOW }),
    ]);

    expect(results.filter((result) => result.tasksReset)).toHaveLength(1);
    expect(harness.calls.week_archive.create).toHaveLength(1);
    expect(harness.calls.week_data.create).toHaveLength(1);
    expect(harness.snapshotTasks().filter((task) => task.title === "Dishes")).toHaveLength(1);
  });
});

describe("resetRecurringTasksForWeek", () => {
  it("uses the supplied server ID allocator", () => {
    const tasks = [sourceTask({ id: 7 })];
    const result = resetRecurringTasksForWeek(tasks, CURRENT, () => 22);
    expect(result.tasks[0]).toMatchObject({ id: 22, completed: false, due: CURRENT });
    expect(result.deletedTaskIds).toEqual([7]);
  });
});

describe("GET /api/tasks/sync", () => {
  it("runs rollover before returning the snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const harness = createHarness();
      mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(harness.state.week_data).toHaveLength(1);
      expect(harness.state.week_data[0].weekStart).toBe(CURRENT);
      expect(body.snapshot).toMatchObject({
        taskWeekStart: CURRENT,
        weekData: { weekStart: CURRENT, points: {}, history: [] },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
