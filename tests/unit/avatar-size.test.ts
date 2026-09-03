import { describe, it, expect } from "vitest";
import { normalizeAvatarSize, selectableAvatarSize, AVATAR_SIZE_OPTIONS } from "@/lib/avatar-size";

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

describe("selectableAvatarSize", () => {
  it("maps the legacy 'base' alias to 'md' so a picker always highlights an option", () => {
    expect(selectableAvatarSize("base")).toBe("md");
  });
  it("passes through the offered sizes unchanged", () => {
    for (const s of ["xs", "sm", "md", "lg"]) {
      expect(selectableAvatarSize(s)).toBe(s);
    }
  });
  it("coerces invalid/missing to md", () => {
    expect(selectableAvatarSize(undefined)).toBe("md");
    expect(selectableAvatarSize("nope")).toBe("md");
  });
  it("always returns a value that is one of the offered options", () => {
    const offered = new Set(AVATAR_SIZE_OPTIONS.map((o) => o.value));
    for (const probe of ["base", "xs", "lg", "junk", undefined]) {
      expect(offered.has(selectableAvatarSize(probe))).toBe(true);
    }
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
