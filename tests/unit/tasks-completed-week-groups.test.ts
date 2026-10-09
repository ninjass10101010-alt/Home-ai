// @vitest-environment jsdom
// F1 — the Completed card's week grouping, pure half + the two source scans.
//
// B2_TIP_SHA = 190b626d5e8f4c3f78ae419fabcb69ef532f8c25
// Every "unchanged" claim in F1's report is relative to THAT commit, never to
// the pre-wave file: B2 rewrote `getThisWeeksCompletedTasks` and the
// leaderboard's this-week count, and F1 must leave both of those B2 shapes in
// place. The writer-surface baseline below was captured from that same SHA.
//
// Fixture instants (America/Detroit, EDT = UTC-4), re-derived per the wave
// plan's §0.5 instant table:
//   2026-09-29T01:00:00.000Z -> Mon 2026-09-28 21:00  (week 2026-09-28)
//   2026-09-24T18:00:00.000Z -> Thu 2026-09-24 14:00  (week 2026-09-21)
//   2026-09-14T15:00:00.000Z -> Mon 2026-09-14 11:00  (week 2026-09-14)
//   2026-10-05T02:00:00.000Z -> Sun 2026-10-04 22:00  (week 2026-09-28 — a
//     UTC slice would say 2026-10-05, a Monday: the divergent case)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { groupCompletedTasksByWeek } from "@/lib/task-utils";
import { isCompletedInWeek, isPendingApproval } from "@/lib/task-utils";
import type { Task } from "@/types/tasks";

const DETROIT = "America/Detroit";
const B2_TIP_SHA = "190b626d5e8f4c3f78ae419fabcb69ef532f8c25";

const MON_9PM_EDT = "2026-09-29T01:00:00.000Z";
const PREV_THU = "2026-09-24T18:00:00.000Z";
const TWO_WEEKS_AGO = "2026-09-14T15:00:00.000Z";
const SUN_9PM_UTC_NEXT = "2026-10-05T02:00:00.000Z";
const FUTURE_WEEK = "2026-10-19";

