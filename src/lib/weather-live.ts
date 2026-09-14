import { getServiceConfig } from "@/lib/services/config";

export interface LiveWeatherSummary {
  tempF: number; feelsLikeF: number; highF: number; lowF: number;
  condition: string; precipProb: number;
}

const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
};

export async function fetchLiveWeather(): Promise<{ ok: true; data: LiveWeatherSummary } | { ok: false; error: string }> {
  try {
    const lat = (await getServiceConfig("weather_location", "LAT")) || process.env.LAT || "42.7875";
    const lon = (await getServiceConfig("weather_location", "LON")) || process.env.LON || "-86.1089";
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
      + "&current=temperature_2m,apparent_temperature,weather_code"
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      + "&temperature_unit=fahrenheit&forecast_days=1&timezone=auto";
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `weather service ${res.status}` };
    const j: any = await res.json();
    const c = j?.current, d = j?.daily;
    if (!c || !d) return { ok: false, error: "weather service malformed" };
    return {
      ok: true,
      data: {
        tempF: Math.round(Number(c.temperature_2m)),
        feelsLikeF: Math.round(Number(c.apparent_temperature)),
        highF: Math.round(Number(d.temperature_2m_max?.[0])),
        lowF: Math.round(Number(d.temperature_2m_min?.[0])),
        condition: WMO[Number(c.weather_code)] ?? `Conditions code ${c.weather_code}`,
        precipProb: Number(d.precipitation_probability_max?.[0] ?? 0),
      },
    };
  } catch (e: any) {
    return { ok: false, error: `weather unavailable (${e?.message || "fetch failed"})` };
  }
}
