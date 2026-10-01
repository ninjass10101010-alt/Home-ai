import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { curateWallPhotos } from "@/lib/photos/curate";
import { PB_RECORD_ID, type WallPhoto } from "@/db/features/photos";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Wall photo feed.
 *
 * The browser never talks to PocketBase: this route resolves which file each
 * record should display (`wall` when a resized copy exists, `original`
 * otherwise) and hands back same-origin `/api/photos/file` URLs. That keeps the
 * PocketBase file token server-side, and sidesteps the fact that
 * NEXT_PUBLIC_PB_URL is the internal Docker hostname (`http://pocketbase:8090`)
 * which no browser can resolve.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(40, Math.max(1, Number(params.get("limit")) || 12));
  const recentIds = (params.get("recent") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // `all=1` is for the Photos page, which has to show the pictures that are
  // currently OFF the wall in order to put them back on it.
  const includeHidden = params.get("all") === "1";

  try {
    const list = await withAdmin(async (pb) =>
      pb.collection("photos").getList(1, 60, {
        // Newest first; curation then applies the day's deterministic order.
        sort: "-takenAt",
        ...(includeHidden ? {} : { filter: "showOnWall = true" }),
      }),
    );

    const photos: WallPhoto[] = (list?.items ?? []).map((item: Record<string, unknown>) => {
      const wall = String(item.wall ?? "");
      const original = String(item.original ?? "");
      const filename = wall || original;
      return {
        id: String(item.id),
        // The filename changes on every re-upload, so it doubles as the cache
        // key and lets the bytes be served `immutable`.
        url: `/api/photos/file?r=${encodeURIComponent(String(item.id))}&f=${encodeURIComponent(filename)}`,
        width: Number(item.width ?? 0) || 0,
        height: Number(item.height ?? 0) || 0,
        takenAt: String(item.takenAt ?? item.created ?? ""),
        caption: typeof item.caption === "string" && item.caption.trim() ? item.caption : undefined,
        album: typeof item.album === "string" && item.album.trim() ? item.album : undefined,
        ...(includeHidden ? { showOnWall: item.showOnWall !== false } : {}),
      } satisfies WallPhoto;
    });

    return NextResponse.json({ ok: true, photos: curateWallPhotos(photos, { limit, recentIds }) });
  } catch {
    // Includes the collection not existing yet — `npm run migrate:features`
    // creates it. Honest 503: the widget shows "unavailable", never fake art.
    return NextResponse.json({ ok: false, error: "photos_unreachable" }, { status: 503 });
  }
}

/**
 * Pull a photo off the wall, or put it back: `{ id, showOnWall }`.
 *
 * This is the moderation lever. Without it, removing one picture means opening
 * the PocketBase admin console, which is not something to hand a family at the
 * kitchen counter — and `showOnWall` (rather than delete) means "not now" and
 * "never" stay different decisions.
 */
export async function PATCH(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown; showOnWall?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!PB_RECORD_ID.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  if (typeof body.showOnWall !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid_show_on_wall" }, { status: 400 });
  }

  try {
    await withAdmin(async (pb) => pb.collection("photos").update(id, { showOnWall: body.showOnWall }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 502 });
  }
}

export async function POST() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
