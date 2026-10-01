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
