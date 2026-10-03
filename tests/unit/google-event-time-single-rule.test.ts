/**
 * Bug 2 (P1) — one event, two screens, two different times.
 *
 * `src/lib/calendar/google-mapping.ts` (the Calendar page + the Home widget)
 * printed the event's **local** wall clock; `src/lib/consuela/todays-events.ts`
 * (Ask Consuela's calendar answers) printed the **authored UTC offset's** wall
 * clock. A 09:00 school event read "9:00 AM" in chat and "12:00 PM" on the
 * calendar.
 *
 * THE RULE (pinned by this suite): a timed Google event is displayed in the
 * FAMILY-LOCAL timezone — the same `familyTimeZone()` every other "what's on
 * today" surface already uses, and the same frame `googleEventCoveredDays`
 * already decides the DAY in. Printing the authored offset would leave an event
 * with a family-local day and a foreign hour: internally inconsistent, and
 * unreadable as "when do we leave".
 *
 * Both surfaces must go through ONE implementation, so these tests assert
 * agreement across the two modules rather than two separate expectations.
 *
 * The suite runs under the vitest `env.TZ = "America/Detroit"` pin. EDT is
 * UTC-04:00 in September, EST is UTC-05:00 in January — that DST difference is
 * what makes the DST cases here discriminating rather than decorative.
 */

import { describe, it, expect } from "vitest";
import { expandGoogleEvent, googleEventClockTime, googleEventLocalMinutes } from "@/lib/calendar/google-mapping";
import { googleEventTime, mergeTodaysEvents } from "@/lib/consuela/todays-events";

/** What the Calendar page renders for one Google row. */
function calendarTime(start_iso: string | undefined, all_day?: boolean): string | undefined {
  return expandGoogleEvent({ google_id: "g1", start_iso, all_day })[0]?.time;
}

/** What Ask Consuela says about the same row. */
function chatTime(start_iso: string | undefined): string | undefined {
  return googleEventTime(start_iso);
}

const ROWS: Array<{ label: string; start_iso: string; all_day?: boolean; expect: string }> = [
  // The reported bug: authored 09:00 in a -07:00 zone is 12:00 in Detroit.
  { label: "authored Pacific morning", start_iso: "2026-09-09T09:00:00-07:00", expect: "12:00 PM" },
  // Authored in the family's own zone — must not move (no churn on screen).
  { label: "authored Eastern afternoon", start_iso: "2026-09-09T18:30:00-04:00", expect: "6:30 PM" },
  // Authored east of the family: 08:00+02:00 is 02:00 EDT.
  { label: "authored European morning", start_iso: "2026-09-09T08:00:00+02:00", expect: "2:00 AM" },
  // Authored UTC: 16:00Z is 12:00 EDT.
  { label: "authored UTC afternoon", start_iso: "2026-09-09T16:00:00Z", expect: "12:00 PM" },
  // Midnight-boundary rollover: 23:30-07:00 is already the next local day.
  { label: "authored Pacific late night", start_iso: "2026-09-09T23:30:00-07:00", expect: "2:30 AM" },
  // No offset at all — read as family-local wall time (what parseGoogleStart does).
  { label: "naive local wall time", start_iso: "2026-09-09T14:45:00", expect: "2:45 PM" },
  // DST spring forward: 03:30 EST is 08:30Z, past the 07:00Z transition, so
  // Detroit is already on EDT (-04:00) → 04:30.
  { label: "DST spring forward", start_iso: "2026-03-08T03:30:00-05:00", expect: "4:30 AM" },
  // DST fall back: 02:30 -07:00 is 09:30Z, past the 06:00Z transition, so
  // Detroit is on EST (-05:00) → 04:30 (an EDT-naive reading would say 05:30).
  { label: "DST fall back", start_iso: "2026-11-01T02:30:00-07:00", expect: "4:30 AM" },
  // The REPEATED hour itself: 01:30 EDT (05:30Z) is still EDT → 01:30, and
  // 01:30 EST (06:30Z) is EST → 01:30. Two distinct instants, one clock — the
  // ambiguity must not shift either of them by an hour.
  { label: "DST repeated hour, first pass", start_iso: "2026-11-01T01:30:00-04:00", expect: "1:30 AM" },
  { label: "DST repeated hour, second pass", start_iso: "2026-11-01T01:30:00-05:00", expect: "1:30 AM" },
];

