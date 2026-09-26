import { describe, it, expect } from "vitest";
import { skyPhase, skySceneKey } from "@/lib/weather-scene-params";

describe("skyPhase — night must win before dawn/dusk", () => {
  it("night wins even when clamped progress is 0 (the 4am case)", () => {
    expect(skyPhase(0, false)).toBe("night");
    expect(skyPhase(0.05, false)).toBe("night");
  });
  it("null progress yields no dawn or dusk", () => {
    expect(skyPhase(null, true)).toBe("day");
    expect(skyPhase(null, false)).toBe("night");
  });
  it("fires dawn below 0.12 and dusk above 0.88", () => {
    expect(skyPhase(0, true)).toBe("dawn");
    expect(skyPhase(0.119, true)).toBe("dawn");
    expect(skyPhase(0.12, true)).toBe("day");
    expect(skyPhase(0.5, true)).toBe("day");
    expect(skyPhase(0.88, true)).toBe("day");
    expect(skyPhase(0.881, true)).toBe("dusk");
    expect(skyPhase(1, true)).toBe("dusk");
  });
});

describe("skySceneKey — only clear/cloudy gain phases", () => {
  it("precipitation scenes keep their own washes", () => {
    for (const scene of ["rain", "snow", "storm", "night"] as const) {
      expect(skySceneKey(scene, "dawn", false)).toBe(scene);
      expect(skySceneKey(scene, "dusk", false)).toBe(scene);
    }
  });
  it("heavySnow wins over everything", () => {
    expect(skySceneKey("snow", "dawn", true)).toBe("heavySnow");
    expect(skySceneKey("clear", "dusk", true)).toBe("heavySnow");
  });
  it("clear/cloudy adopt dawn/dusk, else stay themselves", () => {
    expect(skySceneKey("clear", "dawn", false)).toBe("dawn");
    expect(skySceneKey("cloudy", "dusk", false)).toBe("dusk");
    expect(skySceneKey("clear", "day", false)).toBe("clear");
    expect(skySceneKey("cloudy", "night", false)).toBe("cloudy");
  });
});
