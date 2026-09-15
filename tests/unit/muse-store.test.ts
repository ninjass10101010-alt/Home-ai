import { describe, it, expect } from "vitest";
import { generateKey, hashMuseKey, clampRateLimit } from "@/lib/muse/store";

describe("muse store helpers", () => {
  it("generateKey returns a muse_-prefixed key, its sha256 hex, and an 8-char prefix", () => {
    const { key, keyHash, keyPrefix } = generateKey();
    expect(key.startsWith("muse_")).toBe(true);
    // 32 random bytes → 43 base64url chars, plus the 5-char namespace.
    expect(key.length).toBe("muse_".length + 43);
    expect(keyHash).toBe(hashMuseKey(key));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPrefix).toBe(key.slice(0, 8));
  });

  it("generates unique keys", () => {
    expect(generateKey().key).not.toBe(generateKey().key);
  });

  it("clampRateLimit keeps rateLimitPerMin inside 10..600", () => {
    expect(clampRateLimit(5)).toBe(10);
    expect(clampRateLimit(120)).toBe(120);
    expect(clampRateLimit(600)).toBe(600);
    expect(clampRateLimit(9999)).toBe(600);
    expect(clampRateLimit(NaN)).toBe(10);
  });
});
