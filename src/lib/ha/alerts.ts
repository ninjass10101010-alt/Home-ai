import { severeFamily, type SevereKind } from "@/lib/weather-severity";
import { stormAdvice, snowAdvice } from "@/lib/weather-insights";
import { familyTimeZone } from "@/lib/local-date";

export const IMPORTANCE_THRESHOLD = 50;
export const CALENDAR_LEAD_MS = 60 * 60_000;
export const ROUTINE_LEAD_MS = 30 * 60_000;
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 7;

export type EpisodeState = {
  active: boolean;
  startedAtISO: string | null;
  family: SevereKind;
  alertedAtISO: string | null;
};
export type AlertedRef = { id: string; date: string };
export type CalendarAlert = { id: string; title: string; time: string; minutesLeft: number };

function hourInTz(now: Date, tz: string): number {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now)
  );
  return Number.isNaN(h) ? now.getHours() : h % 24;
}

export function withinQuietHours(now: Date, tz: string = familyTimeZone()): boolean {
  const h = hourInTz(now, tz);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

export function weatherEpisodeDecision(input: {
  code: number | null;
  severeEndISO: string | null;
  now: Date;
  state: EpisodeState;
  tz?: string;
}): { fire: boolean; title?: string; message?: string; nextState: EpisodeState } {
  const tz = input.tz ?? familyTimeZone();
  const family = input.code == null ? null : severeFamily(input.code);

  if (!family) {
    return { fire: false, nextState: { active: false, startedAtISO: null, family: null, alertedAtISO: null } };
  }

  // New episode: not active, or a different severe family than the active one.
  const episode: EpisodeState =
    !input.state.active || input.state.family !== family
      ? { active: true, startedAtISO: input.now.toISOString(), family, alertedAtISO: null }
      : input.state;

  if (episode.alertedAtISO) return { fire: false, nextState: episode };
  if (withinQuietHours(input.now, tz)) return { fire: false, nextState: episode };

  const advice = family === "storm" ? stormAdvice(input.severeEndISO, false) : snowAdvice(input.severeEndISO, false);
  const emoji = family === "storm" ? "⛈️" : "❄️";
  return {
    fire: true,
    title: `${emoji} ${advice.headline}`,
    message: advice.detail,
    nextState: { ...episode, alertedAtISO: input.now.toISOString() },
  };
}

// Event times: "16:00" (24h) or "4:00 PM" (12h) — same grammar as weather-insights.
function parseEventMinutes(time: string): number | null {
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
  const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (m12[3].toUpperCase() === "PM") h += 12;
    return h * 60 + Number(m12[2]);
  }
  return null;
}

function startMsForEvent(date: string, time: string): number {
  const mins = parseEventMinutes(time);
  if (mins == null) return NaN;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  // Server-local parse; the container runs TZ=America/Detroit, matching how
  // events are stored. Do NOT apply a manual utc_offset.
  return new Date(`${date}T${h}:${m}:00`).getTime();
}

export function calendarLeadDecisions(input: {
  events: Array<{ id: string; title: string; date: string; time?: string; importanceScore?: number }>;
  now: Date;
  alerted: AlertedRef[];
  leadMs?: number;
  threshold?: number;
  tz?: string;
}): { alerts: CalendarAlert[]; nextState: AlertedRef[] } {
  const leadMs = input.leadMs ?? CALENDAR_LEAD_MS;
  const threshold = input.threshold ?? IMPORTANCE_THRESHOLD;
  const tz = input.tz ?? familyTimeZone();
  const alertedSet = new Set(input.alerted.map((a) => `${a.id}|${a.date}`));
  const quiet = withinQuietHours(input.now, tz);

  const fired: Array<CalendarAlert & { date: string }> = [];
  for (const e of input.events) {
    if ((e.importanceScore ?? 0) < threshold) continue;
    if (alertedSet.has(`${e.id}|${e.date}`)) continue;
    if (!e.time) continue;
    const start = startMsForEvent(e.date, e.time);
    if (!isFinite(start)) continue;
    const delta = start - input.now.getTime();
    if (delta > 0 && delta <= leadMs && !quiet) {
      fired.push({ id: e.id, title: e.title, time: e.time, date: e.date, minutesLeft: Math.round(delta / 60_000) });
    }
  }

  // Prune refs whose events started > 48h ago so the row stays bounded.
  const horizon = input.now.getTime() - 48 * 60 * 60_000;
  const kept: AlertedRef[] = input.alerted.filter((a) => {
    const st = new Date(`${a.date}T23:59:00`).getTime();
    return isFinite(st) ? st > horizon : true;
  });
  const next = [...kept];
  const seen = new Set(next.map((a) => `${a.id}|${a.date}`));
  for (const f of fired) if (!seen.has(`${f.id}|${f.date}`)) next.push({ id: f.id, date: f.date });

  const alerts: CalendarAlert[] = fired.map(({ date: _date, ...rest }) => rest);
  return { alerts, nextState: next };
}
