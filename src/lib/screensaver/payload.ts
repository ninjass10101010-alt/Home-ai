/**
 * Impure half of the screensaver composer: PocketBase reads + Open-Meteo.
 * PB failure THROWS (route → 503); weather failure degrades to null.
 * Caches: whole payload 45s (wall display polls 60s; several displays must
 * not stampede PB), weather 15 min (matches the widget's refresh rhythm).
 */
import { withAdmin } from "@/lib/pb-auth";
import { getServiceConfig } from "@/lib/services/config";
import { localTodayISO, localWeekdayShort } from "@/lib/local-date";
import { weekKey } from "@/lib/task-utils";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { dinnerForToday } from "@/lib/consuela/chat-context";
import {
  selectTodayEvents,
  choreProgress,
  briefingDigest,
  wxConditionLabel,
  type ScreensaverPayload,
} from "./compose";

const PAYLOAD_TTL_MS = 45_000;
const WX_TTL_MS = 15 * 60_000;

let payloadCache: { at: number; payload: ScreensaverPayload } | null = null;
let wxCache: { at: number; wx: ScreensaverPayload["weather"] } | null = null;

/** Test seam — caches are module state so vitest cases must start clean. */
export function __resetScreensaverCaches(): void {
  payloadCache = null;
  wxCache = null;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleString("en-CA", { timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone }).split(",")[0];
}

async function fetchWeather(now: Date): Promise<ScreensaverPayload["weather"]> {
  if (wxCache && now.getTime() - wxCache.at < WX_TTL_MS) return wxCache.wx;
  const lat = (await getServiceConfig("weather_location", "LAT")) || "42.7875";
  const lon = (await getServiceConfig("weather_location", "LON")) || "-86.1089";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const temp = j.current?.temperature_2m;
  if (typeof temp !== "number") throw new Error("open-meteo: missing current temp");
  const wx = {
    tempF: Math.round(temp),
    hiF: Math.round(j.daily?.temperature_2m_max?.[0] ?? NaN),
    loF: Math.round(j.daily?.temperature_2m_min?.[0] ?? NaN),
    condition: wxConditionLabel(j.current?.weather_code ?? -1),
  };
  wxCache = { at: now.getTime(), wx };
  return wx;
}

export async function composeScreensaverPayload(now: Date = new Date()): Promise<ScreensaverPayload> {
  if (payloadCache && now.getTime() - payloadCache.at < PAYLOAD_TTL_MS) return payloadCache.payload;

  const today = localTodayISO(now);
  const wk = weekKey(now);
  const weekStart = weekStartForDate(today);
  const weekEnd = addDaysISO(weekStart, 6);

  // One admin session, five reads. A throw here means PB is down → caller 503s.
  const [familyEvents, googleEvents, tasks, meals, briefingRows] = await withAdmin(async (pb) =>
    Promise.all([
      pb.collection("events").getFullList({ filter: `date="${today}"`, requestKey: null }),
      pb.collection("consuela_google_calendar_events").getFullList({ filter: `start_iso~"${today}"`, requestKey: null }),
      pb.collection("tasks").getFullList({ requestKey: null }),
      pb.collection("meal_plan_entries").getFullList({ filter: `weekOf="${weekStart}"`, requestKey: null }),
      pb.collection("morning_briefing").getFullList({ filter: `scopeDate="${today}"`, requestKey: null }),
    ])
  );

  const weather = await fetchWeather(now).catch(() => null);
  const summary = (briefingRows[0] as { summary?: never } | undefined)?.summary ?? null;

  const payload: ScreensaverPayload = {
    ok: true,
    generatedAt: now.toISOString(),
    date: today,
    events: selectTodayEvents(familyEvents as never, googleEvents as never, today, now),
    dinner: dinnerForToday(
      (meals as unknown as Array<{ name: string; mealType?: string; time: string; weekOf?: string }>).map(
        (m) => ({ name: m.name, mealType: m.mealType, time: m.time, weekOf: m.weekOf })
      ),
      weekStart,
      localWeekdayShort(now)
    ),
    tasks: choreProgress(tasks as never, wk, weekEnd),
    briefing: briefingDigest(summary as never),
    weather,
  };
  payloadCache = { at: now.getTime(), payload };
  return payload;
}
