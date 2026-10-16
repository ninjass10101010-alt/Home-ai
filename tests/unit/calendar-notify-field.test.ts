import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "@/lib/pb-seed";
import { dbScheduleToScheduleItem, dbEventToCalEvent } from "@/lib/calendar/google-mapping";

describe("calendar notify field", () => {
  it("schedules and events collections include a notify bool field", () => {
    for (const name of ["schedules", "events"]) {
      const col = COLLECTIONS.find((c) => c.name === name)!;
      const f = col.schema.find((s: any) => s.name === "notify");
      expect(f).toBeDefined();
      expect(f!.type).toBe("bool");
    }
  });

  it("dbScheduleToScheduleItem maps notify and defaults to false", () => {
    expect(dbScheduleToScheduleItem({ id: "1", title: "Dinner", time: "6:00 PM", notify: true })?.notify).toBe(true);
    expect(dbScheduleToScheduleItem({ id: "1", title: "Dinner", time: "6:00 PM" })?.notify).toBe(false);
  });

  it("dbEventToCalEvent maps notify", () => {
    expect(dbEventToCalEvent({ id: "1", title: "Dentist", date: "2026-10-20", time: "2:00 PM", notify: true })?.notify).toBe(true);
  });
});
