import { WEATHER_MATERIAL } from "@/lib/weather-skins/types";
import { getWeatherSkin } from "@/components/ui/WeatherSkins";
it("WEATHER_MATERIAL is monster", () => expect(WEATHER_MATERIAL).toBe("monster"));
it("getWeatherSkin still returns a skin for each condition (monster washes)", () => {
  for (const code of [0,3,45,61,71,95]) {
    const skin = getWeatherSkin("summer", false, code);
    expect(skin.skyGradient).toBeDefined();
  }
});
