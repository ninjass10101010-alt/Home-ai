import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { verifyLiveParentSession } from "@/lib/live-member";
import {
  PHOTO_ORDERS,
  PHOTO_SETTINGS_DEFAULTS,
  PHOTO_TRANSITIONS,
  clampRotateSeconds,
  normalizePhotoSettings,
  type PhotoOrder,
  type PhotoSettings,
  type PhotoTransition,
} from "@/lib/photos/settings";

export const dynamic = "force-dynamic";

/** The singleton's collection and the one row it holds (spec §1). */
const COLLECTION = "photo_settings";
const WALL_KEY = "wall";

type PbRow = Record<string, unknown>;

/** PocketBase 404s for BOTH "no such record" and "no such collection" — only
 *  the message tells them apart, and the difference matters: no row is a
 *  healthy "nobody has tuned it yet" (defaults, no `degraded`), while a
 *  missing collection is a read failure (defaults + `degraded`). */
function isMissingRow(err: unknown): boolean {
  const e = err as { status?: number; message?: string; data?: { code?: number } } | null;
  const notFound = e?.status === 404 || e?.data?.code === 404;
  if (!notFound) return false;
  return !/collection/i.test(String(e?.message ?? ""));
}

function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; data?: { code?: number } } | null;
  return e?.status === 404 || e?.data?.code === 404;
}

/** A unique-index violation on create (spec §2: a create race means another
 *  writer won — re-read their row and update it instead). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { status?: number; message?: string; data?: unknown; response?: unknown } | null;
  if (e?.status !== 400) return false;
  const haystack = JSON.stringify({
    message: e.message,
    data: e.data,
    response: e.response,
  }).toLowerCase();
  return haystack.includes("unique");
}

/**
 * GET /api/photos/settings — any signed-in family member (the wall panel is
 * itself a signed-in member and must be able to read this).
 *
 * A config outage must never blank the wall: a missing row is 200 defaults,
 * and ANY other read failure is 200 defaults + `degraded: true` (spec §2 /
 * §5.1 — the settings form keeps its controls disabled when `degraded`, so a
 * failed read can never turn into an accidental write).
 */
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const row = (await withAdmin((pb) =>
      pb.collection(COLLECTION).getFirstListItem(`key="${WALL_KEY}"`),
    )) as PbRow;
    return NextResponse.json({ ok: true, settings: normalizePhotoSettings(row) });
  } catch (err) {
    if (isMissingRow(err)) {
      return NextResponse.json({ ok: true, settings: PHOTO_SETTINGS_DEFAULTS });
    }
    console.error("[photos:settings]", err instanceof Error ? err.message : err);
    return NextResponse.json({
      ok: true,
      settings: PHOTO_SETTINGS_DEFAULTS,
      degraded: true,
    });
  }
}

/**
 * PATCH /api/photos/settings — parent only, via a LIVE PocketBase identity
 * re-read (`verifyLiveParentSession`): a cookie's role claim is seven days old
 * with no revocation, and PB identity outage fails closed (spec §2 / §4-12).
 *
 * Body is any SUBSET of the four fields (the settings form sends only what
 * changed; reset sends all four). Validation is per-field and only for fields
 * actually present: an unrecognised enum is a 400 on write — a silent
 * fallback here is how a typo becomes the family's permanent setting — while
 * `rotateSeconds` is clamped into [10, 600].
 *
 * The singleton is upserted by `key = "wall"`: update the row if it exists,
 * create it if not, and on a create race (unique index) re-read and update so
 * a second row can never make reads non-deterministic.
 */
export async function PATCH(request: NextRequest) {
  const auth = await verifyLiveParentSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const patch = body as Record<string, unknown>;

  const valid: Partial<PhotoSettings> = {};
  if ("rotateSeconds" in patch) {
    const raw = patch.rotateSeconds;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return NextResponse.json({ ok: false, error: "invalid_rotate_seconds" }, { status: 400 });
    }
    valid.rotateSeconds = clampRotateSeconds(raw);
  }
  if ("transition" in patch) {
    const raw = patch.transition;
    if (typeof raw !== "string" || !(PHOTO_TRANSITIONS as readonly string[]).includes(raw)) {
      return NextResponse.json({ ok: false, error: "invalid_transition" }, { status: 400 });
    }
    valid.transition = raw as PhotoTransition;
  }
  if ("order" in patch) {
    const raw = patch.order;
    if (typeof raw !== "string" || !(PHOTO_ORDERS as readonly string[]).includes(raw)) {
      return NextResponse.json({ ok: false, error: "invalid_order" }, { status: 400 });
    }
    valid.order = raw as PhotoOrder;
  }
  if ("showCaption" in patch) {
    const raw = patch.showCaption;
    if (typeof raw !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_show_caption" }, { status: 400 });
    }
    valid.showCaption = raw;
  }

  try {
    const settings = (await withAdmin(async (pb) => {
      const collection = pb.collection(COLLECTION);

      const lookup = async (): Promise<PbRow | null> => {
        try {
          return (await collection.getFirstListItem(`key="${WALL_KEY}"`)) as PbRow;
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      };

      let existing = await lookup();
      // Normalize the MERGE (stored row + validated subset) so the response —
      // and the row we write — is server truth, not the client's guess.
      let merged = normalizePhotoSettings({ ...(existing ?? {}), ...valid });

      if (existing) {
        await collection.update(String(existing.id), { ...merged });
        return merged;
      }

      try {
        await collection.create({ key: WALL_KEY, ...merged });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Lost the create race: someone else made the singleton. Re-read THEIR
        // row and merge the patch onto it — never create a second row, and
        // never let this write's defaults clobber their stored values.
        const winner = await lookup();
        if (!winner) throw err;
        merged = normalizePhotoSettings({ ...winner, ...valid });
        await collection.update(String(winner.id), { ...merged });
      }
      return merged;
    })) as PhotoSettings;

    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    // Collection missing or PocketBase down: honest 503 so the client can roll
    // back its optimistic control and toast — never a generic 500.
    console.error("[photos:settings]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "settings_unreachable" }, { status: 503 });
  }
}
