import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  composeContextPrompt,
  loadContextPack,
  type ContextPack,
} from "@/lib/consuela/assistant-context";

// Seam: delegate the zone readers to a per-test registry so loadContextPack's
// REAL wiring (which reader each zone uses, null → unavailable, [] → honest
// empty) is exercised without a live PocketBase.
const readers = vi.hoisted(() => ({ current: {} as Record<string, any> }));

vi.mock("@/lib/consuela/live-reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/consuela/live-reads")>();
  const delegate = (name: string) => (...args: any[]) => readers.current[name](...args);
  return {
    ...actual,
    liveMembers: delegate("liveMembers"),
    liveEventsRange: delegate("liveEventsRange"),
    liveMealRows: delegate("liveMealRows"),
    livePantry: delegate("livePantry"),
    liveGrocery: delegate("liveGrocery"),
    livePendingTasks: delegate("livePendingTasks"),
    livePendingTasksForPack: delegate("livePendingTasksForPack"),
    liveRewards: delegate("liveRewards"),
    liveWeekArchive: delegate("liveWeekArchive"),
    liveSchedulesAll: delegate("liveSchedulesAll"),
  };
});

vi.mock("@/lib/weather-live", () => ({
  fetchLiveWeather: (...args: any[]) => readers.current.fetchLiveWeather(...args),
}));

let fns: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  fns = {
    liveMembers: vi.fn(async () => [{ fullName: "Emily G", role: "child", age: 14 }]),
    liveEventsRange: vi.fn(async () => ({ days: {} })),
    liveMealRows: vi.fn(async () => []),
    livePantry: vi.fn(async () => []),
    liveGrocery: vi.fn(async () => []),
    livePendingTasks: vi.fn(async () => []),
    livePendingTasksForPack: vi.fn(async () => []),
    liveRewards: vi.fn(async () => []),
    liveWeekArchive: vi.fn(async () => []),
    liveSchedulesAll: vi.fn(async () => []),
    fetchLiveWeather: vi.fn(async () => ({ ok: false, error: "unused in these tests" })),
  };
  readers.current = fns;
});

const base: ContextPack = {
  roster: [{ name: "Emily G", role: "child", age: 14 }],
  today: { iso: "2026-09-10", weekday: "Thu", yesterdayIso: "2026-09-09", weekStartISO: "2026-09-07", tz: "America/Detroit" },
  unavailable: [],
};

describe("composeContextPrompt", () => {
  it("renders roster + dates", () => {
    const s = composeContextPrompt(base);
    expect(s).toContain("Emily G");
    expect(s).toContain("Thu");
    expect(s).toContain("2026-09-07");
  });
  it("names unavailable zones as unavailable so the model says so", () => {
    const s = composeContextPrompt({ ...base, unavailable: ["pantry"] });
    expect(s).toMatch(/pantry.*unavailable/i);
    expect(s).toContain("do not guess");
  });
  it("caps calendar digest so prompts stay small", () => {
    const days: Record<string, any[]> = {};
    for (let d = 1; d <= 30; d++) days[`2026-09-${String(d).padStart(2, "0")}`] = [{ title: "X" }];
    const s = composeContextPrompt({ ...base, calendar: days });
    expect((s.match(/- /g) || []).length).toBeLessThanOrEqual(40);
  });
  it("suppresses the roster line when the roster zone failed (no contradiction)", () => {
    const s = composeContextPrompt({ ...base, roster: [], unavailable: ["roster"] });
    expect(s).not.toContain("Roster:");
    expect(s).toMatch(/roster: unavailable/i);
    expect(s).toContain("do not guess");
  });
  it("keeps the roster line when the roster loaded", () => {
    expect(composeContextPrompt(base)).toContain("Roster: Emily G (child, 14)");
  });
});

describe("loadContextPack — task scope zone wiring", () => {
  it("null tasks read pushes 'tasks' onto unavailable + composer says so", async () => {
    fns.livePendingTasksForPack.mockResolvedValue(null);
    const pack = await loadContextPack("task");
    expect(pack.unavailable).toContain("tasks");
    expect(pack.tasks).toBeUndefined();
    const s = composeContextPrompt(pack);
    expect(s).toMatch(/tasks: unavailable/i);
    expect(s).toContain("do not guess");
  });
  it("empty tasks read is honest: no unavailable flag, 'nothing pending' line", async () => {
    const pack = await loadContextPack("task");
    expect(pack.unavailable).not.toContain("tasks");
    expect(pack.tasks).toEqual([]);
    const s = composeContextPrompt(pack);
    expect(s).toContain("nothing pending");
    expect(s).not.toMatch(/tasks: unavailable/i);
  });
  it("the pack reads tasks through the pack-only sibling, never the tool reader", async () => {
    await loadContextPack("task");
    expect(fns.livePendingTasks).not.toHaveBeenCalled();
    expect(fns.livePendingTasksForPack).toHaveBeenCalledTimes(1);
  });
  it("task scope does not fire the meal/schedule zone reads", async () => {
    await loadContextPack("task");
    expect(fns.liveMealRows).not.toHaveBeenCalled();
    expect(fns.livePantry).not.toHaveBeenCalled();
    expect(fns.liveGrocery).not.toHaveBeenCalled();
    expect(fns.liveSchedulesAll).not.toHaveBeenCalled();
    expect(fns.fetchLiveWeather).not.toHaveBeenCalled();
  });
});
