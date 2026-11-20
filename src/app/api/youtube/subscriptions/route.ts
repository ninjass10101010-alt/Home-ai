import { NextRequest, NextResponse } from "next/server";
import { authorizeCurrentMemberRequest } from "@/lib/server-auth";
import { ComposioError } from "@/lib/google/composio";
import { composioHttpStatus, listYouTubeSubscriptions } from "@/lib/google/youtube";

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
    const subscriptions = await listYouTubeSubscriptions();
    return NextResponse.json({ ok: true, subscriptions });
  } catch (error) {
    if (error instanceof ComposioError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: composioHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load subscriptions" },
      { status: 500 },
    );
  }
}
