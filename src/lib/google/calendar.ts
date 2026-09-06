import { googleFetch } from "./oauth-client.ts";
import { withAdmin } from "../pb-auth.ts";
import type { GoogleCalendarEvent } from "./types.ts";

const PRIMARY = "primary";
const CONSUMELA_TAG = "consuelaDashboard";
const EVENTS_COLLECTION = "consuela_google_calendar_events";
const CAL_SYNC_COLLECTION = "consuela_google_calendar_sync";

// One calendar's slice of a sync run. `ok:false` means this calendar's pull
// or upsert loop failed (recorded in its own last_error) — other calendars
// still synced fine; one bad calendar never aborts the run.
export interface CalendarSyncResult {
  calendarId: string;
  summary: string;
  events: number;
  deleted: number;
  nextSyncToken: string | null;
  ok: boolean;
  error?: string;
}

export interface SyncResult {
  // Aggregate across every selected calendar (kept for the existing route
  // responses: /api/google/sync reports `events`/`deleted`).
  events: number;
  nextSyncToken: string | null;
  deleted: number;
  perCalendar: CalendarSyncResult[];
}

export interface SyncSkipped {
  skipped: true;
  reason: string;
}

export type SyncOutcome = SyncResult | SyncSkipped;

// L8 — in-process lock: two concurrent cron fires (or a manual "Sync now" on
// top of the cron) must not run listAllEvents + the upsert loop at the same
// time. The loser gets { skipped: true } and the route reports it.
let syncInFlight: Promise<SyncOutcome> | null = null;

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

interface GoogleEventsListArgs {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  syncToken?: string;
  pageToken?: string;
}

function escapePb(s: string): string {
  return s.replace(/"/g, '\\"');
}

// Rows written before multi-calendar sync (and by the Composio-backed cron)
// carry an empty calendar_id — they all belong to the primary calendar.
function calendarIdFilter(calendarId: string): string {
  return calendarId === PRIMARY
    ? `(calendar_id = "${PRIMARY}" || calendar_id = "")`
    : `calendar_id = "${escapePb(calendarId)}"`;
}

export interface CalendarSyncRow {
  id: string;
  calendar_id: string;
  summary: string;
  color_rgb: string | null;
  selected: boolean;
  sync_token: string | null;
  last_sync_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

function toCalendarSyncRow(r: any): CalendarSyncRow {
  return {
    id: r.id,
    calendar_id: r.calendar_id || PRIMARY,
    summary: r.summary || "",
    color_rgb: r.color_rgb || null,
    selected: !!r.selected,
    sync_token: r.sync_token || null,
    last_sync_at: r.last_sync_at || null,
    last_status: r.last_status || null,
    last_error: r.last_error || null,
  };
}

// Every calendar we know about (selected or not) — the selection API and the
// sync-state route read this; syncCalendar filters to selected=true.
export async function readCalendarSyncRows(): Promise<CalendarSyncRow[]> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(CAL_SYNC_COLLECTION)
      .getFullList({ requestKey: null, sort: "calendar_id" });
    return rows.map(toCalendarSyncRow);
  });
}

async function getSelectedCalendars(): Promise<{ calendarId: string; summary: string }[]> {
  try {
    const rows = await readCalendarSyncRows();
    if (rows.length === 0) {
      // Nothing migrated/created yet: backward-compatible default = primary.
      // (An explicit "all deselected" state has rows with selected=false and
      // is honored below — only the never-configured case defaults.)
      return [{ calendarId: PRIMARY, summary: "Primary" }];
    }
    return rows
      .filter((r) => r.selected)
      .map((r) => ({ calendarId: r.calendar_id, summary: r.summary }));
  } catch {
    // Collection not created yet (ensureGoogleCollections runs on the API
    // routes, but syncCalendar can be reached first) — sync primary.
    return [{ calendarId: PRIMARY, summary: "Primary" }];
  }
}

