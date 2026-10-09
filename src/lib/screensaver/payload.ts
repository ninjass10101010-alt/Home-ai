/**
 * Impure half of the screensaver composer: PocketBase reads + Open-Meteo.
 * PB failure THROWS (route → 503); weather failure degrades to null.
 * Caches: whole payload 45s (wall display polls 60s; several displays must
 * not stampede PB), weather 15 min (matches the widget's refresh rhythm).
 */
import { withAdmin } from "@/lib/pb-auth";
import { getServiceConfig } from "@/lib/services/config";
import { localTodayISO, localWeekdayShort, localWeekStartISO } from "@/lib/local-date";
import { weekStartForDate } from "@/lib/meals-week-utils";
import { dinnerForToday } from "@/lib/consuela/chat-context";
import { readCanonicalTasks, type CanonicalTaskRead } from "@/lib/consuela/live-reads";
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
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
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
  // A missing/NaN daily high/low is a weather FAILURE, not a null temp: the
  // old `?? NaN` passed the number type, JSON-serialized to null ("H null°"),
  // AND cached the broken object for 15 min. Throw → caller degrades to null
  // and nothing lands in wxCache.
  const hi = j.daily?.temperature_2m_max?.[0];
  const lo = j.daily?.temperature_2m_min?.[0];
  if (typeof hi !== "number" || !Number.isFinite(hi) || typeof lo !== "number" || !Number.isFinite(lo)) {
    throw new Error("open-meteo: missing daily max/min");
  }
  const wx = {
    tempF: Math.round(temp),
    hiF: Math.round(hi),
    loF: Math.round(lo),
    condition: wxConditionLabel(j.current?.weather_code ?? -1),
  };
  wxCache = { at: now.getTime(), wx };
  return wx;
}

function choreRowsFor(read: CanonicalTaskRead): Array<{ status: string; completed?: boolean; completedAt?: string; completedInWeek?: string; due?: string }> {
  return read.tasks.map((task: any) => ({
    status: task.completed === true ? "done" : "pending",
    completed: task.completed === true,
    completedAt: task.completedAt,
    completedInWeek: task.completedInWeek,
    due: task.due,
  }));
}

export async function composeScreensaverPayload(now: Date = new Date()): Promise<ScreensaverPayload> {
  if (payloadCache && now.getTime() - payloadCache.at < PAYLOAD_TTL_MS) return payloadCache.payload;

  const today = localTodayISO(now);
  const wk = localWeekStartISO(now);
  const weekStart = weekStartForDate(today);
  const weekEnd = addDaysISO(weekStart, 6);

  const [[familyEvents, googleEvents, meals, briefingRows], taskRead] = await Promise.all([
    // One admin session, four reads. A throw here means PB is down → caller 503s.
    // The Google read is unfiltered on purpose: the collection is
    // sync-window-bounded (~30d back / 90d fwd) so the list stays small, and a
    // `start_iso~"today"` contains-match could never express multi-day coverage
    // — `selectTodayEvents` filters by covered day via `googleEventCoversDay`.
    withAdmin(async (pb) =>
      Promise.all([
        pb.collection("events").getFullList({ filter: `date="${today}"`, requestKey: null }),
        pb.collection("consuela_google_calendar_events").getFullList({ requestKey: null }),
        pb.collection("meal_plan_entries").getFullList({ filter: `weekOf="${weekStart}"`, requestKey: null }),
        pb.collection("morning_briefing").getFullList({ filter: `scopeDate="${today}"`, requestKey: null }),
      ])
    ),
    readCanonicalTasks(),
  ]);
  if (taskRead.source === "unavailable") throw new Error("task_data_unavailable");

  const weather = await fetchWeather(now).catch(() => null);
  const summary =
    (briefingRows[0] as
      | {
          summary?: {
            events?: unknown[];
            tasks?: unknown[];
            suggestions?: Array<{ title?: string }>;
            taskSource?: string;
          };
        }
      | undefined)?.summary ?? null;

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
    tasks: choreProgress(choreRowsFor(taskRead), wk, weekEnd, today),
    briefing: briefingDigest(summary),
    weather,
  };
  payloadCache = { at: now.getTime(), payload };
  return payload;
}
