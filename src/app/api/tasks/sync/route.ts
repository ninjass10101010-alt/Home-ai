import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { requireLiveSession } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { ensureCurrentTaskDay } from "@/lib/task-day-sweep";
import { reconcileTaskProjectionLocked } from "@/lib/task-projection-reconciler";
import { repairCategories } from "@/lib/task-repair-categories";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";
export const LEGACY_SYNC_WRITE_ERROR = "legacy_sync_write_disabled";

async function readSnapshot() {
  return withAdmin(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${KEY}"`,
    });
    const row = rows[0] as any;
    return row?.data ?? null;
  });
}

// B1: this GET is not a read. It performs THREE server-side writes (the week
// rollover, the recurrence day-sweep, the projection repair) and then returns
// the whole family points ledger verbatim — every member's balance, the
// pendingApproval rows and crew state. It took no request at all, so no cookie
// was even reachable and NOTHING authorized it.
//
// `requireLiveSession` (not `verifySession`, not `verifyLiveParentSession`):
//   · The cookie is only a 7-day HMAC proof; `src/middleware.ts` cannot notice
//     a member removed from the roster or demoted, so LIVE identity must be
//     re-read here — that is what `requireLiveSession` does.
//   · It stays SESSION-level, not parent-only, because this is the family-wide
//     read every device polls (kid home, the tasks page, the screensaver, the
//     60s refresher). A parent-only gate would lock children out of their own
//     chores; the three write legs are server-authoritative sweeps that must
//     run for whoever asks.
//   · It preserves the live status verbatim (401 absent, 403 role-drift, 503
//     unreachable roster) so the client can still tell "couldn't reach
//     Consuela" from "wrong PIN" — a 401 here is not a PIN verdict.
export async function GET(request: NextRequest) {
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: live.error,
        reconciled: false,
        repaired: [],
        failed: [],
        snapshot: null,
      },
      { status: live.status },
    );
  }

  let rollover: Awaited<ReturnType<typeof ensureCurrentTaskWeek>>;
  try {
    rollover = await ensureCurrentTaskWeek();
  } catch {
    console.warn("[tasks/sync] rollover unavailable");
    return NextResponse.json({
      ok: false,
      error: "rollover_unavailable",
      reconciled: false,
      repaired: [],
      failed: ["rollover:unavailable"],
      snapshot: null,
    }, { status: 503 });
  }

  const weekStart = rollover.weekStart;
  if (!weekStart) {
    console.warn("[tasks/sync] rollover produced no current week");
    return NextResponse.json({
      ok: false,
      error: "rollover_unavailable",
      reconciled: false,
      repaired: [],
      failed: ["rollover:unavailable"],
      snapshot: null,
    }, { status: 503 });
  }

  let daysweep: Awaited<ReturnType<typeof ensureCurrentTaskDay>>;
  try {
    daysweep = await ensureCurrentTaskDay();
  } catch {
    console.warn("[tasks/sync] day sweep unavailable");
    return NextResponse.json({
      ok: false,
      error: "daysweep_unavailable",
      reconciled: false,
      repaired: [],
      failed: ["tasks:daysweep:unavailable"],
      snapshot: null,
    }, { status: 503 });
  }

  let reconciliation: Awaited<ReturnType<typeof reconcileTaskProjectionLocked>>;
  try {
    reconciliation = await withAdmin((pb) => reconcileTaskProjectionLocked(pb, {
      weekStart,
      // The day sweep mutates the snapshot between rollover and reconcile,
      // so the CAS runs against the revision the sweep last saw — otherwise
      // the first GET of every local day fails `rollover:changed` and never
      // projects the swept rows.
      expectedRevision: daysweep.revision ?? rollover.revision?.revision,
      expectedWeekData: rollover.currentWeekData,
    }));
  } catch {
    console.warn("[tasks/sync] projection reconciliation unavailable");
    return NextResponse.json({
      ok: false,
      error: "projection_reconcile_unavailable",
      reconciled: false,
      repaired: [],
      failed: ["projection:unavailable"],
      snapshot: null,
    }, { status: 503 });
  }

  let snapshot: unknown = null;
  let snapshotReadFailed = false;
  try {
    snapshot = await readSnapshot();
  } catch {
    snapshotReadFailed = true;
    console.warn("[tasks/sync] snapshot read unavailable");
  }

  if (snapshotReadFailed) {
    const repairedCategories = repairCategories(reconciliation.repaired);
    return NextResponse.json({
      ok: false,
      error: "snapshot_unavailable",
      reconciled: false,
      repaired: repairedCategories,
      failed: ["snapshot:read"],
      snapshot: null,
    }, { status: 503 });
  }

  const repairedCategories = repairCategories(reconciliation.repaired);
  // B3: the rollover now reports its OWN failure categories
  // (`week_archive:invalid` for an unreadable prior week, `week_data:invalid`
  // for an unreadable current one) instead of throwing. Emitting only the
  // coarse `rollover:pending` threw that away — the caller was told something
  // was wrong and never which week. `repairCategories` filters the list through
  // REPAIR_CATEGORY, so a PocketBase error string can never ride out of here.
  const failedCategories = [
    ...repairCategories(rollover.reconciled ? [] : ["rollover:pending", ...(rollover.failed ?? [])]),
    ...repairCategories(daysweep.reconciled ? [] : daysweep.failed),
    ...repairCategories(reconciliation.failed),
  ];
  const warningCategories = repairCategories(reconciliation.warnings);
  const reconciled = rollover.reconciled && daysweep.reconciled && reconciliation.reconciled && failedCategories.length === 0;
  // B2: an explicitly UNRECONCILED read must not answer 200. Every other
  // failure arm here already answers 503, and BOTH consumers branch on the
  // status alone (`src/db/index.ts:220` `if (!res.ok) return` and
  // `src/app/tasks/page.tsx:558` `return r.ok ? r.json() : null`) — so a 200
  // here meant the 60s refresh and the page restore both APPLIED a snapshot
  // this handler had just declared unreconciled. Only the outbox read the
  // bespoke `reconciled` flag.
  //
  // The FULL body still ships on the 503, snapshot included: a caller that
  // wants the partial truth can read it off a non-200, and the status no longer
  // lies about it.
  return NextResponse.json(
    {
      ok: reconciled,
      ...(reconciled ? {} : { error: "projection_reconcile_pending", retryable: true }),
      snapshot,
      reconciled,
      repaired: repairedCategories,
      failed: failedCategories,
      warnings: warningCategories,
    },
    { status: reconciled ? 200 : 503 },
  );
}

export async function POST(req: NextRequest) {
  // Middleware already 401s guests, but authorization must also live in the
  // route (F2). The read is session-level; the write path below is retired
  // entirely — a `tasks`/`weekData` body is 410, anything else 400 — so no
  // role decision is needed here any more.
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "tasks") || Object.prototype.hasOwnProperty.call(record, "weekData")) {
    return NextResponse.json(
      { ok: false, error: LEGACY_SYNC_WRITE_ERROR },
      { status: 410 },
    );
  }
  return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
}