async function getCalendarToken(calendarId: string): Promise<string | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb
        .collection(CAL_SYNC_COLLECTION)
        .getFullList({ requestKey: null, filter: `calendar_id = "${escapePb(calendarId)}"` }),
    );
    return rows[0]?.sync_token || null;
  } catch {
    return null;
  }
}

// Fresh read of ONE calendar's `selected` flag. The selection PUT is NOT
// covered by the sync lock, so a deselect can land while a sync run is in
// flight — syncOneCalendar re-checks through this before doing any work and
// again before any write, so a prune is never resurrected.
async function isCalendarSelected(calendarId: string): Promise<boolean> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb
        .collection(CAL_SYNC_COLLECTION)
        .getFullList({ requestKey: null, filter: `calendar_id = "${escapePb(calendarId)}"` }),
    );
    if (rows.length === 0) return true; // never configured → treat as selected
    return !!rows[0].selected;
  } catch {
    return true; // PB hiccup → don't change sync behavior
  }
}

interface CalendarStatePatch {
  sync_token?: string | null;
  last_status?: string;
  last_error?: string | null;
  summary?: string;
  color_rgb?: string | null;
  touch?: boolean;
}

// Upsert one calendar's row in consuela_google_calendar_sync. `touch` stamps
// last_sync_at with the current time (set on every real sync attempt, success
// or failure; selection-only writes leave the previous timestamp alone).
async function saveCalendarState(calendarId: string, patch: CalendarStatePatch): Promise<void> {
  await withAdmin(async (pb) => {
    const rows = await pb
      .collection(CAL_SYNC_COLLECTION)
      .getFullList({ requestKey: null, filter: `calendar_id = "${escapePb(calendarId)}"` });
    const payload: Record<string, unknown> = { calendar_id: calendarId };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "touch") {
        if (v) payload.last_sync_at = new Date().toISOString();
      } else if (v !== undefined) {
        payload[k] = v;
      }
    }
    if (rows.length > 0) {
      await pb.collection(CAL_SYNC_COLLECTION).update(rows[0].id, payload, { requestKey: null });
    } else {
      await pb
        .collection(CAL_SYNC_COLLECTION)
        .create({ ...payload, selected: true }, { requestKey: null });
    }
  });
}

