import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import {
  readConnectionSnapshot,
  reconcileGoogleConnection,
} from "@/lib/google/connection-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  try {
    let snapshot = await readConnectionSnapshot();
    if (!snapshot.connectedAccountId || snapshot.status !== "ACTIVE") {
      try {
        snapshot = await reconcileGoogleConnection();
      } catch {
        // Keep the snapshot we already read; a transient broker failure must
        // not turn a known connection into an unavailable state.
      }
    }
    const connected = !!snapshot.connectedAccountId && snapshot.status === "ACTIVE";
    const pending = !connected
      && (snapshot.status === "INITIALIZING" || snapshot.status === "INITIATED");
    return NextResponse.json({
      ok: true,
      connected,
      pending,
      connection_status: snapshot.status ?? null,
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
