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

  it("weekStartForDate is zone-invariant — the family zone and the process zone cannot disagree (B2 D5)", () => {
    // localWeekStartISO couples an Intl-zone date (localTodayISO) with
    // process-local Date parsing (weekStartForDate). The answer must not move
    // when the PROCESS zone moves, or the seam is a latent wrong week.
    const expected = new Map<string, string>();
    for (const zone of ["America/Detroit", "UTC", "Asia/Tokyo", "Australia/Sydney", "America/Havana", "Pacific/Chatham"]) {
      process.env.TZ = zone;
      expected.set(zone, weekStartForDate("2026-09-28"));
    }
    expect(new Set(expected.values()), "zone-invariant Monday").toEqual(new Set(["2026-09-28"]));

    // And the seam itself, in the family's zone, under a Sunday-evening instant.
    // 2026-10-05T02:00:00.000Z is Sun 2026-10-04 22:00 EDT (NOT Mon 22:00), so the
    // local day is 2026-10-04 and the Monday that contains it is 2026-09-28 —
    // the week that ENDED.
    process.env.TZ = "America/Detroit";
    expect(localWeekStartISO(new Date("2026-10-05T02:00:00.000Z"))).toBe("2026-09-28");
  });
});
