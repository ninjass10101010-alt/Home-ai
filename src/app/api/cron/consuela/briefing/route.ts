import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/consuela/briefing";
import { db } from "@/db";
import { localTodayISO } from "@/lib/local-date";

export const dynamic = "force-dynamic";

function todayISO(): string { return localTodayISO(); }

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
  return NextResponse.json({ ok: true, summary });
}
