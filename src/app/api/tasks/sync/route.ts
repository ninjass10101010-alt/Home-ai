import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { withKeyedLock } from "@/lib/keyed-lock";
import { ensureArchivedWeeksEnshrined } from "@/lib/hall-of-fame-backfill";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";
// The snapshot's non-tasks legs carry family points/ledger state. A child or
// pet session may sync the tasks leg only; the rest are ignored (never merged)
// and reported honestly in the response (F2) — the weekly prize legs are
// parent-owned the same way and are not applied from non-parent posts.
const NON_PARENT_IGNORED_LEGS = ["weekData", "rewards", "penalties", "weeklyPrizes", "weeklyPrizesStamp"];

export async function GET() {
  try {
    const result = await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      const row = rows[0] as any;
      // Self-healing weekly-champion enshrinement: recompute any missing
      // hall_of_fame rows from week_archive (idempotent; never touches existing
      // rows). The client used to be the only writer and its PB push was
      // parent-gateway-gated, so a kid/guest device being first across a Monday
      // rollover left the champion unrecorded server-side forever. Fire on the
      // 60s refresh path every signed-in device already performs; a failure
      // must never break the snapshot read.
      try {
        await ensureArchivedWeeksEnshrined(pb);
      } catch (e: any) {
        console.warn("[tasks/sync] hall-of-fame backfill failed:", e?.message);
      }
      return row?.data ?? null;
    });
    return NextResponse.json({ ok: true, snapshot: result });
  } catch (e: any) {
    console.error("[tasks/sync] read failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  // Middleware already 401s guests, but the role decision must live here too.
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const isParent = session.role === "parent";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (isParent) {
    if (
      !body ||
      !Array.isArray(body.tasks) ||
      typeof body.weekData !== "object" ||
      body.weekData === null ||
      typeof body.weekData.weekStart !== "string"
    ) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }
  } else if (!body || !Array.isArray(body.tasks)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  try {
    // Serialize the snapshot read-modify-write (in-process keyed lock). The
    // non-parent path re-reads the stored parent-owned legs and writes them
    // back with the tasks leg — interleaved with a parent's full-body write,
    // that stale merge used to resurrect the parent's JUST-REPLACED points/
    // rewards on the shared snapshot. Under the lock the second writer always
    // re-reads fresh.
    await withKeyedLock(`snapshot:${KEY}`, () =>
      withAdmin(async (pb) => {
        const rows = await pb.collection(COLLECTION).getFullList({
          requestKey: null,
          filter: `key = "${KEY}"`,
        });
        // Tombstones are UNIONED, never replaced: a device that hasn't yet
        // adopted a chat-initiated delete would otherwise push a body without
        // it and resurrect the row everywhere. Deleted ids are also stripped
        // from whatever task list the pusher sent.
        const stored = (rows[0] as any)?.data ?? {};
        const unionDeleted = [
          ...new Set([
            ...((stored.deletedTaskIds || []) as any[]).map((n) => Number(n)),
            ...((body.deletedTaskIds || []) as any[]).map((n) => Number(n)),
          ]),
        ].filter((n) => Number.isFinite(n));
        const stripDeleted = (list: any[]) =>
          (Array.isArray(list) ? list : []).filter((t) => !unionDeleted.includes(Number(t?.id)));
        // Parent writes the full body (plus the unioned tombstones). A non-parent
        // writes only the tasks leg, preserving the stored parent-owned legs so a
        // kid sync can never move points or wipe the ledger.
        // A parent write stays byte-identical (verbatim) unless there is a
        // tombstone to carry — no spurious keys on the common path.
        const data = isParent
          ? unionDeleted.length
            ? { ...body, tasks: stripDeleted(body.tasks), deletedTaskIds: unionDeleted }
            : body
          : { ...stored, tasks: stripDeleted(body.tasks) };
        const payload = {
          key: KEY,
          data,
          updated_at: new Date().toISOString(),
        };
        if (rows.length > 0) {
          await pb.collection(COLLECTION).update(rows[0].id, payload, { requestKey: null });
        } else {
          await pb.collection(COLLECTION).create(payload, { requestKey: null });
        }
      })
    );
    if (isParent) return NextResponse.json({ ok: true, saved: true });
    return NextResponse.json({ ok: true, saved: true, ignoredLegs: NON_PARENT_IGNORED_LEGS });
  } catch (e: any) {
    console.error("[tasks/sync] save failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}