describe("Bug 2 — the family-local time rule, on BOTH surfaces", () => {
  for (const row of ROWS) {
    it(`calendar and chat agree on ${row.label}`, () => {
      expect(calendarTime(row.start_iso, row.all_day)).toBe(row.expect);
      expect(chatTime(row.start_iso)).toBe(row.expect);
    });
  }

  it("never prints the authored UTC offset as the clock", () => {
    // The exact regression: 09:00 authored must not surface as "9:00 AM".
    expect(chatTime("2026-09-09T09:00:00-07:00")).not.toBe("9:00 AM");
    expect(calendarTime("2026-09-09T09:00:00-07:00")).not.toBe("9:00 AM");
  });

  it("is one implementation, not two that happen to agree today", () => {
    // If the two modules ever grow a private formatter again, this fails:
    // the chat surface must be a thin delegate to the calendar mapper.
    expect(googleEventTime("2026-09-09T09:00:00-07:00")).toBe(
      googleEventClockTime("2026-09-09T09:00:00-07:00", false),
    );
  });
});

describe("Bug 2 — all-day rows", () => {
  it("treats a date-only start as all day on both surfaces", () => {
    expect(calendarTime("2026-09-09")).toBe("All day");
    expect(chatTime("2026-09-09")).toBe("All day");
  });

  it("honours an explicit all_day flag over a timed start", () => {
    expect(calendarTime("2026-09-09T18:30:00-04:00", true)).toBe("All day");
    // The chat merge has no all_day column, so a date-only start is the only
    // shape it can see — assert the two agree on the shape they SHARE.
    expect(chatTime("2026-09-09")).toBe("All day");
  });

  it("degrades to undefined (an honest dash) for unparseable input", () => {
    expect(calendarTime("not-a-time")).toBeUndefined();
    expect(chatTime("not-a-time")).toBeUndefined();
    expect(calendarTime(undefined)).toBeUndefined();
    expect(chatTime(undefined)).toBeUndefined();
  });
});

describe("Bug 2 — ordering uses the same frame as the printed clock", () => {
  it("sortMinutes is family-local, not the authored offset", () => {
    // 08:00+02:00 → 02:00 EDT. Authored minutes would say 08:00 (480).
    expect(googleEventLocalMinutes("2026-09-09T08:00:00+02:00", false)).toBe(120);
  });

  it("an all-day row sorts before timed rows and a bad stamp sorts last", () => {
    expect(googleEventLocalMinutes("2026-09-09", false)).toBe(-1);
    expect(googleEventLocalMinutes("2026-09-09T18:30:00-04:00", true)).toBe(-1);
    expect(googleEventLocalMinutes("not-a-time", false)).toBe(24 * 60);
    expect(googleEventLocalMinutes(undefined, false)).toBe(24 * 60);
  });

  it("orders a day's list by family-local time, not by the authored offset", () => {
    const family = [{ title: "Breakfast", date: "2026-09-09", time: "5:00 AM" }];
    // Authored 08:00 → the old code sorted it AFTER 5:00 AM (480 > 300).
    // Family-local it is 02:00, so it belongs BEFORE Breakfast.
    const google = [{ summary: "Swim", start_iso: "2026-09-09T08:00:00+02:00" }];
    const merged = mergeTodaysEvents(family as any, google as any, "2026-09-09");
    expect(merged.map((e) => e.title)).toEqual(["Swim", "Breakfast"]);
    expect(merged[0].time).toBe("2:00 AM");
  });

  it("keeps a family-authored event untouched by the Google formatter", () => {
    const merged = mergeTodaysEvents(
      [{ title: "Piano", date: "2026-09-09", time: "18:30" }],
      [],
      "2026-09-09",
    );
    expect(merged[0].time).toBe("18:30");
  });
});