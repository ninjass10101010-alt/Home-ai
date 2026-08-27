import { describe, it, expect } from "vitest";
import { parseGoogleStart, mapGoogleEvent, eventInMonth } from "@/lib/calendar/google-mapping";

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
