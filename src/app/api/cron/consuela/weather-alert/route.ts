import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { readSevereWeather } from "@/lib/ha/weather-alert-fetch";
import { weatherEpisodeDecision, type EpisodeState } from "@/lib/ha/alerts";
import { severeFamily } from "@/lib/weather-severity";
import { loadAlertState, saveAlertState, type PBAlertState } from "@/lib/ha/alert-state";
import { withKeyedLock } from "@/lib/keyed-lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_KEY = "weather-alert";
const CLOSED: EpisodeState = { active: false, startedAtISO: null, family: null, alertedAtISO: null };

interface PB {
  collection: (name: string) => {
    getFullList: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
  };
}

async function prefEnabled(pb: PB): Promise<boolean> {
  const rows = await pb.collection("ha_notify_prefs").getFullList();
  return rows.some((r) => r.key === "weather" && r.enabled === true);
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  try {
    const enabled = await withAdmin((pb) => prefEnabled(pb as unknown as PB));
    if (!enabled) return NextResponse.json({ ok: true, skipped: "disabled" });

    const { code, severeEndISO } = await readSevereWeather(now);

    // Serialize load→decide→push→save against overlapping cron runs
    // (in-process keyed lock) and refuse stale writes (CAS on the saved
    // row). Before this, two overlapping runs both read `alertedAtISO: null`,
    // BOTH pushed the episode alert, and the second save clobbered the
    // first — a double push and a lost alerted stamp that re-fires later.
    const { fired, saved } = await withKeyedLock(`ha-alert-state:${STATE_KEY}`, async () => {
      const loaded = await withAdmin((pb) => loadAlertState(pb as unknown as PBAlertState, STATE_KEY));
      const state = { ...CLOSED, ...loaded.value } as EpisodeState;
      const decision = weatherEpisodeDecision({ code, severeEndISO, now, state });

      let nextState = decision.nextState;
      if (decision.fire) {
        const { sent } = await broadcastHouseAlert(decision.title!, decision.message!);
        // Only stamp alerted when something actually landed — a dead channel
        // retries on the next run instead of silently swallowing the alert.
        nextState = { ...nextState, alertedAtISO: sent > 0 ? now.toISOString() : null };
      }
      const saved = await withAdmin((pb) =>
        saveAlertState(pb as unknown as PBAlertState, STATE_KEY, nextState as unknown as Record<string, unknown>, loaded.raw)
      );
      return { fired: decision.fire, saved };
    });

    return NextResponse.json({
      ok: true,
      fired,
      severe: code != null ? severeFamily(code) : null,
      // The CAS refused our (already-pushed) write — another writer won the
      // row; its alerted stamp stands and the next run reconciles.
      ...(saved ? {} : { stateConflict: true }),
    });
  } catch (err) {
    console.warn("[cron/weather-alert]", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
