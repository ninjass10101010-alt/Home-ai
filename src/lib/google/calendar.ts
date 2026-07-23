import { googleFetch } from "./oauth-client.ts";
import { withAdmin } from "../pb-auth.ts";
import type { GoogleCalendarEvent } from "./types.ts";

const PRIMARY = "primary";
const CONSUMELA_TAG = "consuelaDashboard";
const EVENTS_COLLECTION = "consuela_google_calendar_events";
const SYNC_STATE_COLLECTION = "consuela_google_sync_state";

export interface SyncResult {
  events: number;
  nextSyncToken: string | null;
  deleted: number;
}

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

interface GoogleEventsListArgs {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  syncToken?: string;
  pageToken?: string;
}

async function getSyncToken(): Promise<string | null> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(SYNC_STATE_COLLECTION)
      .getFullList({ requestKey: null, filter: `resource = "calendar"` });
    const row: any = rows[0];
    return row?.sync_token || null;
  });
}

async function saveSyncToken(token: string | null, error?: string): Promise<void> {
  await withAdmin(async (pb) => {
    const rows = await pb
      .collection(SYNC_STATE_COLLECTION)
      .getFullList({ requestKey: null, filter: `resource = "calendar"` });
    const payload = {
      resource: "calendar",
      sync_token: token,
      last_sync_at: new Date().toISOString(),
      last_status: error ? "error" : "ok",
      last_error: error || null,
    };
    if (rows.length > 0) {
      await pb
        .collection(SYNC_STATE_COLLECTION)
        .update(rows[0].id, payload, { requestKey: null });
    } else {
      await pb.collection(SYNC_STATE_COLLECTION).create(payload, { requestKey: null });
    }
  });
}

export async function listAllEvents(args: GoogleEventsListArgs = {}): Promise<{
  events: GoogleCalendarEvent[];
  nextSyncToken: string | null;
}> {
  const query: Record<string, string | number | boolean> = {
    showDeleted: true,
    singleEvents: true,
    maxResults: args.maxResults || 250,
  };
  if (args.syncToken) {
    query.syncToken = args.syncToken;
  } else {
    if (args.timeMin) query.timeMin = args.timeMin;
    else query.timeMin = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    if (args.timeMax) query.timeMax = args.timeMax;
    else query.timeMax = new Date(Date.now() + 90 * 24 * 3600_000).toISOString();
  }
  if (args.pageToken) query.pageToken = args.pageToken;

  const events: GoogleCalendarEvent[] = [];
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined = args.pageToken;

  while (true) {
    const q = { ...query };
    if (pageToken) q.pageToken = pageToken;
    else delete (q as any).pageToken;

    const res = await googleFetch<EventsListResponse>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events`,
      { method: "GET", query: q, endpoint: "/calendar/v3/calendars/{id}/events" },
    );
    if (res.data.items) events.push(...res.data.items);
    if (res.data.nextSyncToken) {
      nextSyncToken = res.data.nextSyncToken;
      break;
    }
    if (res.data.nextPageToken) {
      pageToken = res.data.nextPageToken;
    } else {
      break;
    }
  }

  return { events, nextSyncToken };
}

function isAllDay(event: GoogleCalendarEvent): boolean {
  return !!(event.start && event.start.date && !event.start.dateTime);
}

function eventToRow(event: GoogleCalendarEvent) {
  return {
    google_id: event.id,
    calendar_id: PRIMARY,
    summary: event.summary || "(no title)",
    description: event.description || "",
    location: event.location || "",
    start_iso: event.start?.dateTime || event.start?.date || "",
    end_iso: event.end?.dateTime || event.end?.date || "",
    all_day: isAllDay(event),
    etag: event.etag || "",
    html_link: event.htmlLink || "",
    updated_remote: event.updated || "",
    source: "google",
    raw: event,
  };
}

export async function syncCalendar(): Promise<SyncResult> {
  const existingToken = await getSyncToken();
  const { events, nextSyncToken } = await listAllEvents(
    existingToken ? { syncToken: existingToken } : {},
  );

  let upserted = 0;
  let deleted = 0;

  await withAdmin(async (pb) => {
    for (const ev of events) {
      if ((ev as any).status === "cancelled") {
        const existing = await pb
          .collection(EVENTS_COLLECTION)
          .getFullList({ requestKey: null, filter: `google_id = "${ev.id.replace(/"/g, '\\"')}"` });
        for (const row of existing) {
          await pb.collection(EVENTS_COLLECTION).delete(row.id, { requestKey: null });
          deleted++;
        }
        continue;
      }
      const row = eventToRow(ev);
      const existing = await pb
        .collection(EVENTS_COLLECTION)
        .getFullList({ requestKey: null, filter: `google_id = "${ev.id.replace(/"/g, '\\"')}"` });
      if (existing.length > 0) {
        await pb.collection(EVENTS_COLLECTION).update(existing[0].id, row, { requestKey: null });
      } else {
        await pb.collection(EVENTS_COLLECTION).create(row, { requestKey: null });
      }
      upserted++;
    }
  });

  await saveSyncToken(nextSyncToken);

  return { events: upserted, nextSyncToken, deleted };
}

export async function readCachedEvents(): Promise<any[]> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(EVENTS_COLLECTION)
      .getFullList({ requestKey: null, sort: "start_iso" });
    return rows;
  });
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  attendees?: { email: string }[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<GoogleCalendarEvent> {
  const body = {
    summary: input.summary,
    description: input.description || "",
    location: input.location || "",
    start: input.start,
    end: input.end,
    reminders: input.reminders || { useDefault: true },
    attendees: input.attendees,
    extendedProperties: {
      private: { source: CONSUMELA_TAG },
    },
  };
  const res = await googleFetch<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events`,
    { method: "POST", body, endpoint: "/calendar/v3/calendars/{id}/events" },
  );
  return res.data;
}

export async function updateCalendarEvent(
  eventId: string,
  input: Partial<CalendarEventInput>,
  ifMatchEtag?: string,
): Promise<GoogleCalendarEvent> {
  const headers: Record<string, string> = {};
  if (ifMatchEtag) headers["If-Match"] = ifMatchEtag;

  const res = await googleFetch<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: input, headers, endpoint: "/calendar/v3/calendars/{id}/events/{eventId}" },
  );
  return res.data;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PRIMARY)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", endpoint: "/calendar/v3/calendars/{id}/events/{eventId}" },
  );
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const res = await googleFetch<{ items?: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { method: "GET", endpoint: "/calendar/v3/users/me/calendarList" },
  );
  return (res.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
  }));
}
