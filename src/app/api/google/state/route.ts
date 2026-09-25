import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { readPublicState } from "@/lib/google/token-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  const result = await readPublicState();
  if (result.status === "unavailable") {
    return NextResponse.json(
      { ok: false, state: "unavailable", error: result.error },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, ...result.state });
}
