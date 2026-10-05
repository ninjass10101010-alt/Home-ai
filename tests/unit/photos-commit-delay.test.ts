/**
 * `commitDelayMs` — the widget's timing table (spec §3.4), extracted as a
 * pure helper so the numbers live in ONE place instead of a ternary buried in
 * the component. DOM-free and timer-free by design: imported from
 * `@/lib/photos/settings`, never from the component file.
 *
 * The matrix: crossfade/slide ride the full crossfade budget (720),
 * dissolve swaps at the veil's peak (300), cut commits on the arm frame (0),
 * and reduced motion collapses EVERY transition to 0 — a deliberate change
 * from the old `60 ms`, which existed only to let the `is-armed` frame land.
 */
import { describe, it, expect } from "vitest";
import { CROSSFADE_MS, commitDelayMs } from "@/lib/photos/settings";

describe("commitDelayMs (spec §3.4)", () => {
  it("commits each transition on its own beat when motion is allowed", () => {
    expect(commitDelayMs("crossfade", false)).toBe(720);
    expect(commitDelayMs("slide", false)).toBe(720);
    // The swap happens at the veil's fully-opaque instant; the fade-out
    // continues for another 300ms after the commit.
    expect(commitDelayMs("dissolve", false)).toBe(300);
    expect(commitDelayMs("cut", false)).toBe(0);
  });

  it("collapses every transition to an immediate commit under reduced motion", () => {
    for (const transition of ["crossfade", "dissolve", "slide", "cut"] as const) {
      expect(commitDelayMs(transition, true), transition).toBe(0);
    }
  });

  it("keeps crossfade/slide at the full crossfade budget plus the settle beat", () => {
    // Pins the relationship, not just the literal: if CROSSFADE_MS ever
    // moves, this says the layer swap must keep pace with it.
    expect(commitDelayMs("crossfade", false)).toBe(CROSSFADE_MS + 120);
    expect(commitDelayMs("slide", false)).toBe(CROSSFADE_MS + 120);
    // dissolve is exactly half the glide — the same derivation the CSS uses
    // via calc(var(--motion-glide) / 2).
    expect(commitDelayMs("dissolve", false)).toBe(CROSSFADE_MS / 2);
  });
});
