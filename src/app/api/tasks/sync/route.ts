import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { withKeyedLock } from "@/lib/keyed-lock";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { protectPendingOnPush } from "@/lib/snapshot-tasks";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";
// The snapshot's non-tasks legs carry family points/ledger state. A child or
// pet session may sync the tasks leg only; the rest are ignored (never merged)
// and reported honestly in the response (F2) — the weekly prize legs are
// parent-owned the same way and are not applied from non-parent posts.
const NON_PARENT_IGNORED_LEGS = [
  "weekData",
  "rewards",
  "rewardsUpdatedAt",
  "penalties",
  "penaltiesUpdatedAt",
  "weeklyPrizes",
  "weeklyPrizesStamp",
  "configOperationReceipts",
  "revision",
  "operationReceipts",
  "pendingProjectionRepairs",
  "taskWeekStart",
];
const SERVER_OWNED_SNAPSHOT_KEYS = NON_PARENT_IGNORED_LEGS.filter((key) => key !== "weekData");

function preserveServerOwnedSnapshotData(stored: Record<string, any>, data: Record<string, any>) {
  const next = { ...data };
  for (const key of SERVER_OWNED_SNAPSHOT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) next[key] = stored[key];
    else delete next[key];
  }
  return next;
}

export async function GET() {
  try {
    await ensureCurrentTaskWeek();
    const result = await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      const row = rows[0] as any;
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
        // Push-side pending guard (2026-09-23 review): a parent's stale local
        // list must never ERASE a pendingApproval the claim route just wrote
        // server-side (kid devices never push the snapshot), and a stale
        // device must never RESURRECT one the stored row has already resolved
        // (approve / send-back). Proof rules mirror the pull-side merge gates
        // in mergeTasksSnapshot (task-utils).
        const protectedTasks = protectPendingOnPush({
          storedTasks: (Array.isArray(stored.tasks) ? stored.tasks : []).filter(
            (t: any) => !unionDeleted.includes(Number(t?.id))
          ),
          pushedTasks: stripDeleted(body.tasks),
          pushedHistory: isParent ? body?.weekData?.history : undefined,
          storedHistory: stored?.weekData?.history,
        });
        // Parent writes the full body (plus the unioned tombstones). A non-parent
        // writes only the tasks leg, preserving the stored parent-owned legs so a
        // kid sync can never move points or wipe the ledger.
        // The tasks leg is the push's own list, pending-guarded above; every
        // other key passes through verbatim — no spurious keys on the common
        // path.
        const candidateData = isParent
          ? unionDeleted.length
            ? { ...body, tasks: protectedTasks, deletedTaskIds: unionDeleted }
            : { ...body, tasks: protectedTasks }
          : { ...stored, tasks: protectedTasks };
        const data = preserveServerOwnedSnapshotData(stored, candidateData);
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
    // Full PB body: a bare `e.message` ("Failed to update record.") hides the
    // field/constraint that actually rejected the write.
    console.error("[tasks/sync] save failed:", e?.message, e?.data ?? "");
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
}
