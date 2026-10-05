import { withAdmin } from "../pb-auth.ts";
import {
  getGoogleIntegrationGeneration,
  isGoogleIntegrationGenerationCurrent,
  withGoogleIntegrationOperation,
} from "./integration-operation.ts";
import { executeComposioAction } from "./composio.ts";
import { COMPOSIO_ACTIONS } from "./composio-actions.ts";
import { GoogleAuthError, readConnectionSnapshot } from "./connection-state.ts";
import type { GoogleCalendarEvent } from "./types.ts";

const PRIMARY = "primary";
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
// top of the cron) must not run the per-calendar pulls + upsert loop at the
// same time. The loser gets { skipped: true } and the route reports it.
let syncInFlight: Promise<SyncOutcome> | null = null;

// Composio v3.1 wraps every execute result in `{ data, successful, error }`.
interface ComposioEnvelope<T> {
  data?: T | null;
  successful?: boolean;
  error?: { message?: string; code?: string } | null;
}

interface ComposioEventsData {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

interface ComposioCalendarListData {
  items?: { id: string; summary: string; primary?: boolean; accessRole: string; colorRgb?: string }[];
}

// Timed writes return the created/updated event nested under `response_data`.
type ComposioEventWriteData = GoogleCalendarEvent & { response_data?: GoogleCalendarEvent };

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

// One Composio connected account brokers the family's Google grant. A missing
// id is a run-level no-grant (routes answer 409), never a per-calendar error.
async function requireConnectedAccountId(): Promise<string> {
  const snapshot = await readConnectionSnapshot();
  if (!snapshot.connectedAccountId) {
    throw new GoogleAuthError("no_grant", "Google account is not connected");
  }
  return snapshot.connectedAccountId;
}

// Composio auth_failed means the brokered grant (or the broker key) is dead —
// every calendar shares it, so it must abort the run instead of isolating to
// one calendar. Every other ComposioError (api_error/timeout, not_configured)
// propagates as-is and is contained by the per-calendar catch below.
function rethrowRunLevelComposioError(err: unknown): never {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "auth_failed") {
    throw new GoogleAuthError(
      "config",
      err instanceof Error ? err.message : "Composio is not usable",
    );
  }
  throw err;
}

async function executeGoogleAction<T>(
  action: string,
  args: Record<string, unknown>,
  connectedAccountId: string,
): Promise<T> {
  try {
    return await executeComposioAction<T>(action, args, connectedAccountId);
  } catch (err) {
    return rethrowRunLevelComposioError(err);
  }
}

function unwrapComposioData<T>(result: ComposioEnvelope<T>): T {
  if (!result || result.successful === false || result.data == null) {
    throw new Error(result?.error?.message || "Composio tool execution failed");
  }
  return result.data;
}

// Rows written before multi-calendar sync carry an empty calendar_id — they belong to the primary calendar.
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

const WINDOW_BACK_MS = 30 * 24 * 3600_000;
const WINDOW_FORWARD_MS = 90 * 24 * 3600_000;

// Composio exposes no incremental sync token (there is no SYNC_EVENTS action),
// so every run is a full-window pull. time_min/time_max are mandatory — the
// action has no default window. The persisted `sync_token` cache field is dead
// state: it is never read, never sent, and never rewritten here.
async function listEventsViaComposio(
  calendarId: string,
  window: { timeMin?: string; timeMax?: string } = {},
): Promise<{ events: GoogleCalendarEvent[]; nextCursor: string | null }> {
  const connectedAccountId = await requireConnectedAccountId();
  const timeMin = window.timeMin || new Date(Date.now() - WINDOW_BACK_MS).toISOString();
  const timeMax = window.timeMax || new Date(Date.now() + WINDOW_FORWARD_MS).toISOString();

  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  while (true) {
    const args: Record<string, unknown> = {
      calendar_id: calendarId,
      time_min: timeMin,
      time_max: timeMax,
      single_events: true,
      show_deleted: true,
    };
    if (pageToken) args.page_token = pageToken;

    const result = await executeGoogleAction<ComposioEnvelope<ComposioEventsData>>(
      COMPOSIO_ACTIONS.LIST_EVENTS,
      args,
      connectedAccountId,
    );
    const data = unwrapComposioData(result);
    if (data.items) events.push(...data.items);
    if (data.nextPageToken) pageToken = data.nextPageToken;
    else break;
  }

  return { events, nextCursor: null };
}

