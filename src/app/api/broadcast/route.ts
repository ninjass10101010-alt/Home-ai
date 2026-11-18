import { NextRequest, NextResponse } from "next/server";
import {
  publishBroadcast,
  waitForBroadcast,
  getLatestBroadcastId,
} from "@/lib/broadcast";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const since = searchParams.get("since") || undefined;
    const timeoutRaw = searchParams.get("timeout");
    let timeoutMs = 25000;
    if (timeoutRaw) {
      const parsed = parseInt(timeoutRaw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        timeoutMs = Math.min(parsed, 30000); // Cap at 30s
      }
    }

    const broadcasts = await waitForBroadcast(since, timeoutMs);
    return NextResponse.json({
      ok: true,
      broadcasts,
      latestId: getLatestBroadcastId(),
    });
  } catch (error: any) {
    console.error("[api/broadcast GET] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to poll broadcasts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = body?.message;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Missing or empty "message" in request body' },
        { status: 400 }
      );
    }

    const broadcast = await publishBroadcast(message.trim(), {
      title: body?.title,
      sender: body?.sender,
    });

    return NextResponse.json({
      ok: true,
      broadcast,
    });
  } catch (error: any) {
    console.error("[api/broadcast POST] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to publish broadcast" },
      { status: 500 }
    );
  }
}
