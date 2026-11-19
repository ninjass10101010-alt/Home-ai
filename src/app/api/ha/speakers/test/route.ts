import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentParentRequest } from "@/lib/server-auth";
import { announceToSpeakers, resolveLanMediaBaseUrl } from "@/lib/ha/speakers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authorizeCurrentParentRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status ?? 401 }
    );
  }

  const rawBody = await request.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as { entities?: unknown; voiceKey?: unknown; message?: unknown })
      : {};

  const entities = Array.isArray(body.entities)
    ? body.entities.filter((e): e is string => typeof e === "string" && e.startsWith("media_player."))
    : undefined;

  const customMessage =
    typeof body.message === "string" && body.message.trim() ? body.message.trim() : null;
  const voiceKey =
    typeof body.voiceKey === "string" && body.voiceKey.trim()
      ? body.voiceKey.trim()
      : customMessage
        ? null
        : "routine_schedule_summary";

  const message =
    customMessage ?? "Testing Consuela speaker announcements. Your Google speakers are connected!";

  try {
    const result = await announceToSpeakers({
      message,
      category: "general",
      voiceKey,
      targetEntities: entities,
      lanBaseUrl: resolveLanMediaBaseUrl(request.headers.get("host")),
      force: true,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        attempted: entities?.length ?? 0,
        delivered: 0,
        failed: entities?.length ?? 0,
        errors: [err instanceof Error ? err.message : String(err)],
      },
      { status: 502 }
    );
  }
}
