// @vitest-environment jsdom
// Tombstones: a chat-initiated delete must remove the row on every device.
// The client merge is add-only, so a plain removal would be resurrected by the
// next push — `snapshot.deletedTaskIds` is the durable removal signal.
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
  mergeTasksSnapshot,
  loadDeletedTaskIds,
  saveDeletedTaskIds,
  emptyWeekData,
} from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    due: "2026-09-15",
    points: 5,
    recurring: null,
    category: "chores",
    completed: false,
    priority: "medium",
    ...overrides,
  } as Task;
}

beforeEach(() => {
  localStorage.clear();
});

describe("mergeTasksSnapshot — tombstones", () => {
  it("removes a task listed in the snapshot's deletedTaskIds", () => {
    const local = [task({ id: 1, title: "Dishes" }), task({ id: 2, title: "Trash" })];
    const { tasks, tasksChanged, deletedTaskIds } = mergeTasksSnapshot(local, emptyWeekData("2026-09-21"), {
      tasks: [],
      deletedTaskIds: [2],
    });
    expect(tasks.map((t) => t.id)).toEqual([1]);
    expect(tasksChanged).toBe(true);
    expect(deletedTaskIds).toContain(2);
  });

  it("does not resurrect a tombstoned id even when the snapshot still carries the row", () => {
    const local = [task({ id: 7, title: "Sweep" })];
    const { tasks } = mergeTasksSnapshot(local, emptyWeekData("2026-09-21"), {
      tasks: [task({ id: 7, title: "Sweep" })],
      deletedTaskIds: [7],
    });
    expect(tasks.find((t) => t.id === 7)).toBeUndefined();
  });

  it("unions local tombstones with the snapshot's", () => {
    saveDeletedTaskIds([3]);
    const { deletedTaskIds } = mergeTasksSnapshot([], emptyWeekData("2026-09-21"), {
      tasks: [],
      deletedTaskIds: [9],
    });
    expect(deletedTaskIds).toEqual(expect.arrayContaining([3, 9]));
  });

  it("leaves an unrelated snapshot unchanged (no deletion, same references)", () => {
    const local = [task({ id: 1 })];
    const week = emptyWeekData("2026-09-21");
    const { tasks, tasksChanged } = mergeTasksSnapshot(local, week, { tasks: [], deletedTaskIds: [] });
    expect(tasks).toBe(local);
    expect(tasksChanged).toBe(false);
  });
});
