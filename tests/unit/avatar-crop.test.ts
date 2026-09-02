import { describe, it, expect } from "vitest";
import { centerCropSquare } from "@/components/profile/AvatarPicker";
import { coverScale, clampPan, getCropSourceRect } from "@/components/profile/PhotoCropEditor";

describe("centerCropSquare", () => {
  it("landscape source crops the horizontal middle, full height", () => {
    expect(centerCropSquare(300, 150)).toEqual({ side: 150, sx: 75, sy: 0 });
  });

  it("portrait source crops the vertical middle, full width", () => {
    expect(centerCropSquare(150, 300)).toEqual({ side: 150, sx: 0, sy: 75 });
  });

  it("square source crops nothing", () => {
    expect(centerCropSquare(200, 200)).toEqual({ side: 200, sx: 0, sy: 0 });
  });

  it("wide landscape centers the crop with an integer sx", () => {
    expect(centerCropSquare(640, 360)).toEqual({ side: 360, sx: 140, sy: 0 });
  });
});

describe("coverScale", () => {
  it("scales a wide image so it covers a square viewport", () => {
    // 800x400 into a 200 viewport: height is the constraint (200/400 = 0.5).
    expect(coverScale(800, 400, 200)).toBeCloseTo(0.5, 6);
  });

  it("covers when the image is smaller than the viewport", () => {
    expect(coverScale(200, 100, 300)).toBeCloseTo(3, 6);
  });
});

describe("clampPan", () => {
  it("allows panning within the cover bounds", () => {
    // Wide image (800x400) cover-scaled: no vertical room at zoom 1 (H === view),
    // but horizontal room exists.
    const out = clampPan(50, 10, 800, 400, 200, 1);
    expect(out.tx).toBe(50);
    expect(out.ty).toBe(0);
  });

  it("clamps panning so the image never leaves a gap", () => {
    // Pushing far past the bound clamps to the cover edge.
    const out = clampPan(1000, 0, 800, 400, 200, 1);
    expect(out.tx).toBeCloseTo(100, 6); // (W - V)/2 with W=400 => 100
    expect(out.ty).toBe(0);
  });

  it("allows more pan when zoomed in", () => {
    const zoomedOut = clampPan(100000, 0, 800, 400, 200, 1);
    const zoomed = clampPan(100000, 0, 800, 400, 200, 2);
    expect(Math.abs(zoomed.tx)).toBeGreaterThan(Math.abs(zoomedOut.tx));
  });
});

describe("getCropSourceRect", () => {
  it("centered at zoom 1 maps to the centered square crop", () => {
    // 800x400 in a 200 viewport: the visible square is the vertical middle.
    const r = getCropSourceRect(800, 400, 200, 0, 0, 1);
    expect(r.src).toBeCloseTo(400, 6);
    expect(r.sx).toBeCloseTo(200, 6); // centered horizontally
    expect(r.sy).toBeCloseTo(0, 6);
  });

  it("panning right moves the source window left", () => {
    const r = getCropSourceRect(800, 400, 200, 50, 0, 1);
    expect(r.sx).toBeLessThan(200);
    expect(r.sy).toBeCloseTo(0, 6);
    expect(r.src).toBeCloseTo(400, 6);
  });

  it("zooming in shrinks the sampled source region", () => {
    const z1 = getCropSourceRect(800, 400, 200, 0, 0, 1);
    const z2 = getCropSourceRect(800, 400, 200, 0, 0, 2);
    expect(z2.src).toBeCloseTo(z1.src / 2, 6);
  });
});
