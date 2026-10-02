import { describe, it, expect } from "vitest";
import { contrastRatio, posterTextSurface, weatherHeaderTextSurfaces } from "@/lib/weather-contrast";
import { SKY } from "@/components/ui/wx-tokens";

const SLATE_800 = "#1E293B";
const SCENES = ["clear", "cloudy", "rain", "snow", "storm", "night"] as const;
const PHASES = ["dawn", "day", "dusk", "night"] as const;
const DAWN = ["#898CBB", "#E8A2B6", "#FFD8A0"];
const DUSK = ["#8C8DB1", "#CE73A1", "#FFB072"];

describe("AA gate — dawn/dusk stops (C10)", () => {
  it.each(["dawn", "dusk"] as const)("every %s stop is ≥ 4.5:1 vs slate-800", (phase) => {
    for (const scene of ["clear", "cloudy"] as const) {
      const stops = posterTextSurface(scene, false, phase);
      expect(stops).toHaveLength(3);
      for (const stop of stops) {
        expect(contrastRatio(SLATE_800, stop), `${scene}/${phase} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("pins the machine-verified dawn stops", () => {
    expect(posterTextSurface("clear", false, "dawn")).toEqual(DAWN);
    expect(posterTextSurface("cloudy", false, "dawn")).toEqual(DAWN);
  });
  it("pins the machine-verified dusk stops", () => {
    expect(posterTextSurface("clear", false, "dusk")).toEqual(DUSK);
    expect(posterTextSurface("cloudy", false, "dusk")).toEqual(DUSK);
  });
});

describe("posterTextSurface shape", () => {
  it("returns exactly three stops for every scene × heavySnow × phase", () => {
    for (const scene of SCENES) {
      for (const phase of PHASES) {
        expect(posterTextSurface(scene, false, phase)).toHaveLength(3);
        expect(posterTextSurface(scene, true, phase)).toHaveLength(3);
      }
    }
  });
  it("ignores skyPhase for precipitation scenes", () => {
    expect(posterTextSurface("rain", false, "dawn")).toEqual(posterTextSurface("rain", false, "day"));
    expect(posterTextSurface("snow", false, "dusk")).toEqual(posterTextSurface("snow", false, "day"));
    expect(posterTextSurface("storm", false, "dawn")).toEqual(posterTextSurface("storm", false, "night"));
    expect(posterTextSurface("night", false, "dawn")).toEqual(posterTextSurface("night", false, "day"));
  });
  it("keeps heavySnow distinct from plain snow", () => {
    expect(posterTextSurface("snow", true, "dawn")).not.toEqual(posterTextSurface("snow", false, "dawn"));
  });
  it("defaults to the day surfaces (call sites untouched this task)", () => {
    expect(posterTextSurface("clear")).toEqual(posterTextSurface("clear", false, "day"));
  });
});

describe("weatherHeaderTextSurfaces", () => {
  it("is a 2× composite of every stop", () => {
    expect(weatherHeaderTextSurfaces("clear", false, false, "dawn")).toHaveLength(6);
    expect(weatherHeaderTextSurfaces("storm", false, false)).toHaveLength(6);
  });
  it("failedFetch mixes toward the gray without changing count", () => {
    expect(weatherHeaderTextSurfaces("clear", true, false, "dawn")).toHaveLength(6);
  });
});

describe("contrastRatio sanity", () => {
  it("black/white is 21", () => expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1));
  it("identical colors are 1", () => expect(contrastRatio("#898CBB", "#898CBB")).toBeCloseTo(1, 3));
});

describe("AA gate — Monster wash stops via posterTextSurface", () => {
  it.each([
    { scene: "clear" as const, heavy: false, ink: SLATE_800 },
    { scene: "cloudy" as const, heavy: false, ink: SLATE_800 },
    { scene: "rain" as const, heavy: false, ink: SLATE_800 },
    { scene: "snow" as const, heavy: false, ink: SLATE_800 },
    { scene: "snow" as const, heavy: true, ink: "#FFFFFF" },
    { scene: "storm" as const, heavy: false, ink: "#FFFFFF" },
    { scene: "night" as const, heavy: false, ink: SLATE_800 },
  ])("every $scene heavy=$heavy stop is ≥ 4.5:1 vs its ink", ({ scene, heavy, ink }) => {
    for (const stop of posterTextSurface(scene, heavy, "day")) {
      expect(contrastRatio(ink, stop), `${scene} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("SKY wash strings match the verified ink stops", () => {
  const stopsOf = (skyClass: string) =>
    Array.from(skyClass.matchAll(/#([0-9a-f]{6})/gi), (m) => `#${m[1]}`.toLowerCase())

  // SKY key → the posterTextSurface call whose stops must equal the wash.
  const SURFACE_FOR: Record<string, () => string[]> = {
    clear: () => posterTextSurface("clear", false, "day"),
    dawn: () => posterTextSurface("clear", false, "dawn"),
    dusk: () => posterTextSurface("clear", false, "dusk"),
    cloudy: () => posterTextSurface("cloudy", false, "day"),
    rain: () => posterTextSurface("rain", false, "day"),
    snow: () => posterTextSurface("snow", false, "day"),
    heavySnow: () => posterTextSurface("snow", true, "day"),
    storm: () => posterTextSurface("storm", false, "day"),
    night: () => posterTextSurface("night", false, "day"),
  };

  it.each(Object.keys(SURFACE_FOR))("SKY.%s hexes equal posterTextSurface stops", (key) => {
    expect(stopsOf(SKY[key])).toEqual(SURFACE_FOR[key]().map((s) => s.toLowerCase()));
  });
});
