/**
 * Wall photo curation — pure, deterministic, unit-tested.
 *
 * The wall rotates through family photos, and the sequencing is the one piece
 * of the feature with real logic in it, so it lives here with no React and no
 * PocketBase import. Three properties the product depends on:
 *
 *  1. STABLE PER DAY. The order is seeded from the calendar day, so reloading
 *     the panel (or a 3am Next restart, which this box does constantly) resumes
 *     the same sequence instead of reshuffling in front of the family.
 *  2. NOT MONOPOLISED. One vacation can't own the wall: each album gets a cap
 *     per pass, and recency is a gentle weight, not a sort.
 *  3. NEVER A HEAD-FAKE. Photos dated in the future (a wrong camera clock, an
 *     EXIF-less import) are excluded rather than shown with a nonsense caption.
 */

import { isOnThisDay, type WallPhoto } from '@/db/features/photos';

/** Deterministic 32-bit string hash (FNV-1a) — the seed for a day's order. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG so a given day always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `YYYY-M-D` in the viewer's own calendar, so a day's order matches the day. */
export function dayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export interface CurateOptions {
  /** Seed for the day. Defaults to today. */
  dateKey?: string;
  /** Cap on the returned queue length. */
  limit?: number;
  /** Per-album ceiling within one pass; `album` undefined counts as its own group. */
  albumCap?: number;
  /** Ids shown most recently, kept out of the front of the queue when possible. */
  recentIds?: string[];
  /** "Now" for future-date filtering and the on-this-day boost. */
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Build the queue the wall walks through. Returns at most `limit` photos,
 * in the order they should appear.
 */
export function curateWallPhotos(photos: WallPhoto[], options: CurateOptions = {}): WallPhoto[] {
  const {
    dateKey: seed = dayKey(),
    limit = 12,
    albumCap = 3,
    recentIds = [],
    now = new Date(),
  } = options;

  const eligible = photos.filter((p) => {
    const taken = new Date(p.takenAt).getTime();
    // Undated rows sort as "very old" rather than being dropped — a photo with
    // no clock is still a photo. A *future* date is a data error, so it's out.
    if (Number.isNaN(taken)) return true;
    return taken <= now.getTime() + MS_PER_DAY;
  });

  if (eligible.length === 0) return [];

  const rand = mulberry32(hashString(seed));
  const jittered = eligible
    .map((photo) => {
      const taken = new Date(photo.takenAt).getTime();
      const ageDays = Number.isNaN(taken)
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, (now.getTime() - taken) / MS_PER_DAY);
      // Gentle recency weight: something from last week beats something from
      // 2019, but a 5-year-old picture is still reachable on any given day.
      // An "on this day" picture from a previous year jumps the line outright.
      const onThisDay = isOnThisDay(photo.takenAt, now);
      const recencyScore = onThisDay ? 10 : 1 / (1 + Math.log1p(ageDays));
      return { photo, score: recencyScore + rand() * 0.9 };
    })
    .sort((a, b) => b.score - a.score);

  // Recently-shown photos are demoted up front, not re-sorted at the end: a
  // wall that repeats a picture the family just looked at is the one thing a
  // slideshow is judged on. Demoting first also means a small library still
  // fills its queue — the repeats simply arrive last — instead of emptying it.
  const recent = new Set(recentIds);
  const fresh = jittered.filter(({ photo }) => !recent.has(photo.id));
  const seenRecently = jittered.filter(({ photo }) => recent.has(photo.id));

  const chosen: WallPhoto[] = [];
  const picked = new Set<string>();
  const byAlbum = new Map<string, number>();

  /** Take photos in score order; `respectCap` applies the per-album ceiling. */
  const pass = (pool: { photo: WallPhoto }[], respectCap: boolean) => {
    for (const { photo } of pool) {
      if (chosen.length >= limit) return;
      if (picked.has(photo.id)) continue;
      const album = photo.album?.trim() || '__ungrouped__';
      const used = byAlbum.get(album) ?? 0;
      if (respectCap && used >= albumCap) continue;
      byAlbum.set(album, used + 1);
      picked.add(photo.id);
      chosen.push(photo);
    }
  };

  // Four ordered phases, so every unseen photo precedes every repeat:
  // fresh-with-cap, fresh-without-cap, repeats-with-cap, repeats-without-cap.
  // Reaching a later phase is exactly the scarcity case — one big album, or a
  // library made entirely of recent shots — and the wall degrades to showing
  // those rather than handing back a two-photo loop or an empty tile.
  pass(fresh, true);
  pass(fresh, false);
  pass(seenRecently, true);
  pass(seenRecently, false);

  return chosen;
}
