import { describe, expect, it } from "vitest";
import { filterMirroredFamilyRows } from "@/lib/calendar/google-dedupe";

describe("filterMirroredFamilyRows", () => {
  it("drops cached Google rows claimed by a family event", () => {
    const googleRows = [
      { google_id: "g1", calendar_id: "primary", summary: "Dentist", start_iso: "2026-10-21T09:00:00" },
      { google_id: "g2", calendar_id: "primary", summary: "Other", start_iso: "2026-10-21T11:00:00" },
    ];
    const family = [{ googleEventId: "g1" }];
    expect(filterMirroredFamilyRows(googleRows, family).map((r) => r.google_id)).toEqual(["g2"]);
  });

  it("keeps every Google row when the family read fails", () => {
    const googleRows = [{ google_id: "g1" }];
    expect(filterMirroredFamilyRows(googleRows, []).map((r) => r.google_id)).toEqual(["g1"]);
  });
});
