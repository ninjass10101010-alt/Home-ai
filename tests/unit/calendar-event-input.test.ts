import { describe, expect, it } from "vitest";
import {
  eventSortMinutes,
  googleInputFor,
  nextDateISO,
  parseClockToHHMM,
  rowToEventInput,
  validateEventInput,
  type EventInput,
} from "@/lib/calendar/event-input";

const base = (): EventInput => ({
  title: "Dentist",
  date: "2026-10-21",
  startTime: "09:00",
  endTime: "10:00",
  allDay: false,
  member: "Mia",
  location: "Main St",
  notes: "Bring forms",
  notify: true,
});

describe("parseClockToHHMM", () => {
  it.each([
    ["09:00", "09:00"],
    ["9:00 AM", "09:00"],
    ["7:05 PM", "19:05"],
    ["19:05", "19:05"],
    ["12:00 AM", "00:00"],
    ["12:00 PM", "12:00"],
  ])("normalizes %s", (input, expected) => {
    expect(parseClockToHHMM(input)).toBe(expected);
  });

  it.each(["", "25:00", "9:7", "noon", "13:00 PM"])("rejects %s", (input) => {
    expect(parseClockToHHMM(input)).toBeNull();
  });
});

describe("validateEventInput", () => {
  it("normalizes a timed event", () => {
    const out = validateEventInput(base());
    expect(out).toMatchObject({
      title: "Dentist",
      date: "2026-10-21",
      time: "09:00",
      endTime: "10:00",
      allDay: false,
      member: "Mia",
      location: "Main St",
      notes: "Bring forms",
      notify: true,
    });
  });

  it("defaults an omitted end to start + 60 minutes", () => {
    expect(validateEventInput({ ...base(), endTime: "" }).endTime).toBe("10:00");
  });

  it("clamps a late start to 23:59", () => {
    expect(validateEventInput({ ...base(), startTime: "23:30", endTime: "" }).endTime).toBe("23:59");
  });

  it("rejects an end at or before the start", () => {
    expect(() => validateEventInput({ ...base(), endTime: "09:00" })).toThrow(/end/i);
  });

  it("keeps all-day events free of clock values", () => {
    expect(validateEventInput({ ...base(), allDay: true, startTime: "", endTime: "" })).toMatchObject({
      allDay: true,
      time: "All day",
      endTime: "",
    });
  });

  it("rejects impossible calendar dates", () => {
    expect(() => validateEventInput({ ...base(), date: "2026-02-30" })).toThrow(/date/i);
  });

  it("rejects invalid times", () => {
    expect(() => validateEventInput({ ...base(), startTime: "25:00" })).toThrow(/time/i);
  });

  it("trims and bounds the title", () => {
    expect(validateEventInput({ ...base(), title: "  Dentist  " }).title).toBe("Dentist");
    expect(() => validateEventInput({ ...base(), title: "   " })).toThrow(/title/i);
    expect(() => validateEventInput({ ...base(), title: "x".repeat(201) })).toThrow(/title/i);
  });

  it("accepts the All pseudo-member but rejects an unknown live member", () => {
    expect(validateEventInput({ ...base(), member: "All" }).member).toBe("All");
    expect(() =>
      validateEventInput({ ...base(), member: "Nobody" }, ["Mia", "Alex", "Ben"]),
    ).toThrow(/member/i);
  });

  it("allows an empty member when the roster is unavailable", () => {
    expect(validateEventInput({ ...base(), member: "" }, []).member).toBe("All");
  });
});

describe("date and Google mappers", () => {
  it("sorts all-day first and malformed last", () => {
    expect(eventSortMinutes("All day", true)).toBe(-1);
    expect(eventSortMinutes("09:00", false)).toBe(540);
    expect(eventSortMinutes("7:05 PM", false)).toBe(1145);
    expect(eventSortMinutes("nope", false)).toBe(1440);
  });

  it("advances a date across month and year boundaries", () => {
    expect(nextDateISO("2026-10-31")).toBe("2026-11-01");
    expect(nextDateISO("2026-12-31")).toBe("2027-01-01");
  });

  it("maps a timed event to Composio datetimes", () => {
    expect(googleInputFor(validateEventInput(base()))).toMatchObject({
      summary: "Dentist",
      start: { dateTime: "2026-10-21T09:00:00" },
      end: { dateTime: "2026-10-21T10:00:00" },
      location: "Main St",
      description: "Bring forms",
    });
  });

  it("maps an all-day event to inclusive start / exclusive end dates", () => {
    expect(
      googleInputFor(validateEventInput({ ...base(), allDay: true, startTime: "", endTime: "" })),
    ).toMatchObject({
      start: { date: "2026-10-21" },
      end: { date: "2026-10-22" },
    });
  });

  it("reads a legacy row into the input shape", () => {
    expect(
      rowToEventInput({
        id: "e1",
        title: "Legacy",
        date: "2026-10-21",
        time: "7:00 PM",
        member: "Mia",
      }),
    ).toMatchObject({ title: "Legacy", startTime: "19:00", endTime: "20:00", allDay: false });
  });
});
