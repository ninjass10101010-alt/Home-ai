// Pure schedule-notification decision cores. No I/O, no Date.now() — the caller
// supplies `now` — so both are unit-testable and mirrorable by the cron routes.
import {
  CALENDAR_LEAD_MS,
  ROUTINE_LEAD_MS,
  withinQuietHours,
  type AlertedRef,
} from "@/lib/ha/alerts";
import { familyTimeZone } from "@/lib/local-date";
import {
  formatScheduleTime12h,
  scheduleCoversWeekday,
  scheduleTimeMinutes,
} from "@/lib/schedule-time";

export interface ScheduleAlert {
  id: string;
  title: string;
  time: string;
  minutesLeft: number;
}

function dateKeyInTz(now: Date, tz?: string): string {
  const zone = tz ?? familyTimeZone();
  return now.toLocaleString("en-CA", { timeZone: zone }).split(",")[0];
}

function prune(alerted: AlertedRef[], now: Date): AlertedRef[] {
  const horizon = now.getTime() - 48 * 60 * 60_000;
  return alerted.filter((a) => {
    const t = new Date(`${a.date}T23:59:00`).getTime();
    return isFinite(t) ? t > horizon : true;
  });
}

function merge(kept: AlertedRef[], fired: Array<{ id: string }>, dateKey: string): AlertedRef[] {
  const seen = new Set(kept.map((a) => `${a.id}|${a.date}`));
  const out = [...kept];
  for (const f of fired) {
    if (!seen.has(`${f.id}|${dateKey}`)) {
      out.push({ id: f.id, date: dateKey });
      seen.add(`${f.id}|${dateKey}`);
    }
  }
  return out;
}

export function routineLeadDecisions(input: {
  routines: Array<{ id: string; title?: string; time?: string; days?: string; notify?: boolean }>;
  now: Date;
  alerted: AlertedRef[];
  weekdayShort: string;
  weekdayIndex: number;
  leadMs?: number;
  tz?: string;
  dateKey?: string;
}): { alerts: ScheduleAlert[]; nextState: AlertedRef[] } {
  const leadMs = input.leadMs ?? ROUTINE_LEAD_MS;
  const quiet = withinQuietHours(input.now, input.tz);
  const dateKey = input.dateKey ?? dateKeyInTz(input.now, input.tz);
  const alertedSet = new Set(input.alerted.map((a) => `${a.id}|${a.date}`));
  const nowM = input.now.getHours() * 60 + input.now.getMinutes();
  const leadMin = leadMs / 60000;

  const fired: ScheduleAlert[] = [];
  for (const s of input.routines) {
    if (s.notify !== true) continue;
    if (!scheduleCoversWeekday(s.days, input.weekdayShort, input.weekdayIndex)) continue;
    if (alertedSet.has(`${s.id}|${dateKey}`)) continue;
    const mins = scheduleTimeMinutes(s.time);
    if (mins == null) continue;
    const delta = mins - nowM;
    if (delta > 0 && delta <= leadMin && !quiet) {
      fired.push({
        id: s.id,
        title: s.title || "Routine",
        time: formatScheduleTime12h(s.time),
        minutesLeft: Math.round(delta),
      });
    }
  }
  const kept = prune(input.alerted, input.now);
  return { alerts: fired, nextState: merge(kept, fired, dateKey) };
}

export function eventNotifyDecisions(input: {
  events: Array<{ id: string; title: string; date: string; time?: string; notify?: boolean }>;
  now: Date;
  alerted: AlertedRef[];
  todayISO?: string;
  leadMs?: number;
  tz?: string;
}): { alerts: ScheduleAlert[]; nextState: AlertedRef[] } {
  const leadMs = input.leadMs ?? CALENDAR_LEAD_MS;
  const quiet = withinQuietHours(input.now, input.tz);
  const todayISO = input.todayISO ?? dateKeyInTz(input.now, input.tz);
  const alertedSet = new Set(input.alerted.map((a) => `${a.id}|${a.date}`));

  const fired: ScheduleAlert[] = [];
  for (const e of input.events) {
    if (e.notify !== true) continue;
    if (e.date !== todayISO) continue;
    if (alertedSet.has(`${e.id}|${e.date}`)) continue;
    const mins = scheduleTimeMinutes(e.time);
    if (mins == null) continue;
    // Local-family-time parse: new Date(`${date}T00:00:00`) resolves in the
    // process's local zone (mirrors startMsForEvent in alerts.ts). Do not
    // reinterpret as UTC.
    const start = new Date(`${e.date}T00:00:00`);
    start.setMinutes(mins);
    // setMinutes on midnight with mins > 1439? scheduleTimeMinutes max 1439 (23:59), okay.
    const delta = start.getTime() - input.now.getTime();
    if (delta > 0 && delta <= leadMs && !quiet) {
      fired.push({
        id: e.id,
        title: e.title,
        time: formatScheduleTime12h(e.time),
        minutesLeft: Math.round(delta / 60000),
      });
    }
  }
  const kept = prune(input.alerted, input.now);
  return { alerts: fired, nextState: merge(kept, fired, todayISO) };
}
