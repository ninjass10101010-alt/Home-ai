import { describe, it, expect } from "vitest";
import { googleEventTime, mergeTodaysEvents, type ToolEvent } from "@/lib/consuela/todays-events";

const fam = (title: string, time?: string, extra: Partial<ToolEvent> = {}): ToolEvent => ({
  title, time, source: "family", icon: "📅", color: "amber", sortMinutes: 0, ...extra,
});

const goog = (summary: string, startIso: string, extra: Record<string, unknown> = {}) => ({
  summary, start_iso: startIso, all_day: !startIso.includes("T"), ...extra,
});

describe("googleEventTime", () => {
  it("formats a timed ISO start as 12-hour local time", () => {
    expect(googleEventTime("2026-09-09T18:30:00-04:00")).toBe("6:30 PM");
    expect(googleEventTime("2026-09-09T09:05:00-04:00")).toBe("9:05 AM");
  });

  it("returns All day for a date-only (all-day) start", () => {
    expect(googleEventTime("2026-09-10")).toBe("All day");
  });
});

describe("mergeTodaysEvents", () => {
  it("includes family events plus google events dated today", () => {
    const merged = mergeTodaysEvents(
      [fam("Emily Orchestra", "6:30 PM")],
      [goog("Bailey & Emily at home!", "2026-09-10"), goog("Choir", "2026-09-09T16:00:00-04:00")],
      "2026-09-09",
    );
    expect(merged.map((e) => `${e.source}:${e.title}`)).toEqual([
      "google:Choir",
      "family:Emily Orchestra",
    ]);
  });

  it("drops google rows not on the requested day", () => {
    const merged = mergeTodaysEvents([], [goog("Yesterday thing", "2026-09-08T10:00:00-04:00")], "2026-09-09");
    expect(merged).toEqual([]);
  });

  it("sorts all-day google events first, then by time", () => {
    const merged = mergeTodaysEvents(
      [fam("Evening", "7:00 PM"), fam("Morning", "8:00 AM")],
      [goog("All-day trip", "2026-09-09"), goog("Noon", "2026-09-09T12:00:00-04:00")],
      "2026-09-09",
    );
    expect(merged.map((e) => e.title)).toEqual(["All-day trip", "Morning", "Noon", "Evening"]);
  });

  it("google rows carry the calendar-page cyan fallback + 📅 icon", () => {
    const merged = mergeTodaysEvents([], [goog("Choir", "2026-09-09T16:00:00-04:00")], "2026-09-09");
    expect(merged[0]).toMatchObject({ source: "google", color: "cyan", icon: "📅", time: "4:00 PM" });
  });

  it("survives a dead google read (empty rows)", () => {
    const merged = mergeTodaysEvents([fam("Solo")], [], "2026-09-09");
    expect(merged).toHaveLength(1);
  });
});
