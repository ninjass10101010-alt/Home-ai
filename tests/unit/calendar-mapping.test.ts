import { beforeAll, describe, expect, it } from "vitest";
import { googleEventCoveredDays } from "@/lib/calendar/google-mapping";
import { eventSortMinutes } from "@/lib/calendar/event-input";

beforeAll(() => {
  process.env.TZ = "America/Detroit";
});

describe("calendar date and sort integrity", () => {
  it("keeps a late-evening event on its local day across the DST transition", () => {
    const out = googleEventCoveredDays({
      all_day: false,
      start_iso: "2026-03-08T20:00:00",
      end_iso: "2026-03-08T23:30:00",
    });
    expect(out).toEqual(["2026-03-08"]);
  });

  it("buckets an all-day Google event by the date part even when start is a full timestamp", () => {
    const out = googleEventCoveredDays({
      all_day: true,
      start_iso: "2026-10-21T00:00:00Z",
      end_iso: "2026-10-22T00:00:00Z",
    });
    expect(out).toEqual(["2026-10-21"]);
  });

  it("keeps a timed event ending at local midnight on its start day", () => {
    const out = googleEventCoveredDays({
      all_day: false,
      start_iso: "2026-10-21T20:00:00",
      end_iso: "2026-10-22T00:00:00",
    });
    expect(out).toEqual(["2026-10-21"]);
  });

  it("sorts all-day first and malformed last", () => {
    expect(eventSortMinutes("All day", true)).toBe(-1);
    expect(eventSortMinutes("09:00", false)).toBe(540);
    expect(eventSortMinutes("nope", false)).toBe(1440);
  });
});
