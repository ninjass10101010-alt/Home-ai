import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await withAdmin(async (pb) => {
      const rows = await pb.collection("consuela_google_sync_state").getFullList({ requestKey: null });
      const map: Record<string, string | null> = {};
      for (const r of rows) {
        if (r.resource && r.last_sync_at) map[r.resource] = r.last_sync_at;
      }
      return {
        calendar_last_sync_at: map.calendar || null,
        tasks_last_sync_at: map.tasks || null,
      };
    });
    return NextResponse.json({ ok: true, ...state });
  } catch (e: any) {
    console.error("[google/sync-state]", e);
    return NextResponse.json(
      { ok: false, calendar_last_sync_at: null, tasks_last_sync_at: null, error: e?.message || "Failed" },
      { status: 500 },
    );
  }
}
