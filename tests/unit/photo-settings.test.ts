// src/lib/photos/settings.ts — the pure normalizer + timing helpers
// (spec §1.1 "one normalizer, three callers" and §3.4 `commitDelayMs`).
// DOM-free by contract: this file must run in the plain node environment.
import { describe, it, expect } from "vitest";
import {
  PHOTO_SETTINGS_DEFAULTS,
  ROTATE_MIN_S,
  ROTATE_MAX_S,
  PHOTO_TRANSITIONS,
  PHOTO_ORDERS,
  CROSSFADE_MS,
  clampRotateSeconds,
  normalizePhotoSettings,
  formatRotateLabel,
  commitDelayMs,
  type PhotoSettings,
} from "@/lib/photos/settings";

const DEFAULTS: PhotoSettings = {
  rotateSeconds: 75,
  transition: "crossfade",
  order: "shuffle",
  showCaption: true,
};

describe("constants", () => {
  it("pins the shipped defaults (75 / crossfade / shuffle / caption on)", () => {
    expect(PHOTO_SETTINGS_DEFAULTS).toEqual(DEFAULTS);
  });

  it("pins the delay bounds and the crossfade budget", () => {
    expect(ROTATE_MIN_S).toBe(10);
    expect(ROTATE_MAX_S).toBe(600);
    expect(CROSSFADE_MS).toBe(600);
  });

  it("exposes the enum members the route validates against", () => {
    expect(PHOTO_TRANSITIONS).toEqual(["crossfade", "dissolve", "slide", "cut"]);
    expect(PHOTO_ORDERS).toEqual(["shuffle", "newest", "oldest"]);
  });
});

describe("clampRotateSeconds", () => {
  it("clamps out-of-range values into [10, 600]", () => {
    expect(clampRotateSeconds(5)).toBe(10);
    expect(clampRotateSeconds(-1)).toBe(10);
    expect(clampRotateSeconds(9999)).toBe(600);
    expect(clampRotateSeconds(10)).toBe(10);
    expect(clampRotateSeconds(600)).toBe(600);
    expect(clampRotateSeconds(75)).toBe(75);
  });

  it("falls back to 75 for anything that is not a finite number", () => {
    expect(clampRotateSeconds(Number.NaN)).toBe(75);
    expect(clampRotateSeconds(Infinity)).toBe(75);
    expect(clampRotateSeconds(-Infinity)).toBe(75);
    expect(clampRotateSeconds(undefined)).toBe(75);
    expect(clampRotateSeconds(null)).toBe(75);
    expect(clampRotateSeconds("120")).toBe(75);
    expect(clampRotateSeconds({})).toBe(75);
    expect(clampRotateSeconds(true)).toBe(75);
  });
});

