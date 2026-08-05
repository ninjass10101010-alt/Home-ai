import { NextRequest, NextResponse } from "next/server";
import { runEngine } from "@/lib/consuela/engine";
import { db } from "@/db";

export const dynamic = "force-dynamic";

function todayISO(): string { return new Date().toISOString().split("T")[0]; }
function weekAgoISO(): string { return new Date(Date.now() - 7 * 86400_000).toISOString(); }

export async function POST(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runEngine({ scopeDate: todayISO() });
  await db.deleteStaleSuggestions(weekAgoISO());
  return NextResponse.json({ ok: true, ...result });
}
