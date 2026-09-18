import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import { museToolCatalog } from "@/lib/muse/execute";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The MUSE tool catalog. Admin tools are included only when the live
 * `adminEnabled` operator toggle is on — it takes effect immediately for
 * tokens that were minted before it was switched on.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ ok: true, tools: museToolCatalog(auth.adm) });
}
