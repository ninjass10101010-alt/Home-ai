import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANNEL_TOKEN = process.env.GOOGLE_WEBHOOK_CHANNEL_TOKEN || "";

export async function POST(req: NextRequest) {
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceId = req.headers.get("x-goog-resource-id");

  if (CHANNEL_TOKEN && channelToken !== CHANNEL_TOKEN) {
    return NextResponse.json({ ok: false, error: "Invalid channel token" }, { status: 403 });
  }

  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, ignored: "initial sync message" });
  }

  if (channelId) {
    try {
      const { syncCalendar } = await import("@/lib/google/calendar");
      await syncCalendar().catch((e) => {
        console.error("[google/webhook] calendar sync failed:", e?.message);
      });
      const { syncTasks } = await import("@/lib/google/tasks");
      await syncTasks().catch((e) => {
        console.error("[google/webhook] tasks sync failed:", e?.message);
      });
    } catch (e: any) {
      console.error("[google/webhook]", e);
    }
  }

  return NextResponse.json({ ok: true, received: true, resourceId });
}
