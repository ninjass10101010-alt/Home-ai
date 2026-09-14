import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The fixture meals are built relative to the REAL local "today" so the test is
// date-independent. Both `localTodayISO()`/`localWeekdayShort()` and the live
// meal read resolve via process.env.TZ (set to America/Detroit inside each
// test), so they agree. 2026-09-10: the meal tools read `meal_plan_entries`
// LIVE via withAdmin — the stale db.selectMeals mock now THROWS as a red-proof.
vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: vi.fn(() => []),
    selectPendingTasks: vi.fn(() => []),
    selectMeals: () => { throw new Error("STALE CACHE READ — must use live reads"); },
  },
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn() }));

import { getTool } from "@/lib/hermes-tools";
import { withAdmin } from "@/lib/pb-auth";
import { localTodayISO, localWeekdayShort, familyTimeZone } from "@/lib/local-date";
import { weekStartForDate, isoDateForWeekday, shiftWeek } from "@/lib/meals-week-utils";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
  vi.resetAllMocks();
});

// Live `meal_plan_entries` rows: today, a DIFFERENT weekday of the current
// week, and a last-week row wearing today's weekday name that the week filter
// must keep out of this week's answers. Computed at CALL time (inside
// getFullList) so the TZ set within each test is honored.
function liveMealFixture(): any[] {
  const today = localTodayISO();
  const todayWd = localWeekdayShort();
  const weekOf = weekStartForDate(today);
  const otherWd = todayWd === "Mon" ? "Tue" : "Mon";
  const otherDate = isoDateForWeekday(weekOf, otherWd);
  const prevMonday = shiftWeek(weekOf, -1);
  return [
    // matches today's LOCAL weekday -> the meal that must appear in meals_today
    { name: "Leftovers", time: todayWd, mealType: "lunch", weekOf, date: today },
    // a different weekday of the SAME week -> must NOT appear in meals_today
    { name: "Pizza", time: otherWd, mealType: "dinner", weekOf, date: otherDate },
    // last week's row wearing today's weekday -> must be filtered out by week
    { name: "Old Soup", time: todayWd, mealType: "dinner", weekOf: prevMonday, date: prevMonday },
  ];
}

function liveReadsClient() {
  return {
    collection: (name: string) => ({
      getFullList: async () => (name === "meal_plan_entries" ? liveMealFixture() : []),
      getFirstListItem: async () => { throw new Error("404"); },
      update: async (id: string, r: any) => ({ id, ...r }),
      create: async (r: any) => ({ id: "new123", ...r }),
      delete: async () => true,
    }),
  };
}

describe("hermes-tools local day resolution", () => {
  beforeEach(() => {
    vi.mocked(withAdmin).mockImplementation(async (fn: any) => fn(liveReadsClient()));
  });

  it("get_dashboard_summary matches meals by LOCAL weekday, not UTC", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_dashboard_summary")!.handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.date).toBe(localTodayISO());
    expect(data.today_weekday).toBe(localWeekdayShort());
    expect(data.family_timezone).toBe(familyTimeZone());
    const names = data.meals_today.map((m: any) => m.name);
    // The meal whose `time` == today's LOCAL weekday must appear; the other
    // current-week day must not; the PREVIOUS week's row must never leak.
    expect(names).toContain("Leftovers");
    expect(names).not.toContain("Pizza");
    expect(names).not.toContain("Old Soup");
  });

  it("get_weekly_meals reports today + current week monday", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_weekly_meals")!.handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.today).toContain(localWeekdayShort());
    expect(data.today).toContain(localTodayISO());
    expect(data.current_week_monday).toBe(weekStartForDate(localTodayISO()));
    const weekOf = weekStartForDate(localTodayISO());
    const otherWd = localWeekdayShort() === "Mon" ? "Tue" : "Mon";
    expect(data.days[otherWd][0].date).toBe(isoDateForWeekday(weekOf, otherWd));
    // only THIS week's rows for today's weekday — the Old Soup row stays out
    expect(data.days[localWeekdayShort()].map((m: any) => m.name)).toEqual(["Leftovers"]);
  });
});

// NOTE: day resolution must be date-independent (the test must pass on any run date,
// just like the get_dashboard_summary/get_weekly_meals tests). "Monday of the current
// week" and "Sunday of the current week" are derived from weekStartForDate(localTodayISO()),
// never hardcoded. 2026-09-01 is a TUESDAY — do not use it as a "Monday" fixture.
const pbMock = {
  collection: vi.fn((name: string) => {
    if (name !== "meal_plan_entries") throw new Error("unexpected collection");
    return {
      getFullList: vi.fn(async () => []),
      create: vi.fn(async (r: any) => ({ id: "new123", ...r })),
      update: vi.fn(async (id: string, r: any) => ({ id, ...r })),
    };
  }),
};

describe("add_meal tool", () => {
  // Re-establish each test: the sibling "hermes-tools local day resolution"
  // describe's afterEach calls vi.resetAllMocks(), which wipes withAdmin's impl.
  beforeEach(() => {
    vi.mocked(withAdmin).mockImplementation(async (fn: any) => fn(pbMock));
  });

  it("resolves an ISO date (this week's Monday) to weekday + weekOf + date", async () => {
    process.env.TZ = "America/Detroit";
    const mon = weekStartForDate(localTodayISO()); // e.g. "2026-08-31"
    const hand = getTool("add_meal")!.handler;
    const raw = await hand({ name: "Little Caesars Pizza", day: mon, mealType: "dinner" });
    const data = JSON.parse(raw);
    expect(data.ok).toBe(true);
    expect(data.meal.time).toBe("Mon");
    expect(data.meal.weekOf).toBe(mon);
    expect(data.meal.date).toBe(mon);
    expect(data.meal.mealType).toBe("dinner");
  });

  it("treats a Sunday weekday as part of the current week", async () => {
    process.env.TZ = "America/Detroit";
    const expectedSun = isoDateForWeekday(weekStartForDate(localTodayISO()), "Sun"); // this week's Sunday
    const hand = getTool("add_meal")!.handler;
    const raw = await hand({ name: "BBQ", day: "Sun" });
    const data = JSON.parse(raw);
    expect(data.meal.time).toBe("Sun");
    expect(data.meal.weekOf).toBe(weekStartForDate(expectedSun));
    expect(data.meal.date).toBe(expectedSun);
  });
});
