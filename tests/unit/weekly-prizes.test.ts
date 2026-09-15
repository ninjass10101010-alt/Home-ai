// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadWeeklyPrizes, saveWeeklyPrizes, prizeForRank,
  DEFAULT_WEEKLY_PRIZES, WEEKLY_PRIZES_KEY,
  raceGap,
} from "@/lib/task-utils";

beforeEach(() => localStorage.clear());

describe("weekly prizes storage", () => {
  it("returns the defaults when nothing is stored", () => {
    const prizes = loadWeeklyPrizes();
    expect(prizes).toEqual(DEFAULT_WEEKLY_PRIZES);
    expect(prizes).toHaveLength(3);
  });
  it("round-trips saved prizes", () => {
    saveWeeklyPrizes([{ id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" }]);
    expect(loadWeeklyPrizes()).toEqual([{ id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" }]);
  });
  it("prizeForRank resolves by rank number", () => {
    const prizes = loadWeeklyPrizes();
    expect(prizeForRank(prizes, 2)?.text).toBe(DEFAULT_WEEKLY_PRIZES[1].text);
    expect(prizeForRank(prizes, 4)).toBeUndefined();
  });
  it("falls back to defaults when stored JSON is corrupt", () => {
    localStorage.setItem(WEEKLY_PRIZES_KEY, "{broken");
    expect(loadWeeklyPrizes()).toEqual(DEFAULT_WEEKLY_PRIZES);
  });
});

const board = { "Rebecca": 120, "Jeffery": 60, "Emily": 30, "Caspian": 10 };

describe("raceGap", () => {
  it("reports the leader", () => {
    expect(raceGap("Rebecca", board)).toEqual({ rank: 1, onPodium: true, gapToPodium: null, leader: { name: "Rebecca", points: 120 } });
  });
  it("reports the gap for off-podium members", () => {
    expect(raceGap("Caspian", board)).toEqual({ rank: 4, onPodium: false, gapToPodium: 20, leader: { name: "Rebecca", points: 120 } });
  });
  it("reports zero-point members as not yet in the race", () => {
    expect(raceGap("Aurora", { ...board, Aurora: 0 }))
      .toEqual({ rank: null, onPodium: false, gapToPodium: 30, leader: { name: "Rebecca", points: 120 } });
  });
  it("handles an empty week honestly", () => {
    expect(raceGap("Rebecca", {})).toEqual({ rank: null, onPodium: false, gapToPodium: null, leader: null });
  });
  it("uses competition ranking — ties share a rank", () => {
    const tied = { A: 50, B: 50, C: 40 };
    expect(raceGap("A", tied).rank).toBe(1);
    expect(raceGap("B", tied).rank).toBe(1);
    expect(raceGap("C", tied).rank).toBe(3);
  });
  it("respects maxPrizeRank when fewer prizes are configured", () => {
    // only 2 prizes: #3 is no longer a podium spot — C is chasing #2 (60 pts)
    expect(raceGap("Caspian", board, 2)).toEqual({ rank: 4, onPodium: false, gapToPodium: 50, leader: { name: "Rebecca", points: 120 } });
  });
});
