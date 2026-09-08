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

import {
  applyTasksSnapshotToStores,
  emptyWeekData,
  mergeTasksSnapshot,
  saveTasks,
  saveWeekData,
  todayMondayISO,
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
        { id: 7, title: "Recycle", assigned: "Caspian", completed: true, completedBy: "Caspian", completedAt: "2026-09-03T10:00:00Z", completedInWeek: todayMondayISO() },
      ],
    });
    expect(res.tasksChanged).toBe(true);
    const adopted = res.tasks.find((t) => t.title === "Recycle") as any;
    expect(adopted.id).toBe(7);
    expect(adopted.assignee).toBe("Caspian"); // assigned → assignee bridge
    expect(adopted.completedBy).toBe("Caspian");
    expect(adopted.completedInWeek).toBe(todayMondayISO());
  });

  it("never duplicates a task already present by id OR by title", () => {
    const local = [makeTask({ id: 1, title: "Dishes" }), makeTask({ id: 2, title: "Laundry" })];
    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: 1, title: "Dishes (renamed row)" },
        { id: 99, title: "Laundry" },
      ],
    });
    expect(res.tasksChanged).toBe(false);
    expect(res.tasks).toBe(local);
  });

  it("adopts a NEWER week and a richer same-week history, ignores a poorer or OLDER week", () => {
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

    const poorer = mergeTasksSnapshot([], richer, { weekData: local });
    expect(poorer.weekChanged).toBe(false);
    expect(poorer.weekData).toBe(richer);
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

  it("a no-change refresh leaves the stores byte-identical (never clobbers local state)", () => {
    saveTasks([makeTask({ id: 1, title: "Dishes" })]);
    saveWeekData(emptyWeekData());
    const rawTasks = localStorage.getItem(TASKS_STORAGE_KEY);
    const rawWeek = localStorage.getItem(WEEK_DATA_KEY);

    const changed = applyTasksSnapshotToStores({
      tasks: [{ id: 1, title: "Dishes" }],
      weekData: emptyWeekData(),
    });
    expect(changed).toBe(false);
    expect(localStorage.getItem(TASKS_STORAGE_KEY)).toBe(rawTasks);
    expect(localStorage.getItem(WEEK_DATA_KEY)).toBe(rawWeek);
  });

  it("persists a richer same-week history so cross-device points land", () => {
    saveTasks([]);
    saveWeekData(emptyWeekData());
    const changed = applyTasksSnapshotToStores({
      weekData: {
        weekStart: todayMondayISO(),
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
