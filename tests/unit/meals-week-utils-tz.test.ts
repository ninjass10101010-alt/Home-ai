import { describe, it, expect, afterEach } from "vitest";
import {
  todayMondayISO,
  weekStartForDate,
  shiftWeek,
  isoDateForWeekday,
} from "@/lib/meals-week-utils";
import { localTodayISO, localWeekStartISO, localPreviousDayISO } from "@/lib/local-date";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("meals-week-utils timezone safety", () => {
  it("computes the correct Monday in a UTC-AHEAD zone (the toISOString() failure case)", () => {
    // Australia/Sydney is UTC+10: local-midnight serializes to the PREVIOUS UTC
    // day, so the old `.toISOString()` path mis-computed weekOf by one day.
    process.env.TZ = "Australia/Sydney";
    expect(weekStartForDate("2026-09-01")).toBe("2026-08-31"); // Tue 9/1 -> Mon 8/31
    expect(isoDateForWeekday("2026-08-31", "Tue")).toBe("2026-09-01");
    expect(shiftWeek("2026-08-31", 1)).toBe("2026-09-07");
  });

  it("agrees with the family zone on a UTC layout (no over-correction)", () => {
    process.env.TZ = "UTC";
    expect(weekStartForDate("2026-09-01")).toBe("2026-08-31");
    expect(isoDateForWeekday("2026-08-31", "Sun")).toBe("2026-09-06");
  });

  it("todayMondayISO and localWeekStartISO agree (single source of truth)", () => {
    process.env.TZ = "America/Detroit";
    const now = new Date();
    expect(localWeekStartISO(now)).toBe(todayMondayISO());
  });

  it("localPreviousDayISO is correct in a UTC-ahead zone", () => {
    process.env.TZ = "Australia/Sydney";
    expect(localPreviousDayISO("2026-09-01")).toBe("2026-08-31");
  });
});
