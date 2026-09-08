export interface GoogleEventRow {
  google_id: string;
  calendar_id?: string;
  summary?: string;
  start_iso?: string;
  all_day?: boolean;
}

export interface MappedGoogleEvent {
  id: string;
  title: string;
  time: string;
  member: "Google";
  color: "cyan";
  emoji: string;
  day: number;
  month: number;
  year: number;
  // Raw Google event id + owning calendar — the client reads these instead
  // of parsing the composite id string (startEditEvent used to split("_")[1],
  // which breaks the moment a calendar token joins the id).
  googleId: string;
  calendarId: string;
  // Google's per-calendar colorRgb (e.g. "#616161") when the caller passes a
  // calendarId→color map; the page paints --event-color with it, falling
  // back to the named `color` ("cyan").
  colorHex?: string;
}

export function parseGoogleStart(startIso: string, allDay: boolean): Date | null {
  if (!startIso) return null;
  let d: Date;
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(startIso)) {
    const [y, m, dd] = startIso.split("-").map(Number);
    d = new Date(y, m - 1, dd);
  } else {
    d = new Date(startIso);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

// Short stable token for a non-primary calendar id (they're email-ish and far
// too long to embed raw in a client id). djb2 → base36.
function calendarToken(calendarId: string): string {
  let h = 5381;
  for (let i = 0; i < calendarId.length; i++) {
    h = ((h << 5) + h + calendarId.charCodeAt(i)) >>> 0;
  }
  return `c${h.toString(36)}`;
}

// Id shape: primary/legacy rows keep the original
// `g_{google_id}_{day}_{month}_{year}_{time}` (no churn for the 67 cached
// events already in device localStorage); events from any other calendar get
// a `c{hash}_` segment so the same google_id synced into two calendars yields
// two distinct client ids instead of a React-key collision.
export function mapGoogleEvent(
  ge: GoogleEventRow,
  colorMap?: Record<string, string> | null,
): MappedGoogleEvent | null {
  const d = parseGoogleStart(ge.start_iso || "", !!ge.all_day);
  if (!d) return null;
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const time = ge.all_day
    ? "All day"
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const calendarId = ge.calendar_id || "primary";
  const prefix = calendarId === "primary" ? "" : `${calendarToken(calendarId)}_`;
  const colorHex = colorMap?.[calendarId];
  const mapped: MappedGoogleEvent = {
    id: `g_${prefix}${ge.google_id}_${day}_${month + 1}_${year}_${time}`,
    title: ge.summary || "(no title)",
    time,
    member: "Google",
    color: "cyan",
    emoji: "\uD83D\uDCC5",
    day,
    month,
    year,
    googleId: ge.google_id,
    calendarId,
  };
  if (colorHex) mapped.colorHex = colorHex;
  return mapped;
}

export function eventInMonth(
  e: { day: number; month?: number; year?: number },
  month: number,
  year: number
): boolean {
  if (e.month == null || e.year == null) return true;
  return e.month === month && e.year === year;
}

export interface DbEventRow {
  id: string;
  title?: string;
  date?: string;
  time?: string;
  icon?: string;
  color?: string;
  member?: string;
}

export interface MappedDbEvent {
  id: string;
  title: string;
  time: string;
  member: string;
  color: string;
  emoji: string;
  day: number;
  month: number;
  year: number;
}

// Maps a PocketBase `events` row (manually added family events) to the
// calendar page's CalEvent shape. Date-only strings are parsed as local
// dates so the day never shifts across timezones.
export function dbEventToCalEvent(row: DbEventRow | null | undefined): MappedDbEvent | null {
  if (!row?.title || !row.date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.date);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  return {
    id: row.id,
    title: row.title,
    time: row.time || "All day",
    member: row.member || "All",
    color: row.color || "green",
    emoji: row.icon || "\uD83D\uDCC5",
    day: d,
    month: mo - 1,
    year: y,
  };
}

export interface DbScheduleRow {
  id: string;
  title?: string;
  time?: string;
  days?: string;
  type?: string;
  icon?: string;
  color?: string;
  member?: string;
  mealType?: string;
}

export interface MappedDbSchedule {
  id: string;
  title: string;
  time: string;
  days: string;
  type: "routine" | "reminder";
  icon: string;
  color: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack" | "none";
  member?: string;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

// Maps a PocketBase `schedules` row to the Calendar page's ScheduleItem
// shape. Legacy rows may lack mealType/days (the DB gateway returns whatever
// the row holds); anything unmapped falls back to the form's defaults so a
// row never crashes the tab.
export function dbScheduleToScheduleItem(row: DbScheduleRow | null | undefined): MappedDbSchedule | null {
  if (!row?.title || !row.time) return null;
  const mealType = MEAL_TYPES.includes(row.mealType as any)
    ? (row.mealType as MappedDbSchedule["mealType"])
    : "none";
  return {
    id: row.id,
    title: row.title,
    time: row.time,
    days: row.days || "all",
    type: row.type === "reminder" ? "reminder" : "routine",
    icon: row.icon || "⏰",
    color: row.color || "green",
    mealType,
    member: row.member || "",
  };
}
