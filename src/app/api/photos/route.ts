import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { curateWallPhotos } from "@/lib/photos/curate";
import { PB_RECORD_ID, type WallPhoto } from "@/db/features/photos";
import { verifyLiveParentSession } from "@/lib/live-member";

export const dynamic = "force-dynamic";

/** One fetch page. 20 pages × 60 = 1200 photos — a bound, not a ceiling most
 *  libraries reach, so a bad count can't stream the whole table. */
const PAGE_SIZE = 60;
const MAX_PAGES = 20;

const PHOTO_ORDERS = ["shuffle", "newest", "oldest"] as const;
type PhotoOrder = (typeof PHOTO_ORDERS)[number];

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
  const rawLimit = Number(params.get("limit")) || 12;
  const limit = Math.min(40, Math.max(1, Math.floor(rawLimit)));
  const recentIds = (params.get("recent") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // `all=1` is for the Photos page, which has to show the pictures that are
  // currently OFF the wall in order to put them back on it.
  const includeHidden = params.get("all") === "1";
  // Validated before anything else — an invalid order is a client bug, and a
  // silent fallback would make the client think its choice stuck while the
  // wall shuffles anyway (spec §3.7, plan T5 step 3: reject).
  const order = parseOrder(params.get("order"));
  if (order === null) {
    return NextResponse.json({ ok: false, error: "invalid_order" }, { status: 400 });
  }
  // The window follows the order (spec §3.7): `oldest` has to walk the
  // library from the far end, not reverse the 60 newest rows.
  const sort = order === "oldest" ? "takenAt" : "-takenAt";

  try {
    // Bounded page loop rather than getFullList: it caps the work explicitly
    // (MAX_PAGES) while still giving curation the whole eligible library —
    // the old `getList(1, 60)` showed curation only the newest 60 rows.
    const items: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await withAdmin(async (pb) =>
        pb.collection("photos").getList(page, PAGE_SIZE, {
          sort,
          ...(includeHidden ? {} : { filter: "showOnWall = true" }),
        }),
      );
      const batch: Record<string, unknown>[] = list?.items ?? [];
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const photos = items.map((item) => mapRow(item, includeHidden));

    // The Photos page is a management grid, not a slideshow: every row, newest
    // first, no curation and no 40-item truncation to explain away.
    if (includeHidden) {
      photos.sort((a, b) => (Date.parse(b.takenAt) || 0) - (Date.parse(a.takenAt) || 0));
      return NextResponse.json({ ok: true, photos });
    }

    return NextResponse.json({
      ok: true,
      photos: curateWallPhotos(photos, { limit, recentIds, order }),
    });
  } catch (err) {
    // Includes the collection not existing yet — `npm run migrate:features`
    // creates it. Honest 503: the widget shows "unavailable", never fake art.
    console.error("[photos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "photos_unreachable" }, { status: 503 });
  }
}

/**
 * Absent (or explicitly empty) means today's default, `shuffle`. Anything else
 * must be a real order value — an unknown one returns `null` and the caller
 * 400s with `invalid_order`, because a lenient fallback hides a client bug
 * behind a wall that quietly ignores what the family chose (spec §3.7).
 */
function parseOrder(raw: string | null): PhotoOrder | null {
  if (raw === null || raw === "") return "shuffle";
  if ((PHOTO_ORDERS as readonly string[]).includes(raw)) return raw as PhotoOrder;
  return null;
}

/** PocketBase row → the same-origin shape the widget consumes. */
function mapRow(item: Record<string, unknown>, includeHidden: boolean): WallPhoto {
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
}

/**
 * Pull a photo off the wall, or put it back: `{ id, showOnWall }`.
 *
 * This is the moderation lever. Without it, removing one picture means opening
 * the PocketBase admin console, which is not something to hand a family at the
 * kitchen counter — and `showOnWall` (rather than delete) means "not now" and
 * "never" stay different decisions.
 *
 * Parent-only via a LIVE identity re-read (`verifyLiveParentSession`): a
 * cookie's role claim is seven days old with no revocation, and a child must
 * not be able to moderate the family wall.
 */
export async function PATCH(request: NextRequest) {
  const auth = await verifyLiveParentSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
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
  } catch (err) {
    console.error("[photos]", err instanceof Error ? err.message : err);
    // A stale bookmark / deleted row is the caller's 404, not a PB outage.
    const failure = err as { status?: number; data?: { code?: number } };
    if (failure?.status === 404 || failure?.data?.code === 404) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 502 });
  }
}

export async function POST() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
