import { describe, it, expect } from "vitest";
process.env.TZ = "America/Detroit";
import {
  withinQuietHours,
  weatherEpisodeDecision,
  calendarLeadDecisions,
  IMPORTANCE_THRESHOLD,
  type EpisodeState,
} from "@/lib/ha/alerts";

const CLOSED: EpisodeState = { active: false, startedAtISO: null, family: null, alertedAtISO: null };

describe("withinQuietHours (America/Detroit)", () => {
  const tz = "America/Detroit";
  it("true at 02:00 and 06:59, false at 07:00 and 20:00, true at 21:00", () => {
    expect(withinQuietHours(new Date("2026-01-05T02:00:00-05:00"), tz)).toBe(true);
    expect(withinQuietHours(new Date("2026-01-05T06:59:00-05:00"), tz)).toBe(true);
    expect(withinQuietHours(new Date("2026-01-05T07:00:00-05:00"), tz)).toBe(false);
    expect(withinQuietHours(new Date("2026-01-05T20:00:00-05:00"), tz)).toBe(false);
    expect(withinQuietHours(new Date("2026-01-05T21:00:00-05:00"), tz)).toBe(true);
  });
});

describe("weatherEpisodeDecision", () => {
  const now = new Date("2026-01-05T15:00:00-05:00"); // 3 PM, not quiet
  it("opens a new storm episode and fires once", () => {
    const r = weatherEpisodeDecision({ code: 95, severeEndISO: null, now, state: CLOSED, tz: "America/Detroit" });
    expect(r.fire).toBe(true);
    expect(r.title).toMatch(/Thunderstorm/i);
    expect(r.nextState).toMatchObject({ active: true, family: "storm", alertedAtISO: expect.any(String) });
  });
  it("does not re-fire within the same active, already-alerted episode", () => {
    const state: EpisodeState = { active: true, startedAtISO: now.toISOString(), family: "storm", alertedAtISO: now.toISOString() };
    const r = weatherEpisodeDecision({ code: 96, severeEndISO: null, now, state, tz: "America/Detroit" });
    expect(r.fire).toBe(false);
    expect(r.nextState.active).toBe(true);
  });
  it("closes the episode on a non-severe code so a new one can fire later", () => {
    const state: EpisodeState = { active: true, startedAtISO: now.toISOString(), family: "storm", alertedAtISO: now.toISOString() };
    const r = weatherEpisodeDecision({ code: 1, severeEndISO: null, now, state, tz: "America/Detroit" });
    expect(r.fire).toBe(false);
    expect(r.nextState.active).toBe(false);
  });
  it("does not alert for WMO 85 snow showers but alerts for WMO 86 heavy snow", () => {
    const shower = weatherEpisodeDecision({ code: 85, severeEndISO: null, now, state: CLOSED, tz: "America/Detroit" });
    const heavy = weatherEpisodeDecision({ code: 86, severeEndISO: null, now, state: CLOSED, tz: "America/Detroit" });
    expect(shower.fire).toBe(false);
    expect(shower.nextState).toMatchObject({ active: false, family: null });
    expect(heavy.fire).toBe(true);
    expect(heavy.title).toMatch(/Big snow/i);
  });

  it("holds (no fire) during quiet hours and stays unalerted to retry after", () => {
    const quietNow = new Date("2026-01-05T02:00:00-05:00");
    const r = weatherEpisodeDecision({ code: 95, severeEndISO: null, now: quietNow, state: CLOSED, tz: "America/Detroit" });
    expect(r.fire).toBe(false);
    expect(r.nextState.alertedAtISO).toBeNull();
  });
});

describe("calendarLeadDecisions", () => {
  const now = new Date("2026-01-05T14:00:00-05:00"); // 2 PM EST
  const mk = (id: string, score: number, time: string) =>
    ({ id, title: `T-${id}`, date: "2026-01-05", time, importanceScore: score });
  it("fires for an important event 0–60 min out, reports minutesLeft", () => {
    const r = calendarLeadDecisions({ events: [mk("a", IMPORTANCE_THRESHOLD, "2:45 PM")], now, alerted: [], tz: "America/Detroit" });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ id: "a", minutesLeft: 45 });
    expect(r.nextState).toContainEqual({ id: "a", date: "2026-01-05" });
  });
  it("ignores below-threshold, past-start, and already-alerted", () => {
    const r = calendarLeadDecisions({
      events: [mk("low", 0, "2:45 PM"), mk("past", 80, "1:00 PM"), mk("seen", 80, "2:45 PM")],
      now, alerted: [{ id: "seen", date: "2026-01-05" }], tz: "America/Detroit",
    });
    expect(r.alerts.map((a) => a.id)).toEqual([]);
  });
  it("supports 24h time; drops alerts inside quiet hours", () => {
    const ok = calendarLeadDecisions({ events: [mk("z", 80, "14:45")], now, alerted: [], tz: "America/Detroit" });
    expect(ok.alerts[0].id).toBe("z"); // 45 min out, 14:45 is not quiet
    const late = new Date("2026-01-05T22:40:00-05:00");
    const quiet = calendarLeadDecisions({ events: [mk("q", 80, "23:10")], now: late, alerted: [], tz: "America/Detroit" });
    expect(quiet.alerts).toHaveLength(0); // inside quiet hours → dropped
    expect(quiet.nextState).not.toContainEqual({ id: "q", date: "2026-01-05" });
  });
});
