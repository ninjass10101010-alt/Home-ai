// Local-date helper for suggestion/briefing scope dates.
//
// I7 — the dashboard runs on a host whose local day may differ from UTC
// (e.g. Pacific time: 23:00 PT is 06:00 UTC tomorrow). Suggestions and the
// morning briefing are "what's relevant TODAY" in the family's local timezone,
// so they must be anchored to the local calendar date, not the UTC date.
//
// `toLocaleString("en-CA", ...)` formats as YYYY-MM-DD, so splitting on "," is
// deterministic across Node and browsers.
import { weekStartForDate } from "@/lib/meals-week-utils";

export function localTodayISO(now: Date = new Date()): string {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return now.toLocaleString("en-CA", { timeZone: tz }).split(",")[0];
}

export function localPreviousDayISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export function familyTimeZone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function localWeekdayShort(now: Date = new Date()): string {
  return now.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function weekdayOfISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleString("en-US", { timeZone: familyTimeZone(), weekday: "short" });
}

export function localWeekStartISO(now: Date = new Date()): string {
  // Single source of truth for week-start math (see meals-week-utils.ts).
  // weekStartForDate serializes from LOCAL date parts, so it is correct in any timezone.
  return weekStartForDate(localTodayISO(now));
}

export interface LocalDateContext {
  todayISO: string;
  todayWeekday: string;
  yesterdayISO: string;
  yesterdayWeekday: string;
  weekStartISO: string;
  tz: string;
}

export function localDateContext(now: Date = new Date()): LocalDateContext {
  const todayISO = localTodayISO(now);
  const yesterdayISO = localPreviousDayISO(todayISO);
  const tz = familyTimeZone();
  return {
    todayISO,
    todayWeekday: localWeekdayShort(now),
    yesterdayISO,
    yesterdayWeekday: weekdayOfISO(yesterdayISO),
    weekStartISO: localWeekStartISO(now),
    tz,
  };
}
