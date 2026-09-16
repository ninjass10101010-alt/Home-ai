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
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act renderHook shim (see
// tests/unit/use-wall-mode.test.tsx). The hook reads localStorage-backed
// task-utils for real; only `@/db` is mocked for a deterministic roster
// (+ a controllable PB hall feed for the merged-downlink tests).
const pbHall = vi.hoisted(() => ({ rows: [] as any[] }));
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
});

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot?.unmount();
    });
    activeRoot = null;
  }
  document.body.innerHTML = "";
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

  it("re-reads a member's points when consuela-data-refreshed fires", () => {
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
  });

  it("re-reads when the roster refreshes (consuela-members-updated)", () => {
    seedWeek({ Rebecca: 10, Emily: 5 });
    const { result } = renderHook(() => useLeaderboardData());
    expect(pointsOf(result, "Emily")).toBe(5);

    seedWeek({ Rebecca: 10, Emily: 40 });
    act(() => {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    });

    expect(pointsOf(result, "Emily")).toBe(40);
  });
});

describe("useLeaderboardData — per-member streak", () => {
  // calculateRealStreak's contract: the completion dates MUST already be
  // filtered to the member being scored. The hook used to pass the whole
  // family's dates, so every member showed the same aggregate streak.
  it("gives each member their own streak, not the family aggregate", () => {
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

    // Emily: today only → streak 1. Rebecca: today + 2 prior days → streak 3.
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
    expect(rebecca?.streak).toBe(3);
  });
});

describe("useLeaderboardData — weekly champ badge from hall of fame", () => {
  it("grants 🥇 to a member with a rank-1 hall entry, only to that member", () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");
    const emily = result.current.data.entries.find((e) => e.name === "Emily");

    expect(rebecca?.badges).toContain("🥇");
    expect(emily?.badges).not.toContain("🥇");
  });

  it("grants no 🥇 badge when the hall is empty", () => {
    seedWeek({ Rebecca: 15, Emily: 5 });

    const { result } = renderHook(() => useLeaderboardData());

    for (const entry of result.current.data.entries) {
      expect(entry.badges).not.toContain("🥇");
    }
  });

  it("grants no 🥇 badge for a rank-2 hall entry (only the winner is champ)", () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 2 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca");

    expect(rebecca?.badges).not.toContain("🥇");
  });

  it("exposes the hall on the returned data for downstream components", () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());

    expect(result.current.data.hall).toHaveLength(1);
    expect(result.current.data.hall[0]).toMatchObject({ member: "Rebecca", rank: 1 });
  });

  it("never double-adds 🥇 when the badge is somehow already present", () => {
    seedWeek({ Rebecca: 15, Emily: 5 });
    seedHall([{ member: "Rebecca", rank: 1 }]);

    const { result } = renderHook(() => useLeaderboardData());
    const rebecca = result.current.data.entries.find((e) => e.name === "Rebecca")!;

    expect(rebecca.badges.filter((b) => b === "🥇")).toHaveLength(1);
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
