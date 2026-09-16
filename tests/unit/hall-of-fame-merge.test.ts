// @vitest-environment jsdom
// loadHallOfFameMerged — the PB→local hall downlink (final-review I1).
// Merge rules, keyed by `member + weekStart`:
//  - local entries win points/emoji/rank/prize (the rollover device froze them);
//  - a PB row's `celebrated === true` ALWAYS wins over the local flag
//    (server authority for the ceremony gate — the /api/hall-of-fame/celebrate
//    claim lives server-side);
//  - PB rows unknown to local are adopted (cross-device enshrinement);
//  - the merged list is persisted with saveHallOfFame() and returned.
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectHallOfFame = vi.hoisted(() => vi.fn(async () => [] as any[]));
vi.mock("@/db", () => ({ db: { selectHallOfFame } }));

import {
  loadHallOfFameMerged,
  loadHallOfFame,
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

  it("a local celebrated=true survives a PB row that has never been claimed", async () => {
    saveHallOfFame([{ ...LOCAL_WIN, celebrated: true }]);
    selectHallOfFame.mockResolvedValue([{ ...LOCAL_WIN }]); // PB row behind (no flag)

    const merged = await loadHallOfFameMerged();

    expect(merged[0].celebrated).toBe(true);
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

  it("local fields win points/emoji/rank/prize against a stale PB row", async () => {
    saveHallOfFame([LOCAL_WIN]);
    selectHallOfFame.mockResolvedValue([
      { ...LOCAL_WIN, points: 1, prize: null, emoji: "❓", rank: 3 },
    ]);

    const merged = await loadHallOfFameMerged();

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      member: "Caspian G",
      emoji: "🦊",
      points: 42,
      rank: 1,
      prize: "Picks the movie",
    });
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

  it("keeps local order for known entries and appends adopted rows after", async () => {
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

    expect(merged.map((e) => e.member)).toEqual(["Emily G", "Caspian G", "Rebecca"]);
  });
});
