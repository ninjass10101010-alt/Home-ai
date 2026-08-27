import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { getHABridgeStatus } from "@/lib/ha/bridge";

export async function GET() {
  try {
    const client = await getHAWebSocketClient();
    return NextResponse.json({
      ok: true,
      wsStatus: client.status,
      wsConnected: client.status === "connected",
      bridge: getHABridgeStatus(),
    });
  } catch {
    // HA_HOST/HA_TOKEN absent (or config unreadable) — report the
    // unconfigured state honestly instead of a bare 500.
    return NextResponse.json({
      ok: false,
      configured: false,
      reason: "not_configured",
      wsStatus: "disconnected",
      wsConnected: false,
    });
  }
}
