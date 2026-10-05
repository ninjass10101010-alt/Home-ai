import { withKeyedLock } from "@/lib/keyed-lock";
import { withAdmin } from "../pb-auth.ts";

// Legacy name kept only for the cleared Google cache: the direct Device Flow
// token store is gone (Composio is the only connect path). This helper is
// still called by the Composio disconnect route to purge the cached calendar
// selection/events so a reconnect starts from a clean slate.
const CACHE_LOCK = "google-calendar-cache";

export async function clearCalendarCache(): Promise<boolean> {
  return withKeyedLock(CACHE_LOCK, () => withAdmin(async (pb) => {
    const eventRows = await pb.collection("consuela_google_calendar_events").getFullList({ requestKey: null });
    for (const row of eventRows as any[]) {
      await pb.collection("consuela_google_calendar_events").delete(row.id, { requestKey: null });
    }
    const calendarRows = await pb.collection("consuela_google_calendar_sync").getFullList({ requestKey: null });
    for (const row of calendarRows as any[]) {
      await pb.collection("consuela_google_calendar_sync").delete(row.id, { requestKey: null });
    }
    const legacyRows = await pb.collection("consuela_google_sync_state").getFullList({ requestKey: null });
    for (const row of legacyRows as any[]) {
      if (row.resource === "calendar") {
        await pb.collection("consuela_google_sync_state").delete(row.id, { requestKey: null });
      }
    }
    return true;
  }));
}
