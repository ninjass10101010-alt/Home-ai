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

import { emptyWeekData, mergeTasksSnapshot, TASKS_STORAGE_KEY } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    points: 5,
    recurring: null,
    completed: false,
    priority: "medium",
    ...overrides,
  } as Task;
}

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * A task id is only meaningful if the SERVER snapshot still holds that id.
 *
 * `mergeTasksSnapshot` matches rows by id OR by (title + assignee). When a
 * server row matches a local row by (title + assignee) but carries a
 * DIFFERENT id, the old code treated it as "already known" and kept the
 * local id. Every producer of a re-keyed row therefore stranded the device:
 *
 *   - `recurringClone()` (src/lib/task-recurrence.ts) issues the day's clone
 *     with a NEW id and the SAME title/assignee (lineage IS title+cadence+
 *     owner), so the day sweep re-keys the id on every recurrence.
 *   - "Repeat last week" and delete-then-re-add re-create a chore the same way.
 *
 * The stranded id is sent to `POST /api/tasks/manage` {action:"delete"}, the
 * server's `liveSnapshotTasks()` does not contain it, and the command 404s
 * `unknown_task` -> the outbox marks it failed -> "couldn't be sent" -> the
 * display-only optimistic hide is released and the row returns. Forever.
 */
describe("mergeTasksSnapshot — stale-id healing (server id is authoritative)", () => {
  it("adopts the server id when a local row matches by title+assignee but the id is stale", () => {
    const local = [makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    expect(res.tasks.map((t) => t.id)).toEqual([1002]);
    expect(res.tasksChanged).toBe(true);
  });

  it("leaves the id alone when the ids already agree", () => {
    const local = [makeTask({ id: 1002, title: "Feed the cat", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    expect(res.tasks.map((t) => t.id)).toEqual([1002]);
    expect(res.tasksChanged).toBe(false);
  });

  it("does NOT re-key when the same title belongs to a DIFFERENT assignee", () => {
    const local = [makeTask({ id: 5555, title: "Walking Dogs", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [
        { id: 1002, title: "Walking Dogs", assignee: "Bailey", completed: false },
        { id: 1003, title: "Walking Dogs", assignee: "Caspian", completed: false },
      ],
      deletedTaskIds: [],
    });

    expect(res.tasks.map((t) => t.id).sort()).toEqual([1002, 1003, 5555]);
  });

  it("never re-keys onto a tombstoned id", () => {
    const local = [makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [1002],
    });

    // The server row is tombstoned, so it is not a valid target: keep the
    // local row exactly as it was rather than pointing it at a dead id.
    expect(res.tasks.map((t) => t.id)).toEqual([5555]);
  });

  it("never re-keys onto an id another local row already holds", () => {
    const local = [
      makeTask({ id: 1002, title: "Feed the cat", assignee: "Emily" }),
      makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" }),
    ];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    // 1002 is already taken by a live local row; the stale duplicate must not
    // be collapsed onto it (that would silently drop a row the family can see).
    expect(res.tasks).toHaveLength(2);
  });

  it("preserves a local optimistic completion while re-keying", () => {
    const local = [
      makeTask({
        id: 5555,
        title: "Feed the cat",
        assignee: "Emily",
        completed: true,
        completedBy: "Emily",
        completedAt: "2026-09-03T10:00:00Z",
      }),
    ];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    expect(res.tasks[0].id).toBe(1002);
    // A kid's fresh tap must not be wiped by the re-key: the stale snapshot
    // row says not-done, but the local row is the newer truth until proven
    // otherwise by the existing completion gates.
    expect(res.tasks[0].completed).toBe(true);
    expect(res.tasks[0].completedBy).toBe("Emily");
  });

  it("is idempotent — a second merge over the same snapshot changes nothing", () => {
    const local = [makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" })];
    const snapshot = {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    };

    const first = mergeTasksSnapshot(local, emptyWeekData(), snapshot);
    const second = mergeTasksSnapshot(first.tasks, emptyWeekData(), snapshot);

    expect(second.tasks.map((t) => t.id)).toEqual([1002]);
    expect(second.tasksChanged).toBe(false);
  });

  it("does not re-key when the server row's id is not a usable integer", () => {
    const local = [makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: "legacy-abc", title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    expect(res.tasks.map((t) => t.id)).toEqual([5555]);
  });

  it("persists the re-keyed row to the local store", () => {
    const local = [makeTask({ id: 5555, title: "Feed the cat", assignee: "Emily" })];

    const res = mergeTasksSnapshot(local, emptyWeekData(), {
      tasks: [{ id: 1002, title: "Feed the cat", assignee: "Emily", completed: false }],
      deletedTaskIds: [],
    });

    // The Tasks page only calls saveTasks() when tasksChanged is true, so the
    // healed id must actually reach localStorage or the next mount resurrects
    // the stale row from the cache.
    expect(res.tasksChanged).toBe(true);
    expect(res.tasks.map((t) => t.id)).toEqual([1002]);
    expect(TASKS_STORAGE_KEY).toBe("consuela-tasks");
  });
});