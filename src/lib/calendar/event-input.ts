import { familyTimeZone } from "@/lib/local-date";

export type EventInput = {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  member?: string;
  location?: string;
  notes?: string;
  notify?: boolean;
  icon?: string;
  color?: string;
};

export type NormalizedEvent = {
  title: string;
  date: string;
  time: string;
  endTime: string;
  allDay: boolean;
  member: string;
  location: string;
  notes: string;
  notify: boolean;
  icon: string;
  color: string;
};

export type PbEventRow = {
  id?: string;
  title: string;
  date: string;
  time: string;
  endTime?: string;
  allDay?: boolean;
  member: string;
  location?: string;
  notes?: string;
  notify?: boolean;
  icon?: string;
  color?: string;
  source?: string;
  googleEventId?: string;
  googleCalendarId?: string;
  googleSyncStatus?: string;
  googleSyncError?: string;
  googleSyncedAt?: string;
};

export const ALL_DAY_TIME = "All day";
export const DEFAULT_EVENT_MINUTES = 60;

export class EventValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "EventValidationError";
    this.field = field;
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isRealDateISO(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function nextDateISO(value: string): string {
  if (!isRealDateISO(value)) throw new EventValidationError("date", "Choose a real date.");
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function parseClockToHHMM(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toUpperCase();
  if (HHMM.test(value)) return value;
  const twelve = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!twelve) return null;
  const hour = Number(twelve[1]);
  const minute = Number(twelve[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = twelve[3] === "PM";
  const h = (hour % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function validateEventInput(
  input: EventInput,
  knownMembers?: string[],
): NormalizedEvent {
  const title = String(input.title ?? "").trim();
  if (!title) throw new EventValidationError("title", "Add a title.");
  if (title.length > 200) throw new EventValidationError("title", "Title is too long (200 characters max).");

  const date = String(input.date ?? "").trim();
  if (!isRealDateISO(date)) throw new EventValidationError("date", "Choose a real date.");

  const allDay = Boolean(input.allDay);
  const member = String(input.member ?? "").trim() || "All";
  if (member !== "All" && knownMembers && knownMembers.length > 0 && !knownMembers.includes(member)) {
    throw new EventValidationError("member", "Choose a family member from the list.");
  }

  const location = String(input.location ?? "").trim().slice(0, 200);
  const notes = String(input.notes ?? "").trim().slice(0, 2000);
  const icon = String(input.icon ?? "").trim().slice(0, 8) || "📅";
  const color = String(input.color ?? "").trim().slice(0, 16) || "green";

  if (allDay) {
    return { title, date, time: ALL_DAY_TIME, endTime: "", allDay: true, member, location, notes, notify: Boolean(input.notify), icon, color };
  }

  const start = parseClockToHHMM(input.startTime);
  if (!start) throw new EventValidationError("startTime", "Choose a real start time.");
  const rawEnd = String(input.endTime ?? "").trim();
  const end = rawEnd ? parseClockToHHMM(rawEnd) : addMinutes(start, DEFAULT_EVENT_MINUTES);
  if (!end) throw new EventValidationError("endTime", "Choose a real end time.");
  if (end <= start) throw new EventValidationError("endTime", "End time must be after the start time.");

  return { title, date, time: start, endTime: end, allDay: false, member, location, notes, notify: Boolean(input.notify), icon, color };
}

export function eventToPbRow(event: NormalizedEvent): PbEventRow {
  return {
    title: event.title,
    date: event.date,
    time: event.time,
    endTime: event.endTime,
    allDay: event.allDay,
    member: event.member,
    location: event.location,
    notes: event.notes,
    notify: event.notify,
    icon: event.icon,
    color: event.color,
    source: "family",
  };
}

export function rowToEventInput(row: Partial<PbEventRow>): EventInput & { id?: string } {
  const allDay = Boolean(row.allDay) || row.time === ALL_DAY_TIME;
  const start = allDay ? "" : parseClockToHHMM(row.time) ?? "";
  const end = allDay ? "" : parseClockToHHMM(row.endTime) ?? (start ? addMinutes(start, DEFAULT_EVENT_MINUTES) : "");
  return {
    id: row.id,
    title: row.title ?? "",
    date: row.date ?? "",
    startTime: start,
    endTime: end,
    allDay,
    member: row.member ?? "All",
    location: row.location ?? "",
    notes: row.notes ?? "",
    notify: Boolean(row.notify),
    icon: row.icon ?? "📅",
    color: row.color ?? "green",
  };
}

export function googleInputFor(event: NormalizedEvent) {
  const timezone = familyTimeZone();
  const description = event.notes ? event.notes : undefined;
  if (event.allDay) {
    return {
      summary: event.title,
      description,
      location: event.location || undefined,
      start: { date: event.date },
      end: { date: nextDateISO(event.date) },
    };
  }
  return {
    summary: event.title,
    description,
    location: event.location || undefined,
    start: { dateTime: `${event.date}T${event.time}:00`, timeZone: timezone },
    end: { dateTime: `${event.date}T${event.endTime}:00`, timeZone: timezone },
  };
}

export function eventSortMinutes(time?: string | null, allDay?: boolean): number {
  if (allDay || time === ALL_DAY_TIME) return -1;
  const parsed = parseClockToHHMM(time ?? undefined);
  if (!parsed) return 24 * 60;
  const [h, m] = parsed.split(":").map(Number);
  return h * 60 + m;
}
