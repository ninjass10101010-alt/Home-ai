// tests/unit/normalize-pantry-name.test.ts
// Task 6's live pantry matcher must use the SAME normalization as
// src/hooks/usePantry.ts normalizeName (punctuation strip), or "Soy sauce!"
// from chat never matches the stored "soy sauce" and creates a duplicate row.
import { describe, it, expect } from "vitest";
import { normalizePantryName } from "@/lib/hermes-tools";

describe("normalizePantryName", () => {
  it("matches usePantry's normalize: punctuation stripped, whitespace collapsed, lowercased", () => {
    expect(normalizePantryName("Soy sauce!")).toBe(normalizePantryName("soy sauce"));
    expect(normalizePantryName("Soy sauce!")).toBe("soy sauce");
  });
  it("trims and collapses internal runs of whitespace", () => {
    expect(normalizePantryName("  Ground   Coffee  ")).toBe("ground coffee");
  });
  it("tolerates non-string input", () => {
    expect(normalizePantryName(null)).toBe("");
    expect(normalizePantryName(undefined)).toBe("");
  });
});
