import { describe, it, expect } from "vitest";
import {
  PB_TASK_EMOJI_MAX,
  persistedTaskEmoji,
} from "@/lib/task-emoji";

// Real photo avatars in members.emoji are 100KB+ base64 data URLs. PocketBase
// tasks.assigneeEmoji is text max=5000 — a raw photo URL fails
// validation_max_text_constraint and the whole task row never lands (the
// dashboard then never sees a pendingApproval from another device).
const PHOTO_URL =
  `data:image/webp;base64,${"A".repeat(212_050)}`;

describe("persistedTaskEmoji", () => {
  it("keeps a short emoji glyph as-is", () => {
    expect(persistedTaskEmoji("🦊")).toBe("🦊");
    expect(persistedTaskEmoji("👧")).toBe("👧");
  });

  it("keeps empty / missing as empty string (never undefined)", () => {
    expect(persistedTaskEmoji(undefined)).toBe("");
    expect(persistedTaskEmoji(null)).toBe("");
    expect(persistedTaskEmoji("")).toBe("");
  });

  it("collapses a photo data-URL to the generic glyph (never base64 into PB)", () => {
    expect(persistedTaskEmoji(PHOTO_URL)).toBe("👤");
    expect(PHOTO_URL.length).toBeGreaterThan(PB_TASK_EMOJI_MAX);
  });

  it("collapses an http(s) avatar URL to the generic glyph", () => {
    expect(persistedTaskEmoji("https://example.com/face.png")).toBe("👤");
  });

  it("collapses any over-limit string so PB's max=5000 cannot reject the row", () => {
    const blob = "x".repeat(PB_TASK_EMOJI_MAX + 1);
    expect(persistedTaskEmoji(blob)).toBe("👤");
  });

  it("accepts a value exactly at the PB max", () => {
    const edge = "x".repeat(PB_TASK_EMOJI_MAX);
    expect(persistedTaskEmoji(edge)).toBe(edge);
  });
});
