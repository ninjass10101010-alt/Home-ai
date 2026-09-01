export interface GoogleEventRow {
  google_id: string;
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

export function mapGoogleEvent(ge: GoogleEventRow): MappedGoogleEvent | null {
  const d = parseGoogleStart(ge.start_iso || "", !!ge.all_day);
  if (!d) return null;
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const time = ge.all_day
    ? "All day"
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return {
    id: `g_${ge.google_id}_${day}_${month + 1}_${year}_${time}`,
    title: ge.summary || "(no title)",
    time,
    member: "Google",
    color: "cyan",
    emoji: "\uD83D\uDCC5",
    day,
    month,
    year,
  };
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
