import { describe, it, expect } from "vitest";
import { parseGoogleStart, mapGoogleEvent, eventInMonth, expandGoogleEvent, googleEventCoveredDays, googleEventCoversDay } from "@/lib/calendar/google-mapping";

describe("parseGoogleStart", () => {
  it("parses all-day date-only strings as local calendar dates (no UTC shift)", () => {
    const d = parseGoogleStart("2026-08-12", true);
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(12);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getFullYear()).toBe(2026);
  });

  it("parses timed ISO strings", () => {
    const d = parseGoogleStart("2026-09-03T09:30:00-07:00", false);
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(3);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseGoogleStart("", true)).toBeNull();
    expect(parseGoogleStart("not-a-date", false)).toBeNull();
  });
});

describe("mapGoogleEvent", () => {
  it("keeps the full date (day + month + year) instead of day-of-month only", () => {
    const mapped = mapGoogleEvent({
      google_id: "abc123",
      summary: "September meeting",
      start_iso: "2026-09-12T10:00:00-07:00",
      all_day: false,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.day).toBe(12);
    expect(mapped!.month).toBe(8);
    expect(mapped!.year).toBe(2026);
    expect(mapped!.title).toBe("September meeting");
    expect(mapped!.member).toBe("Google");
    expect(mapped!.id).toContain("abc123");
  });

  it("maps all-day events to 'All day'", () => {
    const mapped = mapGoogleEvent({
      google_id: "allday1",
      summary: "Holiday",
      start_iso: "2026-10-31",
      all_day: true,
    });
    expect(mapped!.time).toBe("All day");
    expect(mapped!.month).toBe(9);
    expect(mapped!.day).toBe(31);
  });

  it("falls back to '(no title)' and returns null for unusable rows", () => {
    const mapped = mapGoogleEvent({ google_id: "x", start_iso: "2026-08-01T09:00:00Z", all_day: false });
    expect(mapped!.title).toBe("(no title)");
    expect(mapGoogleEvent({ google_id: "y", start_iso: "", all_day: false })).toBeNull();
  });
});

describe("eventInMonth", () => {
  it("family events without month/year repeat every month (existing behavior)", () => {
    expect(eventInMonth({ day: 18 }, 0, 2026)).toBe(true);
    expect(eventInMonth({ day: 18 }, 11, 2027)).toBe(true);
  });

  it("dated events match only their own month and year", () => {
    const aug = { day: 12, month: 7, year: 2026 };
    expect(eventInMonth(aug, 7, 2026)).toBe(true);
    expect(eventInMonth(aug, 6, 2026)).toBe(false);
    expect(eventInMonth(aug, 8, 2026)).toBe(false);
    expect(eventInMonth(aug, 7, 2027)).toBe(false);
  });

  it("next-month events are visible in their own month (no ghost copies, no drops)", () => {
    const aug12 = mapGoogleEvent({ google_id: "a", summary: "Aug", start_iso: "2026-08-12", all_day: true })!;
    const sep12 = mapGoogleEvent({ google_id: "b", summary: "Sep", start_iso: "2026-09-12", all_day: true })!;
    expect(eventInMonth(aug12, 7, 2026)).toBe(true);
    expect(eventInMonth(aug12, 8, 2026)).toBe(false);
    expect(eventInMonth(sep12, 8, 2026)).toBe(true);
    expect(eventInMonth(sep12, 7, 2026)).toBe(false);
  });
});

import { dbEventToCalEvent } from "@/lib/calendar/google-mapping";

describe("dbEventToCalEvent", () => {
  it("maps a PB events row to a dated CalEvent (0-based month)", () => {
    const e = dbEventToCalEvent({
      id: "pb_e1",
      title: "Recital",
      date: "2026-09-15",
      time: "7:00 PM",
      icon: "🎹",
      color: "amber",
      member: "Emily",
    });
    expect(e).toEqual({
      id: "pb_e1",
      title: "Recital",
      time: "7:00 PM",
      member: "Emily",
      color: "amber",
      emoji: "🎹",
      day: 15,
      month: 8,
      year: 2026,
    });
  });

  it("returns null for rows without a title or a parseable date", () => {
    expect(dbEventToCalEvent({ id: "x", title: "", date: "2026-09-15" })).toBeNull();
    expect(dbEventToCalEvent({ id: "x", title: "Y", date: "garbage" })).toBeNull();
    expect(dbEventToCalEvent(null)).toBeNull();
  });

  it("defaults missing icon/color/member", () => {
    const e = dbEventToCalEvent({ id: "pb_e2", title: "Simple", date: "2026-12-01" })!;
    expect(e.emoji).toBe("📅");
    expect(e.color).toBe("green");
    expect(e.member).toBe("All");
    expect(e.month).toBe(11);
  });
});

describe("mapGoogleEvent — multi-calendar (Fix-C)", () => {
  it("carries googleId + calendarId as explicit fields", () => {
    const mapped = mapGoogleEvent({
      google_id: "abc123",
      calendar_id: "family@gmail.com",
      summary: "Soccer",
      start_iso: "2026-09-12T10:00:00-07:00",
      all_day: false,
    })!;
    expect(mapped.googleId).toBe("abc123");
    expect(mapped.calendarId).toBe("family@gmail.com");
  });

  it("treats a missing calendar_id as primary", () => {
    const mapped = mapGoogleEvent({
      google_id: "abc123",
      summary: "Legacy",
      start_iso: "2026-09-12T10:00:00-07:00",
      all_day: false,
    })!;
    expect(mapped.calendarId).toBe("primary");
  });

  it("keeps the original id shape for primary events (no localStorage churn)", () => {
    const mapped = mapGoogleEvent({
      google_id: "abc123",
      calendar_id: "primary",
      summary: "Old shape",
      start_iso: "2026-09-12",
      all_day: true,
    })!;
    expect(mapped.id).toBe(`g_abc123_12_9_2026_All day`);
  });

  it("cross-calendar google_id collision produces two distinct client ids", () => {
    const row = {
      google_id: "shared1",
      summary: "Collision",
      start_iso: "2026-09-12",
      all_day: true,
    };
    const inPrimary = mapGoogleEvent({ ...row, calendar_id: "primary" })!;
    const inFamily = mapGoogleEvent({ ...row, calendar_id: "family@gmail.com" })!;
    const inWork = mapGoogleEvent({ ...row, calendar_id: "work@company.com" })!;
    expect(inPrimary.id).not.toBe(inFamily.id);
    expect(inFamily.id).not.toBe(inWork.id);
    // both still resolve back to the same raw Google id
    expect(inPrimary.googleId).toBe(inFamily.googleId);
  });

  it("passes colorHex through from a calendarId→colorRgb map", () => {
    const mapped = mapGoogleEvent(
      {
        google_id: "f1",
        calendar_id: "family@gmail.com",
        summary: "Recital",
        start_iso: "2026-09-12",
        all_day: true,
      },
      { "family@gmail.com": "#ab47bc", primary: "#0b804b" },
    )!;
    expect(mapped.colorHex).toBe("#ab47bc");
    expect(mapped.color).toBe("cyan"); // named fallback untouched
  });

  it("omits colorHex when the calendar has no entry in the map (or no map)", () => {
    const noMap = mapGoogleEvent({
      google_id: "f2",
      calendar_id: "family@gmail.com",
      summary: "X",
      start_iso: "2026-09-12",
      all_day: true,
    })!;
    expect("colorHex" in noMap).toBe(false);
    const unknownCal = mapGoogleEvent(
      { google_id: "f3", calendar_id: "other@x.com", summary: "Y", start_iso: "2026-09-12", all_day: true },
      { primary: "#0b804b" },
    )!;
    expect("colorHex" in unknownCal).toBe(false);
  });
});

describe("multi-day coverage", () => {
  const weekend = {
    google_id: "wk1",
    summary: "Bailey & Emily at home",
    start_iso: "2026-10-30",
    end_iso: "2026-11-02",
    all_day: true,
  };
  it("all-day span covers every day, exclusive end", () => {
    expect(googleEventCoveredDays(weekend)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    const rows = expandGoogleEvent(weekend);
    expect(rows.map((r) => [r.day, r.month, r.year])).toEqual([
      [30, 9, 2026],
      [31, 9, 2026],
      [1, 10, 2026],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.every((r) => r.time === "All day")).toBe(true);
    expect(googleEventCoversDay(weekend, "2026-11-01")).toBe(true);
    expect(googleEventCoversDay(weekend, "2026-11-02")).toBe(false);
  });
  it("single-day row keeps the legacy id byte-identical", () => {
    const one = {
      google_id: "a1",
      summary: "X",
      start_iso: "2026-10-30",
      end_iso: "2026-10-31",
      all_day: true,
    };
    expect(expandGoogleEvent(one).length).toBe(1);
    expect(mapGoogleEvent(one)!.id).toBe(expandGoogleEvent(one)[0].id);
  });
  it("cross-midnight timed event covers both days; exact-midnight end does not", () => {
    const span = {
      google_id: "t1",
      summary: "T",
      start_iso: "2026-10-30T23:00:00-04:00",
      end_iso: "2026-10-31T01:00:00-04:00",
    };
    expect(googleEventCoveredDays(span).length).toBe(2);
    const midnightEnd = { ...span, end_iso: "2026-10-31T00:00:00-04:00" };
    expect(googleEventCoveredDays(midnightEnd).length).toBe(1);
  });
  it("unflagged date-only start_iso is still a local all-day value (no TZ day-shift)", () => {
    const u = {
      google_id: "u1",
      summary: "U",
      start_iso: "2026-09-10",
      end_iso: "2026-09-11",
    };
    expect(googleEventCoveredDays(u)).toEqual(["2026-09-10"]);
    expect(expandGoogleEvent(u)[0].time).toBe("All day");
  });
  it("unflagged multi-day date-only span covers every day, exclusive end", () => {
    const m = {
      google_id: "u2",
      summary: "M",
      start_iso: "2026-10-30",
      end_iso: "2026-11-02",
    };
    expect(googleEventCoveredDays(m)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
  it("missing/invalid end_iso and end<=start degrade to the start day only", () => {
    expect(
      googleEventCoveredDays({ google_id: "g", start_iso: "2026-10-30", all_day: true }),
    ).toEqual(["2026-10-30"]);
    expect(
      googleEventCoveredDays({
        google_id: "g",
        start_iso: "2026-10-30",
        end_iso: "2026-10-30",
        all_day: true,
      }),
    ).toEqual(["2026-10-30"]);
    expect(googleEventCoveredDays({ google_id: "g", start_iso: "" })).toEqual([]);
  });
});
