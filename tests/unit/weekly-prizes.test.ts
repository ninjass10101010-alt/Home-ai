// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadWeeklyPrizes, saveWeeklyPrizes, prizeForRank,
  DEFAULT_WEEKLY_PRIZES, WEEKLY_PRIZES_KEY,
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
