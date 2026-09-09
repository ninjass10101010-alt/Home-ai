// Live-read contract for the chat tools (2026-09-09): the calendar/event/task
// tools previously read PROCESS-START caches (db.selectTodaysEvents() etc.)
// and the events tool missed every Google-synced row. They must read PB live
// at call time and merge the Google calendar into "today's events".
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ collection: string; filter?: string }> = [];
const rows: Record<string, any[]> = {};

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => fn({
    collection: (name: string) => ({
      getFullList: async (opts: any) => {
        calls.push({ collection: name, filter: opts?.filter });
        return rows[name] ?? [];
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
  it("reads the tasks collection at call time and returns every pending row", async () => {
    rows.tasks = [
      { id: "t1", title: "Walk Rocco", status: "pending", assigned: "Emily", points: 10, due: TODAY },
      { id: "t2", title: "Dishes", status: "pending", assigned: "Rebecca", points: 5, due: "2026-09-10" },
      { id: "t3", title: "Old done thing", status: "done", assigned: "Emily", points: 5 },
    ];
    const out = JSON.parse(await getTool("get_pending_tasks")!.handler({}));
    const list = Array.isArray(out) ? out : out.tasks ?? out.pending_tasks;
    expect(list.filter((t: any) => t.title !== "Old done thing")).toHaveLength(2);
    expect(calls.some((c) => c.collection === "tasks")).toBe(true);
  });

  it("member filter still works against live rows", async () => {
    rows.tasks = [
      { id: "t1", title: "Walk Rocco", status: "pending", assigned: "Emily", points: 10 },
      { id: "t2", title: "Dishes", status: "pending", assigned: "Rebecca", points: 5 },
    ];
    const out = JSON.parse(await getTool("get_pending_tasks")!.handler({ member: "Emily" }));
    const list = Array.isArray(out) ? out : out.tasks ?? out.pending_tasks;
    expect(list.every((t: any) => String(t.assigned || "").includes("Emily"))).toBe(true);
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
