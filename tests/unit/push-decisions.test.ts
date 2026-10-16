import { describe, it, expect } from "vitest";
process.env.TZ = "UTC";
import { routineLeadDecisions, eventNotifyDecisions } from "@/lib/push/decisions";
import type { AlertedRef } from "@/lib/ha/alerts";

describe("routineLeadDecisions", () => {
  const now = new Date("2026-01-05T12:00:00Z");
  it("fires for a notify routine starting in 20 min", () => {
    const r = routineLeadDecisions({
      routines: [{ id: "r1", title: "Standup", time: "12:20", days: "all", notify: true }],
      now,
      alerted: [],
      weekdayShort: "Mon",
      weekdayIndex: 1,
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].id).toBe("r1");
    expect(r.alerts[0].minutesLeft).toBe(20);
  });
  it("does not fire when notify is false", () => {
    const r = routineLeadDecisions({
      routines: [{ id: "r1", title: "Standup", time: "12:20", days: "all", notify: false }],
      now,
      alerted: [],
      weekdayShort: "Mon",
      weekdayIndex: 1,
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(0);
  });
  it("does not fire when routine does not cover weekday", () => {
    const r = routineLeadDecisions({
      routines: [{ id: "r1", title: "Standup", time: "12:20", days: "weekends", notify: true }],
      now,
      alerted: [],
      weekdayShort: "Mon",
      weekdayIndex: 1,
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(0);
  });
  it("does not re-fire already-alerted id|date", () => {
    const alerted: AlertedRef[] = [{ id: "r1", date: "2026-01-05" }];
    const r = routineLeadDecisions({
      routines: [{ id: "r1", title: "Standup", time: "12:20", days: "all", notify: true }],
      now,
      alerted,
      weekdayShort: "Mon",
      weekdayIndex: 1,
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(0);
  });
  it("suppresses during quiet hours", () => {
    const quietNow = new Date("2026-01-05T22:00:00Z");
    const r = routineLeadDecisions({
      routines: [{ id: "r1", title: "Standup", time: "22:20", days: "all", notify: true }],
      now: quietNow,
      alerted: [],
      weekdayShort: "Mon",
      weekdayIndex: 1,
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(0);
  });
});

describe("eventNotifyDecisions", () => {
  const now = new Date("2026-01-05T12:00:00Z");
  it("fires for notify event within 60 min", () => {
    const r = eventNotifyDecisions({
      events: [{ id: "e1", title: "Dinner", date: "2026-01-05", time: "13:00", notify: true }],
      now,
      alerted: [],
      todayISO: "2026-01-05",
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].id).toBe("e1");
    expect(r.alerts[0].minutesLeft).toBe(60);
  });
  it("does not fire when notify is false", () => {
    const r = eventNotifyDecisions({
      events: [{ id: "e1", title: "Dinner", date: "2026-01-05", time: "13:00", notify: false }],
      now,
      alerted: [],
      todayISO: "2026-01-05",
      tz: "UTC",
    });
    expect(r.alerts).toHaveLength(0);
  });
});
