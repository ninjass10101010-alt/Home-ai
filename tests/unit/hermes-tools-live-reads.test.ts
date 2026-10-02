// Live-read contract for the chat tools (2026-09-09): the calendar/event/task
// tools previously read PROCESS-START caches (db.selectTodaysEvents() etc.)
// and the events tool missed every Google-synced row. They must read PB live
// at call time and merge the Google calendar into "today's events".
//
// Since the final review: the readers behind the HIGH-TRAFFIC tools must also
// distinguish "the read FAILED" from "there is genuinely nothing" — `| null`
// for the first, `[]` for the second, the idiom every sibling reader already
// used. These four are the ones ai/TOOLS.md tells the model to call first, two
// of them answer a kid, and `check_conflicts` gates a WRITE on its answer.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ collection: string; filter?: string }> = [];
const rows: Record<string, any[] | null> = {};

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => {
        calls.push({ collection: name, filter: opts?.filter });
        const value = rows[name];
        if (value === null) throw new Error(`read failed: ${name}`);
        return value ?? [];
      },
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (_id: string, d: any) => ({ id: _id, ...d }),
      create: async (d: any) => ({ id: `new-${Math.random()}`, ...d }),
      delete: async () => true,
    }),
  })),
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectPendingTasks: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectTodaysSchedulesRaw: () => { throw new Error("STALE CACHE READ — must use live reads"); },
    selectMeals: async () => [],
    selectPantry: async () => [],
    selectGrocery: async () => [],
    selectMembers: () => [],
    selectRecipes: () => [],
  },
}));

import { getTool } from "@/lib/hermes-tools";

