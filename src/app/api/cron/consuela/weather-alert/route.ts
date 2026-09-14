import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { withAdmin } from "@/lib/pb-auth";
import { broadcastHouseAlert } from "@/lib/ha/notify";
import { readSevereWeather } from "@/lib/ha/weather-alert-fetch";
import { weatherEpisodeDecision, type EpisodeState } from "@/lib/ha/alerts";
import { severeFamily } from "@/lib/weather-severity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_KEY = "weather-alert";
const CLOSED: EpisodeState = { active: false, startedAtISO: null, family: null, alertedAtISO: null };

interface PB {
  collection: (name: string) => {
    getFullList: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
    getFirstListItem: (filter: string) => Promise<{ id: string; value?: unknown }>;
    create: (data: Record<string, unknown>) => Promise<unknown>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  };
}

async function prefEnabled(pb: PB): Promise<boolean> {
  const rows = await pb.collection("ha_notify_prefs").getFullList();
  return rows.some((r) => r.key === "weather" && r.enabled === true);
}

async function loadState(pb: PB): Promise<EpisodeState> {
  try {
    const row = await pb.collection("ha_alert_state").getFirstListItem(`key="${STATE_KEY}"`);
    return { ...CLOSED, ...(JSON.parse(String(row.value ?? "{}")) as Partial<EpisodeState>) };
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return CLOSED;
    throw err;
  }
}

async function saveState(pb: PB, state: EpisodeState): Promise<void> {
  const collection = pb.collection("ha_alert_state");
  const payload = { key: STATE_KEY, value: JSON.stringify(state) };
  try {
    const existing = await collection.getFirstListItem(`key="${STATE_KEY}"`);
    await collection.update(existing.id, payload);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) {
      await collection.create(payload);
      return;
    }
    throw err;
  }
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  try {
    const enabled = await withAdmin((pb) => prefEnabled(pb as unknown as PB));
    if (!enabled) return NextResponse.json({ ok: true, skipped: "disabled" });

    const { code, severeEndISO } = await readSevereWeather(now);
    const state = await withAdmin((pb) => loadState(pb as unknown as PB));
    const decision = weatherEpisodeDecision({ code, severeEndISO, now, state });

    let nextState = decision.nextState;
    if (decision.fire) {
      const { sent } = await broadcastHouseAlert(decision.title!, decision.message!);
      // Only stamp alerted when something actually landed — a dead channel
      // retries on the next run instead of silently swallowing the alert.
      nextState = { ...nextState, alertedAtISO: sent > 0 ? now.toISOString() : null };
    }
    await withAdmin((pb) => saveState(pb as unknown as PB, nextState));
    return NextResponse.json({ ok: true, fired: decision.fire, severe: code != null ? severeFamily(code) : null });
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
