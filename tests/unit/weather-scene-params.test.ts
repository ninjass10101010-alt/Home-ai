import { describe, it, expect } from "vitest";
import { cloudVariant, backCloudVariant, starOpacity } from "@/lib/weather-scene-params";

describe("cloudVariant", () => {
  it("null cover renders the plainest form", () => expect(cloudVariant(null)).toBe(0));
  it("scales with measured cover at 34/67 boundaries", () => {
    expect(cloudVariant(0)).toBe(0);
    expect(cloudVariant(33)).toBe(0);
    expect(cloudVariant(34)).toBe(1);
    expect(cloudVariant(66)).toBe(1);
    expect(cloudVariant(67)).toBe(2);
    expect(cloudVariant(100)).toBe(2);
  });
});

describe("backCloudVariant", () => {
  it("is one step denser than the front, capped at 2", () => {
    expect(backCloudVariant(0)).toBe(1);
    expect(backCloudVariant(1)).toBe(2);
    expect(backCloudVariant(2)).toBe(2);
  });
});

describe("starOpacity", () => {
  it("unknown cover does not dim", () => expect(starOpacity(null)).toBe(1));
  it("heavy cover dims rather than hides", () => {
    expect(starOpacity(0)).toBe(1);
    expect(starOpacity(60)).toBe(1);
    expect(starOpacity(61)).toBe(0.45);
    expect(starOpacity(100)).toBe(0.45);
  });
});
