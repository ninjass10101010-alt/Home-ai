// @vitest-environment jsdom
// Two family members can legitimately have the SAME chore title ("Walking
// Dogs" for Bailey, Emily and Jasmine). The snapshot merge used to dedupe by
// title alone, so only the first survived and the rest were silently dropped.
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import { mergeTasksSnapshot, emptyWeekData } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const t = (over: Partial<Task>): Task => ({
  id: 1, title: "Walking Dogs", assignee: "All", assigneeEmoji: "👧",
  due: "2026-09-20", points: 10, recurring: null, category: "chores",
  completed: false, priority: "medium", ...over,
} as Task);

beforeEach(() => localStorage.clear());

describe("mergeTasksSnapshot — same title, different assignee", () => {
  it("keeps one row per assignee instead of collapsing same-titled chores", () => {
    const local = [t({ id: 1, assignee: "Bailey" })];
    const { tasks } = mergeTasksSnapshot(local, emptyWeekData("2026-09-21"), {
      tasks: [t({ id: 1, assignee: "Bailey" }), t({ id: 2, assignee: "Emily" }), t({ id: 3, assignee: "Jasmine" })],
    });
    expect(tasks.filter((x) => x.title === "Walking Dogs").map((x) => x.assignee).sort())
      .toEqual(["Bailey", "Emily", "Jasmine"]);
  });

  it("still dedupes a true duplicate (same id, or same title AND assignee)", () => {
    const { tasks } = mergeTasksSnapshot([], emptyWeekData("2026-09-21"), {
      tasks: [t({ id: 5, assignee: "Bailey" }), t({ id: 5, assignee: "Bailey" })],
    });
    expect(tasks).toHaveLength(1);
  });
});
