import { describe, expect, it } from "vitest";

import {
  curateWallPhotos,
  dayKey,
  hashString,
  mulberry32,
} from "@/lib/photos/curate";
import { isOnThisDay, type WallPhoto } from "@/db/features/photos";

/**
 * Curation is the only place the photo wall has real logic, and every rule in
 * it exists because of a failure mode a family would notice: the same shuffled
 * mess on every reload, one vacation owning the wall, a camera with a wrong
 * clock dated next year, or a picture repeating the moment the queue loops.
 */

const NOW = new Date(2026, 8, 30, 12, 0, 0); // local: 30 Sep 2026, noon

function photo(id: string, over: Partial<WallPhoto> = {}): WallPhoto {
  return {
    id,
    url: `/api/photos/file?r=${id}`,
    width: 1600,
    height: 1000,
    takenAt: "2026-01-15T12:00:00.000Z",
    ...over,
  };
}

function library(count: number, over: Partial<WallPhoto> = {}): WallPhoto[] {
  return Array.from({ length: count }, (_, index) => photo(`p${index + 1}`, over));
}

describe("deterministic ordering", () => {
  const shots = library(10);

  it("gives the same day the same order, so a panel restart does not reshuffle in front of the family", () => {
    const first = curateWallPhotos(shots, { dateKey: "2026-9-30", now: NOW });
    const second = curateWallPhotos(shots, { dateKey: "2026-9-30", now: NOW });
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
  });

  it("changes the order on a different day, so the wall is not the same picture stack forever", () => {
    const today = curateWallPhotos(shots, { dateKey: "2026-9-30", now: NOW }).map((p) => p.id);
    const tomorrow = curateWallPhotos(shots, { dateKey: "2026-10-1", now: NOW }).map((p) => p.id);
    expect(today).not.toEqual(tomorrow);
  });

  it("returns the same sequence from the seeded PRNG for the same seed", () => {
    const a = mulberry32(hashString("seed-a"));
    const b = mulberry32(hashString("seed-a"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("dayKey is the viewer's own calendar day", () => {
    expect(dayKey(NOW)).toBe("2026-9-30");
  });
});

describe("eligibility", () => {
  it("drops photos dated in the future — a wrong camera clock is not shown as a preview of next year", () => {
    const result = curateWallPhotos(
      [photo("good"), photo("future", { takenAt: "2027-06-01T12:00:00.000Z" })],
      { now: NOW },
    );
    expect(result.map((p) => p.id)).toEqual(["good"]);
  });

  it("keeps undated photos: a picture with no clock is still a picture", () => {
    const result = curateWallPhotos([photo("nodate", { takenAt: "" })], { now: NOW });
    expect(result.map((p) => p.id)).toEqual(["nodate"]);
  });

  it("respects limit", () => {
    expect(curateWallPhotos(library(10), { now: NOW, limit: 3 })).toHaveLength(3);
  });
});

describe("album variety", () => {
  it("caps one album per pass so a single trip cannot own the wall", () => {
    const trip = library(6, { album: "Oregon" });
    const others = library(8).map((p, i) => ({ ...p, id: `o${i}`, album: `everyday-${i}` }));
    const result = curateWallPhotos([...trip, ...others], { now: NOW, limit: 8, albumCap: 2 });
    expect(result.filter((p) => p.album === "Oregon")).toHaveLength(2);
    expect(result).toHaveLength(8);
  });

  it("lets the cap yield when the library is too small otherwise, rather than showing a two-photo loop", () => {
    const trip = library(6, { album: "Oregon" });
    const others = library(2).map((p, i) => ({ ...p, id: `o${i}`, album: `everyday-${i}` }));
    const result = curateWallPhotos([...trip, ...others], { now: NOW, limit: 6, albumCap: 2 });
    // The cap wanted 2 Oregon shots; six tiles' worth of wall would otherwise
    // sit empty, so the third-to-sixth strongest Oregon pictures step up.
    expect(result).toHaveLength(6);
    expect(result.filter((p) => p.album === "Oregon").length).toBeGreaterThan(2);
  });

  it("backfills instead of starving the queue when the whole library is one album", () => {
    const result = curateWallPhotos(library(10, { album: "Oregon" }), {
      now: NOW,
      limit: 8,
      albumCap: 2,
    });
    expect(result).toHaveLength(8);
  });

  it("treats untagged photos as their own group rather than one giant album", () => {
    const result = curateWallPhotos(library(6), { now: NOW, limit: 6, albumCap: 2 });
    expect(result).toHaveLength(6);
  });
});

describe("repeat handling", () => {
  it("pushes recently-shown photos to the back rather than repeating them immediately", () => {
    const shots = library(8);
    const result = curateWallPhotos(shots, {
      now: NOW,
      dateKey: "2026-9-30",
      limit: 8,
      recentIds: shots.slice(0, 2).map((p) => p.id),
    });
    const recent = new Set(shots.slice(0, 2).map((p) => p.id));
    const positions = result.map((p) => recent.has(p.id));
    // Repeats are a contiguous suffix: nothing unseen may come after one.
    const lastFresh = positions.lastIndexOf(false);
    expect(lastFresh).toBeGreaterThan(-1);
    expect(positions.slice(0, lastFresh).every((isRecent) => !isRecent)).toBe(true);
    expect(positions.slice(lastFresh + 1).every((isRecent) => isRecent)).toBe(true);
  });

  it("still shows something when the whole library is recently shown", () => {
    const shots = library(3);
    const result = curateWallPhotos(shots, {
      now: NOW,
      recentIds: shots.map((p) => p.id),
      limit: 3,
    });
    expect(result).toHaveLength(3);
  });

  it("returns an empty queue for an empty library so the widget can show its empty state", () => {
    expect(curateWallPhotos([], { now: NOW })).toEqual([]);
  });
});

describe("shuffle regression pin (spec §3.7 — the branch chrono modes must not touch)", () => {
  // A fixed, mixed library: varied dates, albums, one undated, one future,
  // two recently shown. The exact sequence below is today's shuffle output for
  // this seed; if any shuffle edit changes it, the pin fails — by design.
  const pinned: WallPhoto[] = [
    photo("a", { takenAt: "2026-03-05T09:00:00.000Z", album: "trip" }),
    photo("b", { takenAt: "2024-12-25T09:00:00.000Z" }),
    photo("c", { takenAt: "2026-08-01T09:00:00.000Z", album: "trip" }),
    photo("d", { takenAt: "2025-06-10T09:00:00.000Z", album: "everyday" }),
    photo("e", { takenAt: "", album: "scan" }),
    photo("f", { takenAt: "2026-09-01T09:00:00.000Z" }),
    photo("g", { takenAt: "2019-01-01T09:00:00.000Z", album: "trip" }),
    photo("h", { takenAt: "2027-01-01T09:00:00.000Z" }),
    photo("i", { takenAt: "2026-07-15T09:00:00.000Z", album: "everyday" }),
    photo("j", { takenAt: "2026-09-30T08:00:00.000Z" }),
  ];
  const pinOpts = {
    dateKey: "2026-9-30",
    now: NOW,
    limit: 8,
    recentIds: ["a", "f"],
  };

  it("returns exactly this sequence for a seeded input, with no order option", () => {
    const ids = curateWallPhotos(pinned, pinOpts).map((p) => p.id);
    expect(ids).toEqual(["j", "e", "d", "c", "g", "i", "b", "f"]);
  });

  it("returns the same pinned sequence with an explicit shuffle order", () => {
    const ids = curateWallPhotos(pinned, { ...pinOpts, order: "shuffle" }).map((p) => p.id);
    expect(ids).toEqual(["j", "e", "d", "c", "g", "i", "b", "f"]);
  });

  it("still excludes the future-dated row and respects the limit inside the pin", () => {
    const ids = curateWallPhotos(pinned, pinOpts).map((p) => p.id);
    expect(ids).toHaveLength(8);
    expect(ids).not.toContain("h");
  });
});

describe("chronological order — newest / oldest (spec §3.7)", () => {
  // Deliberately scrambled input order: the modes must sort by takenAt, never
  // trust the array. `anniv` is an on-this-day picture from 2019 — in shuffle
  // it would jump the line; in chrono it must sit in date position.
  const mixed: WallPhoto[] = [
    photo("m2", { takenAt: "2025-05-05T10:00:00.000Z" }),
    photo("m1", { takenAt: "2026-06-06T10:00:00.000Z" }),
    photo("anniv", { takenAt: "2019-09-30T10:00:00.000Z" }),
    photo("m3", { takenAt: "2023-01-01T10:00:00.000Z" }),
    photo("undated", { takenAt: "" }),
  ];

  it("newest is strictly chronological descending", () => {
    const ids = curateWallPhotos(mixed, { now: NOW, order: "newest", limit: 10 }).map((p) => p.id);
    expect(ids).toEqual(["m1", "m2", "m3", "anniv", "undated"]);
  });

  it("oldest is strictly chronological ascending, undated STILL last", () => {
    const ids = curateWallPhotos(mixed, { now: NOW, order: "oldest", limit: 10 }).map((p) => p.id);
    expect(ids).toEqual(["anniv", "m3", "m2", "m1", "undated"]);
  });

  it("does not promote an on-this-day photo in a chronological mode", () => {
    const ids = curateWallPhotos(mixed, { now: NOW, order: "newest", limit: 10 }).map((p) => p.id);
    expect(ids[0]).not.toBe("anniv");
    expect(ids[3]).toBe("anniv");
  });

  it.each(["shuffle", "newest", "oldest"] as const)(
    "excludes future-dated photos in order=%s",
    (order) => {
      const ids = curateWallPhotos(
        [
          photo("past", { takenAt: "2025-01-01T00:00:00.000Z" }),
          photo("future", { takenAt: "2027-06-01T00:00:00.000Z" }),
          photo("undated", { takenAt: "" }),
        ],
        { now: NOW, order, limit: 10 },
      ).map((p) => p.id);
      expect(ids).not.toContain("future");
      expect(ids).toContain("past");
      expect(ids).toContain("undated");
    },
  );

  it("applies the recent-holdback: fresh photos first, seen ones behind them", () => {
    const shots = [
      photo("n1", { takenAt: "2026-08-01T10:00:00.000Z" }),
      photo("n2", { takenAt: "2026-07-01T10:00:00.000Z" }),
      photo("n3", { takenAt: "2026-06-01T10:00:00.000Z" }),
      photo("n4", { takenAt: "2026-05-01T10:00:00.000Z" }),
    ];
    const ids = curateWallPhotos(shots, {
      now: NOW,
      order: "newest",
      limit: 4,
      recentIds: ["n1"],
    }).map((p) => p.id);
    // n1 is the newest photo but was just shown; the fresher batch fills the
    // queue first, in chronological order, and n1 waits at the back.
    expect(ids).toEqual(["n2", "n3", "n4", "n1"]);
  });

  it("holdback + limit: the recently-seen photo yields its slot to a fresher one", () => {
    const shots = [
      photo("n1", { takenAt: "2026-08-01T10:00:00.000Z" }),
      photo("n2", { takenAt: "2026-07-01T10:00:00.000Z" }),
      photo("n3", { takenAt: "2026-06-01T10:00:00.000Z" }),
    ];
    const ids = curateWallPhotos(shots, {
      now: NOW,
      order: "oldest",
      limit: 2,
      recentIds: ["n1"],
    }).map((p) => p.id);
    expect(ids).toEqual(["n3", "n2"]);
  });

  it("ignores the album cap: one album can fill the whole chronological queue", () => {
    // Six shots from one trip, stricter cap than the queue length. The cap is
    // a shuffle-fairness device; "oldest first" must not skip a photo because
    // its album already had its turn.
    const trip = [
      photo("o1", { takenAt: "2024-01-01T10:00:00.000Z", album: "Oregon" }),
      photo("o2", { takenAt: "2024-02-01T10:00:00.000Z", album: "Oregon" }),
      photo("o3", { takenAt: "2024-03-01T10:00:00.000Z", album: "Oregon" }),
      photo("o4", { takenAt: "2024-04-01T10:00:00.000Z", album: "Oregon" }),
      photo("o5", { takenAt: "2024-05-01T10:00:00.000Z", album: "Oregon" }),
      photo("u6", { takenAt: "2024-06-01T10:00:00.000Z" }),
    ];
    const ids = curateWallPhotos(trip, {
      now: NOW,
      order: "oldest",
      limit: 6,
      albumCap: 1,
    }).map((p) => p.id);
    expect(ids).toEqual(["o1", "o2", "o3", "o4", "o5", "u6"]);
  });

  it("honors limit by taking the chronological head, not a subset", () => {
    const ids = curateWallPhotos(mixed, { now: NOW, order: "newest", limit: 2 }).map((p) => p.id);
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("honors limit in oldest mode too", () => {
    const ids = curateWallPhotos(mixed, { now: NOW, order: "oldest", limit: 3 }).map((p) => p.id);
    expect(ids).toEqual(["anniv", "m3", "m2"]);
  });

  it("returns an empty queue for an empty library", () => {
    expect(curateWallPhotos([], { now: NOW, order: "newest" })).toEqual([]);
  });
});

describe("on this day", () => {
  it("recognises the same calendar day in an earlier year", () => {
    const anniversary = new Date(2019, NOW.getMonth(), NOW.getDate(), 9, 0, 0);
    expect(isOnThisDay(anniversary.toISOString(), NOW)).toBe(true);
  });

  it("never treats today's own photo as an anniversary", () => {
    expect(isOnThisDay(new Date(NOW).toISOString(), NOW)).toBe(false);
  });

  it("promotes an anniversary shot to the front of the queue", () => {
    const anniversary = new Date(2019, NOW.getMonth(), NOW.getDate(), 9, 0, 0);
    const result = curateWallPhotos(
      [
        photo("anniversary", { takenAt: anniversary.toISOString(), album: "a" }),
        ...library(5).map((p, i) => ({ ...p, album: `b${i}` })),
      ],
      { now: NOW, dateKey: "2026-9-30", limit: 6 },
    );
    expect(result[0].id).toBe("anniversary");
  });
});
