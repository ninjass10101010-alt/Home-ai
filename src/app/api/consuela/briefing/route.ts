import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const scopeDate = request.nextUrl.searchParams.get("scopeDate") || undefined;
  const briefing = await db.selectMorningBriefing(scopeDate);
  return NextResponse.json({ ok: true, briefing });
}

export async function PATCH(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.ackMorningBriefing(id);
  return NextResponse.json({ ok: true });
}
