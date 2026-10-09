// B2 — week-attribution correctness.
//
// One predicate owns "was this task completed inside the week that starts on
// `weekStart`". Before B2, six read surfaces each re-derived the answer, and
// both leaderboard counts compared a UTC `completedAt` instant to a date-only
// LOCAL Monday string: lexically `"2026-10-05T02:00:00.000Z" >= "2026-10-05"`
// is TRUE, and that instant is Sunday 22:00 in Detroit — so a Sunday-evening
// completion was pulled INTO the new week the moment the rollover flipped
// `weekData.weekStart` (it runs on every sync).
//
// Every fixture instant below is quoted from the plan's §0.5 instant table,
// which re-derived each one by EXECUTING the real helpers under
// TZ=America/Detroit:
//   2026-10-05T02:00:00.000Z → Sun 2026-10-04 22:00 EDT (NOT Mon 22:00)
//   2026-10-07T14:00:00.000Z → Wed 2026-10-07 10:00 EDT
//   2026-10-07T23:00:00.000Z → Wed 2026-10-07 19:00 EDT
//   2026-10-08T00:30:00.000Z → Wed 2026-10-07 20:30 EDT
//   2026-10-09T15:00:00.000Z → Fri 2026-10-09 11:00 EDT
//   2026-10-05T15:00:00.000Z → Mon 2026-10-05 11:00 EDT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getThisWeeksCompletedTasks,
  isCompletedInWeek,
  needsStreakSave,
} from "@/lib/task-utils";

const DETROIT = "America/Detroit";

function atLocal(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  process.env.TZ = DETROIT;
});

afterEach(() => {
  vi.useRealTimers();
  // Mandatory restore — vitest.config.ts:15 pins the whole run to America/Detroit.
  process.env.TZ = DETROIT;
});

describe("isCompletedInWeek — the one predicate (D1/D2)", () => {
  it("counts an unstamped completion made inside the week (the D1/D2 shared rule)", () => {
    atLocal("2026-10-07T21:00:00-04:00"); // Wed 21:00 EDT — today 2026-10-07, monday 2026-10-05
    expect(
      isCompletedInWeek(
        { completed: true, completedAt: "2026-10-07T23:00:00.000Z", completedInWeek: undefined },
        "2026-10-05"
      )
    ).toBe(true);
  });

  it("REFUTES the leaderboard's raw compare: a Sunday-evening completion is NOT this week", () => {
    // 2026-10-05T02:00:00.000Z is Sun 2026-10-04 22:00 EDT — the week that
    // ENDED, whose Monday is 2026-09-28. `completedAt >= "2026-10-05"` is TRUE,
    // so the old leaderboard predicate pulled it into the new week; the
    // local-day predicate must not.
    atLocal("2026-10-05T09:00:00-04:00"); // Mon 09:00 EDT — the rollover already flipped
    const row = { completed: true, completedAt: "2026-10-05T02:00:00.000Z", completedInWeek: undefined };
    expect(isCompletedInWeek(row, "2026-10-05")).toBe(false);
    // Control: the exact expression the two leaderboards used.
    expect(row.completedAt >= "2026-10-05").toBe(true);
  });

  it("keeps the stamp authoritative: a STAMPED row from another week is never this week", () => {
    atLocal("2026-10-05T12:00:00-04:00"); // Mon 12:00 EDT — today 2026-10-05
    expect(
      isCompletedInWeek(
        { completed: true, completedAt: "2026-10-05T15:00:00.000Z", completedInWeek: "2026-09-28" },
        "2026-10-05"
      )
    ).toBe(false);
  });

  it("is false for an incomplete task and for a clock-skewed future completion", () => {
    atLocal("2026-10-07T12:00:00-04:00"); // Wed 12:00 EDT — today 2026-10-07
    expect(isCompletedInWeek({ completed: false, completedAt: "2026-10-07T15:00:00.000Z" }, "2026-10-05")).toBe(false);
    expect(isCompletedInWeek({ completed: true, completedAt: "2026-10-09T15:00:00.000Z" }, "2026-10-05")).toBe(false);
  });
});

describe("the leaderboard surfaces read the one predicate (D1)", () => {
  it("no leaderboard surface compares a completedAt instant to a date-only week string", () => {
    for (const file of [
      "src/app/tasks/page.tsx",
      "src/components/leaderboard/hooks/useLeaderboardData.ts",
      "src/lib/task-utils.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(
        /completedAt\s*>=\s*(currentMonday|currentWeek\.weekStart|weekData\.weekStart|monday)/
      );
    }
  });
});

describe("A4 — the streak-save nag is a LOCAL day", () => {
  it("a chore finished at 20:30 local counts as done today", () => {
    atLocal("2026-10-07T20:30:00-04:00"); // Wed 20:30 EDT — today 2026-10-07
    const week = {
      weekStart: "2026-10-05",
      points: {},
      streak: { Caspian: 3 },
      lastActive: {},
      history: [],
    } as never;
    // 2026-10-08T00:30:00.000Z is Wed 2026-10-07 20:30 EDT — the UTC slice read "tomorrow".
    const tasks = [
      { id: 1, title: "Trash", completed: true, completedBy: "Caspian", completedAt: "2026-10-08T00:30:00.000Z" },
    ] as never;
    expect(needsStreakSave("Caspian", week, tasks)).toBe(false); // was `true` (UTC slice)
  });

  it("the page's streak-save gate delegates to the helper and no longer slices the UTC date", () => {
    const src = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");
    expect(src).toMatch(/needsStreakSave\(/);
    expect(src).not.toMatch(/completedAt\.split\("T"\)\[0\]\s*===\s*today/);
  });
});

describe("D6 — the cross-week approval contract", () => {
  it("a cross-week approval keeps the completion stamp and is counted by NO this-week surface", () => {
    // The approval pays the AUTHORITY week (task-approval.ts:1673-1692); no
    // surface may rewrite `completedInWeek` to match the points week.
    atLocal("2026-10-05T12:00:00-04:00"); // Mon 12:00 EDT — today 2026-10-05, monday 2026-10-05
    const row = {
      id: 7,
      completed: true,
      completedBy: "Caspian",
      completedAt: "2026-10-05T15:00:00.000Z", // Mon 11:00 EDT — inside THIS week
      completedInWeek: "2026-09-28", // stamped into the PREVIOUS week
    } as never;
    expect(isCompletedInWeek(row, "2026-10-05")).toBe(false);
    expect(getThisWeeksCompletedTasks([row])).toEqual([]);
    // The leaderboard predicate shape from page.tsx's count.
    const counted = [row].filter(
      (t: { completed: boolean; completedBy: string }) =>
        t.completed && t.completedBy === "Caspian" && isCompletedInWeek(t, "2026-10-05")
    );
    expect(counted).toEqual([]);
  });
});
