// @vitest-environment jsdom
// The week a streak is scoped to is the LOCAL week containing `today`.
//
// `calculateRealStreak` / `getThisWeeksCompletedDates` take `today` as a
// date-only ISO string ("2026-09-28"). Passing that string to `new Date()`
// parses it as UTC MIDNIGHT, which is the previous local day in any zone
// behind UTC — so on a Monday it landed on the Sunday, and the week walk went
// back one week too far. The family NAS and every phone run America/Detroit,
// so on Mondays the leaderboard and the kid streaks counted the PREVIOUS
// week. `mondayOf(...).toISOString()` had the mirror defect east of UTC, where
// local midnight serializes as the previous UTC day.
//
// Both halves of the bug are pinned here: Detroit (behind UTC, the family's
// zone, the one vitest.config pins) and Asia/Tokyo (ahead of UTC, the mirror
// defect). Every case pins its own date, so nothing here rots with the wall
// clock.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { calculateRealStreak, emptyWeekData, getThisWeeksCompletedDates } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const DETROIT = "America/Detroit"; // the family's zone; also the config pin
const TOKYO = "Asia/Tokyo"; // ahead of UTC — the mirror defect

// 2026-09-21 Mon · 25 Fri · 27 Sun · 28 Mon · 30 Wed
const WEEK_MONDAY = "2026-09-21";
const PREV_FRIDAY = "2026-09-25";
const PREV_SUNDAY = "2026-09-20";
const SUNDAY = "2026-09-27";
const MONDAY = "2026-09-28";
const WEDNESDAY = "2026-09-30";

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeTask(id: number, iso: string, by = "Alex"): Task {
  return {
    id,
    title: `task ${id}`,
    assignee: by,
    assigneeEmoji: "🦊",
    due: iso,
    points: 5,
    recurring: null,
    category: "chores",
    completed: true,
    completedBy: by,
    completedAt: `${iso}T10:00:00.000Z`,
    priority: "medium",
  } as Task;
}

function tasksOn(dates: string[], by = "Alex"): Task[] {
  return dates.map((d, i) => makeTask(i + 1, d, by));
}

beforeEach(() => {
  process.env.TZ = DETROIT;
});

afterEach(() => {
  process.env.TZ = DETROIT;
});

describe("behind UTC (America/Detroit — the family's zone)", () => {
  it("a Monday scopes to THAT Monday, not the previous week's", () => {
    // `today` is Monday 2026-09-28, so 2026-09-25 is last week and must not
    // be in scope. UTC-midnight parsing made it local Sunday the 27th and the
    // week walk started 2026-09-21, so last Friday counted.
    const tasks = tasksOn([PREV_FRIDAY, MONDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", MONDAY);
    expect(dates).toEqual([`${MONDAY}T10:00:00.000Z`]);
    // The walk is contiguous across the week boundary, so the wrong Monday
    // showed up in the streak: last Friday + today = 2, not 1.
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, MONDAY)).toBe(1);
  });

  it("a Monday with an empty current week does not inherit last week's streak", () => {
    const tasks = tasksOn([
      WEEK_MONDAY,
      addDaysISO(WEEK_MONDAY, 1),
      addDaysISO(WEEK_MONDAY, 2),
      addDaysISO(WEEK_MONDAY, 3),
      addDaysISO(WEEK_MONDAY, 4),
    ]);
    expect(getThisWeeksCompletedDates(tasks, "Alex", MONDAY)).toEqual([]);
    expect(calculateRealStreak("Alex", emptyWeekData(), [], MONDAY)).toBe(0);
  });

  it("a Sunday still counts the whole week back to Monday", () => {
    const week = Array.from({ length: 7 }, (_, i) => addDaysISO(SUNDAY, -6 + i));
    const tasks = tasksOn([...week, PREV_SUNDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", SUNDAY);
    expect(dates.map((d) => d.slice(0, 10))).toEqual(week);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, SUNDAY)).toBe(7);
  });

  it("mid-week scopes Monday→today and drops every earlier day", () => {
    const tasks = tasksOn([PREV_SUNDAY, SUNDAY, MONDAY, addDaysISO(MONDAY, 1), WEDNESDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(dates.map((d) => d.slice(0, 10))).toEqual([MONDAY, addDaysISO(MONDAY, 1), WEDNESDAY]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(3);
  });

  it("breaks the streak on a gap day mid-week", () => {
    const tasks = tasksOn([MONDAY, WEDNESDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(1);
  });
});

describe("ahead of UTC (Asia/Tokyo — the mirror defect)", () => {
  it("a Monday scopes to THAT Monday, not the preceding Sunday", () => {
    // Local midnight serialized with toISOString() lands on the previous UTC
    // day here, so the week key read "2026-09-27" and counted the Sunday.
    process.env.TZ = TOKYO;
    const tasks = tasksOn([SUNDAY, MONDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", MONDAY);
    expect(dates).toEqual([`${MONDAY}T10:00:00.000Z`]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, MONDAY)).toBe(1);
  });

  it("a Sunday still counts the whole week back to Monday", () => {
    process.env.TZ = TOKYO;
    const week = Array.from({ length: 7 }, (_, i) => addDaysISO(SUNDAY, -6 + i));
    const tasks = tasksOn([...week, PREV_SUNDAY]);
    const dates = getThisWeeksCompletedDates(tasks, "Alex", SUNDAY);
    expect(dates.map((d) => d.slice(0, 10))).toEqual(week);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, SUNDAY)).toBe(7);
  });
});
