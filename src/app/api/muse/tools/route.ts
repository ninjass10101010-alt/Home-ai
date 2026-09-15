import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import { museToolCatalog } from "@/lib/muse/execute";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The MUSE tool catalog. Admin tools are included only when the caller's
 * token is admin (the intersection of the token claim and the live row).
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ ok: true, tools: museToolCatalog(auth.adm) });
}
