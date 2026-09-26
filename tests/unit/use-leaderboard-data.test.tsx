// @vitest-environment jsdom
// Pin TZ so the UTC date math in task-utils is deterministic (mirrors
// task-utils.test.ts); otherwise the streak walk is machine-timezone-dependent.
process.env.TZ = "UTC";

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderboardData } from "@/components/leaderboard/hooks/useLeaderboardData";
import {
  WEEK_DATA_KEY,
  HALL_OF_FAME_KEY,
  TASKS_STORAGE_KEY,
  todayISO,
  mondayOf,
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act renderHook shim (see
// tests/unit/use-wall-mode.test.tsx). The hook reads localStorage-backed
// task-utils for real; only `@/db` is mocked for a deterministic roster
// (+ a controllable PB hall feed for the merged-downlink tests).
const pbHall = vi.hoisted(() => ({ rows: [] as any[] }));
const allTime = vi.hoisted(() => ({
  payload: {
    weekStart: "2026-09-21",
    totals: {
      Rebecca: { points: 15, completions: 2 },
      Emily: { points: 5, completions: 1 },
    },
    historyComplete: true,
    source: "pocketbase",
    fetchedAt: "2026-09-24T10:00:00.000Z",
  } as unknown,
}));
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => allTime.payload } as unknown as Response));
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 3, name: "Fido", fullName: "Fido", role: "pet", emoji: "🐶", color: "amber" },
    ],
    selectHallOfFame: async () => pbHall.rows,
  },
}));

let activeRoot: Root | null = null;
function renderHook<T>(use: () => T): { result: { current: T } } {
  const result = { current: undefined as T };
  function Probe() {
    result.current = use();
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(createElement(Probe));
  });
  return { result };
}

async function settleAllTime(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function thisMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seedWeek(points: Record<string, number>) {
  localStorage.setItem(
    WEEK_DATA_KEY,
    JSON.stringify({
      weekStart: thisMondayISO(),
      points,
      streak: {},
      lastActive: {},
      history: [],
    })
  );
}

function seedHall(entries: Array<{ member: string; rank: number }>) {
  const hall: HallOfFameEntry[] = entries.map((e) => ({
    member: e.member,
    emoji: "🏅",
    weekStart: "2026-09-07",
    points: 40,
    rank: e.rank,
  }));
  localStorage.setItem(HALL_OF_FAME_KEY, JSON.stringify(hall));
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  pbHall.rows = [];
  allTime.payload = {
    weekStart: "2026-09-21",
    totals: {
      Rebecca: { points: 15, completions: 2 },
      Emily: { points: 5, completions: 1 },
    },
    historyComplete: true,
    source: "pocketbase",
    fetchedAt: "2026-09-24T10:00:00.000Z",
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => allTime.payload } as unknown as Response));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useLeaderboardData — live refresh on the 60s data pulse", () => {
  // The Home leaderboard stays mounted on the always-on kitchen display while
  // tasks get completed elsewhere (another device's completion lands via the
  // refresher, which merges the snapshot into the week store and dispatches
  // `consuela-data-refreshed`). The hook MUST re-read then — like every other
  // Home data source (useWeeklyPrizes/useMeals/usePantry/...) — or the widget
  // keeps showing whatever points it had at mount time: exactly "members are
  // not displaying the points they are earning".
  function pointsOf(result: { current: ReturnType<typeof useLeaderboardData> }, name: string): number {
    const entry = result.current.data.entries.find((e) => e.name === name);
    return entry?.points ?? -1;
  }

  it("re-reads a member's points when consuela-data-refreshed fires", async () => {
    seedWeek({ Rebecca: 10, Emily: 5 });
    const { result } = renderHook(() => useLeaderboardData());
    expect(pointsOf(result, "Emily")).toBe(5);

    // A completion lands: the refresh loop wrote the merged week into the
    // store and dispatched the pulse.
    seedWeek({ Rebecca: 10, Emily: 25 });
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
    });

    expect(pointsOf(result, "Emily")).toBe(25);

    await settleAllTime();
  });

  it("re-reads when the roster refreshes (consuela-members-updated)", async () => {
    seedWeek({ Rebecca: 10, Emily: 5 });
    const { result } = renderHook(() => useLeaderboardData());
    expect(pointsOf(result, "Emily")).toBe(5);

    seedWeek({ Rebecca: 10, Emily: 40 });
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });

    expect(pointsOf(result, "Emily")).toBe(40);

    await settleAllTime();
  });
});

