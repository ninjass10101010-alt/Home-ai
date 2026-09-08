// Pure schedule-time helpers shared by the db read paths (pb-db.ts +
// db/index.ts) and the Calendar page. The schedule form stores 12-hour
// strings ("8:00 AM") while legacy rows store 24-hour ("08:00") — the old
// `new Date("2000-01-01T" + time)` format path produced Invalid Date for
// every 12-hour value, and `localeCompare` sorted 10:00 AM before 8:00 AM.
// Both formats parse here; anything unparseable passes through untouched.

const TIME_12H = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const TIME_24H = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight, or null when the string is not a known format. */
export function scheduleTimeMinutes(time: unknown): number | null {
  const s = String(time ?? "").trim();
  if (!s) return null;
  const m12 = s.match(TIME_12H);
  if (m12) {
    const h = parseInt(m12[1], 10);
    const m = parseInt(m12[2], 10);
    if (h < 1 || h > 12 || m > 59) return null;
    let hh = h % 12;
    if (m12[3].toUpperCase() === "PM") hh += 12;
    return hh * 60 + m;
  }
  const m24 = s.match(TIME_24H);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  return null;
}

/** Canonical "H:MM AM/PM" display string; unparseable input passes through. */
export function formatScheduleTime12h(time: unknown): string {
  const s = String(time ?? "").trim();
  const minutes = scheduleTimeMinutes(s);
  if (minutes === null) return s || "";
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Does a routine's `days` scope cover a given weekday? The Calendar form
 * stores all/weekdays/weekends/friday; the old read path filtered with
 * `days.includes(weekdayShort)`, which never matched "weekdays"/"weekends"
 * (e.g. "weekdays".includes("tue") === false) so weekday routines silently
 * vanished from Home's Daily Schedule widget. `weekdayShort` ("mon".."sun")
 * remains supported for legacy raw values.
 */
export function scheduleCoversWeekday(days: unknown, weekdayShort: string, weekdayIndex: number): boolean {
  const d = String(days ?? "").trim().toLowerCase();
  if (!d) return true;
  if (d === "all") return true;
  if (d === "weekdays") return weekdayIndex >= 1 && weekdayIndex <= 5;
  if (d === "weekends") return weekdayIndex === 0 || weekdayIndex === 6;
  if (d === "friday") return weekdayIndex === 5;
  return d.includes(weekdayShort.toLowerCase());
}

/** Stable dedupe key for schedule rows across localStorage / PB. */
export function scheduleDedupeKey(row: { title?: unknown; time?: unknown; days?: unknown }): string {
  return `${String(row.title ?? "").trim().toLowerCase()}|${String(row.time ?? "").trim()}|${String(row.days ?? "").trim().toLowerCase()}`;
}
