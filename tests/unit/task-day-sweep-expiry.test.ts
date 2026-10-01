import { describe, it, expect } from "vitest";
import { addDaysISO } from "@/lib/due-date-utils";
import { cullExpiredTasksOnTasks } from "@/lib/task-day-sweep";

const TODAY = "2026-10-01";

function task(overrides: Record<string, unknown> = {}): any {
  return {
    id: 300, title: "Trash", assignee: "Alex", assigneeEmoji: "🦊",
    due: "2026-09-28", points: 5, recurring: null, category: "chores",
    priority: "medium", completed: false, expiresAfterDays: 3, ...overrides,
  };
}

describe("addDaysISO", () => {
  it("walks local calendar days", () => {
    expect(addDaysISO("2026-10-01", 3)).toBe("2026-10-04");
    expect(addDaysISO("2026-09-28", 3)).toBe("2026-10-01");
  });
  it("returns null for garbage", () => {
    expect(addDaysISO("Tomorrow", 1)).toBeNull();
    expect(addDaysISO("2026-10-01", 1.5)).toBeNull();
  });
});

describe("cullExpiredTasksOnTasks", () => {
  it("culls on day N+1", () => {
    expect(cullExpiredTasksOnTasks([task()], TODAY).deletedIds).toEqual([300]);
  });
  it("does not cull on day N", () => {
    expect(cullExpiredTasksOnTasks([task({ due: "2026-09-29" })], TODAY).deletedIds).toEqual([]);
  });
  it("never culls a task without a due date", () => {
    expect(cullExpiredTasksOnTasks([task({ due: null })], TODAY).deletedIds).toEqual([]);
  });
  it("never culls completed, pending-approval, or recurring rows", () => {
    expect(cullExpiredTasksOnTasks([task({ completed: true })], TODAY).deletedIds).toEqual([]);
    expect(cullExpiredTasksOnTasks([task({ pendingApproval: { byName: "Alex", at: "t", points: 5 } })], TODAY).deletedIds).toEqual([]);
    expect(cullExpiredTasksOnTasks([task({ recurring: "daily" })], TODAY).deletedIds).toEqual([]);
  });
  it("culls an expired open task and an expired incomplete crew one-off alike", () => {
    const open = task({ id: 301, universal: true });
    const crew = task({ id: 302, crewSize: 2, crew: { members: [] } });
    const result = cullExpiredTasksOnTasks([open, crew], TODAY);
    expect(result.deletedIds.sort()).toEqual([301, 302]);
    expect(result.tasks).toHaveLength(0);
  });
});
