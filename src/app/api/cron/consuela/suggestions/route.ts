import { NextRequest, NextResponse } from "next/server";
import { runEngine } from "@/lib/consuela/engine";
import { db } from "@/db";
import { localTodayISO } from "@/lib/local-date";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// M-B — suggestions created 5pm–midnight local time must land on today's
// (local) scopeDate, not tomorrow's UTC date. The briefing generator already
// uses localTodayISO; the engine scan entry point must match it.
function weekAgoISO(): string { return new Date(Date.now() - 7 * 86400_000).toISOString(); }

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runEngine({ scopeDate: localTodayISO() });
  await db.deleteStaleSuggestions(weekAgoISO());
  try {
    for (const s of result.insertedSuggestions ?? []) {
      await (await import("@/lib/push/fanout")).pushFanout({ title: "Consuela suggests", body: s.title, url: "/suggestions" });
    }
  } catch (err) {
    console.warn("[cron/suggestions] push fanout failed", err);
  }
  return NextResponse.json({ ok: true, ...result });
}
