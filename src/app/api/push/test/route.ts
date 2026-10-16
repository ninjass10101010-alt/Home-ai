import { NextResponse } from "next/server";
import { requireLiveSession } from "@/lib/server-auth";
import { pushFanout } from "@/lib/push/fanout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireLiveSession(request, { requireRole: "parent" });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await pushFanout({
    title: "🔔 Test notification",
    body: "Push notifications are working on this device.",
    url: "/",
  });
  if (result.skipped === "push_not_configured") {
    return NextResponse.json({ ok: false, error: "push_not_configured", ...result }, { status: 409 });
  }
  return NextResponse.json({ ok: true, ...result });
}
