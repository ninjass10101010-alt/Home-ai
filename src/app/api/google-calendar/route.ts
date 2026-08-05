import { NextRequest, NextResponse } from "next/server";
import { isGoogleConnected, GoogleAuthError } from "@/lib/google/oauth-client";
import { readCachedEvents, syncCalendar } from "@/lib/google/calendar";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { getStoredTokens } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sync = searchParams.get("sync");

  try {
    await ensureGoogleCollections();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, events: [], error: "PocketBase not reachable: " + (e?.message || "unknown") },
      { status: 200 },
    );
  }

  const connected = await isGoogleConnected();

  if (!connected) {
    return NextResponse.json({
      ok: true,
      connected: false,
      source: "static",
      events: [],
    });
  }

  if (sync === "now") {
    try {
      await syncCalendar();
    } catch (e: any) {
      if (e instanceof GoogleAuthError) {
        return NextResponse.json(
          { ok: false, connected: true, code: e.code, error: e.message, events: [] },
          { status: e.code === "no_grant" ? 409 : 401 },
        );
      }
      console.error("[google-calendar] sync-now failed:", e?.message);
    }
  }

  try {
    const events = await readCachedEvents();
    const tokens = await getStoredTokens();
    return NextResponse.json({
      ok: true,
      connected: true,
      source: "google",
      account_email: tokens?.account_email || null,
      last_sync_at: tokens?.granted_at || null,
      events,
    });
  } catch (e: any) {
    console.error("[google-calendar] read failed:", e?.message);
    return NextResponse.json(
      { ok: false, connected: true, events: [], error: e?.message },
      { status: 200 },
    );
  }
}
