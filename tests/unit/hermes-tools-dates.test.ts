import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The mock meals are built relative to the REAL local "today" so the test is
// date-independent. Both `localTodayISO()`/`localWeekdayShort()` and the db mock
// read process.env.TZ (set to America/Detroit inside each test), so they agree.
vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: vi.fn(() => []),
    selectPendingTasks: vi.fn(() => []),
    selectMeals: vi.fn(async () => {
      const tz = process.env.TZ || "America/Detroit";
      const isoOf = (d: Date) => d.toLocaleString("en-CA", { timeZone: tz }).split(",")[0];
      const wdOf = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short" });
      const today = isoOf(new Date());
      const todayWd = wdOf(new Date());
      const nextD = new Date(today + "T12:00:00");
      nextD.setDate(nextD.getDate() + 1);
      const next = isoOf(nextD);
      const nextWd = wdOf(nextD);
      return [
        // matches today's LOCAL weekday -> the meal that must appear in meals_today
        { name: "Leftovers", time: todayWd, mealType: "lunch", weekOf: today, date: today },
        // a different weekday           -> the meal that must NOT appear in meals_today
        { name: "Pizza", time: nextWd, mealType: "dinner", weekOf: next, date: next },
      ];
    }),
  },
}));
vi.mock("@/lib/pb-auth", () => ({ withAdmin: vi.fn() }));
vi.mock("@/lib/ha/websocket-client", () => ({ getHAWebSocketClient: vi.fn() }));

import { getTool } from "@/lib/hermes-tools";
import { withAdmin } from "@/lib/pb-auth";
import { localTodayISO, localWeekdayShort, familyTimeZone } from "@/lib/local-date";
import { weekStartForDate, isoDateForWeekday } from "@/lib/meals-week-utils";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
  vi.resetAllMocks();
});

describe("hermes-tools local day resolution", () => {
  it("get_dashboard_summary matches meals by LOCAL weekday, not UTC", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_dashboard_summary")!.handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.date).toBe(localTodayISO());
    expect(data.today_weekday).toBe(localWeekdayShort());
    expect(data.family_timezone).toBe(familyTimeZone());
    // The meal whose `time` == today's LOCAL weekday must appear; the other must not.
    expect(data.meals_today.map((m: any) => m.name)).toContain("Leftovers");
    expect(data.meals_today.map((m: any) => m.name)).not.toContain("Pizza");
  });

  it("get_weekly_meals reports today + current week monday", async () => {
    process.env.TZ = "America/Detroit";
    const hand = getTool("get_weekly_meals")!.handler;
    const raw = await hand({});
    const data = JSON.parse(raw);
    expect(data.today).toContain(localWeekdayShort());
    expect(data.today).toContain(localTodayISO());
    expect(data.current_week_monday).toBe(weekStartForDate(localTodayISO()));
    const tz = process.env.TZ || "America/Detroit";
    const nextD = new Date(localTodayISO() + "T12:00:00");
    nextD.setDate(nextD.getDate() + 1);
    const next = nextD.toLocaleString("en-CA", { timeZone: tz }).split(",")[0];
    const nextWd = nextD.toLocaleString("en-US", { timeZone: tz, weekday: "short" });
    expect(data.days[nextWd][0].date).toBe(next);
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
