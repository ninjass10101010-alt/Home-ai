import { getServiceConfig } from "@/lib/services/config";
import { severeFamily } from "@/lib/weather-severity";

/** Read Open-Meteo and reduce to the two facts the alert cron needs:
 *  the current-hour WMO code, and the first future hour whose severe family
 *  differs from now's (the "clearing by" time). Throws on fetch/shape failure —
 *  the caller degrades. */
export async function readSevereWeather(
  now: Date = new Date()
): Promise<{ code: number | null; severeEndISO: string | null }> {
  const lat = (await getServiceConfig("weather_location", "LAT")) || "42.7875";
  const lon = (await getServiceConfig("weather_location", "LON")) || "-86.1089";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=weather_code&hourly=weather_code&forecast_days=1&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = (await res.json()) as {
    current?: { weather_code?: number };
    hourly?: { time?: string[]; weather_code?: number[] };
  };
  const code = typeof j.current?.weather_code === "number" ? j.current.weather_code : null;
  const nowFam = code == null ? null : severeFamily(code);
  let severeEndISO: string | null = null;
  if (nowFam) {
    const times = j.hourly?.time ?? [];
    const codes = j.hourly?.weather_code ?? [];
    const nowMs = now.getTime();
    for (let i = 0; i < times.length; i++) {
      if (new Date(times[i]).getTime() <= nowMs) continue;
      if (severeFamily(codes[i] ?? 0) !== nowFam) {
        severeEndISO = times[i];
        break;
      }
    }
  }
  return { code, severeEndISO };
}
