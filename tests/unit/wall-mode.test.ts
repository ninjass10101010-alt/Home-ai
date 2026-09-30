import { describe, expect, it } from "vitest";
import { computeWallMode, WALL_GRID_CLASS } from "@/lib/layout-config";

const WALL = { isPortrait: true, width: 1080, height: 1920, coarsePointer: true };

describe("computeWallMode", () => {
  it("auto-detects the portrait ApoloSign panel", () => {
    expect(computeWallMode({ ...WALL, manual: null, urlParam: null })).toBe(true);
  });

  it("does not auto-detect landscape panels (stands down)", () => {
    expect(computeWallMode({ ...WALL, isPortrait: false, manual: null, urlParam: null })).toBe(false);
  });

  it("does not auto-detect portrait phones (width too small)", () => {
    expect(computeWallMode({ ...WALL, width: 390, height: 844, manual: null, urlParam: null })).toBe(false);
  });

  it("does not auto-detect touchscreen laptops (fine pointer)", () => {
    expect(computeWallMode({ ...WALL, coarsePointer: false, manual: null, urlParam: null })).toBe(false);
  });

  it("?wall=1 forces on and ?wall=0 forces off (highest priority)", () => {
    expect(computeWallMode({ ...WALL, manual: false, urlParam: "1" })).toBe(true);
    expect(computeWallMode({ ...WALL, manual: true, urlParam: "0" })).toBe(false);
  });

  it("manual toggle wins over auto-detect", () => {
    expect(computeWallMode({ ...WALL, manual: false, urlParam: null })).toBe(false);
    expect(computeWallMode({ ...WALL, width: 390, height: 844, manual: true, urlParam: null })).toBe(true);
  });

  it("absent manual (null) falls through to auto-detect", () => {
    expect(computeWallMode({ ...WALL, manual: null, urlParam: null })).toBe(true);
    expect(computeWallMode({ ...WALL, width: 390, height: 844, manual: null, urlParam: null })).toBe(false);
  });
});

describe("WALL_GRID_CLASS", () => {
  it("is a 3-column bento whose rows flex to fill the wall canvas", () => {
    // Rows are viewport-derived (1fr under the flex-fit main), not fixed 440px:
    // a fixed row height overflowed the 1920px-tall panel by 1768px.
    expect(WALL_GRID_CLASS).toBe("wall-widget-grid grid grid-cols-3 gap-4 grid-flow-dense auto-rows-[minmax(220px,1fr)]");
  });
});