const TODAY = "2026-09-09";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
  rows.members = [
    { id: 1, name: "Emily", fullName: "Emily G", role: "child", emoji: "🎻" },
    { id: 2, name: "Rebecca", fullName: "Rebecca G", role: "parent", emoji: "🐱" },
  ];
  vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`) });
});

import { afterEach } from "vitest";
afterEach(() => { vi.useRealTimers(); });

describe("get_todays_events — live reads + Google merge", () => {
  it("merges family + google events for today and tags the source", async () => {
    rows.events = [{ id: "e1", title: "Emily Orchestra", date: TODAY, time: "18:30", member: "Emily" }];
    rows.consuela_google_calendar_events = [
      { summary: "Bailey & Emily at home!", start_iso: "2026-09-10" },
      { summary: "Choir Practice", start_iso: `${TODAY}T16:00:00-04:00` },
    ];
    const out = JSON.parse(await getTool("get_todays_events")!.handler({}));
    const titles = (out.events ?? out).map?.call ? [] : null;
    const list = Array.isArray(out) ? out : out.events;
    expect(list.map((e: any) => `${e.source ?? ""}${e.title}`)).toEqual(["googleChoir Practice", "familyEmily Orchestra"]);
    expect(list.some((e: any) => e.title === "Bailey & Emily at home!")).toBe(false);
    expect(calls.some((c) => c.collection === "consuela_google_calendar_events")).toBe(true);
    expect(calls.some((c) => c.collection === "events")).toBe(true);
  });

  it("google read failure degrades to family-only (no throw)", async () => {
    rows.events = [{ id: "e1", title: "Solo event", date: TODAY, time: "09:00" }];
    const out = JSON.parse(await getTool("get_todays_events")!.handler({}));
    const list = Array.isArray(out) ? out : out.events;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Solo event");
  });
});

describe("get_pending_tasks — live read, full list", () => {
  it("reads the tasks SNAPSHOT at call time and returns every pending row", async () => {
    rows.consuela_data_snapshots = [{
      id: "snap1", key: "tasks-snapshot",
      data: {
        tasks: [
          { id: 1, title: "Walk Rocco", assignee: "Emily", points: 10, due: TODAY, completed: false },
          { id: 2, title: "Dishes", assignee: "Rebecca", points: 5, due: "2026-09-10", completed: false },
          { id: 3, title: "Old done thing", assignee: "Emily", points: 5, completed: true },
        ],
        deletedTaskIds: [],
      },
    }];
    const out = JSON.parse(await getTool("get_pending_tasks")!.handler({}));
    const list = Array.isArray(out) ? out : out.tasks ?? out.pending_tasks;
    expect(list.map((t: any) => t.title)).toEqual(["Walk Rocco", "Dishes"]);
    expect(calls.some((c) => c.collection === "consuela_data_snapshots")).toBe(true);
  });

  it("member filter still works against live rows", async () => {
    rows.consuela_data_snapshots = [{
      id: "snap1", key: "tasks-snapshot",
      data: {
        tasks: [
          { id: 1, title: "Walk Rocco", assignee: "Emily", points: 10, completed: false },
          { id: 2, title: "Dishes", assignee: "Rebecca", points: 5, completed: false },
        ],
        deletedTaskIds: [],
      },
    }];
    const out = JSON.parse(await getTool("get_pending_tasks")!.handler({ member: "Emily" }));
    const list = Array.isArray(out) ? out : out.tasks ?? out.pending_tasks;
    expect(list.map((t: any) => t.title)).toEqual(["Walk Rocco"]);
    expect(list.every((t: any) => String(t.assigned || "").includes("Emily"))).toBe(true);
  });

  it("both task sources down reports unavailable, never an empty chore list", async () => {
    rows.consuela_data_snapshots = null;
    rows.tasks = null;
    const out = JSON.parse(await getTool("get_pending_tasks")!.handler({}));
    expect(out.error).toContain("unavailable");
    expect(out.tasks).toEqual([]);
  });
});

describe("get_todays_schedule — live read", () => {
  it("reads schedules at call time", async () => {
    rows.schedules = [{ id: "s1", title: "Bedtime routine", time: "8:00 PM", days: "weekdays", icon: "🌙" }];
    const out = JSON.parse(await getTool("get_todays_schedule")!.handler({}));
    const list = Array.isArray(out) ? out : out.schedules ?? out.schedule;
    expect(list).toHaveLength(1);
    expect(calls.some((c) => c.collection === "schedules")).toBe(true);
  });
});

describe("get_dashboard_summary — includes google events", () => {
  it("summary events merge the google calendar", async () => {
    rows.events = [{ id: "e1", title: "Emily Orchestra", date: TODAY, time: "18:30", member: "Emily" }];
    rows.consuela_google_calendar_events = [{ summary: "Choir", start_iso: `${TODAY}T16:00:00-04:00` }];
    rows.tasks = [];
    rows.meal_plan_entries = [];
    const out = JSON.parse(await getTool("get_dashboard_summary")!.handler({}));
    const titles = (out.events ?? []).map((e: any) => e.title);
    expect(titles).toContain("Choir");
    expect(titles).toContain("Emily Orchestra");
  });
});

describe("get_leaderboard — real points from week_data", () => {
  it("returns this week's points per member, sorted", async () => {
    // localWeekStartISO() for Wed 2026-09-09 (Detroit) = Monday 2026-09-07
    rows.week_data = [{
      weekStart: "2026-09-07",
      points: { "Emily G": 40, "Rebecca G": 25 },
    }];
    const out = JSON.parse(await getTool("get_leaderboard")!.handler({}));
    const entries = out.leaderboard ?? out.members ?? out;
    const first = Array.isArray(entries) ? entries[0] : entries[Object.keys(entries)[0]];
    expect(JSON.stringify(out)).toContain("40");
  });
});

describe("honest degradation — a failed read is never an empty answer", () => {
  /** Every high-traffic reader, exercised on both sides of the seam: the read
   *  failing must say so, and a genuinely empty read must NOT. */
  describe("get_todays_events (kid-facing)", () => {
    it("says the calendar is unavailable when BOTH sources fail", async () => {
      rows.events = null;
      rows.consuela_google_calendar_events = null;

      const out = JSON.parse(await getTool("get_todays_events")!.handler({}));

      expect(out.error).toContain("unavailable");
      expect(out.error).toMatch(/do not guess/i);
      expect(out.events).toEqual([]);
    });

    it("still answers with the family's own events when only Google fails", async () => {
      rows.events = [{ id: "e1", title: "Solo event", date: TODAY, time: "09:00" }];
      rows.consuela_google_calendar_events = null;

      const out = JSON.parse(await getTool("get_todays_events")!.handler({}));

      const list = Array.isArray(out) ? out : out.events;
      expect(list.map((e: any) => e.title)).toEqual(["Solo event"]);
    });

    it("reports a genuinely empty day as empty, with no error", async () => {
      rows.events = [];
      rows.consuela_google_calendar_events = [];

      const out = JSON.parse(await getTool("get_todays_events")!.handler({}));

      const list = Array.isArray(out) ? out : out.events;
      expect(list).toEqual([]);
      expect(out.error).toBeUndefined();
    });
  });

  describe("get_todays_schedule (kid-facing)", () => {
    it("says the routine is unavailable when the read fails", async () => {
      rows.schedules = null;

      const out = JSON.parse(await getTool("get_todays_schedule")!.handler({}));

      expect(out.error).toContain("unavailable");
      expect(out.error).toMatch(/do not guess/i);
      expect(out.schedule).toEqual([]);
    });

    it("reports a genuinely empty routine as empty, with no error", async () => {
      rows.schedules = [];

      const out = JSON.parse(await getTool("get_todays_schedule")!.handler({}));

      const list = Array.isArray(out) ? out : out.schedules ?? out.schedule;
      expect(list).toEqual([]);
      expect(out.error).toBeUndefined();
    });
  });

  describe("get_dashboard_summary", () => {
    beforeEach(() => {
      rows.consuela_data_snapshots = [{ id: "s", key: "tasks-snapshot", data: { tasks: [] } }];
      rows.meal_plan_entries = [];
    });

    it("carries its own events_error leg instead of shipping an empty day", async () => {
      rows.events = null;
      rows.consuela_google_calendar_events = null;

      const out = JSON.parse(await getTool("get_dashboard_summary")!.handler({}));

      expect(out.events_error).toMatch(/do not guess/i);
      expect(out.events).toEqual([]);
      // The other legs are unaffected — one dead collection must not blank the
      // whole overview.
      expect(out.meals_error).toBeUndefined();
      expect(out.tasks_error).toBeUndefined();
    });

    it("has no events_error when the calendar really is empty", async () => {
      rows.events = [];
      rows.consuela_google_calendar_events = [];

      const out = JSON.parse(await getTool("get_dashboard_summary")!.handler({}));

      expect(out.events).toEqual([]);
      expect(out.events_error).toBeUndefined();
    });
  });

  describe("check_conflicts (gates a write)", () => {
    const NEW_EVENT = {
      summary: "Soccer practice",
      start: `${TODAY}T17:00:00-04:00`,
      end: `${TODAY}T18:00:00-04:00`,
    };

    it("refuses to certify 'no conflict' when the family calendar could not be read", async () => {
      rows.events = null;

      const out = JSON.parse(await getTool("check_conflicts")!.handler(NEW_EVENT));

      // ai/TOOLS.md tells the model to run this BEFORE add_event, so a false
      // negative here is a silent gate on a write.
      expect(out.hasConflict).not.toBe(false);
      expect(out.error).toContain("unavailable");
      expect(out.error).toMatch(/do not guess/i);
    });

    it("still reports real overlaps when the read works", async () => {
      rows.events = [{ id: "e1", title: "Choir", date: TODAY, time: "17:30" }];

      const out = JSON.parse(await getTool("check_conflicts")!.handler(NEW_EVENT));

      expect(out.hasConflict).toBe(true);
      expect(out.conflictCount).toBeGreaterThan(0);
    });

    it("still reports no conflict on a genuinely free slot", async () => {
      rows.events = [{ id: "e1", title: "Choir", date: TODAY, time: "09:00" }];

      const out = JSON.parse(await getTool("check_conflicts")!.handler(NEW_EVENT));

      expect(out.hasConflict).toBe(false);
      expect(out.error).toBeUndefined();
    });
  });
});
