import { describe, it, expect } from "vitest";
import { mergeEventsRange } from "@/lib/consuela/todays-events";

describe("mergeEventsRange", () => {
  it("buckets merged per-day lists across the range, family + google, sorted", () => {
    const family = [{ title: "Recital", date: "2026-09-11", time: "18:30", member: "Emily", source: "family" }];
    const google = [{ summary: "PD Training", start_iso: "2026-09-11T14:00:00-04:00" }];
    const byDay = mergeEventsRange(family as any, google as any, "2026-09-11", "2026-09-12");
    expect(byDay["2026-09-11"].map((e) => e.title)).toEqual(["PD Training", "Recital"]);
    expect(byDay["2026-09-12"]).toEqual([]);
    expect(byDay["2026-09-11"][0].source).toBe("google");
  });
  it("caps at 30 days inclusive", () => {
    const byDay = mergeEventsRange([], [], "2026-01-01", "2026-03-01");
    expect(Object.keys(byDay)).toHaveLength(30);
  });
  it("range mode includes a spanning all-day event on every covered day", () => {
    const out = mergeEventsRange(
      [],
      [{ summary: "At home", start_iso: "2026-10-30", end_iso: "2026-11-02", all_day: true }],
      "2026-10-30",
      "2026-11-02",
    );
    expect(out["2026-10-31"].some((e) => e.title === "At home")).toBe(true);
    expect(out["2026-11-01"].some((e) => e.title === "At home")).toBe(true);
    expect(out["2026-11-02"].length).toBe(0);
  });
});
