import { describe, it, expect } from "vitest";
import {
  selectTodayEvents,
  choreProgress,
  briefingDigest,
  wxConditionLabel,
} from "@/lib/screensaver/compose";

const at = (h: number, m = 0) => new Date(2026, 8, 7, h, m, 0); // Mon 2026-09-07 local

describe("selectTodayEvents", () => {
  it("merges family + google rows, drops past events, all-day first, caps at 4", () => {
    const family = [
      { title: "Past thing", date: "2026-09-07", time: "8:00 AM" },
      { title: "Soccer", date: "2026-09-07", time: "4:00 PM", color: "#3b82f6" },
      { title: "All-day errand", date: "2026-09-07", time: "" },
      { title: "Tomorrow", date: "2026-09-08", time: "9:00 AM" },
    ];
    const google = [
      { summary: "Dentist", start_iso: "2026-09-07T18:30:00+08:00", all_day: false },
      { summary: "Birthday", start_iso: "2026-09-07", all_day: true },
      { summary: "Old", start_iso: "2026-09-06T10:00:00+08:00", all_day: false },
    ];
    const out = selectTodayEvents(family, google, "2026-09-07", at(15, 0));
    expect(out.map((e) => e.title)).toEqual([
      "All-day errand",
      "Birthday",
      "Soccer",
      "Dentist",
    ]);
    expect(out[3].time).toBe("6:30 PM");
    expect(out[2].color).toBe("#3b82f6");
  });

  it("keeps all-day rows even late in the day", () => {
    const out = selectTodayEvents([], [{ summary: "Quiet day", start_iso: "2026-09-07", all_day: true }], "2026-09-07", at(23, 0));
    expect(out).toHaveLength(1);
  });

  it("normalizes legacy 24h family times, leaves 12h strings as-is", () => {
    const out = selectTodayEvents(
      [
        { title: "Legacy", date: "2026-09-07", time: "16:30" },
        { title: "Modern", date: "2026-09-07", time: "4:45 PM" },
      ],
      [],
      "2026-09-07",
      at(15, 0)
    );
    expect(out.map((e) => [e.title, e.time])).toEqual([
      ["Legacy", "4:30 PM"],
      ["Modern", "4:45 PM"],
    ]);
  });
});

describe("choreProgress", () => {
  it("counts this-week completions and open items due by week end", () => {
    const tasks = [
      { status: "done", completedInWeek: "2026-09-07", due: "2026-09-07" },
      { status: "done", completedInWeek: "2026-08-31", due: "2026-09-01" }, // last week — not counted
      { status: "pending", due: "2026-09-13" },
      { status: "pending", due: "2026-09-20" }, // due after week end — not counted
      { status: "pending" }, // no due — counted
    ];
    expect(choreProgress(tasks, "2026-09-07", "2026-09-13")).toEqual({ done: 1, total: 3 });
  });
});

describe("briefingDigest", () => {
  it("builds ≤3 honest lines", () => {
    const lines = briefingDigest({
      events: [{}, {}, {}],
      tasks: [{}],
      suggestions: [{ title: "Milk is running low" }],
    });
    expect(lines).toEqual(["📅 3 events today", "✅ 1 chore still open", "💡 Milk is running low"]);
  });
  it("null summary → empty", () => {
    expect(briefingDigest(null)).toEqual([]);
  });
  it("empty day is honest, not silent", () => {
    expect(briefingDigest({ events: [], tasks: [], suggestions: [] })).toEqual([
      "📅 No events today",
      "✅ No chores open",
    ]);
  });
});

describe("wxConditionLabel", () => {
  it("maps WMO codes", () => {
    expect(wxConditionLabel(0)).toBe("Clear");
    expect(wxConditionLabel(2)).toBe("Partly cloudy");
    expect(wxConditionLabel(51)).toBe("Drizzle");
    expect(wxConditionLabel(95)).toBe("Thunderstorms");
    expect(wxConditionLabel(-1)).toBe("—");
  });
});
