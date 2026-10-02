import { it, expect } from "vitest";
import { WEATHER_MATERIAL } from "@/lib/weather-skins/types";
import { getWeatherSkin } from "@/components/ui/WeatherSkins";
import { SKY, INK } from "@/components/ui/wx-tokens";
import { contrastRatio } from "@/lib/weather-contrast";
it("WEATHER_MATERIAL is monster", () => expect(WEATHER_MATERIAL).toBe("monster"));
it("getWeatherSkin still returns a skin for each condition (monster washes)", () => {
  for (const code of [0,3,45,61,71,95]) {
    const skin = getWeatherSkin("summer", false, code);
    expect(skin.skyGradient).toBeDefined();
  }
});
it("every stop of every SKY wash is ≥ 4.5:1 vs its ink", () => {
  for (const [k, cls] of Object.entries(SKY)) {
    const stops = [...cls.matchAll(/#([0-9a-f]{6})/gi)].map((m) => `#${m[1]}`);
    expect(stops.length, k).toBeGreaterThanOrEqual(3);
    const ink = INK[k] === "text-white" ? "#FFFFFF" : "#1E293B";
    for (const stop of stops) {
      expect(contrastRatio(ink, stop), `${k} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
