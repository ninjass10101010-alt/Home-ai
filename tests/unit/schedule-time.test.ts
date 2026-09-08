import { describe, it, expect } from "vitest";
import {
  scheduleTimeMinutes,
  formatScheduleTime12h,
  scheduleCoversWeekday,
  scheduleDedupeKey,
} from "@/lib/schedule-time";

describe("scheduleTimeMinutes", () => {
  it("parses 12-hour AM/PM times", () => {
    expect(scheduleTimeMinutes("8:00 AM")).toBe(480);
    expect(scheduleTimeMinutes("12:00 PM")).toBe(720);
    expect(scheduleTimeMinutes("12:30 AM")).toBe(30);
    expect(scheduleTimeMinutes("7:45 PM")).toBe(1185);
    expect(scheduleTimeMinutes("11:59 pm")).toBe(1439);
  });

  it("parses 24-hour times", () => {
    expect(scheduleTimeMinutes("08:00")).toBe(480);
    expect(scheduleTimeMinutes("20:15")).toBe(1215);
    expect(scheduleTimeMinutes("0:00")).toBe(0);
  });

  it("returns null for garbage/empty input", () => {
    expect(scheduleTimeMinutes("")).toBeNull();
    expect(scheduleTimeMinutes("whenever")).toBeNull();
    expect(scheduleTimeMinutes(null)).toBeNull();
    expect(scheduleTimeMinutes(undefined)).toBeNull();
    expect(scheduleTimeMinutes("25:00")).toBeNull();
    expect(scheduleTimeMinutes("8:75 AM")).toBeNull();
  });
});

describe("formatScheduleTime12h", () => {
  it("normalizes both formats to canonical H:MM AM/PM", () => {
    expect(formatScheduleTime12h("8:00 AM")).toBe("8:00 AM");
    expect(formatScheduleTime12h("08:00")).toBe("8:00 AM");
    expect(formatScheduleTime12h("20:15")).toBe("8:15 PM");
    expect(formatScheduleTime12h("12:00 PM")).toBe("12:00 PM");
    expect(formatScheduleTime12h("0:30")).toBe("12:30 AM");
  });

  it("passes unparseable values through instead of Invalid Date", () => {
    expect(formatScheduleTime12h("All day")).toBe("All day");
    expect(formatScheduleTime12h("")).toBe("");
  });
});

describe("scheduleCoversWeekday", () => {
  // 2026-09-08 is a Tuesday (weekdayIndex 2)
  const tue = 2;
  const sun = 0;
  const sat = 6;
  const fri = 5;

  it("matches all/empty/legacy weekday shorts", () => {
    expect(scheduleCoversWeekday("all", "tue", tue)).toBe(true);
    expect(scheduleCoversWeekday("", "tue", tue)).toBe(true);
    expect(scheduleCoversWeekday(null, "tue", tue)).toBe(true);
    expect(scheduleCoversWeekday("tue", "tue", tue)).toBe(true);
    expect(scheduleCoversWeekday("mon,wed,fri", "tue", tue)).toBe(false);
  });

  it("resolves keyword scopes the legacy includes() check never matched", () => {
    // "weekdays".includes("tue") === false — the old bug silently hid
    // weekday/weekend routines from the Home Daily Schedule widget.
    expect(scheduleCoversWeekday("weekdays", "tue", tue)).toBe(true);
    expect(scheduleCoversWeekday("weekdays", "sun", sun)).toBe(false);
    expect(scheduleCoversWeekday("weekdays", "sat", sat)).toBe(false);
    expect(scheduleCoversWeekday("weekends", "sun", sun)).toBe(true);
    expect(scheduleCoversWeekday("weekends", "sat", sat)).toBe(true);
    expect(scheduleCoversWeekday("weekends", "tue", tue)).toBe(false);
    expect(scheduleCoversWeekday("friday", "fri", fri)).toBe(true);
    expect(scheduleCoversWeekday("friday", "tue", tue)).toBe(false);
  });
});

describe("scheduleDedupeKey", () => {
  it("is stable across case/whitespace for title and days", () => {
    expect(scheduleDedupeKey({ title: " Bedtime ", time: "8:00 PM", days: "ALL" })).toBe(
      scheduleDedupeKey({ title: "bedtime", time: "8:00 PM", days: "all" })
    );
  });

  it("distinguishes different times", () => {
    expect(scheduleDedupeKey({ title: "x", time: "8:00 AM", days: "all" })).not.toBe(
      scheduleDedupeKey({ title: "x", time: "8:00 PM", days: "all" })
    );
  });
});