// Compatibility wrapper for callers of the old direct-Google surface (the
// manual module probe script). syncToken is meaningless under Composio, so
// nextSyncToken is always null and any syncToken arg is ignored.
export async function listAllEvents(args: GoogleEventsListArgs = {}): Promise<{
  events: GoogleCalendarEvent[];
  nextSyncToken: string | null;
}> {
  const { events } = await listEventsViaComposio(args.calendarId || PRIMARY, {
    timeMin: args.timeMin,
    timeMax: args.timeMax,
  });
  return { events, nextSyncToken: null };
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
  operationGeneration: number,
): Promise<CalendarSyncResult | null> {
  // Re-read `selected`: the list was captured at the top of the run and the
  // selection PUT is not lock-covered — if this calendar was deselected
  // since, its rows were just pruned and syncing would resurrect them.
  if (!(await isCalendarSelected(calendarId))) return null;

  // Always a full-window pull: Composio exposes no sync token to resume from.
  const { events } = await listEventsViaComposio(calendarId);

  if (!isGoogleIntegrationGenerationCurrent(operationGeneration)) return null;
  const { upserted, deleted } = await upsertCalendarEvents(calendarId, events);

  // Second re-check, right before the write path: the deselect may have
  // landed DURING the pull/upsert (its prune already ran). Undo this
  // calendar's writes instead of saving the token — otherwise the ghost
  // rows are served forever and the deselect transition is consumed.
  if (!isGoogleIntegrationGenerationCurrent(operationGeneration)) return null;
  if (!(await isCalendarSelected(calendarId))) {
    await pruneCalendar(calendarId);
    return { calendarId, summary, events: 0, deleted: 0, nextSyncToken: null, ok: true };
  }

  // The persisted sync_token field is deliberately not written: there is no
  // incremental resume under Composio, so the old value is left untouched.
  await saveCalendarState(calendarId, {
    last_status: "ok",
    last_error: null,
    touch: true,
  });
  return { calendarId, summary, events: upserted, deleted, nextSyncToken: null, ok: true };
}

