import { NextRequest, NextResponse } from "next/server";
import { composeScreensaverPayload } from "@/lib/screensaver/payload";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const payload = await composeScreensaverPayload();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ ok: false, error: "db_unreachable" }, { status: 503 });
  }
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
