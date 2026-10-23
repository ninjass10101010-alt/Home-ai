import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { isGoogleConnected, readConnectionSnapshot } from "@/lib/google/connection-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  try {
    const connected = await isGoogleConnected();
    const snapshot = await readConnectionSnapshot();
    return NextResponse.json({
      ok: true,
      connected,
      account_email: snapshot.accountEmail ?? null,
      granted_at: snapshot.connectedAt ?? null,
      revoked_at: null,
      expires_at: null,
      scope: null,
      minutes_until_expiry: null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, state: "unavailable", error: "google_state_unavailable" },
      { status: 503 },
    );
  }
}
