// @vitest-environment jsdom
// The family NAS and every phone run America/Detroit (UTC-4/-5). Pin it so
// the streak walk is exercised behind UTC, where the old Date-instant
// comparison dropped the boundary day (local midnight → 04:00Z vs a 00:00Z
// cursor).
process.env.TZ = "America/Detroit";

import { describe, it, expect } from "vitest";
import { calculateRealStreak, emptyWeekData, getThisWeeksCompletedDates } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeTask(id: number, by: string, iso: string): Task {
  return {
    id,
    title: `task ${id}`,
    assignee: by,
    assigneeEmoji: "🦊",
    due: iso,
    points: 5,
    recurring: null,
    category: "kitchen",
    completed: true,
    completedBy: by,
    completedAt: `${iso}T10:00:00.000Z`,
    completedInWeek: undefined,
    priority: "medium",
  } as Task;
}

describe("calculateRealStreak — behind-UTC timezones (America/Detroit)", () => {
  it("counts a streak that reaches back to Monday without dropping the boundary day", () => {
    // A Wednesday with completions Mon/Tue/Wed → a genuine 3-day streak.
    const wednesday = "2026-09-16";
    const tasks: Task[] = [
      makeTask(1, "Alex", wednesday),
      makeTask(2, "Alex", addDaysISO(wednesday, -1)),
      makeTask(3, "Alex", addDaysISO(wednesday, -2)), // Monday
    ];
    const dates = getThisWeeksCompletedDates(tasks, "Alex");
    expect(dates).toHaveLength(3);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates)).toBe(3);
  });

  it("still breaks on the first gap", () => {
    const wednesday = "2026-09-16";
    const tasks: Task[] = [
      makeTask(1, "Alex", wednesday),
      makeTask(2, "Alex", addDaysISO(wednesday, -2)), // gap yesterday
    ];
    const dates = getThisWeeksCompletedDates(tasks, "Alex");
    expect(calculateRealStreak("Alex", emptyWeekData(), dates)).toBe(1);
  });
});
