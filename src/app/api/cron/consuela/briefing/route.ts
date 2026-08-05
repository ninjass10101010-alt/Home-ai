import { NextRequest, NextResponse } from "next/server";
import { generateBriefing } from "@/lib/consuela/briefing";

export const dynamic = "force-dynamic";

function todayISO(): string { return new Date().toISOString().split("T")[0]; }

export async function POST(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await generateBriefing({ scopeDate: todayISO() });
  return NextResponse.json({ ok: true, summary });
}
