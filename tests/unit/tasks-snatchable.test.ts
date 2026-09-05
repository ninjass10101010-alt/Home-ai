import { describe, it, expect, vi } from "vitest";
import type { Task } from "@/types/tasks";

vi.mock("@/db", () => ({ db: { upsertTask: vi.fn(async () => ({})) } }));

import { db } from "@/db";
import { isSnatchable, syncTasksToPB } from "@/lib/task-utils";

function t(over: Partial<Task>): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Emily",
    assigneeEmoji: "👧",
    due: "2026-09-04",
    points: 10,
    recurring: null,
    category: "Chores",
    completed: false,
    priority: "medium",
    ...over,
  };
}

const TODAY = "2026-09-04";

describe("isSnatchable", () => {
  it("true only for stealable, incomplete tasks with due strictly before today", () => {
    expect(isSnatchable(t({ stealable: true, due: "2026-09-03" }), TODAY)).toBe(true);
    expect(isSnatchable(t({ stealable: true, due: TODAY }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "2026-09-05" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, completed: true, due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: false, due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ due: "2026-09-03" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "" }), TODAY)).toBe(false);
    expect(isSnatchable(t({ stealable: true, due: "2026-09-03", universal: true }), TODAY)).toBe(true);
  });

  it("defaults `today` to the real local date", () => {
    expect(isSnatchable(t({ stealable: true, due: "2026-08-01" }))).toBe(true); // long past
    expect(isSnatchable(t({ stealable: true, due: "2999-01-01" }))).toBe(false); // far future
  });
});

describe("syncTasksToPB stealable persistence", () => {
  it("writes stealable:true when set, false otherwise", async () => {
    await syncTasksToPB([
      t({ stealable: true }),
      t({ id: 2, title: "No flag" }),
    ]);
    const calls = vi.mocked(db.upsertTask).mock.calls;
    expect(calls[0][0].stealable).toBe(true);
    expect(calls[1][0].stealable).toBe(false);
  });
});
