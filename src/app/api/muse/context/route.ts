import { NextRequest, NextResponse } from "next/server";
import { authorizeMuseRequest } from "@/lib/muse/auth";
import {
  loadContextPack,
  composeContextPrompt,
  type ContextPack,
} from "@/lib/consuela/assistant-context";

// node:crypto (token HMAC) — this surface must never run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/muse/context?scope=meal|task|schedule|all
//
// A live snapshot of the family's dashboard state for the calling MUSE agent.
// The scope mirrors the assistant context pack's three zones:
//   meal     → roster, calendar, meals, pantry, grocery, weather
//   task     → roster, tasks, rewards, last archived week
//   schedule → roster, calendar, routines, weather
// Missing or `all` merges all three; an unknown scope is rejected 400.
//
// MERGE SHAPE (scope=all): the three packs are loaded concurrently and their
// zones are combined into ONE ContextPack. `roster`/`today` are identical
// across scopes so the meal pack's copy is authoritative; each optional zone
// is adopted from the first pack that defines it (calendar/weather appear in
// both meal and schedule with the same data, so the first wins); `unavailable`
// is the union of all three so a dead zone is never silently dropped. The
// composed prompt is then produced from the merged pack exactly as it is for a
// single scope.
const PACK_SCOPES = ["meal", "task", "schedule"] as const;
type PackScopeName = (typeof PACK_SCOPES)[number];
type PackScopeQuery = PackScopeName | "all";

const ZONE_KEYS = [
  "calendar",
  "routines",
  "meals",
  "pantry",
  "grocery",
  "tasks",
  "rewards",
  "lastWeek",
  "weather",
] as const;

function mergeContextPacks(packs: ContextPack[]): ContextPack {
  const merged: ContextPack = {
    roster: packs[0]?.roster ?? [],
    today: packs[0].today,
    unavailable: [],
  };
  const m = merged as unknown as Record<string, unknown>;
  const unavailable = new Set<string>();
  for (const pack of packs) {
    for (const zone of pack.unavailable) unavailable.add(zone);
    const p = pack as unknown as Record<string, unknown>;
    for (const key of ZONE_KEYS) {
      if (p[key] !== undefined && m[key] === undefined) m[key] = p[key];
    }
  }
  merged.unavailable = [...unavailable];
  return merged;
}

function parseScope(raw: string | null): PackScopeQuery | null {
  if (raw === null || raw === "") return "all";
  if (raw === "all") return "all";
  return (PACK_SCOPES as readonly string[]).includes(raw) ? (raw as PackScopeName) : null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeMuseRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const scope = parseScope(request.nextUrl.searchParams.get("scope"));
  if (!scope) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  const pack =
    scope === "all"
      ? mergeContextPacks(await Promise.all(PACK_SCOPES.map((s) => loadContextPack(s))))
      : await loadContextPack(scope);

  return NextResponse.json({
    ok: true,
    scope,
    pack,
    prompt: composeContextPrompt(pack),
  });
}