describe("normalizePhotoSettings — total, never throws", () => {
  it("returns the defaults for undefined, null and non-object garbage", () => {
    expect(normalizePhotoSettings(undefined)).toEqual(DEFAULTS);
    expect(normalizePhotoSettings(null)).toEqual(DEFAULTS);
    expect(normalizePhotoSettings("wall")).toEqual(DEFAULTS);
    expect(normalizePhotoSettings(42)).toEqual(DEFAULTS);
    expect(normalizePhotoSettings([])).toEqual(DEFAULTS);
    expect(normalizePhotoSettings(() => {})).toEqual(DEFAULTS);
    expect(normalizePhotoSettings({ unknown: 1 })).toEqual(DEFAULTS);
  });

  it("fills the gaps of a partial row from the defaults", () => {
    expect(normalizePhotoSettings({ transition: "dissolve" })).toEqual({
      ...DEFAULTS,
      transition: "dissolve",
    });
    expect(normalizePhotoSettings({ rotateSeconds: 30, showCaption: false })).toEqual({
      ...DEFAULTS,
      rotateSeconds: 30,
      showCaption: false,
    });
  });

  it("clamps rotateSeconds on read (5 → 10, 9999 → 600, 75 → 75)", () => {
    expect(normalizePhotoSettings({ rotateSeconds: 5 }).rotateSeconds).toBe(10);
    expect(normalizePhotoSettings({ rotateSeconds: 9999 }).rotateSeconds).toBe(600);
    expect(normalizePhotoSettings({ rotateSeconds: 75 }).rotateSeconds).toBe(75);
    expect(normalizePhotoSettings({ rotateSeconds: "90" }).rotateSeconds).toBe(75);
    expect(normalizePhotoSettings({ rotateSeconds: Number.NaN }).rotateSeconds).toBe(75);
  });

  it("falls back to the default enum member on an unrecognised value", () => {
    expect(normalizePhotoSettings({ transition: "spin" }).transition).toBe("crossfade");
    expect(normalizePhotoSettings({ transition: 7 }).transition).toBe("crossfade");
    expect(normalizePhotoSettings({ order: "random" }).order).toBe("shuffle");
    expect(normalizePhotoSettings({ order: null }).order).toBe("shuffle");
    expect(normalizePhotoSettings({ transition: "slide", order: "oldest" })).toEqual({
      ...DEFAULTS,
      transition: "slide",
      order: "oldest",
    });
  });

  it("coerces showCaption: only a literal boolean survives, else the default true", () => {
    expect(normalizePhotoSettings({ showCaption: false }).showCaption).toBe(false);
    expect(normalizePhotoSettings({ showCaption: true }).showCaption).toBe(true);
    // Non-booleans fall back to the default (true), they never become false —
    // `"false"`/`0` from a hand-edited row must not silently mute the wall.
    expect(normalizePhotoSettings({ showCaption: "false" }).showCaption).toBe(true);
    expect(normalizePhotoSettings({ showCaption: 0 }).showCaption).toBe(true);
    expect(normalizePhotoSettings({ showCaption: 1 }).showCaption).toBe(true);
    expect(normalizePhotoSettings({ showCaption: null }).showCaption).toBe(true);
    expect(normalizePhotoSettings({ showCaption: "yes" }).showCaption).toBe(true);
  });

  it("normalises a whole hand-edited row into a valid shape", () => {
    expect(
      normalizePhotoSettings({
        id: "rec1",
        key: "wall",
        rotateSeconds: 9999,
        transition: "warp",
        order: "newest",
        showCaption: "false",
      }),
    ).toEqual({
      rotateSeconds: 600,
      transition: "crossfade",
      order: "newest",
      showCaption: true,
    });
  });

  it("does not alias the defaults object (a caller mutating the result cannot corrupt them)", () => {
    const out = normalizePhotoSettings(undefined);
    out.rotateSeconds = 999;
    expect(PHOTO_SETTINGS_DEFAULTS.rotateSeconds).toBe(75);
    expect(normalizePhotoSettings(undefined).rotateSeconds).toBe(75);
  });
});

describe("formatRotateLabel", () => {
  it.each([
    [10, "10s"],
    [45, "45s"],
    [59, "59s"],
    [60, "1m"],
    [75, "1m 15s"],
    [120, "2m"],
    [150, "2m 30s"],
    [300, "5m"],
    [600, "10m"],
    [610, "10m 10s"],
  ])("formats %d seconds as %s", (seconds, label) => {
    expect(formatRotateLabel(seconds)).toBe(label);
  });
});

describe("commitDelayMs", () => {
  it("holds today's crossfade/slide budget (600 + 120 = 720)", () => {
    expect(commitDelayMs("crossfade", false)).toBe(720);
    expect(commitDelayMs("slide", false)).toBe(720);
  });

  it("commits dissolve at the veil peak (300) and cut immediately (0)", () => {
    expect(commitDelayMs("dissolve", false)).toBe(300);
    expect(commitDelayMs("cut", false)).toBe(0);
  });

  it("reduced motion is 0 for EVERY transition, not the old 60ms", () => {
    expect(commitDelayMs("crossfade", true)).toBe(0);
    expect(commitDelayMs("dissolve", true)).toBe(0);
    expect(commitDelayMs("slide", true)).toBe(0);
    expect(commitDelayMs("cut", true)).toBe(0);
  });
});
