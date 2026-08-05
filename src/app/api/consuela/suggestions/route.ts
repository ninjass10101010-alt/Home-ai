import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(200, Math.max(1, rawLimit));
  const items = await db.selectPendingSuggestions({ limit });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest) {
  const { id, status, snoozedUntil } = await request.json();
  if (!id || (!status && !snoozedUntil)) return NextResponse.json({ error: "id + status or snoozedUntil required" }, { status: 400 });
  await db.updateSuggestion(id, { status, snoozedUntil });
  return NextResponse.json({ ok: true });
}
