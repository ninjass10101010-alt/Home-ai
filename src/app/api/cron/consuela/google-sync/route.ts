import { NextRequest, NextResponse } from "next/server";
import { syncCalendar } from "@/lib/google/calendar";
import { checkQuota } from "@/lib/google/quota-guard";
import { isGoogleConnected } from "@/lib/google/oauth-client";
import { ensureGoogleCollections } from "@/lib/google/pb-collections";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await isGoogleConnected())) {
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
    return NextResponse.json({ ok: true, result, quota });
  } catch (e: any) {
    console.error("[cron/google-sync]", e);
    return NextResponse.json(
      { ok: false, code: "unknown", error: e?.message || "Sync failed" },
      { status: 500 },
    );
  }
}
