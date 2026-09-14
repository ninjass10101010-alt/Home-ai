import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { calendarLeadDecisions, IMPORTANCE_THRESHOLD, type AlertedRef } from "@/lib/ha/alerts";
import { localTodayISO } from "@/lib/local-date";

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
    getFirstListItem: (filter: string) => Promise<{ id: string; value?: unknown }>;
    create: (data: Record<string, unknown>) => Promise<unknown>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  };
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const today = localTodayISO(now);

  const { prefs, events, alerted } = await withAdmin(async (rawPb) => {
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

    let alerted: AlertedRef[] = [];
    try {
      const row = await pb.collection("ha_alert_state").getFirstListItem(`key="${STATE_KEY}"`);
      const parsed = JSON.parse(String(row.value ?? "{}")) as { alerted?: AlertedRef[] };
      if (Array.isArray(parsed.alerted)) alerted = parsed.alerted;
    } catch (err) {
      if ((err as { status?: number })?.status !== 404) throw err;
    }

    return { prefs, events, alerted };
  });

  if (!prefs.some((p) => p.key === "calendar" && p.enabled === true)) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  try {
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

    await withAdmin(async (rawPb) => {
      const pb = rawPb as unknown as PB;
      const collection = pb.collection("ha_alert_state");
      const payload = { key: STATE_KEY, value: JSON.stringify({ alerted: merged }) };
      try {
        const existing = await collection.getFirstListItem(`key="${STATE_KEY}"`);
        await collection.update(existing.id, payload);
      } catch (err) {
        if ((err as { status?: number })?.status === 404) await collection.create(payload);
        else throw err;
      }
    });

    return NextResponse.json({ ok: true, fired: delivered.length });
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
