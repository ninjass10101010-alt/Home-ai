import { describe, it, expect } from "vitest";
import { severeFamily, HEAVY_SNOW_CODES } from "@/lib/weather-severity";

describe("severeFamily", () => {
  it("flags storm at WMO >= 95", () => {
    expect(severeFamily(95)).toBe("storm");
    expect(severeFamily(96)).toBe("storm");
    expect(severeFamily(99)).toBe("storm");
  });
  it("flags heavy snow at 73/75/85/86", () => {
    for (const c of [73, 75, 85, 86]) expect(severeFamily(c)).toBe("snow");
  });
  it("returns null for mild codes (drizzle, light snow, cloudy)", () => {
    for (const c of [0, 1, 3, 51, 61, 71, 80, 94]) expect(severeFamily(c)).toBeNull();
  });
  it("exposes the snow code set unchanged", () => {
    expect([...HEAVY_SNOW_CODES].sort()).toEqual([73, 75, 85, 86]);
  });
});
