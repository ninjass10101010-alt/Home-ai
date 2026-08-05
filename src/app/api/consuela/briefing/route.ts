import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { localTodayISO } from "@/lib/local-date";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawScopeDate = request.nextUrl.searchParams.get("scopeDate");
  // M-C — the scopeDate flows into PB filters; reject anything that is not a
  // strict YYYY-MM-DD date (mirrors the L10 threadId hardening on /chat/messages).
  if (rawScopeDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(rawScopeDate)) {
    return NextResponse.json({ error: "invalid scopeDate" }, { status: 400 });
  }
  const scopeDate = rawScopeDate || localTodayISO();
  const briefing = await db.selectMorningBriefing(scopeDate);
  return NextResponse.json({ ok: true, briefing });
}

export async function PATCH(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.ackMorningBriefing(id);
  return NextResponse.json({ ok: true });
}
