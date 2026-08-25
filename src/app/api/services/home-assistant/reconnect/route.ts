import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { resetHABridge, startHABridge } from "@/lib/ha/bridge";

export const dynamic = "force-dynamic";

// Services & Keys companion: after editing HA credentials, restart the
// WebSocket bridge so it dials with the new config — no container restart.
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    await resetHABridge();
    await startHABridge();
    return NextResponse.json({ ok: true, message: "HA bridge reconnecting with current configuration" });
  } catch (err) {
    console.error("[services/ha-reconnect] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
