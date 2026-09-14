import { getServiceConfig } from "@/lib/services/config";

export interface LiveWeatherSummary {
  tempF: number; feelsLikeF?: number; highF?: number; lowF?: number;
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
    // Provider nulls must NOT coerce through Number() (Number(null) === 0 —
    // a fabricated 0° reading). Only finite numbers count.
    const toFinite = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const temp = toFinite(c.temperature_2m);
    if (temp === null) return { ok: false, error: "weather service malformed" }; // a reading with no temperature is not a reading
    const data: LiveWeatherSummary = {
      tempF: Math.round(temp),
      condition: WMO[Number(c.weather_code)] ?? `Conditions code ${c.weather_code}`,
      precipProb: Number(d.precipitation_probability_max?.[0] ?? 0),
    };
    const feelsLike = toFinite(c.apparent_temperature);
    if (feelsLike !== null) data.feelsLikeF = Math.round(feelsLike);
    const high = toFinite(d.temperature_2m_max?.[0]);
    if (high !== null) data.highF = Math.round(high);
    const low = toFinite(d.temperature_2m_min?.[0]);
    if (low !== null) data.lowF = Math.round(low);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: `weather unavailable (${e?.message || "fetch failed"})` };
  }
}
