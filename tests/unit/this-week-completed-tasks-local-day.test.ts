// @vitest-environment jsdom
// `getThisWeeksCompletedTasks` scoped "this week's completions" by comparing a
// full ISO instant against DATE-ONLY local strings:
//
//     t.completedAt >= monday && t.completedAt <= now
//
// Lexically, "2026-09-28T14:00:00.000Z" > "2026-09-28", so the second half is
// false for **any** completion made on the current day. A task with no
// `completedInWeek` stamp — an older row, or one synced from PocketBase without
// it — therefore never appears in this week's completions at all, no matter
// which day it was done. The first clause (`completedInWeek === monday`) masks
// this for freshly-stamped tasks, which is why the defect is easy to miss: it
// only bites the unstamped ones.
//
// Both feeds are user-visible: `tasks/page.tsx:1502` (the Tasks board's
// this-week filter) and `KidHome.tsx:391` (the kid's "Done today" card).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getThisWeeksCompletedTasks } from "@/lib/task-utils";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import type { Task } from "@/types/tasks";

const DETROIT = "America/Detroit";

function atLocal(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: 1,
    title: "Trash",
    assignee: "Caspian",
    assigneeEmoji: "🧒",
    due: "2026-09-28",
    points: 5,
    recurring: null,
    category: "chores",
    completed: true,
    completedBy: "Caspian",
    completedAt: "2026-09-28T14:00:00.000Z", // Mon 10:00 EDT
    priority: "medium",
    ...over,
  } as Task;
}

beforeEach(() => {
  process.env.TZ = DETROIT;
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = DETROIT;
});

describe("getThisWeeksCompletedTasks — an unstamped completion is still this week's", () => {
  it("includes a completion made earlier TODAY with no completedInWeek stamp", () => {
    atLocal("2026-09-28T21:00:00-04:00"); // Mon 21:00 EDT === Tue 01:00Z
    const tasks = [makeTask({ completedInWeek: undefined })];
    expect(
      getThisWeeksCompletedTasks(tasks).map((t) => t.title),
      "an instant must not be compared to a date-only string"
    ).toEqual(["Trash"]);
  });

  it("includes it at 10:00 local too, and excludes last week's", () => {
    atLocal("2026-09-28T10:00:00-04:00");
    const tasks = [
      makeTask({ id: 1, title: "This morning", completedInWeek: undefined }),
      makeTask({
        id: 2,
        title: "Last week",
        completedInWeek: undefined,
        completedAt: "2026-09-20T14:00:00.000Z", // Sun 2026-09-20
      }),
    ];
    expect(getThisWeeksCompletedTasks(tasks).map((t) => t.title)).toEqual(["This morning"]);
  });

  it("keeps the completedInWeek fast path working", () => {
    atLocal("2026-09-28T21:00:00-04:00");
    const stamped = makeTask({ id: 1, title: "Stamped", completedInWeek: localWeekStartISO() });
    expect(getThisWeeksCompletedTasks([stamped]).map((t) => t.title)).toEqual(["Stamped"]);
  });

  it("still excludes an incomplete task and one from a prior week", () => {
    atLocal("2026-09-28T21:00:00-04:00");
    const tasks = [
      makeTask({ id: 1, title: "Open", completed: false, completedInWeek: undefined }),
      makeTask({
        id: 2,
        title: "Prior week",
        completedInWeek: "2026-09-14",
        completedAt: "2026-09-15T14:00:00.000Z",
      }),
    ];
    expect(getThisWeeksCompletedTasks(tasks)).toEqual([]);
  });

  it("agrees with the week the other helper computes", () => {
    atLocal("2026-09-28T21:00:00-04:00");
    // 2026-09-28 IS a Monday, so this week starts on it (2026-09-21 is the
    // previous one) — even at 21:00 local, when the UTC date has rolled over.
    expect(localTodayISO()).toBe("2026-09-28");
    expect(localWeekStartISO()).toBe("2026-09-28");
  });
});
