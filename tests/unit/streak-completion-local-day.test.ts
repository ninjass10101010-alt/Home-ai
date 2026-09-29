// @vitest-environment jsdom
// A completion's CALENDAR day is the LOCAL day it happened on.
//
// `completedAt` is written with `toISOString()` — a UTC instant — but every
// calendar key in this area (`today`, the week start) is a LOCAL date. Slicing
// the UTC string (`d.slice(0, 10)`) therefore compares a UTC day against a
// local day, and the two disagree in a four-hour window on either side of UTC
// midnight:
//
//   behind UTC (Detroit, UTC-4): a completion made 20:00–24:00 local
//     serializes as TOMORROW's UTC date, so it fails `day <= now` and is
//     dropped from the week — the streak reads 0 through the evening, exactly
//     when the family finishes its chores.
//   ahead of UTC (Tokyo, UTC+9): a completion made 00:00–09:00 local
//     serializes as YESTERDAY's UTC date, so a Monday morning chore is read as
//     the preceding Sunday and dropped from the new week.
//
// `streak-week-scope-tz.test.ts` could not see either: every fixture there is
// stamped 10:00Z — 06:00 Detroit, 19:00 Tokyo — the middle of the day in both
// zones, where the UTC date and the local date happen to agree.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { calculateRealStreak, emptyWeekData, getThisWeeksCompletedDates } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const DETROIT = "America/Detroit"; // the family's zone; the vitest.config pin
const TOKYO = "Asia/Tokyo"; // ahead of UTC — the mirror window

// 2026-09-27 Sun · 2026-09-28 Mon · 2026-09-29 Tue · 2026-09-30 Wed
const SUNDAY = "2026-09-27";
const MONDAY = "2026-09-28";
const TUESDAY = "2026-09-29";
const WEDNESDAY = "2026-09-30";

/** A completed task stamped with a FULL ISO instant, the way writers do it. */
function at(id: number, instant: string, by = "Alex"): Task {
  return {
    id,
    title: `task ${id}`,
    assignee: by,
    assigneeEmoji: "🦊",
    due: MONDAY,
    points: 5,
    recurring: null,
    category: "chores",
    completed: true,
    completedBy: by,
    completedAt: instant,
    priority: "medium",
  } as Task;
}

beforeEach(() => {
  process.env.TZ = DETROIT;
});

afterEach(() => {
  process.env.TZ = DETROIT;
});

describe("behind UTC (America/Detroit — the family's zone)", () => {
  it("counts a Monday chore finished at 20:30 local", () => {
    // Mon 2026-09-28 20:30 EDT === 2026-09-29T00:30Z. The UTC date is Tuesday,
    // so `d.slice(0,10) <= "2026-09-28"` fails and the evening chore vanishes.
    const dates = getThisWeeksCompletedDates([at(1, "2026-09-29T00:30:00.000Z")], "Alex", MONDAY);
    expect(dates).toEqual(["2026-09-29T00:30:00.000Z"]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, MONDAY)).toBe(1);
  });

  it("keeps an evening streak alive across three consecutive days", () => {
    // Every completion lands in the next UTC day: Mon→Tue, Tue→Wed, Wed→Thu.
    const instants = [
      "2026-09-29T00:30:00.000Z", // Mon 20:30
      "2026-09-30T00:30:00.000Z", // Tue 20:30
      "2026-10-01T00:30:00.000Z", // Wed 20:30
    ];
    const tasks = instants.map((iso, i) => at(i + 1, iso));
    const dates = getThisWeeksCompletedDates(tasks, "Alex", WEDNESDAY);
    expect(dates).toEqual(instants);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, WEDNESDAY)).toBe(3);
  });

  it("does not pull a Sunday-evening completion into the next week", () => {
    // Sun 2026-09-27 21:00 EDT === 2026-09-28T01:00Z, whose UTC date is the
    // Monday. Comparing the UTC date against `now` counted a last-week chore
    // as this week's, inflating the streak on Monday.
    const dates = getThisWeeksCompletedDates([at(1, "2026-09-28T01:00:00.000Z")], "Alex", MONDAY);
    expect(dates).toEqual([]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, MONDAY)).toBe(0);
  });

  it("still scopes a Sunday-evening completion to the week it ended in", () => {
    // Same instant, read as Sunday: it belongs to the week that closed Sunday.
    const dates = getThisWeeksCompletedDates([at(1, "2026-09-28T01:00:00.000Z")], "Alex", SUNDAY);
    expect(dates).toEqual(["2026-09-28T01:00:00.000Z"]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, SUNDAY)).toBe(1);
  });
});

describe("ahead of UTC (Asia/Tokyo — the mirror window)", () => {
  it("counts a Monday chore finished at 08:00 local", () => {
    process.env.TZ = TOKYO;
    // Mon 2026-09-28 08:00 JST === 2026-09-27T23:00Z. The UTC date is the
    // Sunday, which is before this week's Monday, so the chore was dropped.
    const dates = getThisWeeksCompletedDates([at(1, "2026-09-27T23:00:00.000Z")], "Alex", MONDAY);
    expect(dates).toEqual(["2026-09-27T23:00:00.000Z"]);
    expect(calculateRealStreak("Alex", emptyWeekData(), dates, MONDAY)).toBe(1);
  });

  it("does not pull a Monday-evening completion back into the previous week", () => {
    process.env.TZ = TOKYO;
    // Mon 2026-09-28 23:00 JST === 2026-09-28T14:00Z — UTC Monday, but read on
    // Sunday it must not belong to the week that closed Sunday.
    const dates = getThisWeeksCompletedDates([at(1, "2026-09-28T14:00:00.000Z")], "Alex", SUNDAY);
    expect(dates).toEqual([]);
  });
});
