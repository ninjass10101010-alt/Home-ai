// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderboardData } from "@/components/leaderboard/hooks/useLeaderboardData";
import {
  WEEK_DATA_KEY,
  HALL_OF_FAME_KEY,
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Harness note: this repo has no @testing-library/react — tests use the
// established createRoot + React-act renderHook shim (see
// tests/unit/use-wall-mode.test.tsx). The hook reads localStorage-backed
// task-utils for real; only `@/db` is mocked for a deterministic roster.
vi.mock("@/db", () => ({
  db: {
    selectMembers: () => [
      { id: 1, name: "Rebecca", fullName: "Rebecca", role: "parent", emoji: "👩", color: "violet" },
      { id: 2, name: "Emily", fullName: "Emily", role: "child", emoji: "👧", color: "mint" },
      { id: 3, name: "Fido", fullName: "Fido", role: "pet", emoji: "🐶", color: "amber" },
    ],
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
