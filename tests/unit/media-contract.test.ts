/**
 * Media contracts that are easy to break silently.
 *
 * The behavioural state machine lives in `media-queue.test.ts`. This file pins
 * the things that would fail *at runtime against YouTube* rather than in a unit
 * test — the format picker, the proxy's guards, and the "no credentials reach
 * the browser" rule that the whole server-side design exists to protect.
 *
 * Run: npx vitest run tests/unit/media-contract.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { __testing, audioContainerFor, pickAudioFormat } from "@/lib/media/youtube";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

/** Shaped like the raw `/youtubei/v1/player` streamingData entries. */
function format(itag: number, mimeType: string, extra: Record<string, unknown> = {}) {
  return { itag, mimeType, url: `https://example.test/${itag}`, bitrate: 128000, ...extra };
}

describe("pickAudioFormat", () => {
  it("prefers m4a over webm so iOS Safari can decode it", () => {
    const chosen = pickAudioFormat([
      format(251, 'audio/webm; codecs="opus"'),
      format(140, 'audio/mp4; codecs="mp4a.40.2"'),
    ]);
    expect(chosen?.itag).toBe(140);
  });

  it("falls back through the whole preference order", () => {
    expect(pickAudioFormat([format(249, "audio/webm")])?.itag).toBe(249);
    expect(pickAudioFormat([format(139, "audio/mp4")])?.itag).toBe(139);
  });

  it("picks the highest bitrate when no preferred itag is present", () => {
    const chosen = pickAudioFormat([
      format(300, "audio/mp4", { bitrate: 64000 }),
      format(301, "audio/mp4", { bitrate: 256000 }),
    ]);
    expect(chosen?.itag).toBe(301);
  });

  it("never returns a video-only format", () => {
    const chosen = pickAudioFormat([
      format(137, 'video/mp4; codecs="avc1"', { bitrate: 4000000 }),
      format(140, "audio/mp4"),
    ]);
    expect(chosen?.itag).toBe(140);
  });

  it("skips an audio entry that has no URL", () => {
    const chosen = pickAudioFormat([
      { itag: 140, mimeType: "audio/mp4" } as never,
      format(251, "audio/webm"),
    ]);
    expect(chosen?.itag).toBe(251);
  });

  it("returns null when there is nothing playable", () => {
    expect(pickAudioFormat([])).toBeNull();
    expect(pickAudioFormat([format(137, "video/mp4")])).toBeNull();
  });
});

describe("audioContainerFor", () => {
  it("maps the audio itags to their container", () => {
    expect(audioContainerFor(140)).toBe("m4a");
    expect(audioContainerFor(251)).toBe("webm");
    expect(audioContainerFor(999)).toBeNull();
    expect(audioContainerFor(null)).toBeNull();
  });
});

describe("cache lifetimes", () => {
  it("expires the stream cache well inside the signed-URL lifetime", () => {
    // A googlevideo URL is typically valid ~6h. Caching for longer than that
    // would hand the browser a dead URL mid-track.
    expect(__testing.STREAM_CACHE_TTL_MS).toBeLessThan(60 * 60 * 1000);
  });
});

describe("/api/media/stream guards", () => {
  const source = read("src", "app", "api", "media", "stream", "route.ts");

  it("requires a session", () => {
    expect(source).toContain("verifySession");
  });

  it("validates the video id instead of forwarding it blind", () => {
    expect(source).toMatch(/VIDEO_ID_RE\s*=\s*\/\^\[A-Za-z0-9_-\]\{11\}\$\//);
    expect(source).toContain("VIDEO_ID_RE.test");
  });

  it("caps the Range header it will forward", () => {
    expect(source).toContain("MAX_RANGE_HEADER_BYTES");
  });

  it("forwards Range so <audio> seeking works, and passes Content-Range back", () => {
    expect(source).toContain('request.headers.get("range")');
    expect(source).toContain("Content-Range");
    expect(source).toContain("Accept-Ranges");
  });

  it("never caches the response and never logs the signed URL", () => {
    expect(source).toContain('"Cache-Control", "private, no-store"');
    // A single log of the resolved object would write the signed URL to disk.
    expect(source).not.toMatch(/console\.(log|info|debug)\([^)]*stream\b/);
  });
});

describe("/api/media/search guards", () => {
  const source = read("src", "app", "api", "media", "search", "route.ts");


describe("no credential reaches the client", () => {
  const CLIENT_MEDIA_FILES = [
    "src/hooks/useMediaPlayer.ts",
    "src/hooks/useMediaSearch.ts",
    "src/components/music/MusicWidget.tsx",
    "src/app/player/page.tsx",
    "src/lib/media/queue.ts",
  ];

  it("the signed-URL host appears only in the server module and the proxy", () => {
    const leaks = CLIENT_MEDIA_FILES.filter((path) =>
      /googlevideo/.test(read(...path.split("/"))),
    );
    expect(leaks, "client-side media code must not know the upstream host").toEqual([]);
  });

  it("the guest cookie never leaves src/lib/media/youtube.ts", () => {
    const leaks = CLIENT_MEDIA_FILES
      .concat(["src/app/api/media/stream/route.ts", "src/app/api/media/search/route.ts"])
      .filter((path) => /visitorData|Set-Cookie/i.test(read(...path.split("/"))));
    expect(leaks).toEqual([]);
  });

  it("only the proxy and the server module mention the upstream host at all", () => {
    const mentions = [
      "src/lib/media/youtube.ts",
      "src/app/api/media/stream/route.ts",
    ];
    for (const path of mentions) {
      expect(read(...path.split("/")), path).not.toBe("");
    }
  });
});

describe("the widget is registered everywhere layout-config demands", () => {
  const source = read("src", "lib", "layout-config.ts");

  it("declares the widget id, def, tier and pre-mount span", () => {
    expect(source).toContain('| "music"');
    expect(source).toContain('{ id: "music", label: "Music"');
    expect(source).toMatch(/music:\s*\{\s*phone:\s*"",\s*tablet:\s*"col-span-1"/);
    expect(source).toMatch(/WIDGET_SPANS[\s\S]*?music:\s*"col-span-1"/);
  });

  it("hides the widget on the wall so the grid stays at 12 cells", () => {
    const hidden = /const TABLET_HIDDEN_WIDGETS: WidgetId\[\] = \[([\s\S]*?)\];/.exec(source);
    expect(hidden, "TABLET_HIDDEN_WIDGETS must still be declared").not.toBeNull();
    expect(hidden?.[1]).toContain('"music"');
  });
});

  it("requires a session", () => {
    expect(source).toContain("verifySession");
  });

  it("caps the result limit", () => {
    expect(source).toContain("MAX_LIMIT");
  });
});
