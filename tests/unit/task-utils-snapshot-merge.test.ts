// @vitest-environment jsdom
// Pin TZ so week math in task-utils is deterministic.
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import { localWeekStartISO } from "@/lib/local-date";
import {
  applyTasksSnapshotToStores,
  emptyWeekData,
  mergeTasksSnapshot,
  saveTasks,
  saveWeekData,
  TASKS_STORAGE_KEY,
  WEEK_DATA_KEY,
} from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    due: "2026-09-04",
    points: 5,
    recurring: null,
    category: "kitchen",
    completed: false,
    priority: "medium",
    ...overrides,
  } as Task;
}

describe("mergeTasksSnapshot (pure restore guards — same contract as the Tasks page)", () => {
  it("null/undefined snapshot is a no-op", () => {
    const tasks = [makeTask()];
    const week = emptyWeekData();
    const res = mergeTasksSnapshot(tasks, week, null);
    expect(res.tasks).toBe(tasks);
    expect(res.weekData).toBe(week);
    expect(res.tasksChanged).toBe(false);
    expect(res.weekChanged).toBe(false);
  });

  it("adopts new tasks preserving real ids + completion attribution", () => {
    const local = [makeTask({ id: 1, title: "Dishes" })];
    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: 7, title: "Recycle", assigned: "Caspian", completed: true, completedBy: "Caspian", completedAt: "2026-09-03T10:00:00Z", completedInWeek: localWeekStartISO() },
      ],
    });
    expect(res.tasksChanged).toBe(true);
    const adopted = res.tasks.find((t) => t.title === "Recycle") as any;
    expect(adopted.id).toBe(7);
    expect(adopted.assignee).toBe("Caspian"); // assigned → assignee bridge
    expect(adopted.completedBy).toBe("Caspian");
    expect(adopted.completedInWeek).toBe(localWeekStartISO());
  });

  it("never duplicates a task already present by id OR by (title + assignee)", () => {
    const local = [makeTask({ id: 1, title: "Dishes" }), makeTask({ id: 2, title: "Laundry" })];
    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: 1, title: "Dishes (renamed row)" },
        // Same title AND assignee as the local "Laundry" → one logical row.
        { id: 99, title: "Laundry", assignee: "Alex" },
      ],
    });
    expect(res.tasksChanged).toBe(false);
    expect(res.tasks).toBe(local);
  });

  it("dedupes WITHIN the snapshot — two id-less rows sharing a title land once", () => {
    const local = [makeTask({ id: 1, title: "Dishes" })];
    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: "a1", title: "Water the plants", assigned: "Aurora" },
        { id: "a2", title: "Water the plants", assigned: "Aurora" },
      ],
    });
    const landed = res.tasks.filter((t: any) => t.title === "Water the plants");
    expect(landed).toHaveLength(1);
  });

  it("dedupes WITHIN the snapshot — the same id never lands twice (React keys stay unique)", () => {
    const local = [makeTask({ id: 1, title: "Dishes" })];
    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: 55, title: "Tidy the playroom", assigned: "Bailey" },
        { id: 55, title: "Tidy the playroom (renamed elsewhere)", assigned: "Bailey" },
      ],
    });
    const landed = res.tasks.filter((t: any) => t.id === 55);
    expect(landed).toHaveLength(1);
    // First row wins — the append order is preserved.
    expect(landed[0].title).toBe("Tidy the playroom");
  });

  it("keeps a partial crew award list (and crewCloseMode) through a stale server pull", () => {
    // Local row: a parent closed a crew of 4 into approval with a PARTIAL
    // award list — only Caspian + Aurora checked in (spec 2026-09-29 §6:
    // the existing gates must treat that as ordinary pending data, with no
    // full-crew assumption anywhere in the merge path).
    const local = [makeTask({
      id: 42,
      title: "Backyard cleanup",
      assignee: "Crew",
      assigneeEmoji: "🤝",
      completed: true,
      completedBy: "Crew",
      completedAt: "2026-09-30T10:00:00.000Z",
      completedInWeek: localWeekStartISO(),
      crewSize: 4,
      crew: {
        members: [
          { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-30T07:00:00.000Z", checkedInAt: "2026-09-30T09:00:00.000Z" },
          { name: "Bailey Garcia", emoji: "👧", joinedAt: "2026-09-30T07:05:00.000Z" },
          { name: "Aurora Garcia", emoji: "🌈", joinedAt: "2026-09-30T07:10:00.000Z", checkedInAt: "2026-09-30T09:10:00.000Z" },
          { name: "Lily Garcia", emoji: "🐰", joinedAt: "2026-09-30T07:15:00.000Z" },
        ],
        removed: [],
      },
      crewCloseMode: "parent",
      pendingApproval: {
        byName: "Crew",
        at: "2026-09-30T10:00:00.000Z",
        points: 15,
        crew: ["Caspian Garcia", "Aurora Garcia"],
      },
    })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        {
          id: 42,
          title: "Backyard cleanup",
          assignee: "Crew",
          // Stale pull: the close never reached the server copy — still open.
          completed: false,
          crewSize: 4,
          crew: {
            members: [
              { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-30T07:00:00.000Z" },
              { name: "Bailey Garcia", emoji: "👧", joinedAt: "2026-09-30T07:05:00.000Z" },
              { name: "Aurora Garcia", emoji: "🌈", joinedAt: "2026-09-30T07:10:00.000Z" },
              { name: "Lily Garcia", emoji: "🐰", joinedAt: "2026-09-30T07:15:00.000Z" },
            ],
            removed: [],
          },
        },
      ],
      weekData: emptyWeekData(),
    });

    const row = res.tasks.find((task) => task.id === 42) as any;
    expect(row).toBeDefined();
    // No earn tx and no send-back stamp in the pull → the pending-proof gate
    // keeps the LOCAL row, award list and all.
    expect(row.pendingApproval).toEqual({
      byName: "Crew",
      at: "2026-09-30T10:00:00.000Z",
      points: 15,
      crew: ["Caspian Garcia", "Aurora Garcia"],
    });
    expect(row.completed).toBe(true);
    expect(row.crewCloseMode).toBe("parent");
  });

  it("adopts a NEWER week, always adopts the same-week server leg, refuses an OLDER week", () => {
    const local = emptyWeekData(); // current week, empty history
    // Older snapshot week: a device that missed the Monday rollover. Adopting
    // it would resurrect last week's points into the fresh week — refused.
    const olderWeek = { ...emptyWeekData("2020-01-06"), points: { Alex: 10 } };
    const olderRes = mergeTasksSnapshot([], local, { weekData: olderWeek });
    expect(olderRes.weekChanged).toBe(false);
    expect(olderRes.weekData).toBe(local);

    const richer = { ...local, history: [{ id: 1, timestamp: "t", member: "Alex", type: "earn", amount: 5, description: "x" }] } as any;
    const richRes = mergeTasksSnapshot([], local, { weekData: richer });
    expect(richRes.weekChanged).toBe(true);
    expect(richRes.weekData.history).toHaveLength(1);

    // Task 10: the same-week server leg is authoritative even when it is
    // SHORTER. Every ledger write is a durable command, so a locally held
    // transaction always has a queued command behind it and a shorter server
    // ledger is the server's answer — not evidence of a lost local row.
    const serverShorter = mergeTasksSnapshot([], richer, { weekData: local });
    expect(serverShorter.weekChanged).toBe(true);
    expect(serverShorter.weekData.history).toHaveLength(0);
  });
});

