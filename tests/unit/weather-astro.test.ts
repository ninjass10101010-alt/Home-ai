import { describe, it, expect } from "vitest";
import { moonPhase, moonPhaseName, moonLitPath, makeCloudSpec } from "@/lib/weather-astro";

describe("moonLitPath", () => {
  it("is deterministic for identical input", () => {
    expect(moonLitPath(0.3, 20)).toBe(moonLitPath(0.3, 20));
  });
  it("opens at the top of the disc and closes the shape", () => {
    expect(moonLitPath(0.25, 20)).toMatch(/^M 0 -20 /);
    expect(moonLitPath(0.5, 20)).toMatch(/Z$/);
  });
  it("clamps degenerate quarter arcs instead of emitting zero-radius paths", () => {
    expect(moonLitPath(0.25, 20)).toContain("A 0.01 20");
    expect(moonLitPath(0.75, 20)).toContain("A 0.01 20");
  });
  it("waxing and waning mirror their sweep flags", () => {
    expect(moonLitPath(0.125, 20)).toContain("0 0 1 0 20");
    expect(moonLitPath(0.875, 20)).toContain("0 0 0 0 20");
  });
});

describe("moonPhase / moonPhaseName", () => {
  it("returns phase in [0,1) with a consistent waxing flag", () => {
    const m = moonPhase(Date.UTC(2026, 8, 25, 12));
    expect(m.phase).toBeGreaterThanOrEqual(0);
    expect(m.phase).toBeLessThan(1);
    expect(m.waxing).toBe(m.phase < 0.5);
  });
  it("covers the phase wheel", () => {
    expect(moonPhaseName(0.01)).toBe("New Moon");
    expect(moonPhaseName(0.25)).toBe("First Quarter");
    expect(moonPhaseName(0.5)).toBe("Full Moon");
    expect(moonPhaseName(0.75)).toBe("Last Quarter");
  });
});

describe("makeCloudSpec (moved — keeps its pinned behavior)", () => {
  it("is deterministic", () => {
    expect(makeCloudSpec(12345, 0.6)).toEqual(makeCloudSpec(12345, 0.6));
  });
  it("keeps blobs inside the 200-unit strip for every fullness", () => {
    for (const seed of [1, 55, 999]) {
      for (const b of makeCloudSpec(seed, 0.9).blobs) {
        expect(b.cx - b.rx).toBeGreaterThanOrEqual(15);
        expect(b.cx + b.rx).toBeLessThanOrEqual(185);
      }
    }
  });
});
