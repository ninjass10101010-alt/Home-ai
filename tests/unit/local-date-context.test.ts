import { describe, it, expect, afterEach } from "vitest";
import {
  familyTimeZone,
  localWeekdayShort,
  localDateContext,
} from "@/lib/local-date";

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("localDateContext (family tz = America/Detroit)", () => {
  it("resolves Tuesday-evening-ET conversation to the family's Monday", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-02 00:36 UTC = Tue 2026-09-01 20:36 ET — the exact bug window
    const now = new Date("2026-09-02T00:36:00Z");
    expect(familyTimeZone()).toBe("America/Detroit");
    expect(localWeekdayShort(now)).toBe("Tue");
    expect(localDateContext(now)).toEqual({
      todayISO: "2026-09-01",
      todayWeekday: "Tue",
      yesterdayISO: "2026-08-31",
      yesterdayWeekday: "Mon",
      weekStartISO: "2026-08-31",
      tz: "America/Detroit",
    });
  });

  it("handles Monday morning ET (UTC same day) without shifting", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-01 14:00 UTC = Tue 2026-09-01 10:00 ET
    const now = new Date("2026-09-01T14:00:00Z");
    const ctx = localDateContext(now);
    expect(ctx.todayISO).toBe("2026-09-01");
    expect(ctx.todayWeekday).toBe("Tue");
    expect(ctx.yesterdayISO).toBe("2026-08-31");
    expect(ctx.weekStartISO).toBe("2026-08-31");
  });

  it("handles Sunday (yesterday = Saturday, weekStart = the prior Monday)", () => {
    process.env.TZ = "America/Detroit";
    // 2026-09-06 23:30 UTC = Sun 2026-09-06 19:30 ET
    const now = new Date("2026-09-06T23:30:00Z");
    const ctx = localDateContext(now);
    expect(ctx.todayISO).toBe("2026-09-06");
    expect(ctx.yesterdayISO).toBe("2026-09-05");
    expect(ctx.weekStartISO).toBe("2026-08-31");
  });
});
