import { describe, it, expect } from "vitest";
import { dbScheduleToScheduleItem } from "@/lib/calendar/google-mapping";

describe("dbScheduleToScheduleItem", () => {
  it("maps a full PB schedules row to the ScheduleItem shape", () => {
    const row = {
      id: "abc123",
      title: "Bedtime routine",
      time: "8:00 PM",
      days: "weekdays",
      type: "routine",
      icon: "🌙",
      color: "violet",
      mealType: "none",
      member: "Rebecca",
    };
    const item = dbScheduleToScheduleItem(row);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("abc123");
    expect(item!.title).toBe("Bedtime routine");
    expect(item!.days).toBe("weekdays");
    expect(item!.type).toBe("routine");
    expect(item!.member).toBe("Rebecca");
  });

  it("falls back to form defaults for legacy rows missing optional fields", () => {
    const item = dbScheduleToScheduleItem({ id: "row2", title: "Wake up", time: "6:30 AM" });
    expect(item).not.toBeNull();
    expect(item!.days).toBe("all");
    expect(item!.type).toBe("routine");
    expect(item!.icon).toBe("⏰");
    expect(item!.color).toBe("green");
    expect(item!.mealType).toBe("none");
  });

  it("keeps a valid mealType and rejects an unknown one", () => {
    expect(dbScheduleToScheduleItem({ id: "1", title: "t", time: "8:00", mealType: "dinner" })!.mealType).toBe("dinner");
    expect(dbScheduleToScheduleItem({ id: "1", title: "t", time: "8:00", mealType: "brunch" })!.mealType).toBe("none");
  });

  it("normalizes an unknown type to routine", () => {
    expect(dbScheduleToScheduleItem({ id: "1", title: "t", time: "8:00", type: "alarm" })!.type).toBe("routine");
    expect(dbScheduleToScheduleItem({ id: "1", title: "t", time: "8:00", type: "reminder" })!.type).toBe("reminder");
  });

  it("returns null for rows without title or time", () => {
    expect(dbScheduleToScheduleItem(null)).toBeNull();
    expect(dbScheduleToScheduleItem({ id: "1", title: "", time: "8:00" })).toBeNull();
    expect(dbScheduleToScheduleItem({ id: "1", title: "t", time: "" })).toBeNull();
  });
});
