import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks must be hoisted before imports
const mockGetList = vi.fn();
const mockGetFullList = vi.fn();
const mockSelectTodaysEvents = vi.fn();

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => {
    const pb: any = {
      collection: vi.fn(() => ({
        getList: mockGetList,
        getFullList: mockGetFullList,
      })),
    };
    return fn(pb);
  }),
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
  e.setDate(t.getDate() + 7);
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

describe("getHomeEvents", () => {
  beforeEach(() => {
    mockGetList.mockReset();
    mockGetFullList.mockReset();
    mockSelectTodaysEvents.mockReset();
    mockGetFullList.mockResolvedValue([]);
    // default: selectTodaysEvents returns empty, getList returns empty items
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGetList.mockResolvedValue({ items: [] });
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
    mockGetList.mockResolvedValue({ items: [] });

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
    // Server was asked to limit 3, but we also test JS slice path: if getList returns 5,
    // the hook should still slice to 3 after sorting.
    mockGetList.mockResolvedValue({ items });

    const res = await getHomeEvents();
    expect(res.upcomingImportant).toHaveLength(3);
    // Should be top 3 by score
    expect(res.upcomingImportant.map((e: any) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("filters upcomingImportant to importanceScore >= 50", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const tom = tomorrowStr();
    mockGetList.mockResolvedValue({
      items: [
        { id: "1", date: tom, importanceScore: 70 },
        { id: "2", date: tom, importanceScore: 40 },
        { id: "3", date: tom, importanceScore: 50 },
        { id: "4", date: tom, importanceScore: 49 },
      ],
    });

    const res = await getHomeEvents();
    // Our JS re-sort slice will keep all, but needsJsFilter will detect low scores?
    // Actually items are within window but scores <50 should be filtered in fallback path.
    // However primary getList path assumes PB already filtered. To test the hook's
    // JS enforcement, we force fallback by making getList throw, then getFullList returns mixed scores.
    mockGetList.mockRejectedValueOnce(new Error("force fallback"));
    mockGetFullList.mockResolvedValue([
      { id: "1", date: tom, importanceScore: 70 },
      { id: "2", date: tom, importanceScore: 40 },
      { id: "3", date: tom, importanceScore: 50 },
      { id: "4", date: tom, importanceScore: 49 },
    ]);

    const res2 = await getHomeEvents();
    expect(res2.upcomingImportant.map((e: any) => e.id).sort()).toEqual(["1", "3"]);
    expect(res2.upcomingImportant.every((e: any) => e.importanceScore >= 50)).toBe(true);
  });

  it("queries PB with date window tomorrow inclusive and end exclusive (local date)", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGetList.mockResolvedValue({ items: [] });

    await getHomeEvents();

    expect(mockGetList).toHaveBeenCalledTimes(1);
    const args = mockGetList.mock.calls[0];
    expect(args[0]).toBe(1);
    expect(args[1]).toBe(3);
    const opts = args[2];
    expect(opts.sort).toBe("-importanceScore,date");
    // Filter should contain local dates
    const tom = tomorrowStr();
    const end = endStr();
    expect(opts.filter).toContain(`date >= "${tom}"`);
    expect(opts.filter).toContain(`date < "${end}"`);
    expect(opts.filter).toContain(`importanceScore >= 50`);
    // Must not include today
    const today = todayStr();
    expect(opts.filter).not.toContain(`date >= "${today}"`);
  });

  it("excludes today and includes tomorrow, excludes end boundary", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    const today = todayStr();
    const tom = tomorrowStr();
    const end = endStr();
    const afterEnd = dateOffset(8);

    // Force JS path to verify window logic
    mockGetList.mockRejectedValueOnce(new Error("filter error"));
    mockGetFullList.mockResolvedValue([
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
    mockGetList.mockRejectedValueOnce(new Error("filter error"));
    mockGetFullList.mockResolvedValue([
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

    mockGetList.mockRejectedValueOnce(new Error("filter error"));
    mockGetFullList.mockResolvedValue([
      { id: "start1", start: startIso, end: endIso, title: "Doctor via start", importanceScore: 70 },
    ]);

    const res = await getHomeEvents();
    expect(res.upcomingImportant).toHaveLength(1);
    expect(res.upcomingImportant[0].id).toBe("start1");
  });

  it("uses local date string not UTC for window", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGetList.mockResolvedValue({ items: [] });
    await getHomeEvents();
    const opts = mockGetList.mock.calls[0][2];
    // Ensure filter dates are YYYY-MM-DD and equal to locally computed strings
    const tom = tomorrowStr();
    const end = endStr();
    // They should be local-derived, not ISO UTC slicing
    // We verify they match our local helper (already done) and are not necessarily equal to UTC today
    expect(tom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(opts.filter).toContain(tom);
    expect(opts.filter).toContain(end);
  });

  it("returns empty upcomingImportant on PB error", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([]);
    mockGetList.mockRejectedValue(new Error("pb down"));
    mockGetFullList.mockRejectedValue(new Error("also down"));
    const res = await getHomeEvents();
    expect(res.upcomingImportant).toEqual([]);
    expect(res.todayEvents).toEqual([]);
  });

  it("global constraint: max 3 upcoming, days >today ≤7, score ≥50, sorted correctly", async () => {
    const { getHomeEvents } = await load();
    mockSelectTodaysEvents.mockReturnValue([{ id: "today1", date: todayStr() }]);
    // Provide 10 in-window events with varying scores; only top 3 sorted should survive
    const tom = tomorrowStr();
    mockGetList.mockRejectedValueOnce(new Error("fallback"));
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      date: dateOffset(1 + (i % 6)), // days 1..6 rotating, all in window
      importanceScore: 50 + (i % 5) * 10, // 50..90
    }));
    // Make one score below threshold to ensure filtering
    many.push({ id: "low", date: tom, importanceScore: 30 });
    mockGetFullList.mockResolvedValue(many);

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
