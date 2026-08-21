import { NextResponse } from "next/server";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";

export async function GET() {
  const client = getHAWebSocketClient();
  return NextResponse.json({
    ok: true,
    wsStatus: client.status,
    wsConnected: client.status === "connected",
  });
}
