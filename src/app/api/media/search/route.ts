import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { searchTracks } from "@/lib/media/youtube";

export const dynamic = "force-dynamic";

/** Matches the widget's result list; keeps a stray `limit=9999` from flooding. */
const MAX_LIMIT = 25;

/**
 * GET /api/media/search?q=… — YouTube Music song search.
 *
 * Session-guarded like every other media route: the resolution below relies on
 * a guest identity and signed URLs, so it must never be reachable anonymously.
 * Returns `{ tracks }`; a failed upstream is a 502 with a stable `error` code
 * the widget can render as an inline message.
 */
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : 20;

  try {
    const tracks = await searchTracks(query, limit);
    return NextResponse.json({ tracks });
  } catch (error) {
    // The message is YouTube's, not ours, and carries no credentials — but keep
    // it to a single line so a multi-line upstream body can't reach the UI.
    const detail = error instanceof Error ? error.message.split("\n")[0] : "search failed";
    console.error("[media/search] GET failed:", detail);
    return NextResponse.json({ error: "search_failed", detail }, { status: 502 });
  }
}
