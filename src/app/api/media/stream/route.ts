import { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { resolveStream } from "@/lib/media/youtube";

export const dynamic = "force-dynamic";

/** googlevideo URLs are huge; 6MB of headers would be a denial-of-service. */
const MAX_RANGE_HEADER_BYTES = 128;

/**
 * A YouTube video id is 11 URL-safe base64 chars. Validating here means a junk
 * `?id=` can never reach the player endpoint as a request for something else.
 */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * GET /api/media/stream?id=<videoId> — ad-free audio proxy.
 *
 * Why proxy instead of handing the browser the upstream URL:
 *  - the signed googlevideo URL is a **bearer credential** and expires; the
 *    player would have to re-resolve mid-track when it 403s.
 *  - googlevideo answers `HEAD` with 403 but honours `GET` + `Range`, which is
 *    exactly what `<audio>` seeking does — so we forward ranges verbatim.
 *  - the signed URL (and the guest cookie that mints it) never reaches the
 *    browser at all.
 *
 * Range handling: we forward the client's `Range` header unchanged and pass the
 * upstream status (200/206) and the `Content-Range`/`Accept-Ranges`/`Length`
 * headers back, so the browser's media element sees a normal seekable resource.
 */
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return new Response("unauthorized", { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!VIDEO_ID_RE.test(id)) {
    return new Response("bad_request", { status: 400 });
  }

  let stream: Awaited<ReturnType<typeof resolveStream>>;
  try {
    stream = await resolveStream(id);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "resolve failed";
    console.error("[media/stream] resolve failed:", detail);
    return new Response("stream_unavailable", { status: 502 });
  }

  const rangeHeader = request.headers.get("range");
  if (rangeHeader && rangeHeader.length > MAX_RANGE_HEADER_BYTES) {
    return new Response("range_too_large", { status: 416 });
  }

  const upstream = await fetch(stream.url, {
    headers: rangeHeader ? { Range: rangeHeader } : undefined,
    // The signed URL is already time-limited; never let a stale CDN copy sit in
    // front of it for another 5 hours.
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    console.error("[media/stream] upstream returned", upstream.status);
    return new Response("upstream_error", { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", stream.mimeType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");

  for (const name of ["Content-Range", "Content-Length"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
