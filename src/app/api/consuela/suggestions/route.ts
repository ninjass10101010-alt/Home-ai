import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { verifyPinAgainstAnyMember } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// C3 — write routes (PATCH) require a family-member PIN verified server-side
// against PocketBase. GET stays public (read-only; the data is shown on the
// dashboard anyway).
const PIN_HEADER = "x-consuela-pin";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const pin =
    request.headers.get(PIN_HEADER) || request.cookies.get(PIN_HEADER)?.value || "";
  if (!pin) return false;
  const member = await verifyPinAgainstAnyMember(pin);
  return member !== null;
}

export async function GET(request: NextRequest) {
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(200, Math.max(1, rawLimit));
  const items = await db.selectPendingSuggestions({ limit });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "pin required" }, { status: 401 });
  }
  const { id, status, snoozedUntil } = await request.json();
  if (!id || (!status && !snoozedUntil)) return NextResponse.json({ error: "id + status or snoozedUntil required" }, { status: 400 });
  // M-D — a PB failure must not surface as a 500; report ok:false instead
  // (the act route already try/catches the same way).
  try {
    await db.updateSuggestion(id, { status, snoozedUntil });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "update failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
