import { NextRequest, NextResponse } from "next/server";
import { syncGroceryMirror } from "@/lib/ha/todo-mirror";

export const dynamic = "force-dynamic";

/** 5-min cron: one-way Consuela grocery → HA todo mirror. */
export async function POST(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (request.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncGroceryMirror();
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[ha-mirror] sync failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, reason: "sync_error" });
  }
}
