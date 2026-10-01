// @vitest-environment jsdom
// Pin TZ so the UTC-noon date math in task-utils is deterministic.
process.env.TZ = "UTC";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

import { localWeekStartISO } from "@/lib/local-date";
import {
  ARCHIVE_KEY,
  TASKS_STORAGE_KEY,
  WEEK_DATA_KEY,
  calculateRealStreak,
  emptyWeekData,
  getDaysUntilWeekReset,
  getThisWeeksCompletedDates,
  loadTasks,
  loadWeekData,
  todayISO,
} from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

// Wednesday — mid-week so Monday/today boundaries are both exercised.
const FIXED_NOW = new Date("2026-08-26T12:00:00Z");

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Dishes",
    assignee: "Alex",
    assigneeEmoji: "🦊",
    due: todayISO(),
    points: 5,
    recurring: null,
    category: "kitchen",
    completed: false,
    priority: "medium",
    ...overrides,
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getThisWeeksCompletedDates", () => {
  it("includes a completion from TODAY despite the full ISO timestamp", () => {
    const today = todayISO();
    const tasks = [
      makeTask({
        completed: true,
        completedBy: "Alex",
        completedAt: `${today}T13:00:00.000Z`,
        completedInWeek: localWeekStartISO(),
      }),
    ];
    const dates = getThisWeeksCompletedDates(tasks);
    expect(dates).toEqual([`${today}T13:00:00.000Z`]);
  });

  it("excludes a completion from before this week's Monday", () => {
    const monday = localWeekStartISO();
    const lastSunday = addDays(monday, -1);
    const tasks = [
      makeTask({
        completed: true,
        completedBy: "Alex",
        completedAt: `${lastSunday}T13:00:00.000Z`,
        completedInWeek: addDays(monday, -7),
      }),
    ];
    expect(getThisWeeksCompletedDates(tasks)).toEqual([]);
  });

  it("filters by memberName when provided", () => {
    const today = todayISO();
    const tasks = [
      makeTask({
        id: 1,
        completed: true,
        completedBy: "Alex",
        completedAt: `${today}T09:00:00.000Z`,
      }),
      makeTask({
        id: 2,
        title: "Trash",
        completed: true,
        completedBy: "Sam",
        completedAt: `${today}T10:00:00.000Z`,
      }),
    ];
    expect(getThisWeeksCompletedDates(tasks, "Alex")).toEqual([
      `${today}T09:00:00.000Z`,
    ]);
    expect(getThisWeeksCompletedDates(tasks, "Sam")).toEqual([
      `${today}T10:00:00.000Z`,
    ]);
    expect(getThisWeeksCompletedDates(tasks)).toHaveLength(2);
  });
});

describe("calculateRealStreak", () => {
  it("counts consecutive days from Monday through today", () => {
    const today = todayISO();
    const completions = [
      `${addDays(today, -2)}T10:00:00.000Z`,
      `${addDays(today, -1)}T10:00:00.000Z`,
      `${today}T10:00:00.000Z`,
    ];
    expect(calculateRealStreak("Alex", emptyWeekData(), completions)).toBe(3);
  });

  it("breaks the streak on a gap day", () => {
    const today = todayISO();
    const completions = [
      `${addDays(today, -2)}T10:00:00.000Z`,
      // yesterday missing — gap
      `${today}T10:00:00.000Z`,
    ];
    expect(calculateRealStreak("Alex", emptyWeekData(), completions)).toBe(1);
  });

  it("yields per-member streaks from member-filtered input", () => {
    const today = todayISO();
    const tasks = [
      makeTask({ id: 1, completed: true, completedBy: "Alex", completedAt: `${addDays(today, -2)}T10:00:00.000Z` }),
      makeTask({ id: 2, title: "Trash", completed: true, completedBy: "Alex", completedAt: `${addDays(today, -1)}T10:00:00.000Z` }),
      makeTask({ id: 3, title: "Laundry", completed: true, completedBy: "Alex", completedAt: `${today}T10:00:00.000Z` }),
      makeTask({ id: 4, title: "Sweep", completed: true, completedBy: "Sam", completedAt: `${today}T11:00:00.000Z` }),
    ];
    const week = emptyWeekData();
    const alexStreak = calculateRealStreak("Alex", week, getThisWeeksCompletedDates(tasks, "Alex"));
    const samStreak = calculateRealStreak("Sam", week, getThisWeeksCompletedDates(tasks, "Sam"));
    expect(alexStreak).toBe(3);
    expect(samStreak).toBe(1);
  });
});

describe("local task caches", () => {
  it("loads prior week data without archiving or resetting local storage", () => {
    const previous = {
      weekStart: addDays(localWeekStartISO(), -7),
      points: { Alex: 5 },
      streak: {},
      lastActive: {},
      history: [],
    };
    localStorage.setItem(WEEK_DATA_KEY, JSON.stringify(previous));

    expect(loadWeekData()).toEqual(previous);
    expect(localStorage.getItem(ARCHIVE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(WEEK_DATA_KEY)!)).toEqual(previous);
  });

  it("loads recurring tasks without regeneration or tracker writes", () => {
    const previous = makeTask({
      recurring: "Weekly",
      completed: true,
      completedInWeek: addDays(localWeekStartISO(), -7),
    });
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify([previous]));

    expect(loadTasks()).toEqual([previous]);
    expect(localStorage.getItem("consuela-regen-week")).toBeNull();
  });
});

describe("getDaysUntilWeekReset", () => {
  // 2026-08-31 is a Monday (2026-08-26 is Wednesday).
  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00Z`));

  it("returns 7 on Monday — the week just began, the reset is next Monday", () => {
    at("2026-08-31"); // Monday
    expect(getDaysUntilWeekReset()).toBe(7);
  });

  it("returns 1 on Sunday — the race resets tomorrow (Monday 00:00)", () => {
    at("2026-08-30"); // Sunday
    expect(getDaysUntilWeekReset()).toBe(1);
  });

  it("counts down across the week (Tue 6 … Sat 2)", () => {
    at("2026-09-01"); // Tuesday
    expect(getDaysUntilWeekReset()).toBe(6);
    at("2026-09-05"); // Saturday
    expect(getDaysUntilWeekReset()).toBe(2);
  });
});
