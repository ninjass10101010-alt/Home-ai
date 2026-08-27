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

import {
  calculateRealStreak,
  emptyWeekData,
  getThisWeeksCompletedDates,
  regenerateRecurringTasks,
  todayISO,
  todayMondayISO,
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
        completedInWeek: todayMondayISO(),
      }),
    ];
    const dates = getThisWeeksCompletedDates(tasks);
    expect(dates).toEqual([`${today}T13:00:00.000Z`]);
  });

  it("excludes a completion from before this week's Monday", () => {
    const monday = todayMondayISO();
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

describe("regenerateRecurringTasks", () => {
  it("clones a prior-week completed recurring task once and removes the old completed row", () => {
    const prevMonday = addDays(todayMondayISO(), -7);
    const tasks = [
      makeTask({
        id: 1,
        recurring: "Daily",
        completed: true,
        completedBy: "Alex",
        completedAt: `${prevMonday}T10:00:00.000Z`,
        completedInWeek: prevMonday,
      }),
    ];

    const result = regenerateRecurringTasks(tasks);

    expect(result).toHaveLength(1);
    const clone = result[0];
    expect(clone.id).not.toBe(1);
    expect(clone.completed).toBe(false);
    expect(clone.completedBy).toBeUndefined();
    expect(clone.completedAt).toBeUndefined();
    expect(clone.completedInWeek).toBeUndefined();
    expect(clone.due).toBe(todayISO());
    expect(clone.recurring).toBe("Daily");
  });

  it("is a no-op when run twice in the same week (regen tracker)", () => {
    const prevMonday = addDays(todayMondayISO(), -7);
    const tasks = [
      makeTask({
        id: 1,
        recurring: "Weekly",
        completed: true,
        completedInWeek: prevMonday,
      }),
    ];

    const first = regenerateRecurringTasks(tasks);
    expect(first).toHaveLength(1);
    expect(first[0].completed).toBe(false);

    // Same week, fresh load containing a completed prior-week source again:
    // the tracker blocks a second regen pass.
    const second = regenerateRecurringTasks(tasks);
    expect(second).toEqual(tasks);
  });

  it("does not clone a task completed THIS week", () => {
    const tasks = [
      makeTask({
        id: 1,
        recurring: "Weekly",
        completed: true,
        completedBy: "Alex",
        completedAt: `${todayISO()}T09:00:00.000Z`,
        completedInWeek: todayMondayISO(),
      }),
    ];

    const result = regenerateRecurringTasks(tasks);

    expect(result).toEqual(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  it("produces only ONE clone for duplicate completed rows of the same lineage (no compounding)", () => {
    const prevMonday = addDays(todayMondayISO(), -7);
    const dupA = makeTask({ id: 1, title: "Trash", recurring: "Weekly", completed: true, completedInWeek: prevMonday });
    const dupB = makeTask({ id: 2, title: "Trash", recurring: "Weekly", completed: true, completedInWeek: prevMonday });

    const result = regenerateRecurringTasks([dupA, dupB]);

    const clones = result.filter((t) => !t.completed);
    expect(clones).toHaveLength(1);
    expect(clones[0].title).toBe("Trash");
    // Both stale completed rows are consumed.
    expect(result.filter((t) => t.completed)).toHaveLength(0);

    // The following week, the completed clone regenerates into exactly one
    // fresh pending instance — the lineage never compounds.
    const thisMonday = todayMondayISO();
    localStorage.clear();
    vi.setSystemTime(new Date(`${addDays(thisMonday, 7)}T12:00:00Z`));
    const completedClone = {
      ...clones[0],
      completed: true,
      completedBy: "Alex",
      completedAt: `${addDays(thisMonday, 8)}T10:00:00.000Z`,
      completedInWeek: thisMonday,
    };
    const nextWeek = regenerateRecurringTasks([completedClone]);
    expect(nextWeek.filter((t) => !t.completed)).toHaveLength(1);
    expect(nextWeek.filter((t) => t.completed)).toHaveLength(0);
  });

  it("regenerates universal tasks as assignee All / 🤝", () => {
    const prevMonday = addDays(todayMondayISO(), -7);
    const tasks = [
      makeTask({
        id: 3,
        title: "Yard work",
        recurring: "Weekly",
        universal: true,
        assignee: "Alex",
        assigneeEmoji: "🦊",
        completed: true,
        completedBy: "Alex",
        completedInWeek: prevMonday,
      }),
    ];

    const result = regenerateRecurringTasks(tasks);

    expect(result).toHaveLength(1);
    const clone = result[0];
    expect(clone.universal).toBe(true);
    expect(clone.assignee).toBe("All");
    expect(clone.assigneeEmoji).toBe("🤝");
    expect(clone.completed).toBe(false);
  });
});
