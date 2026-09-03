import { describe, it, expect } from "vitest";
import { normalizeAvatarSize, AVATAR_SIZE_OPTIONS } from "@/lib/avatar-size";

describe("normalizeAvatarSize", () => {
  it("passes through valid sizes", () => {
    for (const s of ["xs", "sm", "md", "base", "lg"]) {
      expect(normalizeAvatarSize(s)).toBe(s);
    }
  });
  it("coerces missing/invalid/legacy values to md", () => {
    expect(normalizeAvatarSize(undefined)).toBe("md");
    expect(normalizeAvatarSize("")).toBe("md");
    expect(normalizeAvatarSize("huge")).toBe("md");
    expect(normalizeAvatarSize("BASE")).toBe("md"); // case-sensitive
  });
});

describe("AVATAR_SIZE_OPTIONS", () => {
  it("offers exactly the four friendly choices, no legacy 'base'", () => {
    expect(AVATAR_SIZE_OPTIONS.map((o) => o.value)).toEqual(["xs", "sm", "md", "lg"]);
  });
  it("labels every option with a friendly name (not the raw token)", () => {
    for (const o of AVATAR_SIZE_OPTIONS) {
      expect(o.label).not.toBe(o.value);
      expect(o.label.length).toBeGreaterThan(1);
    }
  });
  it("every offered value is a valid AvatarSize", () => {
    for (const o of AVATAR_SIZE_OPTIONS) {
      expect(normalizeAvatarSize(o.value)).toBe(o.value);
    }
  });
});
