// @vitest-environment jsdom
// loadHallOfFameMerged — the PB→local hall downlink (final-review I1).
// The SERVER is the authority, keyed by `member + weekStart`:
//  - the server's fields win — points/emoji/rank/prize and the `celebrated`
//    ceremony flag all come from PocketBase, because both the enshrinement and
//    the /api/hall-of-fame/celebrate claim are server-owned;
//  - a server list of ≥1 row REPLACES the local copy (and is persisted with
//    saveHallOfFame()), so a stale local row can never outlive the server;
//  - an empty or unreadable server read keeps the local hall — a transient
//    outage must never blank the board;
//  - PB rows without a member or weekStart are skipped, not adopted.
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectHallOfFame = vi.hoisted(() => vi.fn(async () => [] as any[]));
const listArchivedWeeks = vi.hoisted(() => vi.fn(async () => [] as any[]));
vi.mock("@/db", () => ({ db: { selectHallOfFame, listArchivedWeeks } }));

import {
  loadHallOfFameMerged,
  loadHallOfFame,
  loadPreviousWeekRanksMerged,
  saveCurrentWeekRanksForNextWeek,
  saveHallOfFame,
  uncelebratedWinFor,
} from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

const LOCAL_WIN: HallOfFameEntry = {
  member: "Caspian G",
  emoji: "🦊",
  weekStart: "2026-09-07",
  points: 42,
  rank: 1,
  prize: "Picks the movie",
};

beforeEach(() => {
  localStorage.clear();
  selectHallOfFame.mockReset();
  selectHallOfFame.mockResolvedValue([]);
  listArchivedWeeks.mockReset();
  listArchivedWeeks.mockResolvedValue([]);
});

describe("loadHallOfFameMerged", () => {
  it("degrades to the local hall when the PB read fails (best-effort downlink)", async () => {
    saveHallOfFame([LOCAL_WIN]);
    selectHallOfFame.mockRejectedValue(new Error("pb down"));

    const merged = await loadHallOfFameMerged();

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      member: "Caspian G",
      prize: "Picks the movie",
      points: 42,
      rank: 1,
    });
  });

  it("a PB row's celebrated=true always wins over the local flag (server authority)", async () => {
    saveHallOfFame([LOCAL_WIN]); // local copy never got the claim
    selectHallOfFame.mockResolvedValue([{ ...LOCAL_WIN, celebrated: true }]);

    const merged = await loadHallOfFameMerged();

    const entry = merged.find(
      (e) => e.member === "Caspian G" && e.weekStart === "2026-09-07"
    )!;
    expect(entry.celebrated).toBe(true);
    // The ceremony gate no longer sees an un-celebrated win for this member…
    expect(uncelebratedWinFor(merged, "Caspian G")).toBeNull();
    // …and the merge persisted locally so the next local-only reader sees it too.
    expect(loadHallOfFame()[0].celebrated).toBe(true);
  });

  it("uses the server celebration flag over a stale local claim", async () => {
    saveHallOfFame([{ ...LOCAL_WIN, celebrated: true }]);
    selectHallOfFame.mockResolvedValue([{ ...LOCAL_WIN }]);

    const merged = await loadHallOfFameMerged();

    expect(merged[0].celebrated).toBeUndefined();
  });

  it("adopts PB rows the local hall doesn't know (cross-device enshrinement)", async () => {
    saveHallOfFame([]);
    selectHallOfFame.mockResolvedValue([
      {
        member: "Rebecca",
        emoji: "👩",
        weekStart: "2026-09-07",
        points: 90,
        rank: 1,
        prize: "Movie pick",
        celebrated: false,
      },
    ]);

    const merged = await loadHallOfFameMerged();

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      member: "Rebecca",
      weekStart: "2026-09-07",
      points: 90,
      rank: 1,
      prize: "Movie pick",
    });
    // Adopted rows persist locally too.
    expect(loadHallOfFame().some((e) => e.member === "Rebecca")).toBe(true);
  });

  it("uses server fields over a stale local row", async () => {
    saveHallOfFame([LOCAL_WIN]);
    selectHallOfFame.mockResolvedValue([
      { ...LOCAL_WIN, points: 1, prize: null, emoji: "❓", rank: 3 },
    ]);

    const merged = await loadHallOfFameMerged();

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      member: "Caspian G",
      emoji: "❓",
      points: 1,
      rank: 3,
    });
    expect(merged[0].prize).toBeUndefined();
  });

  it("skips malformed PB rows (no member/weekStart) instead of adopting junk", async () => {
    saveHallOfFame([LOCAL_WIN]);
    selectHallOfFame.mockResolvedValue([
      { member: "", weekStart: "2026-09-07", points: 1, rank: 1 },
      { member: "Ghost", points: 2, rank: 2 }, // no weekStart
      null,
    ]);

    const merged = await loadHallOfFameMerged();

    expect(merged).toHaveLength(1);
    expect(merged[0].member).toBe("Caspian G");
  });

  it("replaces local rows with the server-backed list", async () => {
    const olderLocal: HallOfFameEntry = {
      member: "Emily G",
      emoji: "👧",
      weekStart: "2026-08-31",
      points: 10,
      rank: 2,
    };
    saveHallOfFame([olderLocal, LOCAL_WIN]);
    selectHallOfFame.mockResolvedValue([
      { member: "Rebecca", emoji: "👩", weekStart: "2026-09-07", points: 90, rank: 1 },
    ]);

    const merged = await loadHallOfFameMerged();

    expect(merged.map((e) => e.member)).toEqual(["Rebecca"]);
  });
});

describe("loadPreviousWeekRanksMerged", () => {
  it("uses the newest prior archived week from the server", async () => {
    listArchivedWeeks.mockResolvedValue([
      { weekStart: "2026-08-31", points: JSON.stringify({ Alex: 9, Bailey: 4 }) },
      { weekStart: "2026-09-07", points: JSON.stringify({ Alex: 5, Bailey: 5, Caspian: 2 }) },
      { weekStart: "2026-09-14", points: JSON.stringify({ Alex: 100 }) },
    ]);

    const ranks = await loadPreviousWeekRanksMerged("2026-09-14");

    expect(ranks).toEqual({ Alex: 1, Bailey: 1, Caspian: 3 });
  });

  it("falls back to the local rank cache when the server read fails", async () => {
    saveCurrentWeekRanksForNextWeek([{ name: "Local", rank: 2 }]);
    listArchivedWeeks.mockRejectedValue(new Error("offline"));

    const ranks = await loadPreviousWeekRanksMerged("2026-09-14");

    expect(ranks).toEqual({ Local: 2 });
  });
});
