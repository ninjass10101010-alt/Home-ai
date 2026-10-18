/**
 * LRCLIB lookup — stable shape, 404 is an empty state, failures never throw.
 *
 * Run: npx vitest run tests/unit/media-lyrics.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLyricsCache, lookupLyrics } from "@/lib/media/lyrics";

afterEach(() => {
  clearLyricsCache();
  vi.restoreAllMocks();
});

describe("lookupLyrics", () => {
  it("returns synced lyrics when LRCLIB has them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              syncedLyrics: "[00:01.00]Hello\n[00:03.00]World",
              plainLyrics: "Hello\nWorld",
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await lookupLyrics({ title: "Song", artist: "Artist" });
    expect(result.synced).toBe(true);
    expect(result.lyrics).toContain("[00:01.00]Hello");
  });

  it("falls back to plain lyrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              syncedLyrics: null,
              plainLyrics: "Hello\nWorld",
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await lookupLyrics({ title: "Song", artist: "Artist" });
    expect(result).toEqual({ lyrics: "Hello\nWorld", synced: false, source: "lrclib" });
  });

  it("returns nulls on 404 instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const result = await lookupLyrics({ title: "Song", artist: "Artist" });
    expect(result).toEqual({ lyrics: null, synced: false, source: null });
  });
});