describe("useLeaderboardData — per-member streak", () => {
  // calculateRealStreak's contract: the completion dates MUST already be
  // filtered to the member being scored. The hook used to pass the whole
  // family's dates, so every member showed the same aggregate streak.
  it("gives each member their own streak, not the family aggregate", async () => {
    const today = todayISO();
    // UTC-only date math (task-utils compares UTC date parts).
    const addDaysISO = (iso: string, n: number) => {
      const d = new Date(`${iso}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const seedTask = (id: number, by: string, daysAgo: number) => ({
      id,
      title: `task ${id}`,
      completed: true,
      completedBy: by,
      completedAt: `${addDaysISO(today, -daysAgo)}T10:00:00.000Z`,
      completedInWeek: thisMondayISO(),
    });

    // Emily: today only → streak 1. Rebecca: today + 2 prior days → streak
    // = however many of those landed in the CURRENT week (on a Monday only
    // today counts; mid-week all three do — the walk is week-scoped, so the
    // expectation must be too or the test rots with the wall clock).
    const daysSinceMonday = (() => {
      const monday = mondayOf(new Date());
      return Math.round((Date.parse(`${todayISO()}T12:00:00.000Z`) - Date.parse(`${monday.toISOString().slice(0, 10)}T12:00:00.000Z`)) / 86400000);
    })();
    const expectedRebecca = Math.min(3, Math.max(1, daysSinceMonday + 1));
    localStorage.setItem(
      TASKS_STORAGE_KEY,
      JSON.stringify([
        seedTask(1, "Emily", 0),
        seedTask(2, "Rebecca", 0),
        seedTask(3, "Rebecca", 1),
        seedTask(4, "Rebecca", 2),
      ])
    );
    seedWeek({ Rebecca: 30, Emily: 5 });

    const { result } = renderHook(() => useLeaderboardData());
    const emily = result.current.data.entries.find((e) => e.name === "Emily");
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");

    expect(emily?.streak).toBe(1);
    expect(rebecca?.streak).toBe(expectedRebecca);

    await settleAllTime();
  });
});

describe("useLeaderboardData — weekly champ badge from hall of fame", () => {
  it("grants 🥇 to a member with a rank-1 hall entry, only to that member", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");
    const emily = result.current.data.entries.find((e) => e.name === "Emily");

    expect(rebecca?.badges).toContain("🥇");
    expect(emily?.badges).not.toContain("🥇");

    await settleAllTime();
  });

  it("grants no 🥇 badge when the hall is empty", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });

    const { result } = renderHook(() => useLeaderboardData());

    for (const entry of result.current.data.entries) {
      expect(entry.badges).not.toContain("🥇");
    }

    await settleAllTime();
  });

  it("grants no 🥇 badge for a rank-2 hall entry (only the winner is champ)", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 2 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");

    expect(rebecca?.badges).not.toContain("🥇");

    await settleAllTime();
  });

  it("exposes the hall on the returned data for downstream components", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());

    expect(result.current.data.hall).toHaveLength(1);
    expect(result.current.data.hall[0]).toMatchObject({ member: "Rebecca", rank: 1 });

    await settleAllTime();
  });

  it("never double-adds 🥇 when the badge is somehow already present", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca")!;

    expect(rebecca.badges.filter((b) => b === "🥇")).toHaveLength(1);

    await settleAllTime();
  });
});

describe("useLeaderboardData — hall downlink (PB merge)", () => {
  // The hook reads the LOCAL hall synchronously for the first render, then
  // replaces it with the PB-merged list once the downlink resolves.

  async function settle(ms = 20) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  it("first render uses the local hall synchronously, then adopts PB-only rows", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    pbHall.rows = [
      { member: "Rebecca", emoji: "👩", weekStart: "2026-09-07", points: 40, rank: 1, prize: "Movie pick", celebrated: false },
    ];

    const { result } = renderHook(() => useLeaderboardData());
    // Local hall is empty at first render — nothing adopted yet.
    expect(result.current.data.hall).toHaveLength(0);
    expect(result.current.data.entries.find((e) => e.name === "Rebecca")!.badges).not.toContain("🥇");

    await settle();

    // The PB-only rank-1 row is adopted into the exposed hall…
    expect(result.current.data.hall).toHaveLength(1);
    expect(result.current.data.hall[0]).toMatchObject({ member: "Rebecca", rank: 1 });
    // …and the champ badge follows the merged hall.
    expect(result.current.data.entries.find((e) => e.name === "Rebecca")!.badges).toContain("🥇");
  });

  it("a PB celebrated=true flag wins over the local (un-claimed) copy", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]); // local copy: not celebrated
    pbHall.rows = [
      { member: "Rebecca", emoji: "🏅", weekStart: "2026-09-07", points: 40, rank: 1, celebrated: true },
    ];

    const { result } = renderHook(() => useLeaderboardData());

    await settle();

    expect(result.current.data.hall[0].celebrated).toBe(true);
  });
});

describe("useLeaderboardData — all-time totals come from the PB service", () => {
  it("reads every member's all-time total from /api/tasks/all-time, not the local archive", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    localStorage.setItem(
      "consuela-week-archive",
      JSON.stringify({
        "2026-09-14": {
          weekStart: "2026-09-14",
          points: { Rebecca: 500, Emily: 500 },
          streak: {},
          lastActive: {},
          history: [],
        },
      })
    );

    const { result } = renderHook(() => useLeaderboardData());
    await settleAllTime();

    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");
    const emily = result.current.data.entries.find((e) => e.name === "Emily");
    expect(rebecca?.allTimePoints).toBe(15);
    expect(emily?.allTimePoints).toBe(5);
    expect(rebecca?.allTimeCompletions).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/all-time", expect.anything());
  });

  it("exposes the read state so a surface can say loading / offline / unavailable", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    const { result } = renderHook(() => useLeaderboardData());
    expect(result.current.data.allTime.state).toBe("loading");

    await settleAllTime();
    expect(result.current.data.allTime.state).toBe("authoritative");
    expect(result.current.data.allTime.updatedAt).toBe("2026-09-24T10:00:00.000Z");
  });

  it("incomplete history awards NO level and NO points/completion badge (the null policy)", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    allTime.payload = {
      weekStart: "2026-09-21",
      totals: {
        Rebecca: { points: null, completions: null },
        Emily: { points: null, completions: null },
      },
      historyComplete: false,
      source: "pocketbase",
      fetchedAt: "2026-09-24T10:00:00.000Z",
    };

    const { result } = renderHook(() => useLeaderboardData());
    await settleAllTime();

    for (const name of ["Rebecca", "Emily"]) {
      const entry = result.current.data.entries.find((e) => e.name === name)!;
      expect(entry.allTimePoints).toBeNull();
      expect(entry.allTimeCompletions).toBeNull();
      expect(entry.levelKnown).toBe(false);
      expect(entry.level).toBe(0);
      expect(entry.levelTitle).toBe("");
      // A null total can never award a points or completion badge.
      expect(entry.badges).toEqual([]);
    }
  });

  it("a null all-time total still awards the streak badge (the streak is known)", async () => {
    const today = todayISO();
    const addDaysISO = (iso: string, n: number) => {
      const d = new Date(`${iso}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    localStorage.setItem(
      TASKS_STORAGE_KEY,
      JSON.stringify(
        [0, 1, 2, 3, 4, 5, 6].map((daysAgo, i) => ({
          id: i + 1,
          title: "t",
          completed: true,
          completedBy: "Emily",
          completedAt: `${addDaysISO(today, -daysAgo)}T10:00:00.000Z`,
          completedInWeek: addDaysISO(today, -daysAgo) >= thisMondayISO() ? thisMondayISO() : undefined,
        }))
      )
    );
    seedWeek({ Rebecca: 15, Emily: 5 });
    allTime.payload = {
      weekStart: "2026-09-21",
      totals: {
        Rebecca: { points: null, completions: null },
        Emily: { points: null, completions: null },
      },
      historyComplete: false,
      source: "pocketbase",
      fetchedAt: "2026-09-24T10:00:00.000Z",
    };

    const { result } = renderHook(() => useLeaderboardData());
    await settleAllTime();

    const emily = result.current.data.entries.find((e) => e.name === "Emily")!;
    // The streak is a weekly/ledger read, not an all-time read: it stays known
    // and still drives the streak badge...
    expect(emily.streak).toBeGreaterThan(0);
    expect(emily.badges.includes("🔥")).toBe(emily.streak >= 3);
    // ...while the completion-count badge is withheld (null count, not 0).
    expect(emily.badges).not.toContain("🎯");
    expect(emily.levelKnown).toBe(false);
  });

  it("a member missing from the payload is unknown, never zero", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    allTime.payload = {
      weekStart: "2026-09-21",
      totals: { Rebecca: { points: 15, completions: 2 } },
      historyComplete: true,
      source: "pocketbase",
      fetchedAt: "2026-09-24T10:00:00.000Z",
    };

    const { result } = renderHook(() => useLeaderboardData());
    await settleAllTime();

    const emily = result.current.data.entries.find((e) => e.name === "Emily")!;
    expect(emily.allTimePoints).toBeNull();
    expect(emily.levelKnown).toBe(false);
  });

  it("a failed read with no cache leaves every total unknown (never a fabricated number)", async () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));

    const { result } = renderHook(() => useLeaderboardData());
    await settleAllTime();

    expect(result.current.data.allTime.state).toBe("error");
    for (const entry of result.current.data.entries) {
      expect(entry.allTimePoints).toBeNull();
      expect(entry.levelKnown).toBe(false);
    }
  });
});
