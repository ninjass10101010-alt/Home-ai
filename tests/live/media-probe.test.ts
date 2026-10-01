// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * Live check of the real server module: mints a signed googlevideo URL and
 * proves a byte range actually comes back. Opt-in — it talks to YouTube.
 *
 * This lives under tests/ rather than beside the route because that is the only
 * place vitest looks (its include glob is rooted at tests), and a probe file it
 * never discovers is worse than no probe file.
 *
 * Run: YT_MEDIA_PROBE=1 npx vitest run tests/live/media-probe.test.ts
 */
describe("live youtube media probe", () => {
  it("resolves a playable audio range", async () => {
    if (process.env.YT_MEDIA_PROBE !== "1") {
      console.log("SKIPPED (set YT_MEDIA_PROBE=1 to run)");
      return;
    }
    const { resolveStream, searchTracks } = await import("@/lib/media/youtube");

    const tracks = await searchTracks("daft punk one more time", 3);
    console.log("SEARCH_COUNT", tracks.length, "FIRST", tracks[0]?.id, tracks[0]?.title);
    expect(tracks.length).toBeGreaterThan(0);

    const stream = await resolveStream(tracks[0].id);
    console.log(
      "MIME",
      stream.mimeType,
      "LEN",
      stream.contentLength,
      "DUR",
      stream.durationSeconds,
    );

    // googlevideo 403s a HEAD but honours GET+Range, which is what <audio>
    // seeking actually does — so the range fetch is the real assertion.
    const ranged = await fetch(stream.url, { headers: { Range: "bytes=0-4095" } });
    const buf = new Uint8Array(await ranged.arrayBuffer());
    console.log("RANGE_STATUS", ranged.status, "BYTES", buf.byteLength);
    expect(ranged.status).toBe(206);
    expect(buf.byteLength).toBeGreaterThan(1000);
  }, 120_000);
});
