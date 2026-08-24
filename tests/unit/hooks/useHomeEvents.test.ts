import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks must be hoisted before imports
const mockGatewayList = vi.fn();
const mockSelectTodaysEvents = vi.fn();

vi.mock("@/db/gateway-client", () => ({
  gatewayList: mockGatewayList,
}));

vi.mock("@/db", () => ({
  db: {
    selectTodaysEvents: mockSelectTodaysEvents,
  },
}));

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowStr(): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const tom = new Date(t);
  tom.setDate(t.getDate() + 1);
  return formatLocalDate(tom);
}
function endStr(): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const e = new Date(t);
  e.setDate(t.getDate() + 8);
  return formatLocalDate(e);
}
function todayStr(): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return formatLocalDate(t);
}
function dateOffset(days: number): string {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + days);
  return formatLocalDate(t);
}

function lastQuery(): URLSearchParams {
  const qs: string = mockGatewayList.mock.calls[0][1];
  expect(qs.startsWith("?")).toBe(true);
  return new URLSearchParams(qs);
}

describe("getHomeEvents", () => {
  beforeEach(() => {
    mockGatewayList.mockReset();
    mockSelectTodaysEvents.mockReset();
    // default: selectTodaysEvents returns empty, gateway list returns empty rows
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGatewayList.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function load() {
    return await import("@/hooks/useHomeEvents");
  }

  it("returns todayEvents from db.selectTodaysEvents", async () => {
    const { getHomeEvents } = await load();
    const todayEvents = [{ id: "t1", title: "Today event", date: todayStr() }];
    mockSelectTodaysEvents.mockReturnValue(todayEvents);
    mockGatewayList.mockResolvedValue([]);

    const res = await getHomeEvents();
    expect(mockSelectTodaysEvents).toHaveBeenCalledTimes(1);
    expect(res.todayEvents).toEqual(todayEvents);
    expect(res.upcomingImportant).toEqual([]);
  });

  it("limits upcomingImportant to 3", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const tom = tomorrowStr();
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      title: `Important ${i + 1}`,
      date: tom,
      importanceScore: 80 - i,
    }));
    // Gateway caps server-side via limit param; if more rows come back anyway,
    // the hook must still slice to 3 after sorting.
    mockGatewayList.mockResolvedValue(items);

    const res = await getHomeEvents();
    expect(res.upcomingImportant).toHaveLength(3);
    // Should be top 3 by score
    expect(res.upcomingImportant.map((e: any) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("filters upcomingImportant to importanceScore >= 50", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const tom = tomorrowStr();
    mockGatewayList.mockResolvedValue([
      { id: "1", date: tom, importanceScore: 70 },
      { id: "2", date: tom, importanceScore: 40 },
      { id: "3", date: tom, importanceScore: 50 },
      { id: "4", date: tom, importanceScore: 49 },
    ]);

    await getHomeEvents();

    // Force the JS-enforcement path: primary query fails, fetch-all fallback
    // returns mixed scores; the hook must filter <50 itself.
    mockGatewayList.mockRejectedValueOnce(new Error("force fallback"));
    mockGatewayList.mockResolvedValue([
      { id: "1", date: tom, importanceScore: 70 },
      { id: "2", date: tom, importanceScore: 40 },
      { id: "3", date: tom, importanceScore: 50 },
      { id: "4", date: tom, importanceScore: 49 },
    ]);

    const res2 = await getHomeEvents();
    expect(res2.upcomingImportant.map((e: any) => e.id).sort()).toEqual(["1", "3"]);
    expect(res2.upcomingImportant.every((e: any) => e.importanceScore >= 50)).toBe(true);
  });

  it("queries the events collection with windowed filter, sort and limit 3", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGatewayList.mockResolvedValue([]);

    await getHomeEvents();

    expect(mockGatewayList).toHaveBeenCalledTimes(1);
    const args = mockGatewayList.mock.calls[0];
    expect(args[0]).toBe("events");
    const opts = lastQuery();
    expect(opts.get("limit")).toBe("3");
    expect(opts.get("sort")).toBe("-importanceScore,date");
    // Filter should contain local dates
    const tom = tomorrowStr();
    const end = endStr();
    expect(opts.get("filter")).toContain(`date >= "${tom}"`);
    expect(opts.get("filter")).toContain(`date < "${end}"`);
    expect(opts.get("filter")).toContain(`importanceScore >= 50`);
    // Must not include today
    const today = todayStr();
    expect(opts.get("filter")).not.toContain(`date >= "${today}"`);
  });

  it("excludes today and includes tomorrow, excludes end boundary", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const today = todayStr();
    const tom = tomorrowStr();
    const end = endStr();
    const afterEnd = dateOffset(9);

    // Force JS path to verify window logic
    mockGatewayList.mockRejectedValueOnce(new Error("filter error"));
    mockGatewayList.mockResolvedValue([
      { id: "today", date: today, importanceScore: 90 },
      { id: "tom", date: tom, importanceScore: 80 },
      { id: "end", date: end, importanceScore: 95 }, // exclusive -> excluded
      { id: "afterEnd", date: afterEnd, importanceScore: 99 },
      { id: "mid", date: dateOffset(3), importanceScore: 60 },
    ]);

    const res = await getHomeEvents();
    const ids = res.upcomingImportant.map((e: any) => e.id);
    expect(ids).not.toContain("today");
    expect(ids).toContain("tom");
    expect(ids).not.toContain("end");
    expect(ids).not.toContain("afterEnd");
    expect(ids).toContain("mid");
  });

  it("sorts by -importanceScore then date asc, limit 3", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const tom = tomorrowStr();
    const d2 = dateOffset(2);
    const d3 = dateOffset(3);
    // Force JS fallback path
    mockGatewayList.mockRejectedValueOnce(new Error("filter error"));
    mockGatewayList.mockResolvedValue([
      { id: "a", date: d3, importanceScore: 80 },
      { id: "b", date: tom, importanceScore: 80 }, // same score earlier date first
      { id: "c", date: d2, importanceScore: 95 }, // highest score first
      { id: "d", date: d2, importanceScore: 60 },
    ]);

    const res = await getHomeEvents();
    expect(res.upcomingImportant.map((e: any) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("handles start ISO shape for date derivation (local date)", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const tomDate = new Date();
    tomDate.setHours(0, 0, 0, 0);
    tomDate.setDate(tomDate.getDate() + 1);
    tomDate.setHours(10, 0, 0, 0);
    const startIso = tomDate.toISOString();
    const endIso = new Date(tomDate.getTime() + 60 * 60000).toISOString();

    mockGatewayList.mockRejectedValueOnce(new Error("filter error"));
    mockGatewayList.mockResolvedValue([
      { id: "start1", start: startIso, end: endIso, title: "Doctor via start", importanceScore: 70 },
    ]);

    const res = await getHomeEvents();
    expect(res.upcomingImportant).toHaveLength(1);
    expect(res.upcomingImportant[0].id).toBe("start1");
  });

  it("uses local date string not UTC for window", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGatewayList.mockResolvedValue([]);
    await getHomeEvents();
    const opts = lastQuery();
    // Ensure filter dates are YYYY-MM-DD and equal to locally computed strings
    const tom = tomorrowStr();
    const end = endStr();
    // They should be local-derived, not ISO UTC slicing
    expect(tom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts.get("filter")).toContain(tom);
    expect(opts.get("filter")).toContain(end);
  });

  it("returns empty upcomingImportant on gateway failure", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGatewayList.mockRejectedValue(new Error("gateway down"));
    const res = await getHomeEvents();
    expect(res.upcomingImportant).toEqual([]);
    expect(res.todayEvents).toEqual([]);
  });

  it("global constraint: max 3 upcoming, days >today ≤7, score ≥50, sorted correctly", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([{ id: "today1", date: todayStr() }]);
    // Provide 10 in-window events with varying scores; only top 3 sorted should survive
    const tom = tomorrowStr();
    mockGatewayList.mockRejectedValueOnce(new Error("fallback"));
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      date: dateOffset(1 + (i % 7)), // days 1..7 rotating, all in 7-day window
      importanceScore: 50 + (i % 5) * 10, // 50..90
    }));
    // Make one score below threshold to ensure filtering
    many.push({ id: "low", date: tom, importanceScore: 30 });
    mockGatewayList.mockResolvedValue(many);

    const res = await getHomeEvents();
    expect(res.upcomingImportant.length).toBeLessThanOrEqual(3);
    expect(res.upcomingImportant.every((e: any) => e.importanceScore >= 50)).toBe(true);
    // Sorted descending score
    for (let i = 1; i < res.upcomingImportant.length; i++) {
      expect(res.upcomingImportant[i - 1].importanceScore).toBeGreaterThanOrEqual(res.upcomingImportant[i].importanceScore);
    }
    // All dates in window
    const tomS = tomorrowStr();
    const endS = endStr();
    for (const e of res.upcomingImportant) {
      const d = (e.date as string).slice(0, 10);
      expect(d >= tomS).toBe(true);
      expect(d < endS).toBe(true);
    }
  });
});
