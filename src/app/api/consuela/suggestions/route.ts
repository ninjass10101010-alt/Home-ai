import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await db.selectPendingSuggestions({ limit: 20 });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest) {
  const { id, status, snoozedUntil } = await request.json();
  if (!id || !status) return NextResponse.json({ error: "id+status required" }, { status: 400 });
  await db.updateSuggestion(id, { status, snoozedUntil });
  return NextResponse.json({ ok: true });
}
