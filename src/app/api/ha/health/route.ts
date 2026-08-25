import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { getHABridgeStatus } from "@/lib/ha/bridge";

export async function GET() {
  const client = await getHAWebSocketClient();
  return NextResponse.json({
    ok: true,
    wsStatus: client.status,
    wsConnected: client.status === "connected",
    bridge: getHABridgeStatus(),
  });
}
