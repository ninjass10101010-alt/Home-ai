import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { createCalendarEvent, deleteCalendarEvent, readCachedEvents } from "@/lib/google/calendar";
import { googleEventCoveredDays, googleEventLocalMinutes } from "@/lib/calendar/google-mapping";
import {
  EventValidationError,
  eventSortMinutes,
  eventToPbRow,
  googleInputFor,
  rowToEventInput,
  validateEventInput,
  type EventInput,
  type PbEventRow,
} from "@/lib/calendar/event-input";

export { EventValidationError, type EventInput, type PbEventRow } from "@/lib/calendar/event-input";

const COLLECTION = "events";

function collectionOf(pb: any): any {
  if (pb && typeof pb.create === "function" && typeof pb.getOne === "function" && typeof pb.update === "function" && typeof pb.delete === "function" && typeof pb.getFullList === "function") {
    return pb;
  }
  return pb.collection(COLLECTION);
}
const MIRROR_BATCH = 20;
const SAFE_CONNECT = "Google Calendar isn't connected.";
const SAFE_SAVE = "Google Calendar couldn't save this event.";

export type MirrorResult = {
  status: "synced" | "pending" | "failed";
  unmirrored?: boolean;
  event?: { id: string; calendarId: string; syncedAt: string };
  message?: string;
};

function safeGoogleError(error: unknown): { status: "pending" | "failed"; message: string } {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "not_connected" || code === "auth_failed") {
    return { status: "pending", message: SAFE_CONNECT };
  }
  return { status: "failed", message: SAFE_SAVE };
}

function assertFamilyRow(row: PbEventRow): void {
  if (row.source && row.source !== "family") {
    throw new EventValidationError("source", "This event comes from Google Calendar.");
  }
}

function publicMirror(mirror: MirrorResult) {
  return {
    status: mirror.status,
    eventId: mirror.event?.id,
    error: mirror.message,
    unmirrored: mirror.unmirrored,
  };
}

async function writeMirror(
  id: string,
  row: PbEventRow,
  input: EventInput,
): Promise<MirrorResult> {
  return withKeyedLock(`calendar-event:${id}`, async () => {
    try {
      const previousId = row.googleEventId;
      if (previousId) {
        await deleteCalendarEvent(previousId);
      }

      let googleId: string | undefined;
      let calendarId = row.googleCalendarId || "primary";

      if (!previousId) {
        const cached = await readCachedEvents().catch(() => []);
        const desiredSort = eventSortMinutes(row.time, row.allDay);
        const match = (cached as any[]).find((candidate) => {
          const covered = googleEventCoveredDays(candidate).includes(row.date);
          const sort = googleEventLocalMinutes(candidate.start_iso, candidate.all_day);
          return String(candidate.summary ?? "") === row.title && covered && sort === desiredSort;
        });
        if (match) {
          googleId = String(match.google_id);
          calendarId = String(match.calendar_id || calendarId);
        }
      }

      if (!googleId) {
        const normalized = validateEventInput(input);
        const created = await createCalendarEvent(googleInputFor(normalized));
        googleId = String((created as any).id);
        calendarId = "primary";
      }

      const syncedAt = new Date().toISOString();
      await withAdmin((pb: any) =>
        collectionOf(pb).update(id, {
          googleEventId: googleId,
          googleCalendarId: calendarId,
          googleSyncStatus: "synced",
          googleSyncError: "",
          googleSyncedAt: syncedAt,
        }),
      );
      return { status: "synced", event: { id: googleId!, calendarId, syncedAt } };
    } catch (error) {
      const safe = safeGoogleError(error);
      await withAdmin((pb: any) =>
        collectionOf(pb).update(id, {
          googleSyncStatus: safe.status,
          googleSyncError: safe.message,
        }),
      ).catch(() => undefined);
      return { status: safe.status, message: safe.message };
    }
  });
}

export async function createFamilyEvent(input: EventInput) {
  const normalized = validateEventInput(input);
  const row = (await withAdmin((pb: any) =>
    collectionOf(pb).create({ ...eventToPbRow(normalized), googleSyncStatus: "pending" }),
  )) as PbEventRow;
  assertFamilyRow(row);
  const mirror = await writeMirror(row.id!, row, input);
  return { event: { ...row, ...mirror.event, googleSyncStatus: mirror.status }, google: publicMirror(mirror) };
}

export async function updateFamilyEvent(id: string, input: EventInput) {
  const normalized = validateEventInput(input);
  const existing = (await withAdmin((pb: any) => collectionOf(pb).getOne(id))) as PbEventRow;
  assertFamilyRow(existing);
  const nextStatus = existing.googleEventId ? "pending" : existing.googleSyncStatus;
  const updated = (await withAdmin((pb: any) =>
    collectionOf(pb).update(id, { ...eventToPbRow(normalized), googleSyncStatus: nextStatus }),
  )) as PbEventRow;
  if (!existing.googleEventId) {
    return {
      event: updated,
      google: { status: "pending" as const, unmirrored: true },
    };
  }
  const mirror = await writeMirror(id, { ...existing, ...updated }, input);
  return { event: { ...updated, ...mirror.event, googleSyncStatus: mirror.status }, google: publicMirror(mirror) };
}

export async function deleteFamilyEvent(id: string) {
  const existing = (await withAdmin((pb: any) => collectionOf(pb).getOne(id))) as PbEventRow;
  assertFamilyRow(existing);
  let google: MirrorResult = { status: "pending", unmirrored: true };
  if (existing.googleEventId) {
    try {
      await deleteCalendarEvent(existing.googleEventId);
      google = { status: "synced" };
    } catch (error) {
      const safe = safeGoogleError(error);
      google = { status: safe.status, message: safe.message };
    }
  }
  await withAdmin((pb: any) => collectionOf(pb).delete(id));
  return { deleted: true, google: publicMirror(google) };
}

export async function retryFamilyEventGoogle(id: string) {
  const row = (await withAdmin((pb: any) => collectionOf(pb).getOne(id))) as PbEventRow;
  assertFamilyRow(row);
  const mirror = await writeMirror(id, row, rowToEventInput(row));
  return { event: { ...row, ...mirror.event, googleSyncStatus: mirror.status }, google: publicMirror(mirror) };
}

export async function retryPendingCalendarMirrors(limit = MIRROR_BATCH) {
  const all = (await withAdmin((pb: any) =>
    collectionOf(pb).getFullList({
      filter: 'source = "family" && (googleSyncStatus = "pending" || googleSyncStatus = "failed")',
      sort: "created",
      requestKey: null,
    }),
  )) as PbEventRow[];
  const rows = all.slice(0, Math.max(1, limit));

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await writeMirror(row.id!, row, rowToEventInput(row));
    if (result.status === "synced") synced += 1;
    else failed += 1;
  }
  return { checked: rows.length, synced, failed };
}
