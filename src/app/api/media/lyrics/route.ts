import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { lookupLyrics } from "@/lib/media/lyrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/lyrics?id=&title=&artist=&duration=
 *
 * Session-guarded like every media route. A missing lyric is a 200 with
 * `lyrics: null` — only an upstream failure becomes a 502.
 */
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const title = request.nextUrl.searchParams.get("title")?.slice(0, 200) ?? "";
  const artist = request.nextUrl.searchParams.get("artist")?.slice(0, 200) ?? "";
  const rawDuration = Number(request.nextUrl.searchParams.get("duration"));
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  try {
    const result = await lookupLyrics({ title, artist, durationSeconds });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "lyrics_failed" }, { status: 502 });
  }
}
