import { describe, expect, it } from "vitest";
import { BADGES } from "@/types/tasks";
import {
  BADGE_REQUIREMENT,
  COMPLETION_UNAVAILABLE_LABEL,
  LEVEL_UNAVAILABLE_LABEL,
  LOADING_LABEL,
  OFFLINE_LABEL,
  UNAVAILABLE_LABEL,
  allTimeCaption,
  allTimeLevelLabel,
  isBadgeEarned,
  resolveAllTimeLevel,
  splitBadges,
} from "@/components/leaderboard/level";

function byId(id: string) {
  const badge = BADGES.find((b) => b.id === id);
  if (!badge) throw new Error(`missing badge ${id}`);
  return badge;
}

describe("the null all-time policy: an unknown total awards nothing", () => {
  it("classifies every badge by the unknown value it depends on (a new badge must be classified)", () => {
    expect(Object.keys(BADGE_REQUIREMENT).sort()).toEqual(BADGES.map((b) => b.id).sort());
  });

  it("a known total still resolves the real level", () => {
    const level = resolveAllTimeLevel(300);
    expect(level.known).toBe(true);
    expect(level.title).toBe("Star Performer");
    expect(allTimeLevelLabel(level)).toBe("🌟 Star Performer");
  });

  it("a null total awards NO level and never reads as a fresh Rookie", () => {
    const level = resolveAllTimeLevel(null);
    expect(level.known).toBe(false);
    expect(level.level).toBe(0);
    expect(allTimeLevelLabel(level)).toBe(LEVEL_UNAVAILABLE_LABEL);
    expect(allTimeLevelLabel(level)).not.toContain("Rookie");
  });

  it("null is NOT zero: an unknown total never equals a real 0-point member", () => {
    expect(resolveAllTimeLevel(null).level).not.toBe(resolveAllTimeLevel(0).level);
    expect(resolveAllTimeLevel(null).known).not.toBe(resolveAllTimeLevel(0).known);
  });

  it("a null total awards no points-dependent badge, while a known total does", () => {
    for (const id of ["century", "half_k", "thousand"]) {
      expect(isBadgeEarned(byId(id), null, 9, 99)).toBe(false);
      expect(isBadgeEarned(byId(id), 1000, 9, 99)).toBe(true);
    }
  });

  it("a null completion count awards no completion-dependent badge, while a known count does", () => {
    for (const id of ["first_task", "helper_10", "helper_50"]) {
      expect(isBadgeEarned(byId(id), 1000, 9, null)).toBe(false);
      expect(isBadgeEarned(byId(id), 1000, 9, 50)).toBe(true);
    }
  });

  it("a streak badge still lands when only the all-time totals are unknown (the streak IS known)", () => {
    expect(isBadgeEarned(byId("streak_3"), null, 3, null)).toBe(true);
    expect(isBadgeEarned(byId("streak_7"), null, 7, null)).toBe(true);
    expect(isBadgeEarned(byId("streak_7"), null, 6, null)).toBe(false);
  });

  it("a known 0/0 member earns nothing (no false 'earned' badge at zero)", () => {
    expect(splitBadges(0, 0, 0).earned).toEqual([]);
  });

  it("splitBadges partitions every badge under a null total", () => {
    const { earned, locked } = splitBadges(null, 7, null);
    expect(earned.map((b) => b.id)).toEqual(["streak_3", "streak_7"]);
    expect(earned.length + locked.length).toBe(BADGES.length);
  });
});

describe("the caption vocabulary", () => {
  it("loading never shows a number", () => {
    expect(allTimeCaption(45, "loading", "2026-09-24T10:00:00.000Z")).toBe(LOADING_LABEL);
  });

  it("a null value is unavailable", () => {
    expect(allTimeCaption(null, "authoritative", "2026-09-24T10:00:00.000Z")).toBe(UNAVAILABLE_LABEL);
    expect(allTimeCaption(undefined, "error", null)).toBe(UNAVAILABLE_LABEL);
  });

  it("an authoritative value renders the plain figure", () => {
    expect(allTimeCaption(45, "authoritative", "2026-09-24T10:00:00.000Z", "pts all-time")).toBe("45 pts all-time");
  });

  it("an offline-cached value says so and carries its timestamp", () => {
    const text = allTimeCaption(45, "offline_cache", "2026-09-24T10:00:00.000Z");
    expect(text).toContain("45");
    expect(text).toContain(OFFLINE_LABEL);
    expect(text).toContain("2026");
  });

  it("an offline-cached UNKNOWN value stays unavailable (a null total never prints a figure)", () => {
    const text = allTimeCaption(null, "offline_cache", "2026-09-24T10:00:00.000Z");
    expect(text).toBe(UNAVAILABLE_LABEL);
  });

  it("owns the one completion-unavailable sentence", () => {
    expect(COMPLETION_UNAVAILABLE_LABEL).toBe("completion count unavailable");
  });
});
