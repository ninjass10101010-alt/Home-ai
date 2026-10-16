import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { pushFanout } from "@/lib/push/fanout";
import { calendarLeadDecisions, IMPORTANCE_THRESHOLD, type AlertedRef } from "@/lib/ha/alerts";
import { routineLeadDecisions, eventNotifyDecisions } from "@/lib/push/decisions";
import { localTodayISO } from "@/lib/local-date";
import { loadAlertState, saveAlertState, type PBAlertState } from "@/lib/ha/alert-state";
import { withKeyedLock } from "@/lib/keyed-lock";
import { weekdayOfISO } from "@/lib/local-date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_KEY = "calendar-alert";

interface EventRow {
  id: string;
  title: string;
  date: string;
  time?: string;
  importanceScore?: number;
  notify?: boolean;
}

interface ScheduleRow {
  id: string;
  title?: string;
  time?: string;
  days?: string;
  notify?: boolean;
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
        if (sent > 0) delivered.push({ id: a.id, date: today });
      }

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

    // Schedule + notify-event second lane, never throw.
    try {
      await withKeyedLock("ha-alert-state:routine-alert", async () => {
        const wd = now.toLocaleString("en-US", { weekday: "short" });
        const wdIndex = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wd.toLowerCase()) + 7) % 7;
        const { routines: loadedSchedules, allEvents } = await withAdmin(async (rawPb) => {
          const pb = rawPb as unknown as PB;
          const schedules = (await pb.collection("schedules").getFullList({ requestKey: null })) as unknown as ScheduleRow[];
          let eventsAll: EventRow[] = [];
          try {
            eventsAll = (await pb.collection("events").getFullList({ requestKey: null })) as unknown as EventRow[];
          } catch {
            eventsAll = [];
          }
          return { routines: schedules, allEvents: eventsAll };
        });
        const routinesToday = loadedSchedules.map((s) => ({ id: s.id, title: s.title, time: s.time, days: s.days, notify: s.notify }));

        const stateLoaded = await withAdmin((rawPb) => loadAlertState(rawPb as unknown as PBAlertState, "routine-alert"));
        const alerted = Array.isArray((stateLoaded.value as { alerted?: AlertedRef[] }).alerted)
          ? ((stateLoaded.value as { alerted: AlertedRef[] }).alerted as AlertedRef[])
          : [];

        const { alerts: routineAlerts, nextState: nextRoutine } = routineLeadDecisions({
          routines: routinesToday,
          now,
          alerted,
          weekdayShort: wd,
          weekdayIndex: wdIndex,
          dateKey: today,
        });

        const { alerts: eventAlerts, nextState: nextState } = eventNotifyDecisions({
          events: allEvents.map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time, notify: e.notify })),
          now,
          alerted: nextRoutine,
          todayISO: today,
        });
        const allAlerts = [...routineAlerts, ...eventAlerts];

        for (const a of allAlerts) {
          await pushFanout({
            title: `⏰ ${a.title}`,
            body: `Starts at ${a.time} — about ${a.minutesLeft} min from now.`,
            url: "/calendar",
          });
        }

        // Persist BOTH cores' refs: eventNotifyDecisions was seeded with
        // nextRoutine and returns the merged (pruned routine + event) state, so
        // a delivered event cannot re-fire on the next 15-min run.
        await withAdmin((rawPb) => saveAlertState(rawPb as unknown as PBAlertState, "routine-alert", { alerted: nextState }, stateLoaded.raw));
      });
    } catch (err) {
      console.warn("[cron/calendar-alert] routine lane", err);
    }

    return NextResponse.json({
      ok: true,
      fired: deliveredCount,
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
