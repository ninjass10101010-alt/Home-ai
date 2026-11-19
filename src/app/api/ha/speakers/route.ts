import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import {
  getSpeakerBroadcastConfig,
  listHASpeakers,
  saveSpeakerBroadcastConfig,
  type HASpeaker,
  type SpeakerBroadcastConfig,
} from "@/lib/ha/speakers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status ?? 401 }
    );
  }

  let speakers: HASpeaker[] = [];
  let haWarning: string | undefined;
  try {
    speakers = await listHASpeakers();
  } catch (err) {
    haWarning = err instanceof Error ? err.message : String(err);
  }

  let config: SpeakerBroadcastConfig | undefined;
  let warning: string | undefined;
  try {
    config = await getSpeakerBroadcastConfig();
  } catch (err) {
    warning = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: true,
    speakers,
    config,
    ...(haWarning ? { haWarning } : {}),
    ...(warning ? { warning } : {}),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status ?? 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const patch: Partial<SpeakerBroadcastConfig> = {};

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_enabled" }, { status: 400 });
    }
    patch.enabled = raw.enabled;
  }

  if (raw.entities !== undefined) {
    if (
      !Array.isArray(raw.entities) ||
      !raw.entities.every((e) => typeof e === "string" && e.trim().startsWith("media_player."))
    ) {
      return NextResponse.json({ ok: false, error: "invalid_entities" }, { status: 400 });
    }
    patch.entities = raw.entities;
  }

  for (const key of ["announceChat", "announceRoutines", "announceCalendar", "announceWeather"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "boolean") {
        return NextResponse.json({ ok: false, error: `invalid_${key}` }, { status: 400 });
      }
      patch[key] = raw[key];
    }
  }

  if (raw.volume !== undefined) {
    if (raw.volume !== null && (typeof raw.volume !== "number" || !Number.isFinite(raw.volume))) {
      return NextResponse.json({ ok: false, error: "invalid_volume" }, { status: 400 });
    }
    patch.volume = raw.volume;
  }

  try {
    const config = await saveSpeakerBroadcastConfig(patch);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