export async function listAllEvents(args: GoogleEventsListArgs = {}): Promise<{
  events: GoogleCalendarEvent[];
  nextSyncToken: string | null;
}> {
  const calendarId = args.calendarId || PRIMARY;
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
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
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

function eventToRow(event: GoogleCalendarEvent, calendarId: string) {
  return {
    google_id: event.id,
    calendar_id: calendarId,
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

// Upsert one calendar's pulled events. The old code paid TWO PocketBase
// round trips per event (a getFullList lookup before every write) — with N
// calendars that multiplied straight into the request budget. Now: one
// getFullList per calendar builds a google_id → row map, and every event is
// a single create/update/delete against it.
async function upsertCalendarEvents(
  calendarId: string,
  events: GoogleCalendarEvent[],
): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0;
  let deleted = 0;
  await withAdmin(async (pb) => {
    const existing = await pb
      .collection(EVENTS_COLLECTION)
      .getFullList({ requestKey: null, filter: calendarIdFilter(calendarId) });
    const byGoogleId = new Map<string, any>();
    for (const row of existing) {
      const dup = byGoogleId.get(row.google_id);
      if (dup) {
        // Pre-heal duplicate (e.g. a Composio "" row beside a synced
        // "primary" row): keep the row whose calendar_id already matches,
        // drop the other.
        const keep = row.calendar_id === calendarId ? row : dup;
        const drop = keep === row ? dup : row;
        byGoogleId.set(row.google_id, keep);
        await pb.collection(EVENTS_COLLECTION).delete(drop.id, { requestKey: null });
        continue;
      }
      byGoogleId.set(row.google_id, row);
    }

    for (const ev of events) {
      const existingRow = byGoogleId.get(ev.id);
      if ((ev as any).status === "cancelled") {
        if (existingRow) {
          await pb.collection(EVENTS_COLLECTION).delete(existingRow.id, { requestKey: null });
          byGoogleId.delete(ev.id);
          deleted++;
        }
        continue;
      }
      const row = eventToRow(ev, calendarId);
      if (existingRow) {
        await pb.collection(EVENTS_COLLECTION).update(existingRow.id, row, { requestKey: null });
      } else {
        await pb.collection(EVENTS_COLLECTION).create(row, { requestKey: null });
      }
      upserted++;
    }
  });
  return { upserted, deleted };
}

async function syncOneCalendar(
  calendarId: string,
  summary: string,
): Promise<CalendarSyncResult | null> {
  // Re-read `selected`: the list was captured at the top of the run and the
  // selection PUT is not lock-covered — if this calendar was deselected
  // since, its rows were just pruned and syncing would resurrect them.
  if (!(await isCalendarSelected(calendarId))) return null;

  const existingToken = await getCalendarToken(calendarId);
  let events: GoogleCalendarEvent[];
  let nextSyncToken: string | null;

  try {
    ({ events, nextSyncToken } = await listAllEvents(
      { calendarId, ...(existingToken ? { syncToken: existingToken } : {}) },
    ));
  } catch (err) {
    // Google returns 410 GONE once an incremental syncToken is expired or
    // invalidated (e.g. after ~a week of downtime, permission changes, or
    // a revoked re-grant). Without this fallback the stale token stays in
    // PB forever and every subsequent cron run fails with the same error.
    // Clear it and do one full-window resync for THIS calendar instead.
    if ((err as any)?.status !== 410 || !existingToken) throw err;
    console.log(`[google-sync] ${calendarId}: sync token invalidated (410) — performing full resync`);
    ({ events, nextSyncToken } = await listAllEvents({ calendarId }));
  }

  const { upserted, deleted } = await upsertCalendarEvents(calendarId, events);

  // Second re-check, right before the write path: the deselect may have
  // landed DURING the pull/upsert (its prune already ran). Undo this
  // calendar's writes instead of saving the token — otherwise the ghost
  // rows are served forever and the deselect transition is consumed.
  if (!(await isCalendarSelected(calendarId))) {
    await pruneCalendar(calendarId);
    return { calendarId, summary, events: 0, deleted: 0, nextSyncToken: null, ok: true };
  }

  await saveCalendarState(calendarId, {
    sync_token: nextSyncToken,
    last_status: "ok",
    last_error: null,
    touch: true,
  });
  return { calendarId, summary, events: upserted, deleted, nextSyncToken, ok: true };
}

// L8 — in-process lock: two concurrent cron fires (or a manual "Sync now" on
// top of the cron) must not run the multi-calendar pulls at the same time.
// The loser gets { skipped: true } and the route reports it.
export async function syncCalendar(): Promise<SyncOutcome> {
  if (syncInFlight) {
    console.log("[google-sync] sync already in progress, skipping");
    return { skipped: true, reason: "already_in_progress" };
  }
  const run = (async () => {
    try {
      const calendars = await getSelectedCalendars();
      const perCalendar: CalendarSyncResult[] = [];
      let totalEvents = 0;
      let totalDeleted = 0;
      let primaryToken: string | null = null;

      for (const cal of calendars) {
        const calendarId = cal.calendarId || PRIMARY;
        try {
          const res = await syncOneCalendar(calendarId, cal.summary);
          if (!res) continue; // deselected since the list was captured
          perCalendar.push(res);
          totalEvents += res.events;
          totalDeleted += res.deleted;
          if (calendarId === PRIMARY) primaryToken = res.nextSyncToken;
        } catch (err: any) {
          // A token/auth failure is global (every calendar shares one
          // grant) — propagate so the routes can answer 401/409 as before.
          // Duck-typed on GoogleAuthError's `code` (the class sets no `name`,
          // and tests mock the oauth-client module, so instanceof is not
          // available here).
          if (err && typeof err.code === "string" && typeof err.status !== "number") throw err;
          // Everything else (410-without-token, 5xx, quota, PB hiccup)
          // isolates to this calendar: record it, keep the loop going.
          console.error(`[google-sync] calendar ${calendarId} failed:`, err?.message || err);
          await saveCalendarState(calendarId, {
            last_status: "error",
            last_error: err?.message || "Sync failed",
            touch: true,
          }).catch(() => {});
          perCalendar.push({
            calendarId,
            summary: cal.summary,
            events: 0,
            deleted: 0,
            nextSyncToken: null,
            ok: false,
            error: err?.message || "Sync failed",
          });
        }
      }

      return {
        events: totalEvents,
        deleted: totalDeleted,
        nextSyncToken: primaryToken,
        perCalendar,
      };
    } finally {
      syncInFlight = null;
    }
  })();
  syncInFlight = run;
  return run;
}

// Delete everything cached for one calendar: its event rows AND its sync
// token (so a later re-selection full-pulls instead of resuming from a token
// whose events are gone). Used by the selection API on deselection.
export async function pruneCalendar(calendarId: string): Promise<{ deleted: number }> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(EVENTS_COLLECTION)
      .getFullList({ requestKey: null, filter: calendarIdFilter(calendarId) });
    for (const row of rows) {
      await pb.collection(EVENTS_COLLECTION).delete(row.id, { requestKey: null });
    }
    const stateRows = await pb
      .collection(CAL_SYNC_COLLECTION)
      .getFullList({ requestKey: null, filter: `calendar_id = "${escapePb(calendarId)}"` });
    if (stateRows.length > 0) {
      await pb
        .collection(CAL_SYNC_COLLECTION)
        .update(stateRows[0].id, { sync_token: null, last_status: "pruned", last_error: null }, { requestKey: null });
    }
    return { deleted: rows.length };
  });
}

