// @vitest-environment jsdom
// The family NAS and every phone run America/Detroit (UTC-4/-5). The old
// Date-instant comparison dropped the boundary day (local midnight → 04:00Z
// vs a 00:00Z cursor), and the OLD UTC `todayISO()` cursor rolled "today" to
// tomorrow every evening 8pm–midnight local — both fixed. Scenarios pin a
// fixed date through the optional `today` params so this test never rots
// with the wall clock again (the 2026-09-16-pinned version only ever passed
// on the day it was written).
process.env.TZ = "America/Detroit";

import { describe, it, expect } from "vitest";
import { calculateRealStreak, emptyWeekData, getThisWeeksCompletedDates } from "@/lib/task-utils";
import { localTodayISO } from "@/lib/local-date";
import type { Task } from "@/types/tasks";

const WEDNESDAY = "2026-09-16";

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
    const tasks: Task[] = [
      makeTask(1, "Alex", WEDNESDAY),
      makeTask(2, "Alex", addDaysISO(WEDNESDAY, -1)),
      makeTask(3, "Alex", addDaysISO(WEDNESDAY, -2)), // Monday
    ];
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(dates).toHaveLength(3);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(3);
  });

  it("still breaks on the first gap", () => {
    const tasks: Task[] = [
      makeTask(1, "Alex", WEDNESDAY),
      makeTask(2, "Alex", addDaysISO(WEDNESDAY, -2)), // gap yesterday
    ];
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(1);
  });

  it("8:30 PM local is still TODAY (the UTC-cursor rollover regression)", () => {
    // 2026-09-16 20:30 Detroit = 2026-09-17 00:30Z — the old UTC todayISO()
    // said "2026-09-17" and every streak read 0 all evening.
    expect(localTodayISO(new Date("2026-09-17T00:30:00.000Z"))).toBe("2026-09-16");
    // And the walk with that local "today" finds the evening completion.
    const tasks: Task[] = [makeTask(1, "Alex", WEDNESDAY)];
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(1);
  });

  it("a full week (Sunday) counts all seven days back to Monday", () => {
    const sunday = "2026-09-20";
    const tasks: Task[] = Array.from({ length: 7 }, (_, i) => makeTask(i + 1, "Alex", addDaysISO(sunday, -6 + i)));
    const dates = getThisWeeksCompletedDates(tasks, "Alex", sunday);
    expect(dates).toHaveLength(7);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, sunday)).toBe(7);
  });
});
