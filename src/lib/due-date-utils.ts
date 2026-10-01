import { localTodayISO } from "@/lib/local-date";

/**
 * The LOCAL calendar day `days` from today.
 *
 * Two defects this replaces:
 *   1. `Date.now() + days * 86400000` is exact-24-hour arithmetic against a UTC
 *      instant, then serialized with `toISOString()` — a UTC date. In
 *      America/Detroit that is already "tomorrow" after 20:00 local, so every
 *      preset but `today` was a day ahead all evening.
 *   2. On the fall-back night, 20:30 Monday + 24h is 19:30 Monday *local* —
 *      still Monday — so `isoOffset(1)` returned the same date as
 *      `isoOffset(0)`.
 * `setDate` advances a real calendar day in the family timezone, so a 23- or
 * 25-hour DST day still moves exactly one day, and `localTodayISO` serializes
 * the result on the local axis.
 */
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localTodayISO(d);
}

/** `iso` advanced `days` local calendar days, or null for invalid input. */
export function addDaysISO(iso: string, days: number): string | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (typeof days !== "number" || !Number.isSafeInteger(days)) return null;
  const d = new Date(`${iso}T12:00:00`); // local noon — no UTC slicing
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return localTodayISO(d);
}

/** The next occurrence of a `Date#getDay()` weekday, as a local date. */
function nextWeekdayISO(targetDay: number): string {
  const today = new Date();
  const currentDay = today.getDay();
  let diff = targetDay - currentDay;
  if (diff < 0) diff += 7;
  return isoOffset(diff);
}

/**
 * The due-date presets, as getters so each read re-evaluates against the clock —
 * a `const` snapshot taken at module load would freeze "Today" at import time.
 */
export const getISO = {
  get today() { return localTodayISO(); },
  get tomorrow() { return isoOffset(1); },
  get thisWeek() { return isoOffset(6); },
  get fri() { return nextWeekdayISO(5); },
  get sat() { return nextWeekdayISO(6); },
  get sun() { return nextWeekdayISO(0); },
  get mon() { return nextWeekdayISO(1); },
  get tue() { return nextWeekdayISO(2); },
  get wed() { return nextWeekdayISO(3); },
  get thu() { return nextWeekdayISO(4); },
};

/** The 31-day due `<select>` list, walking local calendar days from today. */
export function getDueOptions(): { label: string; value: string }[] {
  const opts: { label: string; value: string }[] = [];

  for (let i = 0; i < 31; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = localTodayISO(d);
    let label: string;
    if (i === 0) label = "Today";
    else if (i === 1) label = "Tomorrow";
    else if (i <= 6) label = d.toLocaleDateString("en-US", { weekday: "short" });
    else label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    opts.push({ label, value: iso });
  }

  return opts;
}
