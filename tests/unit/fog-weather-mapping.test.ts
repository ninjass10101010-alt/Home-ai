// Fog ↔ weather/theme mapping. The inversion this file used to encode: the
// palette was picked by the CLOCK, so a light theme at night got the near-black
// NIGHT table (a flood between the near-white canvas and every white glass
// card) and a dark theme at noon got the pale DAY table (a milky wash over a
// near-black canvas). The palette belongs to the leg — the resolved theme's
// canvas — and the clock may only shift it WITHIN that leg.
//
// Luminance bands, not vibes: every number below is WCAG relative luminance, so
// "stays on its own canvas" is a claim the next edit has to beat.

import { describe, expect, it } from "vitest";
import { getFogParams, resolveFogColor, FOG_PALETTES, type FogLeg } from "@/lib/fog-weather-mapping";

const CONDITIONS = [
  "sunny",
  "partly-cloudy",
  "cloudy",
  "rainy",
  "snowy",
  "foggy",
  "thunderstorm",
] as const;

const LEGS: FogLeg[] = ["light", "dark"];
const CLOCKS = ["day", "night"] as const;

function luminance(hex: number): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((hex >> 16) & 0xff) +
    0.7152 * channel((hex >> 8) & 0xff) +
    0.0722 * channel(hex & 0xff)
  );
}

const COLOR_SLOTS = ["baseColor", "lowlightColor", "midtoneColor", "highlightColor"] as const;

describe("the fog palette leg follows the theme", () => {
  it("a light leg is never as dark as the same condition's dark leg", () => {
    for (const condition of CONDITIONS) {
      for (const clock of CLOCKS) {
        const light = getFogParams(condition, "light", "none", clock === "night");
        const dark = getFogParams(condition, "dark", "none", clock === "night");
        for (const slot of COLOR_SLOTS) {
          const l = luminance(light[slot]);
          const d = luminance(dark[slot]);
          expect(l, `${condition}/${clock} ${slot}: light leg ${l} vs dark leg ${d}`)
            .toBeGreaterThan(d);
          // Not "slightly lighter" — a wash-out in the wrong direction is the
          // defect, so the gap has to be a whole canvas apart.
          expect(l / Math.max(d, 0.001), `${condition}/${clock} ${slot} gap`)
            .toBeGreaterThan(3);
        }
      }
    }
  });

  it("the light leg stays light and the dark leg stays dark", () => {
    for (const condition of CONDITIONS) {
      for (const clock of CLOCKS) {
        const light = getFogParams(condition, "light", "none", clock === "night");
        const dark = getFogParams(condition, "dark", "none", clock === "night");
        // The dark leg is the near-black canvas: nothing in it may drift up into
        // a mid-tone, which is exactly how a daytime dark theme got washed out.
        expect(luminance(dark.midtoneColor), `${condition}/${clock} dark midtone`)
          .toBeLessThan(0.08);
        expect(luminance(dark.baseColor), `${condition}/${clock} dark base`)
          .toBeLessThan(0.1);
        // Thunderstorm is the one deliberate exception on the light side: a
        // storm is genuinely dark at noon, and the comparative contract above
        // is what keeps it from becoming the dark leg's palette.
        if (condition !== "thunderstorm") {
          expect(luminance(light.midtoneColor), `${condition}/${clock} light midtone`)
            .toBeGreaterThan(0.2);
        }
      }
    }
  });
});

