import { NextRequest, NextResponse } from "next/server";
import { syncCalendar } from "@/lib/google/calendar";
import { checkQuota } from "@/lib/google/quota-guard";
import { isGoogleConnected, mapGoogleAuthError } from "@/lib/google/oauth-client";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authErrorResponse(error: unknown) {
  const mapped = mapGoogleAuthError(error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let connected: boolean;
  try {
    connected = await isGoogleConnected();
  } catch (error) {
    return authErrorResponse(error);
  }
  if (!connected) {
    return NextResponse.json(
      { ok: false, code: "no_grant", error: "Google account is not connected" },
      { status: 409 },
    );
  }

  try {
    await ensureGoogleCollections();

    const quota = await checkQuota();
    if (!quota.ok) {
      return NextResponse.json({ ...quota, reason: "quota" });
    }

    const result = await syncCalendar();
    // L8 — a concurrent sync (cron double-fire or manual "Sync now") holds the
    // in-process lock; report the skip instead of running in parallel.
    if (result && "skipped" in result) {
      return NextResponse.json({ ok: false, reason: "already_in_progress" });
    }
    if (result && "perCalendar" in result && Array.isArray(result.perCalendar) && result.perCalendar.some((entry) => entry.ok === false)) {
      return NextResponse.json({
        ok: false,
        partial: true,
        error: "calendar_partial_failure",
        result,
        quota,
      }, { status: 502 });
    }
    return NextResponse.json({ ok: true, result, quota });
  } catch (error) {
    return authErrorResponse(error);
  }
}
