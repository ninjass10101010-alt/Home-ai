import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/consuela/briefing";
import { db } from "@/db";
import { localTodayISO } from "@/lib/local-date";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";

export const dynamic = "force-dynamic";

function todayISO(): string { return localTodayISO(); }

/** Push the 7am digest only when the family enabled it in Settings. */
async function briefingPushEnabled(): Promise<boolean> {
  try {
    return await withAdmin(async (pb) => {
      try {
        const row = await pb.collection("ha_notify_prefs").getFirstListItem('key="briefing"');
        return row.enabled === true;
      } catch (err) {
        if ((err as { status?: number })?.status === 404) return false;
        throw err;
      }
    });
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scopeDate = todayISO();
  // L3 — idempotency: if a briefing for today already exists (e.g. the host
  // crontab double-fired, or the app was restarted after the 7am run), skip.
  // Skipping is least surprising — regenerating would clobber the user's "Got
  // it" acknowledgment.
  const existing = await db.selectMorningBriefing(scopeDate);
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, briefing: existing });
  }
  const summary = await generateBriefing({ scopeDate });

  let notified: { sent: number } | null = null;
  try {
    if (await briefingPushEnabled()) {
      const result = await broadcastHouseAlert(
        "☀️ Morning briefing is ready",
        "Open Consuela for today's events, chores, meals, and what she noticed."
      );
      notified = { sent: result.sent };
    }
  } catch (err) {
    console.warn("[briefing] house-alert push failed:", err);
  }

  return NextResponse.json({ ok: true, summary, ...(notified ? { notified } : null) });
}
