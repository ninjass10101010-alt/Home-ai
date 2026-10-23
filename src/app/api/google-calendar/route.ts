import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import {
  isGoogleConnected,
  GoogleAuthError,
  mapGoogleAuthError,
  readConnectionSnapshot,
  reconcileGoogleConnection,
} from "@/lib/google/connection-state";
import { readCachedEvents, syncCalendar, readCalendarSyncRows } from "@/lib/google/calendar";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { withAdmin } from "@/lib/pb-auth";
import { filterMirroredFamilyRows } from "@/lib/calendar/google-dedupe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authErrorResponse(error: unknown) {
  const mapped = mapGoogleAuthError(error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}

function noGrantResponse() {
  return NextResponse.json({
    ok: true,
    connected: false,
    source: "none",
    stale: true,
    events: [],
  });
}

async function readAccountEmail(): Promise<string | null> {
  try {
    const snapshot = await readConnectionSnapshot();
    return snapshot.accountEmail ?? null;
  } catch {
    throw new GoogleAuthError("unavailable", "Google connection state unavailable");
  }
}

async function readSyncRows(): Promise<Awaited<ReturnType<typeof readCalendarSyncRows>>> {
  try {
    return await readCalendarSyncRows();
  } catch {
    return [];
  }
}

function newestSyncAt(rows: Awaited<ReturnType<typeof readCalendarSyncRows>>): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (row.last_sync_at && (!newest || row.last_sync_at > newest)) newest = row.last_sync_at;
  }
  return newest;
}

const STALE_SYNC_MS = 15 * 60_000;

// Connected but not fresh: a missing timestamp or one older than 15 minutes
// (the cron cadence is every 5 minutes) means the rows on screen may be stale.
function isStaleSync(lastSyncAt: string | null): boolean {
  if (!lastSyncAt) return true;
  const parsed = Date.parse(lastSyncAt);
  return !Number.isFinite(parsed) || Date.now() - parsed > STALE_SYNC_MS;
}

// Plain GET remains session-scoped for product calendar events; only `sync=now`
// enters the parent gate before collection or connection-state work. calendarId
// → Google colorRgb, so the client can paint each synced event in its own
// calendar's color (mapGoogleEvent's colorHex passthrough).
function calendarColors(rows: Awaited<ReturnType<typeof readCalendarSyncRows>>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) if (r.color_rgb) map[r.calendar_id] = r.color_rgb;
  return map;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sync = searchParams.get("sync");
  if (sync === "now") {
    const gate = await authorizeAdminRequest(request);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error ?? "unauthorized" }, { status: gate.status ?? 401 });
    }
  }

  try {
    await ensureGoogleCollections();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, events: [], error: "PocketBase not reachable: " + (e?.message || "unknown") },
      { status: 200 },
    );
  }

  let connected: boolean;
  try {
    connected = await isGoogleConnected();
    if (!connected) {
      const snapshot = await readConnectionSnapshot();
      if (snapshot.status === "INITIALIZING" || snapshot.status === "INITIATED") {
        const reconciled = await reconcileGoogleConnection();
        connected = !!reconciled.connectedAccountId && reconciled.status === "ACTIVE";
      }
    }
  } catch (error) {
    if (error instanceof GoogleAuthError && error.code === "no_grant") {
      return noGrantResponse();
    }
    return authErrorResponse(error);
  }

  if (!connected) {
    return noGrantResponse();
  }

  let partialSync = false;
  if (sync === "now") {
    try {
      const result = await syncCalendar();
      if (result && "skipped" in result) {
        return NextResponse.json({ ok: false, error: "already_in_progress" }, { status: 409 });
      }
      if (result && "perCalendar" in result && Array.isArray(result.perCalendar)) {
        partialSync = result.perCalendar.some((entry) => entry.ok === false);
      }
    } catch (error) {
      if (error instanceof GoogleAuthError && error.code === "no_grant") {
        return noGrantResponse();
      }
      return authErrorResponse(error);
    }
  }

  try {
    const cachedEvents = await readCachedEvents();
    const accountEmail = await readAccountEmail();
    const rows = await readSyncRows();
    const familyRows = (await withAdmin((pb) =>
      pb.collection("events").getFullList({
        filter: 'source = "family" && googleEventId != ""',
        requestKey: null,
      }),
    ).catch(() => [])) as { googleEventId?: string }[];
    const events = filterMirroredFamilyRows(cachedEvents, familyRows);
    if (partialSync) {
      return NextResponse.json({
        ok: false,
        partial: true,
        stale: true,
        error: "calendar_partial_failure",
        source: "google",
        account_email: accountEmail,
        last_sync_at: newestSyncAt(rows),
        calendar_colors: calendarColors(rows),
        events,
      }, { status: 502 });
    }
    const lastSyncAt = newestSyncAt(rows);
    return NextResponse.json({
      ok: true,
      connected: true,
      source: "google",
      provider: "composio",
      stale: isStaleSync(lastSyncAt),
      account_email: accountEmail,
      last_sync_at: lastSyncAt,
      calendar_colors: calendarColors(rows),
      events,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError && error.code === "no_grant") {
      return noGrantResponse();
    }
    return authErrorResponse(error);
  }
}
