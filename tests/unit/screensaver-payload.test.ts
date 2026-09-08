import { describe, it, expect, vi, beforeEach } from "vitest";
import { weekKey } from "@/lib/task-utils";

const getFullList = vi.fn();
const collection = vi.fn<(name: string) => { getFullList: () => Promise<unknown[]> }>(() => ({ getFullList }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: async (fn: (pb: unknown) => Promise<unknown>) => fn({ collection }),
}));
vi.mock("@/lib/services/config", () => ({
  getServiceConfig: vi.fn(async (_s: string, k: string) => (k === "LAT" ? "42.7875" : "-86.1089")),
}));

import { composeScreensaverPayload, __resetScreensaverCaches } from "@/lib/screensaver/payload";

const now = new Date(2026, 8, 7, 15, 0, 0); // Mon 2026-09-07 15:00 local

function pbRowsFor(name: string): unknown[] {
  switch (name) {
    case "events":
      return [{ title: "Soccer", date: "2026-09-07", time: "4:00 PM" }];
    case "consuela_google_calendar_events":
      return [{ summary: "Dentist", start_iso: "2026-09-07T18:30:00+08:00", all_day: false }];
    case "tasks":
      // completedInWeek must round-trip the SAME helper the app writes with
      // (weekKey is TZ-sensitive) — never hardcode the key in fixtures.
      return [
        { status: "done", completedInWeek: weekKey(now) },
        { status: "pending", due: "2026-09-13" },
      ];
    case "meal_plan_entries":
      return [{ name: "Tacos", mealType: "dinner", time: "Mon", weekOf: "2026-09-07" }];
    case "morning_briefing":
      return [{ summary: { events: [{}, {}, {}], tasks: [{}], suggestions: [{ title: "Milk low" } ] } }];
    default:
      return [];
  }
}

beforeEach(() => {
  __resetScreensaverCaches();
  getFullList.mockReset();
  getFullList.mockImplementation(async () => []);
  vi.unstubAllGlobals();
});

it("composes the full payload from PB rows + weather", async () => {
  // route rows by collection name via the mock's call order
  collection.mockImplementation((name: string) => ({
    getFullList: async () => pbRowsFor(name),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 72.4, weather_code: 1 },
        daily: { temperature_2m_max: [78], temperature_2m_min: [61] },
      }),
    }))
  );
  const p = await composeScreensaverPayload(now);
  expect(p.ok).toBe(true);
  expect(p.date).toBe("2026-09-07");
  expect(p.events.map((e) => e.title)).toEqual(["Soccer", "Dentist"]);
  expect(p.dinner).toEqual({ name: "Tacos" });
  expect(p.tasks).toEqual({ done: 1, total: 2 });
  expect(p.briefing).toEqual(["📅 3 events today", "✅ 1 chore still open", "💡 Milk low"]);
  expect(p.weather).toEqual({ tempF: 72, hiF: 78, loF: 61, condition: "Partly cloudy" });
});

it("weather failure degrades to null, rest intact", async () => {
  collection.mockImplementation((name: string) => ({
    getFullList: async () => pbRowsFor(name),
  }));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
  const p = await composeScreensaverPayload(now);
  expect(p.weather).toBeNull();
  expect(p.events.length).toBeGreaterThan(0);
});

it("PB failure propagates (route maps to 503)", async () => {
  collection.mockImplementation(() => {
    throw new Error("pb down");
  });
  await expect(composeScreensaverPayload(now)).rejects.toThrow();
});

it("second call within TTL is served from cache (no second PB read)", async () => {
  collection.mockImplementation((name: string) => ({
    getFullList: async () => pbRowsFor(name),
  }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 70, weather_code: 0 }, daily: { temperature_2m_max: [75], temperature_2m_min: [60] } }) })));
  await composeScreensaverPayload(now);
  collection.mockClear();
  await composeScreensaverPayload(new Date(now.getTime() + 10_000));
  expect(collection).not.toHaveBeenCalled();
});