// Persist one calendar's selection (and its display metadata). Returns
// whether the calendar WAS selected before this write so the caller can tell
// a fresh selection from a deselect transition.
export async function setCalendarSelection(entry: {
  calendarId: string;
  selected: boolean;
  summary?: string;
  colorRgb?: string | null;
}): Promise<{ wasSelected: boolean }> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(CAL_SYNC_COLLECTION)
      .getFullList({ requestKey: null, filter: `calendar_id = "${escapePb(entry.calendarId)}"` });
    const payload: Record<string, unknown> = {
      calendar_id: entry.calendarId,
      selected: entry.selected,
    };
    if (entry.summary !== undefined) payload.summary = entry.summary;
    if (entry.colorRgb !== undefined) payload.color_rgb = entry.colorRgb;

    if (rows.length > 0) {
      const wasSelected = !!rows[0].selected;
      if (!entry.selected) {
        // Deselecting: the token goes with the cached rows (pruneCalendar).
        payload.sync_token = null;
      } else if (!wasSelected) {
        // Re-selecting: never resume from a token whose base rows may have been
        // pruned (the deselect-race window can leave one behind) — force a
        // full pull of the window instead.
        payload.sync_token = null;
      }
      await pb.collection(CAL_SYNC_COLLECTION).update(rows[0].id, payload, { requestKey: null });
      return { wasSelected };
    }
    // Newly known calendar (first opt-in): no sync_token row → the next sync
    // full-pulls it.
    await pb
      .collection(CAL_SYNC_COLLECTION)
      .create({ ...payload, sync_token: null }, { requestKey: null });
    return { wasSelected: false };
  });
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
  colorRgb: string | null;
}

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const res = await googleFetch<{
    items?: { id: string; summary: string; primary?: boolean; accessRole: string; colorRgb?: string }[];
  }>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { method: "GET", endpoint: "/calendar/v3/users/me/calendarList" },
  );
  return (res.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
    colorRgb: c.colorRgb || null,
  }));
}