describe("the clock shifts the veil WITHIN the leg", () => {
  /** Euclidean distance between two packed RGB ints, channel space. */
  function distance(a: number, b: number): number {
    const ch = (hex: number, i: number) => (hex >> (i * 8)) & 0xff;
    return Math.hypot(ch(a, 0) - ch(b, 0), ch(a, 1) - ch(b, 1), ch(a, 2) - ch(b, 2));
  }

  it("night leans harder on the leg's own cloud tone than day does", () => {
    for (const leg of LEGS) {
      for (const condition of CONDITIONS) {
        const cloud = FOG_PALETTES[leg][condition].lowlight;
        const day = getFogParams(condition, leg, "none", false);
        const night = getFogParams(condition, leg, "none", true);
        expect(night.baseColor, `${leg}/${condition} base must differ by clock`)
          .not.toBe(day.baseColor);
        // Not "darker" — in the light leg the cloud tone is a shadow and in the
        // dark leg it is a moonlit blue. What is claimed is the WEIGHT: at
        // night the sky tone sits further from the cloud tone.
        expect(
          distance(night.baseColor, cloud),
          `${leg}/${condition} night cloud weight`,
        ).toBeLessThan(distance(day.baseColor, cloud));
      }
    }
  });

  it("the shift is a shift, not a leg swap", () => {
    for (const leg of LEGS) {
      for (const condition of CONDITIONS) {
        const day = getFogParams(condition, leg, "none", false);
        const night = getFogParams(condition, leg, "none", true);
        const sky = FOG_PALETTES[leg][condition].base;
        const reach = distance(sky, FOG_PALETTES[leg][condition].lowlight);
        for (const [clock, params] of [["day", day], ["night", night]] as const) {
          expect(distance(params.baseColor, sky), `${leg}/${condition}/${clock}`)
            .toBeLessThanOrEqual(reach);
        }
      }
    }
  });

  it("day and night of the same leg never straddle the other leg's band", () => {
    for (const condition of CONDITIONS) {
      const lightNight = getFogParams(condition, "light", "none", true);
      const darkNight = getFogParams(condition, "dark", "none", true);
      for (const slot of COLOR_SLOTS) {
        expect(luminance(lightNight[slot]), `${condition} ${slot}`)
          .toBeGreaterThan(luminance(darkNight[slot]));
      }
    }
  });

  it("carries the leg's own motion tuning, so the clock is not the leg's only axis", () => {
    const lightFoggy = getFogParams("foggy", "light", "none", true);
    const darkFoggy = getFogParams("foggy", "dark", "none", true);
    expect(lightFoggy.blurFactor).toBeCloseTo(0.55, 5);
    expect(darkFoggy.blurFactor).toBeCloseTo(0.55, 5);
    expect(lightFoggy.speed).toBeGreaterThan(0);
    expect(darkFoggy.speed).toBeGreaterThan(0);
    expect(Number.isFinite(lightFoggy.zoom)).toBe(true);
  });
});

describe("the family's fog colour is an OVERRIDE, not the palette", () => {
  const PRESET = "#c8a86a";
  const LEG_DEFAULT = 0x385878;

  it("an untouched setting defers to the leg's palette", () => {
    expect(resolveFogColor(PRESET, PRESET, LEG_DEFAULT)).toBe(LEG_DEFAULT);
    expect(resolveFogColor(PRESET.toUpperCase(), PRESET, LEG_DEFAULT)).toBe(LEG_DEFAULT);
    expect(resolveFogColor(` ${PRESET} `, PRESET, LEG_DEFAULT)).toBe(LEG_DEFAULT);
  });

  it("a hand-picked colour wins", () => {
    expect(resolveFogColor("#ff00aa", PRESET, LEG_DEFAULT)).toBe(0xff00aa);
  });

  it("an empty or malformed setting falls back instead of reaching the shader", () => {
    // The old `hexToNum(x) ?? fallback` let NaN and truncations through: `??`
    // only covers null/undefined, and `parseInt("#12", 16)` is 18 — a valid
    // number that paints near-black. Both were a black canvas, not a fog.
    for (const bad of ["", "   ", "#", "not-a-colour", "#12", "c8a86azz", "#12345"]) {
      const resolved = resolveFogColor(bad, PRESET, LEG_DEFAULT);
      expect(resolved, `"${bad}"`).toBe(LEG_DEFAULT);
      expect(Number.isFinite(resolved)).toBe(true);
    }
  });

  it("accepts the bare six-digit form the picker may store", () => {
    expect(resolveFogColor("ff00aa", PRESET, LEG_DEFAULT)).toBe(0xff00aa);
  });
});

describe("holiday tint still rides on top of the leg", () => {
  it("tints every slot of the leg it is given", () => {
    for (const leg of LEGS) {
      const plain = getFogParams("cloudy", leg, "none", true);
      const holly = getFogParams("cloudy", leg, "christmas", true);
      for (const slot of COLOR_SLOTS) {
        expect(holly[slot], `${leg} ${slot}`).not.toBe(plain[slot]);
      }
      // A 0.25 glaze — a tint, not a repaint.
      const shifted = Math.abs(luminance(holly.baseColor) - luminance(plain.baseColor));
      expect(shifted, `${leg} christmas base moved by ${shifted}`).toBeLessThan(0.35);
    }
  });

  it("an unknown or absent holiday is a no-op", () => {
    for (const leg of LEGS) {
      const plain = getFogParams("cloudy", leg, "none", true);
      expect(getFogParams("cloudy", leg, "", true)).toEqual(plain);
      expect(getFogParams("cloudy", leg, "not-a-holiday", true)).toEqual(plain);
      expect(getFogParams("cloudy", leg).midtoneColor).toBe(
        getFogParams("cloudy", leg, "none", true).midtoneColor,
      );
    }
  });
});
