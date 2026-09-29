// @vitest-environment jsdom
// The analytics "overdue" count scoped tasks with `new Date(t.due) < new Date()`.
//
// A task's `due` is a bare local date ("2026-09-28") — the Tasks page writes
// `localTodayISO()` / `getISO.*`, and PocketBase stores it in a `text` field
// (pb-seed.ts:172). `new Date("2026-09-28")` parses that as **UTC midnight**,
// which in America/Detroit is the *previous local evening*. So the comparison
// ran against a date 4–8 hours early and the count inflated twice over:
//
//   - every evening from 20:00 local, a task due TOMORROW read as overdue;
//   - all day long, a task due TODAY read as overdue.
//
// Both were "overdue" while the family had not missed a deadline. The per-member
// breakdown (the second filter in the same function) repeated the test verbatim.
//
// Legacy labels ("Today", "Tomorrow", "Later" — written by pb-db.ts:236 and
// db/index.ts:142) are not dates at all: `new Date("Today")` is an Invalid Date,
// and `NaN < x` is false, so they were never counted. That behaviour is
// preserved deliberately — making unparseable labels overdue would inflate every
// count the moment this lands.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetFullList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pb-auth", () => ({
  getAuthedPB: async () => ({ collection: () => ({ getFullList: mockGetFullList }) }),
}));

import { getTaskCompletionStats } from "@/lib/schedule-analytics";

const DETROIT = "America/Detroit";

/** Mon 2026-09-28 21:00 EDT === Tue 01:00Z — past the UTC roll-over. */
const MONDAY_EVENING = "2026-09-28T21:00:00-04:00";

function row(id: number, due: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `task ${id}`,
    status: "pending",
    due,
    assignee: "Caspian",
    createdAt: "2026-09-20T14:00:00.000Z",
    ...over,
  };
}

async function overdueFor(rows: unknown[]): Promise<number> {
  mockGetFullList.mockResolvedValue(rows);
  const stats = await getTaskCompletionStats("family-1", "month");
  return stats.overdueTasks;
}

beforeEach(() => {
  process.env.TZ = DETROIT;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(MONDAY_EVENING));
  mockGetFullList.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = DETROIT;
});

describe("analytics overdue count uses the LOCAL calendar day", () => {
  it("does not count a task due today as overdue", async () => {
    expect(await overdueFor([row(1, "2026-09-28")])).toBe(0);
  });

  it("does not count a task due tomorrow as overdue, in the evening", async () => {
    // 20:00 local is the hour the old comparison flipped: `new Date("2026-09-29")`
    // is Mon 20:00 local, so "due tomorrow" read as already late.
    expect(await overdueFor([row(1, "2026-09-29")])).toBe(0);
  });

  it("still counts a task whose local due date has passed", async () => {
    expect(await overdueFor([row(1, "2026-09-27")])).toBe(1);
  });

  it("counts only the genuinely late tasks in a mixed set", async () => {
    const rows = [
      row(1, "2026-09-25"), // late
      row(2, "2026-09-26"), // late
      row(3, "2026-09-27"), // late
      row(4, "2026-09-28"), // today
      row(5, "2026-09-29"), // tomorrow
      row(6, null), // no due date
      row(7, "2026-09-26", { status: "done" }), // done — never overdue
    ];
    expect(await overdueFor(rows)).toBe(3);
  });

  it("ignores legacy labels that are not dates", async () => {
    const rows = [row(1, "Today"), row(2, "Tomorrow"), row(3, "Later"), row(4, "")];
    expect(await overdueFor(rows)).toBe(0);
  });

  it("applies the same rule to the per-member breakdown", async () => {
    mockGetFullList.mockResolvedValue([
      row(1, "2026-09-27", { assignee: "Caspian" }), // late
      row(2, "2026-09-28", { assignee: "Caspian" }), // today
      row(3, "2026-09-29", { assignee: "Emily" }), // tomorrow
    ]);
    const stats = await getTaskCompletionStats("family-1", "month");
    const byName = Object.fromEntries(stats.memberStats.map((m: any) => [m.memberId, m.overdueTasks]));
    expect(stats.overdueTasks).toBe(1);
    expect(byName.Caspian).toBe(1);
    expect(byName.Emily).toBe(0);
  });
});
