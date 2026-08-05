import { NextResponse } from "next/server";
import { getPublicState } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await getPublicState();
    return NextResponse.json({ ok: true, ...state });
  } catch (e: any) {
    console.error("[google/state]", e);
    return NextResponse.json(
      { ok: false, connected: false, error: e?.message || "Failed to read Google state" },
      { status: 500 },
    );
  }
}