function atLocal(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function makeTask(over: Partial<Task> & { id: number; title: string }): Task {
  return {
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    due: "2026-09-28",
    points: 5,
    recurring: null,
    category: "chores",
    completed: true,
    completedBy: "Caspian Garcia",
    priority: "medium",
    ...over,
  } as Task;
}

const originalTz = process.env.TZ;

beforeEach(() => {
  process.env.TZ = DETROIT;
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("groupCompletedTasksByWeek — week attribution", () => {
  beforeEach(() => atLocal("2026-09-28T21:00:00-04:00")); // Mon 21:00 EDT

  it("groups a stamped row by its STAMP, even when its instant belongs to another week", () => {
    const stampedPrior = makeTask({
      id: 1,
      title: "Stamped prior",
      completedAt: MON_9PM_EDT,
      completedInWeek: "2026-09-21",
    });
    const g = groupCompletedTasksByWeek([stampedPrior], "2026-09-28");
    expect(g.weeks.map((w) => w.key)).toContain("2026-09-21");
    expect(g.weeks.map((w) => w.key)).not.toContain("2026-09-28");
    expect(g.weeks.find((w) => w.key === "2026-09-21")!.tasks.map((t) => t.id)).toEqual([1]);
  });

  it("attributes an UNSTAMPED row by the LOCAL day of its instant, not the UTC day", () => {
    // "2026-09-29T01:00:00.000Z".slice(0,10) is 2026-09-29; its naive Monday
    // is also 2026-09-28, so this fixture agrees by construction — the
    // DIVERGENT case is the next assertion.
    const unstamped = makeTask({ id: 1, title: "Unstamped", completedAt: MON_9PM_EDT });
    const g1 = groupCompletedTasksByWeek([unstamped], "2026-09-28");
    expect(g1.weeks[0].key).toBe("2026-09-28");

    const divergent = makeTask({ id: 2, title: "Sunday night", completedAt: SUN_9PM_UTC_NEXT });
    const g2 = groupCompletedTasksByWeek([divergent], "2026-09-28");
    expect(g2.weeks.map((w) => w.key)).toEqual(["2026-09-28"]);
    expect(g2.weeks.map((w) => w.key)).not.toContain("2026-10-05");
  });

  it("never attributes a row with neither stamp nor instant", () => {
    const undated = makeTask({ id: 3, title: "Undated chore", completedAt: undefined, completedInWeek: undefined });
    const g = groupCompletedTasksByWeek([undated], "2026-09-28");
    expect(g.unattributed.map((t) => t.title)).toEqual(["Undated chore"]);
    expect(g.weeks).toEqual([]);
    expect(g.pending).toEqual([]);
  });
});

describe("groupCompletedTasksByWeek — group order", () => {
  beforeEach(() => atLocal("2026-09-28T21:00:00-04:00"));

  it("puts this week first, then previous weeks newest-first", () => {
    const rows = [
      makeTask({ id: 1, title: "This week", completedAt: MON_9PM_EDT }),
      makeTask({ id: 2, title: "Stamped prior", completedAt: MON_9PM_EDT, completedInWeek: "2026-09-21" }),
      makeTask({ id: 3, title: "Prev Thursday", completedAt: PREV_THU }),
      makeTask({ id: 4, title: "Two weeks ago", completedAt: TWO_WEEKS_AGO }),
      makeTask({ id: 5, title: "Sunday divergent", completedAt: SUN_9PM_UTC_NEXT }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.weeks.map((w) => w.key)).toEqual(["2026-09-28", "2026-09-21", "2026-09-14"]);
  });

  it("keeps a FUTURE-stamped week BELOW this week", () => {
    const rows = [
      makeTask({ id: 1, title: "This week", completedAt: MON_9PM_EDT }),
      makeTask({ id: 2, title: "Future", completedInWeek: FUTURE_WEEK, completedAt: "2026-10-19T14:00:00.000Z" }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.weeks.map((w) => w.key)).toEqual(["2026-09-28", FUTURE_WEEK]);
    expect(g.weeks.find((w) => w.key === FUTURE_WEEK)!.label).toBe("Week of Oct 19–Oct 25");
    expect(g.weeks.find((w) => w.key === FUTURE_WEEK)!.label).not.toBe("This week");
  });

  it("labels the current week 'This week' and every other 'Week of <Mon>–<Sun>'", () => {
    const rows = [
      makeTask({ id: 1, title: "This week", completedAt: MON_9PM_EDT }),
      makeTask({ id: 2, title: "Prev", completedAt: PREV_THU }),
      makeTask({ id: 3, title: "Older", completedAt: TWO_WEEKS_AGO }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.weeks.map((w) => [w.key, w.label])).toEqual([
      ["2026-09-28", "This week"],
      ["2026-09-21", "Week of Sep 21–Sep 27"],
      ["2026-09-14", "Week of Sep 14–Sep 20"],
    ]);
  });
});

describe("groupCompletedTasksByWeek — within-group order", () => {
  beforeEach(() => atLocal("2026-09-28T21:00:00-04:00"));

  it("orders most-recently-completed first", () => {
    const rows = [
      makeTask({ id: 1, title: "early", completedAt: "2026-09-28T13:00:00.000Z" }),
      makeTask({ id: 2, title: "late", completedAt: "2026-09-28T17:00:00.000Z" }),
      makeTask({ id: 3, title: "mid", completedAt: "2026-09-28T15:00:00.000Z" }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.weeks[0].tasks.map((t) => t.title)).toEqual(["late", "mid", "early"]);
  });

  it("puts an undated row LAST, not first", () => {
    const rows = [
      makeTask({ id: 1, title: "dated", completedAt: "2026-09-28T13:00:00.000Z" }),
      makeTask({ id: 2, title: "undated", completedAt: undefined, completedInWeek: "2026-09-28" }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.weeks[0].tasks.map((t) => t.title)).toEqual(["dated", "undated"]);
  });

  it("breaks a timestamp tie on ascending id, deterministically", () => {
    const same = "2026-09-28T13:00:00.000Z";
    const a = makeTask({ id: 9, title: "id 9", completedAt: same });
    const b = makeTask({ id: 4, title: "id 4", completedAt: same });
    const forward = groupCompletedTasksByWeek([a, b], "2026-09-28");
    expect(forward.weeks[0].tasks.map((t) => t.title)).toEqual(["id 4", "id 9"]);
    const reversed = groupCompletedTasksByWeek([b, a], "2026-09-28");
    expect(reversed.weeks[0].tasks.map((t) => t.title)).toEqual(["id 4", "id 9"]);
  });
});

describe("groupCompletedTasksByWeek — pending is pinned, not dated", () => {
  beforeEach(() => atLocal("2026-09-28T21:00:00-04:00"));

  it("pulls every pending-approval row out of the week groups", () => {
    const rows = [
      makeTask({
        id: 1,
        title: "Pending one",
        completedAt: MON_9PM_EDT,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T22:00:00.000Z", points: 5 },
      }),
      makeTask({
        id: 2,
        title: "Pending two",
        completedAt: PREV_THU,
        completedInWeek: "2026-09-21",
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-25T22:00:00.000Z", points: 5 },
      }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.pending).toHaveLength(2);
    const groupedIds = g.weeks.flatMap((w) => w.tasks.map((t) => t.id));
    expect(groupedIds).not.toContain(1);
    expect(groupedIds).not.toContain(2);
    expect(g.unattributed).toEqual([]);
  });

  it("orders the pinned rows most-recently-tapped first", () => {
    const rows = [
      makeTask({
        id: 1,
        title: "tapped early",
        completedAt: MON_9PM_EDT,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T22:00:00.000Z", points: 5 },
      }),
      makeTask({
        id: 2,
        title: "tapped late",
        completedAt: MON_9PM_EDT,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T23:30:00.000Z", points: 5 },
      }),
      makeTask({
        id: 3,
        title: "tapped mid",
        completedAt: MON_9PM_EDT,
        pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T23:00:00.000Z", points: 5 },
      }),
    ];
    const g = groupCompletedTasksByWeek(rows, "2026-09-28");
    expect(g.pending.map((t) => t.title)).toEqual(["tapped late", "tapped mid", "tapped early"]);
  });

  it("pins pending even when its stamp names an old week", () => {
    const row = makeTask({
      id: 1,
      title: "Pending old stamp",
      completedAt: MON_9PM_EDT,
      completedInWeek: "2026-08-31",
      pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T22:00:00.000Z", points: 5 },
    });
    const g = groupCompletedTasksByWeek([row], "2026-09-28");
    expect(g.pending.map((t) => t.id)).toEqual([1]);
    expect(g.weeks.map((w) => w.key)).not.toContain("2026-08-31");
  });
});

describe("groupCompletedTasksByWeek — it is display-only", () => {
  beforeEach(() => atLocal("2026-09-28T21:00:00-04:00"));

  const honestRows = () => [
    makeTask({ id: 1, title: "this week", completedAt: MON_9PM_EDT }),
    makeTask({ id: 2, title: "stamped prior", completedAt: MON_9PM_EDT, completedInWeek: "2026-09-21" }),
    makeTask({ id: 3, title: "prev thu", completedAt: PREV_THU }),
    makeTask({ id: 4, title: "two weeks ago", completedAt: TWO_WEEKS_AGO }),
    makeTask({ id: 5, title: "future stamp", completedAt: "2026-10-19T14:00:00.000Z", completedInWeek: FUTURE_WEEK }),
    makeTask({
      id: 6,
      title: "pending",
      completedAt: MON_9PM_EDT,
      pendingApproval: { byName: "Caspian Garcia", at: "2026-09-28T22:00:00.000Z", points: 5 },
    }),
    makeTask({ id: 7, title: "undated", completedAt: undefined, completedInWeek: undefined }),
  ];

  it("does not mutate its input array or its rows", () => {
    const input = honestRows();
    const before = JSON.stringify(input);
    const beforeIds = input.map((t) => t.id);
    groupCompletedTasksByWeek(input, "2026-09-28");
    expect(JSON.stringify(input)).toBe(before);
    expect(input.map((t) => t.id)).toEqual(beforeIds);
  });

  it("renders every row exactly once — none dropped, none duplicated", () => {
    const input = honestRows();
    const g = groupCompletedTasksByWeek(input, "2026-09-28");
    const all = [...g.pending, ...g.weeks.flatMap((w) => w.tasks), ...g.unattributed].map((t) => t.id);
    expect(all.slice().sort((a, b) => a - b)).toEqual(input.map((t) => t.id).sort((a, b) => a - b));
  });

  it("never reads a points field", () => {
    const base = honestRows();
    const poisoned = base.map((t) => ({
      ...t,
      points: 5,
      pendingApproval: t.pendingApproval ? { ...t.pendingApproval, points: 97 } : undefined,
    }));
    const g1 = groupCompletedTasksByWeek(base, "2026-09-28");
    const g2 = groupCompletedTasksByWeek(poisoned, "2026-09-28");
    // The plan asked for a byte-identical JSON.stringify comparison, but the
    // helper returns the CALLER'S ROW OBJECTS — a row's own `points` field is
    // embedded in the output no matter what the helper reads. The invariant
    // that is actually testable, and sufficient, is that every grouping
    // DECISION (bucket membership, group key/label, order) is unchanged by
    // poisoning both points fields. The token-level gate lives in the purity
    // scan below (no `.points` in the helper body).
    const shape = (g: ReturnType<typeof groupCompletedTasksByWeek>) => JSON.stringify({
      pending: g.pending.map((t) => t.id),
      weeks: g.weeks.map((w) => ({ key: w.key, label: w.label, ids: w.tasks.map((t) => t.id) })),
      unattributed: g.unattributed.map((t) => t.id),
    });
    expect(shape(g2)).toBe(shape(g1));
  });

  it("agrees with B2's isCompletedInWeek about which rows are this week's", () => {
    // The plan pinned `today = "2026-09-28"` for both sides, but its own
    // SUN_9PM_UTC_NEXT fixture is a deliberately FUTURE instant relative to
    // that clock: F1 attributes it to its local week (2026-09-28) while B2's
    // predicate scopes to `today` and says "not yet". That comparison would
    // test eligibility, not attribution. Pinning today to the Sunday that
    // closes the same week keeps both sides denominated in the same week and
    // lets every fixture participate.
    const today = "2026-10-04";
    const rows = [
      ...honestRows(),
      makeTask({ id: 8, title: "sunday divergent", completedAt: SUN_9PM_UTC_NEXT }),
    ];
    const grouped = groupCompletedTasksByWeek(rows.filter((t) => t.completed), today);
    const mine = grouped.weeks
      .filter((g) => g.key === "2026-09-28")
      .flatMap((g) => g.tasks.map((t) => t.id))
      .sort((a, b) => a - b);
    const b2 = rows
      .filter((t) => t.completed && !isPendingApproval(t))
      .filter((t) => isCompletedInWeek(t, "2026-09-28", today))
      .map((t) => t.id)
      .sort((a, b) => a - b);
    expect(mine).toEqual(b2);
    expect(mine).toContain(8); // the divergent fixture is in scope, on both sides
  });
});

describe("groupCompletedTasksByWeek — source scans (house idiom)", () => {
  const taskUtilsSource = readFileSync(join(process.cwd(), "src/lib/task-utils.ts"), "utf8");
  const pageSource = readFileSync(join(process.cwd(), "src/app/tasks/page.tsx"), "utf8");

  function lineNumbers(source: string, pattern: RegExp): number[] {
    return source
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
  }

  function exportedBody(source: string, name: string): string {
    const start = source.indexOf(`export function ${name}`);
    if (start < 0) return "";
    const rest = source.slice(start + 1);
    const next = rest.search(/\nexport (function|const|interface|type|class) /);
    return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
  }

  it("F1's helper is pure — no store, no side effect, no points field", () => {
    const body = exportedBody(taskUtilsSource, "groupCompletedTasksByWeek");
    expect(body, "the helper must exist and be exported").not.toBe("");
    for (const banned of [
      "@/lib/task-command-store",
      "@/lib/task-command-queue",
      "@/db",
      "localStorage",
      "fetch(",
      "queueCommand",
      "setTasks",
      "setWeekData",
      "saveTasks",
      "saveWeekData",
      "addTransaction",
      ".points",
    ]) {
      expect({ banned, present: body.includes(banned) }).toEqual({ banned, present: false });
    }
  });

  it("the file's import block gains no new @/lib import beyond weekLabel", () => {
    // Exactly the four @/lib imports B2's tip carries; F1 only adds the
    // `weekLabel` NAME to the meals-week-utils line.
    expect(lineNumbers(taskUtilsSource, /from "@\/lib\//).length).toBe(4);
    expect(taskUtilsSource).toContain('import { weekLabel, weekStartForDate } from "@/lib/meals-week-utils";');
  });

  it("adds exactly one writer-free statement to the page and no writer call sites", () => {
    // Captured from `git show $B2_TIP_SHA:src/app/tasks/page.tsx` at F1 start.
    // B1a and B2 legitimately move these lines; re-capture from B2's tip,
    // never from the working tree, or this test silently ratifies the
    // pre-wave file.
    const WRITER_BASELINE: Record<string, number> = {
      saveTasks: 1,
      saveWeekData: 1,
      setTasks: 2,
      setWeekData: 2,
    };
    const countWriter = (source: string, name: string) => lineNumbers(source, new RegExp(`\\b${name}\\(`)).length;
    for (const [name, expected] of Object.entries(WRITER_BASELINE)) {
      expect({ name, count: countWriter(pageSource, name) }).toEqual({ name, count: expected });
    }
    expect(countWriter(pageSource, "addTransaction")).toBe(0);

    const at = pageSource.indexOf("const completedGroups =");
    expect(at, "F1's page statement must be present").toBeGreaterThanOrEqual(0);
    const statement = pageSource.slice(at, pageSource.indexOf(";", at) + 1).trim();
    expect(statement).toBe("const completedGroups = groupCompletedTasksByWeek(completed);");
  });
});
