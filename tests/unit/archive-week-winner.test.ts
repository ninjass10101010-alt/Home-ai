// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadHallOfFame,
  saveHallOfFame,
  archiveWeekWinner,
  DEFAULT_WEEKLY_PRIZES,
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

beforeEach(() => localStorage.clear());

function entry(name: string, points: number, rank: number, emoji = "🧒") {
  return { name, emoji, points, rank };
}

describe("archiveWeekWinner — rollover enshrines the top 3 with frozen prize text", () => {
  it("records the top 3 with frozen prize text", () => {
    archiveWeekWinner([
      { name: "Rebecca", emoji: "👩", points: 120, rank: 1 },
      { name: "Emily", emoji: "👧", points: 60, rank: 2 },
      { name: "Caspian", emoji: "👦", points: 40, rank: 3 },
      { name: "Bailey", emoji: "🐶", points: 10, rank: 4 },
    ], "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    const hall = loadHallOfFame();
    expect(hall).toHaveLength(3);
    expect(hall[0]).toMatchObject({
      member: "Rebecca",
      rank: 1,
      points: 120,
      weekStart: "2026-09-07",
      prize: DEFAULT_WEEKLY_PRIZES[0].text,
    });
    expect(hall[2]).toMatchObject({
      member: "Caspian",
      rank: 3,
      prize: DEFAULT_WEEKLY_PRIZES[2].text,
    });
    // rank 4 is never enshrined
    expect(hall.find((h) => h.member === "Bailey")).toBeUndefined();
    // new enshrinements are written without the celebration flag
    for (const h of hall) expect(h).not.toHaveProperty("celebrated");
  });

  it("is idempotent on repeat rollover of the same week (the first enshrinement stays)", () => {
    const entries = [
      entry("Rebecca", 120, 1, "👩"),
      entry("Emily", 60, 2, "👧"),
      entry("Caspian", 40, 3, "👦"),
    ];
    archiveWeekWinner(entries, "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    // A second rollover attempt (interval + mount backfill racing) must not duplicate.
    archiveWeekWinner(entries, "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    expect(loadHallOfFame()).toHaveLength(3);
    // …and must not overwrite the first recorded values.
    archiveWeekWinner([entry("Rebecca", 999, 1, "👩")], "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    const hall = loadHallOfFame();
    expect(hall).toHaveLength(3);
    expect(hall.find((h) => h.member === "Rebecca")?.points).toBe(120);
  });

  it("keeps the latest 12 distinct weeks (a week can hold up to 3 entries — 36 rows max)", () => {
    for (let i = 0; i < 13; i++) {
      const weekStart = new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10);
      archiveWeekWinner(
        [entry("A", 100, 1), entry("B", 50, 2), entry("C", 25, 3)],
        weekStart,
        DEFAULT_WEEKLY_PRIZES,
      );
    }
    const hall = loadHallOfFame();
    expect(hall).toHaveLength(36);
    // The oldest week (2026-01-05) was dropped; the second-oldest survived intact.
    expect(hall.some((h) => h.weekStart === "2026-01-05")).toBe(false);
    expect(hall.filter((h) => h.weekStart === "2026-01-12")).toHaveLength(3);
    // Exactly 12 distinct weeks, ascending within the array (append order).
    const weeks = [...new Set(hall.map((h) => h.weekStart))];
    expect(weeks).toHaveLength(12);
    expect(weeks).toEqual([...weeks].sort());
  });

  it("trims whole weeks (not raw entry count) — a partial oldest week is dropped whole", () => {
    // Seed the oldest week with a single (already-enshrined) member.
    const old: HallOfFameEntry = { member: "Old", emoji: "👵", weekStart: "2026-01-05", points: 80, rank: 1 };
    saveHallOfFame([old]);
    for (let i = 1; i < 13; i++) {
      const weekStart = new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10);
      archiveWeekWinner([entry("A", 100, 1), entry("B", 50, 2)], weekStart, DEFAULT_WEEKLY_PRIZES);
    }
    const hall = loadHallOfFame();
    // 12 distinct weeks kept: week 0 (1 entry) dropped, weeks 1–12 (2 entries each) kept.
    expect(hall.some((h) => h.weekStart === "2026-01-05")).toBe(false);
    expect(hall).toHaveLength(24);
  });

  it("archives with no prize when a rank has no configured prize (key omitted)", () => {
    archiveWeekWinner([{ name: "Rebecca", emoji: "👩", points: 120, rank: 1 }], "2026-09-07", []);
    const hall = loadHallOfFame();
    expect(hall[0].prize).toBeUndefined();
    expect(hall[0]).not.toHaveProperty("prize");
  });

  it("omits the prize key only for ranks with no configured prize", () => {
    archiveWeekWinner([
      entry("Rebecca", 120, 1, "👩"),
      entry("Emily", 60, 2, "👧"),
      entry("Caspian", 40, 3, "👦"),
    ], "2026-09-07", [{ id: "p1", rank: 1, emoji: "🥇", text: "Movie pick" }]);
    const hall = loadHallOfFame();
    expect(hall.find((h) => h.member === "Rebecca")?.prize).toBe("Movie pick");
    expect(hall.find((h) => h.member === "Emily")).not.toHaveProperty("prize");
    expect(hall.find((h) => h.member === "Caspian")).not.toHaveProperty("prize");
  });

  it("ties share the rank and both carry the rank's prize", () => {
    archiveWeekWinner([
      entry("A", 50, 1),
      entry("B", 50, 1),
      entry("C", 40, 3), // competition rank after a shared 1st
    ], "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    const hall = loadHallOfFame();
    expect(hall.filter((h) => h.rank === 1)).toHaveLength(2);
    expect(hall.find((h) => h.member === "A")?.prize).toBe(DEFAULT_WEEKLY_PRIZES[0].text);
    expect(hall.find((h) => h.member === "B")?.prize).toBe(DEFAULT_WEEKLY_PRIZES[0].text);
    expect(hall.find((h) => h.member === "C")?.prize).toBe(DEFAULT_WEEKLY_PRIZES[2].text);
  });

  it("zero-week no-op: an empty entries array leaves the hall unchanged", () => {
    const prior: HallOfFameEntry = {
      member: "Rebecca",
      emoji: "👩",
      weekStart: "2026-08-31",
      points: 90,
      rank: 1,
      prize: "Stored prize",
    };
    saveHallOfFame([prior]);
    archiveWeekWinner([], "2026-09-07", DEFAULT_WEEKLY_PRIZES);
    expect(loadHallOfFame()).toEqual([prior]);
  });

  it("defaults to loadWeeklyPrizes() when the prizes argument is omitted (legacy callers)", () => {
    archiveWeekWinner([entry("Rebecca", 120, 1, "👩")], "2026-09-07");
    expect(loadHallOfFame()[0].prize).toBe(DEFAULT_WEEKLY_PRIZES[0].text);
  });
});