// L8 — in-process lock: two concurrent cron fires (or a manual "Sync now" on
// top of the cron) must not run the multi-calendar pulls at the same time.
// The loser gets { skipped: true } and the route reports it.
export async function syncCalendar(): Promise<SyncOutcome> {
  if (syncInFlight) {
    console.log("[google-sync] sync already in progress, skipping");
    return { skipped: true, reason: "already_in_progress" };
  }
  const operationGeneration = getGoogleIntegrationGeneration();
  const run = withGoogleIntegrationOperation(async (): Promise<SyncOutcome> => {
    try {
      if (!isGoogleIntegrationGenerationCurrent(operationGeneration)) {
        return { skipped: true, reason: "disconnected" };
      }
      const calendars = await getSelectedCalendars();
      const perCalendar: CalendarSyncResult[] = [];
      let totalEvents = 0;
      let totalDeleted = 0;
      let primaryToken: string | null = null;

      for (const cal of calendars) {
        const calendarId = cal.calendarId || PRIMARY;
        try {
          const res = await syncOneCalendar(calendarId, cal.summary, operationGeneration);
          if (!res) continue; // deselected since the list was captured
          perCalendar.push(res);
          totalEvents += res.events;
          totalDeleted += res.deleted;
          if (calendarId === PRIMARY) primaryToken = res.nextSyncToken;
        } catch (err: any) {
          // Only run-level GoogleAuthErrors abort the whole run: the promoted
          // auth_failed above, or a missing grant from requireConnectedAccountId.
          // Everything else — including a network api_error with NO HTTP status —
          // isolates to this calendar: record it, keep the loop going.
          if (err instanceof GoogleAuthError) throw err;
          console.error(`[google-sync] calendar ${calendarId} failed:`, err?.message || err);
          if (!isGoogleIntegrationGenerationCurrent(operationGeneration)) {
            return { skipped: true, reason: "disconnected" };
          }
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

      if (!isGoogleIntegrationGenerationCurrent(operationGeneration)) {
        return { skipped: true, reason: "disconnected" };
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
  });
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

function eventDuration(startIso?: string, endIso?: string): { hours: number; minutes: number } | null {
  if (!startIso || !endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const totalMinutes = Math.round((end - start) / 60000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

// Composio's GOOGLECALENDAR_CREATE_EVENT takes flat arguments plus duration
// fields (it ignores end_datetime on create). reminders/extendedProperties are
// not part of that schema and are dropped; nothing reads the old
// consuelaDashboard tag.
function createEventArgs(input: CalendarEventInput): Record<string, unknown> {
  const startIso = input.start.dateTime || input.start.date;
  const endIso = input.end.dateTime || input.end.date;
  const args: Record<string, unknown> = {
    calendar_id: PRIMARY,
    summary: input.summary,
    start_datetime: startIso,
  };
  if (input.description) args.description = input.description;
  if (input.location) args.location = input.location;
  if (input.start.timeZone) args.timezone = input.start.timeZone;
  const duration = eventDuration(startIso, endIso);
  if (duration) {
    args.event_duration_hour = duration.hours;
    args.event_duration_minutes = duration.minutes;
  }
  if (input.attendees?.length) args.attendees = input.attendees.map((a) => a.email);
  return args;
}

function patchEventArgs(eventId: string, input: Partial<CalendarEventInput>): Record<string, unknown> {
  const args: Record<string, unknown> = { calendar_id: PRIMARY, event_id: eventId };
  if (input.summary !== undefined) args.summary = input.summary;
  if (input.description !== undefined) args.description = input.description;
  if (input.location !== undefined) args.location = input.location;
  const startIso = input.start?.dateTime || input.start?.date;
  const endIso = input.end?.dateTime || input.end?.date;
  if (startIso) args.start_datetime = startIso;
  if (endIso) args.end_datetime = endIso;
  const timeZone = input.start?.timeZone || input.end?.timeZone;
  if (timeZone) args.timezone = timeZone;
  if (input.attendees) args.attendees = input.attendees.map((a) => a.email);
  return args;
}

function createWriteResult(
  result: ComposioEnvelope<ComposioEventWriteData>,
): GoogleCalendarEvent {
  const data = unwrapComposioData(result);
  return data.response_data ?? data;
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<GoogleCalendarEvent> {
  const connectedAccountId = await requireConnectedAccountId();
  const result = await executeGoogleAction<ComposioEnvelope<ComposioEventWriteData>>(
    COMPOSIO_ACTIONS.CREATE_EVENT,
    createEventArgs(input),
    connectedAccountId,
  );
  return createWriteResult(result);
}

export async function updateCalendarEvent(
  eventId: string,
  input: Partial<CalendarEventInput>,
  ifMatchEtag?: string,
): Promise<GoogleCalendarEvent> {
  // Composio PATCH_EVENT has no If-Match equivalent; the etag argument is kept
  // for signature compatibility and intentionally not sent.
  void ifMatchEtag;
  const connectedAccountId = await requireConnectedAccountId();
  const result = await executeGoogleAction<ComposioEnvelope<ComposioEventWriteData>>(
    COMPOSIO_ACTIONS.UPDATE_EVENT,
    patchEventArgs(eventId, input),
    connectedAccountId,
  );
  return createWriteResult(result);
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const connectedAccountId = await requireConnectedAccountId();
  const result = await executeGoogleAction<ComposioEnvelope<ComposioEventWriteData>>(
    COMPOSIO_ACTIONS.DELETE_EVENT,
    { calendar_id: PRIMARY, event_id: eventId },
    connectedAccountId,
  );
  // DELETE arrives as HTTP 200 even when the tool failed (`successful:false`),
  // so unwrap like the create/patch writes — a failed delete must reject.
  createWriteResult(result);
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  colorRgb: string | null;
}

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const connectedAccountId = await requireConnectedAccountId();
  const result = await executeGoogleAction<ComposioEnvelope<ComposioCalendarListData>>(
    COMPOSIO_ACTIONS.LIST_CALENDARS,
    {},
    connectedAccountId,
  );
  const data = unwrapComposioData(result);
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
    colorRgb: c.colorRgb || null,
  }));
}
