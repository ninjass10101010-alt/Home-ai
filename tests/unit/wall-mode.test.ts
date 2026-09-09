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
  it("is a 2-column 440px-row bento", () => {
    expect(WALL_GRID_CLASS).toBe("grid grid-cols-2 gap-6 grid-flow-dense auto-rows-[440px]");
  });
});
