// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";

import {
  uncelebratedWinFor,
  markWinCelebrated,
  loadHallOfFame,
  saveHallOfFame,
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

beforeEach(() => localStorage.clear());

function entry(overrides: Partial<HallOfFameEntry> = {}): HallOfFameEntry {
  return {
    member: "Caspian G",
    emoji: "🦊",
    weekStart: "2026-09-07",
    points: 42,
    rank: 1,
    prize: "Picks the movie",
    ...overrides,
  };
}

describe("uncelebratedWinFor", () => {
  it("(a) happy path — returns the member's uncelebrated top-3 win with a prize", () => {
    const win = entry();
    const hall: HallOfFameEntry[] = [
      win,
      entry({ member: "Rebecca G", weekStart: "2026-09-07" }),
    ];

    expect(uncelebratedWinFor(hall, "Caspian G")).toEqual(win);
  });

  it("(b) returns the NEWEST weekStart when multiple uncelebrated wins match", () => {
    const older = entry({ weekStart: "2026-08-31", prize: "Dessert first" });
    const newer = entry({ weekStart: "2026-09-07", prize: "Picks the movie" });

    const result = uncelebratedWinFor([older, newer], "Caspian G");

    expect(result).toEqual(newer);
  });

  it("(c) returns null when every matching win is already celebrated", () => {
    const hall: HallOfFameEntry[] = [
      entry({ weekStart: "2026-08-31", celebrated: true }),
      entry({ weekStart: "2026-09-07", celebrated: true }),
    ];

    expect(uncelebratedWinFor(hall, "Caspian G")).toBeNull();
  });

  it("(d) returns null for a rank-4 finish even with a prize set", () => {
    const hall: HallOfFameEntry[] = [entry({ rank: 4 })];

    expect(uncelebratedWinFor(hall, "Caspian G")).toBeNull();
  });

  it("(e) returns null when the prize is missing or an empty string", () => {
    const noPrize = entry({ weekStart: "2026-08-31" });
    delete noPrize.prize;
    const emptyPrize = entry({ weekStart: "2026-09-07", prize: "" });

    expect(uncelebratedWinFor([noPrize, emptyPrize], "Caspian G")).toBeNull();
  });

  it("(f) returns null when the member has no entries (but other members do)", () => {
    const hall: HallOfFameEntry[] = [
      entry({ member: "Rebecca G", weekStart: "2026-08-31" }),
      entry({ member: "Emily G", weekStart: "2026-09-07", rank: 2 }),
    ];

    expect(uncelebratedWinFor(hall, "Caspian G")).toBeNull();
    expect(uncelebratedWinFor([], "Caspian G")).toBeNull();
  });
});

describe("markWinCelebrated", () => {
  it("flips celebrated on the matching entry and persists it across a fresh load", () => {
    saveHallOfFame([entry({ weekStart: "2026-09-07" })]);

    markWinCelebrated("Caspian G", "2026-09-07");

    const reloaded = loadHallOfFame();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].celebrated).toBe(true);
    // ...and the previously-uncelebrated helper now finds nothing.
    expect(uncelebratedWinFor(reloaded, "Caspian G")).toBeNull();
  });

  it("is a silent no-op for an unknown week (nothing written, nothing thrown)", () => {
    const before = [entry({ weekStart: "2026-09-07" })];
    saveHallOfFame(before);

    expect(() => markWinCelebrated("Caspian G", "2025-01-06")).not.toThrow();

    const after = loadHallOfFame();
    expect(after).toHaveLength(1);
    expect(after[0].celebrated).toBeUndefined();
  });

  it("does NOT touch the member's other weeks (only the exact week flips)", () => {
    saveHallOfFame([
      entry({ weekStart: "2026-08-31" }),
      entry({ weekStart: "2026-09-07" }),
    ]);

    markWinCelebrated("Caspian G", "2026-09-07");

    const after = loadHallOfFame();
    const older = after.find((h) => h.weekStart === "2026-08-31");
    const newer = after.find((h) => h.weekStart === "2026-09-07");
    expect(older?.celebrated).toBeUndefined();
    expect(newer?.celebrated).toBe(true);
    // The untouched week is still claimable.
    expect(uncelebratedWinFor(after, "Caspian G")).toEqual(older);
  });

  it("is a no-op for an unknown member", () => {
    saveHallOfFame([entry({ weekStart: "2026-09-07" })]);

    expect(() => markWinCelebrated("Nobody", "2026-09-07")).not.toThrow();
    expect(loadHallOfFame()[0].celebrated).toBeUndefined();
  });
});
