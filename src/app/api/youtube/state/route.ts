import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest } from "@/lib/server-auth";
import { ComposioError } from "@/lib/google/composio";
import { composioHttpStatus, getYouTubeConnectionStatus } from "@/lib/google/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeCurrentMemberRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "unauthorized" },
      { status: auth.status ?? 401 },
    );
  }
  try {
    const state = await getYouTubeConnectionStatus();
    return NextResponse.json({ ok: true, ...state });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, code: "youtube_state_unavailable", error: "YouTube state unavailable" },
      { status: 503 },
    );
  }
}
