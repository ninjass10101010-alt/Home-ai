/**
 * Explicit-content detection on search results.
 *
 * YouTube Music exposes the flag only as a badge node whose shape changes
 * between clients. The family-safe filter depends on reading it correctly, so
 * this pins the badge scan against the shape the MUSIC client returns.
 *
 * Run: npx vitest run tests/unit/media-youtube-explicit.test.ts
 */
import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/media/youtube";

describe("music search explicit flag", () => {
  it("marks a track explicit when any badge contains 'Explicit'", () => {
    const track = __testing.toTrack({
      id: "abc12345678",
      title: "Song",
      badges: [{ musicInlineBadgeRenderer: { label: { runs: [{ text: "Explicit" }] } } }],
    } as never);
    expect(track?.explicit).toBe(true);
  });

  it("leaves a clean track non-explicit", () => {
    const track = __testing.toTrack({ id: "abc12345678", title: "Song" } as never);
    expect(track?.explicit).toBe(false);
  });
});
