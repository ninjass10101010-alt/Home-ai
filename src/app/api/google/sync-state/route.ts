import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { readCalendarSyncRows } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // Per-calendar rows live in consuela_google_calendar_sync (Fix-C). The
    // legacy resource-keyed table still owns the tasks row, and its
    // resource="calendar" row is the pre-migration fallback for
    // calendar_last_sync_at.
    const [calRows, legacyMap] = await Promise.all([
      readCalendarSyncRows().catch(() => []),
      withAdmin(async (pb) => {
        const rows = await pb.collection("consuela_google_sync_state").getFullList({ requestKey: null });
        const map: Record<string, string | null> = {};
        for (const r of rows) {
          if (r.resource && r.last_sync_at) map[r.resource] = r.last_sync_at;
        }
        return map;
      }),
    ]);

    const calendars = calRows.map((r) => ({
      calendar_id: r.calendar_id,
      summary: r.summary || r.calendar_id,
      selected: r.selected,
      last_sync_at: r.last_sync_at,
      last_status: r.last_status,
      last_error: r.last_error,
    }));

    let calendarLastSyncAt: string | null = null;
    for (const r of calRows) {
      if (r.selected && r.last_sync_at && (!calendarLastSyncAt || r.last_sync_at > calendarLastSyncAt)) {
        calendarLastSyncAt = r.last_sync_at;
      }
    }
    // Only fall back to the legacy row when the per-calendar table is EMPTY
    // (pre-migration install). With rows present but none selected, the
    // legacy timestamp is never updated — serving it would read as "live".
    if (!calendarLastSyncAt && calRows.length === 0) {
      calendarLastSyncAt = legacyMap.calendar || null;
    }

    return NextResponse.json({
      ok: true,
      calendar_last_sync_at: calendarLastSyncAt,
      tasks_last_sync_at: legacyMap.tasks || null,
      calendars,
    });
  } catch (e: any) {
    console.error("[google/sync-state]", e);
    return NextResponse.json(
      { ok: false, calendar_last_sync_at: null, tasks_last_sync_at: null, calendars: [], error: e?.message || "Failed" },
      { status: 500 },
    );
  }
}
