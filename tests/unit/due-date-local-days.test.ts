// Due-date presets and the 31-day due list are LOCAL calendar days.
//
// A task's `due` is a date-only string ("2026-09-28") — PocketBase stores it in
// a `text` field (pb-seed.ts:172), and the Tasks page writes `localTodayISO()`.
// But these helpers built their values from `Date.now() + days * 86400000`
// serialized with `toISOString()`, which is UTC. Two separate defects:
//
//   1. EVENING SKEW (the family's zone, America/Detroit = UTC-4). At 20:30
//      local the UTC date has already rolled over, so "Tomorrow" produced a
//      date two days out, "This week" ran to +7, and every weekday quick-add
//      was a day ahead — a chore filed under the wrong day, which then reads
//      as overdue or not-due-until-tomorrow on the board.
//   2. DST FALL-BACK COLLISION. `+ 86400000` is exactly 24 hours, not one
//      calendar day. On the night the clocks go back, 20:30 Monday + 24h is
//      still 19:30 Monday *local*, so `isoOffset(1)` returned the SAME date as
//      `isoOffset(0)` — "Tomorrow" became "Today".
//
// `getISO.today` was already local, so the preset row was internally
// inconsistent: "Today" was right while everything beside it was a day ahead.
import { describe, it, expect, afterEach, vi } from "vitest";

import { getDueOptions, getISO } from "@/lib/due-date-utils";
import { localTodayISO } from "@/lib/local-date";

const DETROIT = "America/Detroit";

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = DETROIT;
});

/** Pin "now" to a given LOCAL wall-clock time, so the UTC date is whatever it is. */
function atLocal(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

function addLocalDays(iso: string, n: number): string {
  // Noon, not midnight: a bare date-only string parses as UTC midnight, which
  // behind UTC is the PREVIOUS local day — the same defect under test.
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localTodayISO(d);
}

describe("due-date presets — evening skew (America/Detroit)", () => {
  it("'today' matches the local calendar day at 20:30", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00"); // Mon 20:30 EDT === Tue 00:30Z
    expect(getISO.today).toBe("2026-09-28");
  });

  it("'tomorrow' is the next local day, not two days out", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00");
    expect(getISO.tomorrow).toBe("2026-09-29");
  });

  it("'this week' is six local days out", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00");
    expect(getISO.thisWeek).toBe("2026-10-04");
  });

  it("each weekday quick-add lands on that local weekday", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00"); // Monday
    // "tomorrow" (Tuesday) must be a Tuesday; "fri" must be a Friday.
    expect(getISO.tue).toBe("2026-09-29");
    expect(getISO.fri).toBe("2026-10-02");
  });

  it("the whole preset row is ordered and self-consistent", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00");
    const today = getISO.today;
    expect(getISO.tomorrow > today).toBe(true);
    expect(getISO.thisWeek > getISO.tomorrow).toBe(true);
    // YYYY-MM-DD strings compare lexically in chronological order, which is the
    // same property the production code relies on.
    for (const [key, iso] of Object.entries({
      fri: getISO.fri, sat: getISO.sat, sun: getISO.sun,
      mon: getISO.mon, tue: getISO.tue, wed: getISO.wed, thu: getISO.thu,
    })) {
      expect(iso >= today, `${key} (${iso}) must not be before today (${today})`).toBe(true);
    }
  });
});

describe("due-date presets — DST fall-back collision", () => {
  it("'tomorrow' is a different day than 'today' when the clocks go back", () => {
    process.env.TZ = DETROIT;
    // 2026-11-01 is the US fall-back date. Mon 2026-10-26 20:30 EDT + 24h is
    // Mon 2026-10-26 19:30 EST — still Monday, so the naive +86400000 math
    // returned "2026-10-26" for BOTH offsets.
    atLocal("2026-10-26T20:30:00-04:00");
    expect(getISO.today).toBe("2026-10-26");
    expect(getISO.tomorrow).toBe("2026-10-27");
  });
});

describe("31-day due list", () => {
  it("starts at today and advances one local day per row, in the evening", () => {
    process.env.TZ = DETROIT;
    atLocal("2026-09-28T20:30:00-04:00");
    const opts = getDueOptions();
    expect(opts).toHaveLength(31);
    expect(opts[0].label).toBe("Today");
    expect(opts[0].value).toBe("2026-09-28");
    expect(opts[1].label).toBe("Tomorrow");
    expect(opts[1].value).toBe("2026-09-29");
  });

  it("is contiguous with no gaps and no repeats, across a DST boundary", () => {
    process.env.TZ = DETROIT;
    // Three days before the US fall-back (2026-11-01) and 28 days after.
    atLocal("2026-10-29T21:00:00-04:00");
    const values = getDueOptions().map((o) => o.value);
    expect(new Set(values).size, "no duplicate days across the DST change").toBe(31);
    for (let i = 1; i < values.length; i++) {
      const expected = addLocalDays(values[0], i);
      expect(values[i], `row ${i}`).toBe(expected);
    }
  });
});
