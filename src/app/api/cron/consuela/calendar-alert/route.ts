import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { calendarLeadDecisions, IMPORTANCE_THRESHOLD, type AlertedRef } from "@/lib/ha/alerts";
import { localTodayISO } from "@/lib/local-date";
import { loadAlertState, saveAlertState, type PBAlertState } from "@/lib/ha/alert-state";
import { withKeyedLock } from "@/lib/keyed-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_KEY = "calendar-alert";

interface EventRow {
  id: string;
  title: string;
  date: string;
  time?: string;
  importanceScore?: number;
}

interface PB {
  collection: (name: string) => {
    getFullList: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
  };
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const today = localTodayISO(now);

  const { prefs, events } = await withAdmin(async (rawPb) => {
    const pb = rawPb as unknown as PB;
    const prefs = (await pb.collection("ha_notify_prefs").getFullList()) as Array<{ key: string; enabled?: boolean }>;

    let events: EventRow[] = [];
    try {
      events = (await pb.collection("events").getFullList({
        filter: `date="${today}" && importanceScore >= ${IMPORTANCE_THRESHOLD}`,
        requestKey: null,
      })) as unknown as EventRow[];
    } catch {
      const all = (await pb.collection("events").getFullList({ requestKey: null })) as unknown as EventRow[];
      events = all.filter((e) => e.date === today && (e.importanceScore ?? 0) >= IMPORTANCE_THRESHOLD);
    }

    return { prefs, events };
  });

  if (!prefs.some((p) => p.key === "calendar" && p.enabled === true)) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  try {
    // Serialize load→decide→push→save against overlapping cron runs
    // (in-process keyed lock) and refuse stale writes (CAS on the saved
    // row). Before this, two overlapping runs both read the same dedupe
    // list, BOTH pushed the same event, and the second save could drop the
    // first's delivered refs — a double push that never stops re-firing.
    const { deliveredCount, saved } = await withKeyedLock(`ha-alert-state:${STATE_KEY}`, async () => {
      const loaded = await withAdmin((rawPb) => loadAlertState(rawPb as unknown as PBAlertState, STATE_KEY));
      const alerted = Array.isArray((loaded.value as { alerted?: AlertedRef[] }).alerted)
        ? ((loaded.value as { alerted: AlertedRef[] }).alerted as AlertedRef[])
        : [];

      const { alerts } = calendarLeadDecisions({ events, now, alerted });
      const delivered: AlertedRef[] = [];
      for (const a of alerts) {
        const { sent } = await broadcastHouseAlert(
          `📅 ${a.title}`,
          `Starts at ${a.time} — about ${a.minutesLeft} min from now.`
        );
        // Only ids actually delivered are remembered; a failed push retries next run.
        if (sent > 0) delivered.push({ id: a.id, date: today });
      }

      // Persist: prior refs pruned to the last 48h, plus the newly delivered ones.
      const horizon = now.getTime() - 48 * 60 * 60_000;
      const pruned = alerted.filter((a) => {
        const st = new Date(`${a.date}T23:59:00`).getTime();
        return isFinite(st) ? st > horizon : true;
      });
      const merged = [...pruned];
      const seen = new Set(merged.map((a) => `${a.id}|${a.date}`));
      for (const d of delivered) if (!seen.has(`${d.id}|${d.date}`)) merged.push(d);

      const saved = await withAdmin((rawPb) =>
        saveAlertState(rawPb as unknown as PBAlertState, STATE_KEY, { alerted: merged }, loaded.raw)
      );
      return { deliveredCount: delivered.length, saved };
    });

    return NextResponse.json({
      ok: true,
      fired: deliveredCount,
      // The CAS refused our (already-pushed) write — another writer won the
      // row; its delivered refs stand and the next run reconciles.
      ...(saved ? {} : { stateConflict: true }),
    });
  } catch (err) {
    console.warn("[cron/calendar-alert]", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
