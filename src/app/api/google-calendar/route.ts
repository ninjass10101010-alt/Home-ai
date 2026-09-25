import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { isGoogleConnected, GoogleAuthError, mapGoogleAuthError } from "@/lib/google/oauth-client";
import { readCachedEvents, syncCalendar, readCalendarSyncRows } from "@/lib/google/calendar";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { getStoredTokensStrict } from "@/lib/google/token-store";

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
    events: [],
  });
}

async function readTokensStrict() {
  try {
    const tokens = await getStoredTokensStrict();
    if (!tokens || tokens.revoked_at) {
      throw new GoogleAuthError("no_grant", "Google account is not connected");
    }
    return tokens;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError("unavailable", "Google token state unavailable");
  }
}

// Plain GET remains session-scoped for product calendar events; only `sync=now`
// enters the parent gate before collection or token work. calendarId → Google
// colorRgb, so the client can paint each synced event in its own calendar's color
// (mapGoogleEvent's colorHex passthrough).
async function calendarColors(): Promise<Record<string, string>> {
  const rows = await readCalendarSyncRows().catch(() => []);
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
    const events = await readCachedEvents();
    const tokens = await readTokensStrict();
    if (partialSync) {
      return NextResponse.json({
        ok: false,
        partial: true,
        stale: true,
        error: "calendar_partial_failure",
        source: "google",
        account_email: tokens?.account_email || null,
        last_sync_at: tokens?.granted_at || null,
        calendar_colors: await calendarColors(),
        events,
      }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      connected: true,
      source: "google",
      account_email: tokens?.account_email || null,
      last_sync_at: tokens?.granted_at || null,
      calendar_colors: await calendarColors(),
      events,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError && error.code === "no_grant") {
      return noGrantResponse();
    }
    return authErrorResponse(error);
  }
}