describe("applyTasksSnapshotToStores (the 60s refresh seam into localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("merges another device's task into the store loadTasks() reads", () => {
    saveTasks([makeTask({ id: 1, title: "Dishes" })]);
    saveWeekData(emptyWeekData());

    const changed = applyTasksSnapshotToStores({
      tasks: [{ id: 8, title: "Feed the fish", assigned: "Rebecca" }],
    });
    expect(changed).toBe(true);
    const stored = JSON.parse(localStorage.getItem(TASKS_STORAGE_KEY)!);
    expect(stored.map((t: any) => t.title)).toEqual(expect.arrayContaining(["Dishes", "Feed the fish"]));
  });

  it("a deep-equal canonical week reports weekChanged:false and returns the SAME reference", () => {
    const local = { ...emptyWeekData(), points: { Alex: 5 } };
    const identical = { ...local };
    const result = mergeTasksSnapshot([], local, { weekData: identical });

    // A 60s pull that changed nothing must not churn the store, re-render every
    // subscriber, or look like an adoption.
    expect(result.weekChanged).toBe(false);
    expect(result.weekData).toBe(local);
  });

  it("a genuinely different canonical week still reports weekChanged:true", () => {
    const local = emptyWeekData();
    const moved = { ...local, points: { Alex: 5 } };
    const result = mergeTasksSnapshot([], local, { weekData: moved });

    expect(result.weekChanged).toBe(true);
    expect(result.weekData).not.toBe(local);
    expect(result.weekData.points).toEqual({ Alex: 5 });
  });

  it("applyTasksSnapshotToStores writes nothing for a deep-equal refresh", () => {
    saveTasks([]);
    const week = emptyWeekData();
    saveWeekData(week);
    const rawWeek = localStorage.getItem(WEEK_DATA_KEY);

    const changed = applyTasksSnapshotToStores({ tasks: [], weekData: { ...week } });

    expect(changed).toBe(false);
    expect(localStorage.getItem(WEEK_DATA_KEY)).toBe(rawWeek);
  });

  it("a no-change task refresh rewrites the identical week leg (no task churn)", () => {
    saveTasks([makeTask({ id: 1, title: "Dishes" })]);
    saveWeekData(emptyWeekData());
    const rawTasks = localStorage.getItem(TASKS_STORAGE_KEY);
    const week = emptyWeekData();

    const changed = applyTasksSnapshotToStores({
      tasks: [{ id: 1, title: "Dishes" }],
      weekData: week,
    });
    // The task leg is byte-identical and the week leg is deep-equal, so a
    // no-op refresh writes nothing at all.
    expect(localStorage.getItem(TASKS_STORAGE_KEY)).toBe(rawTasks);
    expect(changed).toBe(false);
    expect(JSON.parse(localStorage.getItem(WEEK_DATA_KEY)!)).toEqual(week);
  });

  it("persists a richer same-week history so cross-device points land", () => {
    saveTasks([]);
    saveWeekData(emptyWeekData());
    const changed = applyTasksSnapshotToStores({
      weekData: {
        weekStart: localWeekStartISO(),
        points: { Alex: 5 },
        streak: {},
        lastActive: {},
        history: [{ id: 1, timestamp: "t", member: "Alex", type: "earn", amount: 5, description: "x" }],
      },
    });
    expect(changed).toBe(true);
    const week = JSON.parse(localStorage.getItem(WEEK_DATA_KEY)!);
    expect(week.history).toHaveLength(1);
    expect(week.points.Alex).toBe(5);
  });
});
