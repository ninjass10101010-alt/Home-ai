/**
 * Lyrics lookup — LRCLIB, server-side.
 *
 * Kept behind our own route so the tablet never talks to a third party, the
 * response can be cached, and the client always gets the same stable shape.
 * LRCLIB answers 404 for "no lyrics", which is a normal empty state, not an
 * error.
 */

const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

export interface LyricsInput {
  title: string;
  artist: string;
  durationSeconds?: number | null;
}

export interface LyricsResult {
  lyrics: string | null;
  synced: boolean;
  source: "lrclib" | null;
}

interface CacheEntry {
  result: LyricsResult;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(input: LyricsInput): string {
  return `${input.artist.trim().toLowerCase()}\u0000${input.title.trim().toLowerCase()}`;
}

export function clearLyricsCache(): void {
  cache.clear();
}

export async function lookupLyrics(input: LyricsInput): Promise<LyricsResult> {
  const title = input.title.trim();
  const artist = input.artist.trim();
  if (!title || !artist) return { lyrics: null, synced: false, source: null };

  const key = cacheKey({ title, artist });
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.result;

  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (typeof input.durationSeconds === "number" && input.durationSeconds > 0) {
    params.set("duration", String(Math.round(input.durationSeconds)));
  }

  let result: LyricsResult = { lyrics: null, synced: false, source: null };
  try {
    const response = await fetch(`${LRCLIB_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "ConsuelaDashboard/1.0 (family dashboard)" },
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as {
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
      };
      if (typeof data.syncedLyrics === "string" && data.syncedLyrics.trim()) {
        result = { lyrics: data.syncedLyrics, synced: true, source: "lrclib" };
      } else if (typeof data.plainLyrics === "string" && data.plainLyrics.trim()) {
        result = { lyrics: data.plainLyrics, synced: false, source: "lrclib" };
      }
    }
  } catch {
    result = { lyrics: null, synced: false, source: null };
  }

  cache.set(key, { result, cachedAt: Date.now() });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}
