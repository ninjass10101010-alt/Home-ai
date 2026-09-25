import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { reconcileTaskProjectionLocked } from "@/lib/task-projection-reconciler";

export const dynamic = "force-dynamic";

const KEY = "tasks-snapshot";
const COLLECTION = "consuela_data_snapshots";
const IGNORED_COMPATIBILITY_LEGS = [
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
const REPAIR_CATEGORY = /^(?:approval|projection|rollover|snapshot|week|task):[a-z0-9_-]+(?::[a-z0-9_-]+)?$/i;

function repairCategories(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => REPAIR_CATEGORY.test(value)))];
}

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

export async function GET() {
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

  let reconciliation: Awaited<ReturnType<typeof reconcileTaskProjectionLocked>>;
  if (rollover.reconciled) {
    try {
      reconciliation = await withAdmin((pb) => reconcileTaskProjectionLocked(pb, {
        weekStart: rollover.weekStart,
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
  } else {
    reconciliation = {
      ok: false,
      reconciled: false,
      repaired: [],
      failed: ["rollover:pending"],
      weekData: rollover.currentWeekData ?? null,
      revision: rollover.revision,
    };
  }

  let snapshot: unknown = null;
  let snapshotReadFailed = false;
  try {
    snapshot = await readSnapshot();
  } catch {
    snapshotReadFailed = true;
    console.warn("[tasks/sync] snapshot read unavailable");
  }

  if (snapshotReadFailed || !reconciliation.reconciled || !reconciliation.ok) {
    const repairedCategories = repairCategories(reconciliation.repaired);
    const failedCategories = repairCategories(reconciliation.failed);
    return NextResponse.json({
      ok: false,
      error: "projection_reconcile_pending",
      reconciled: false,
      repaired: repairedCategories,
      failed: snapshotReadFailed
        ? ["snapshot:read"]
        : failedCategories.length > 0 ? failedCategories : ["projection:pending"],
      snapshot,
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    snapshot,
    reconciled: true,
    repaired: repairCategories(reconciliation.repaired),
    failed: [],
  });
}

export async function POST(req: NextRequest) {
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
      { ok: false, error: "task_snapshot_write_retired" },
      { status: 410 },
    );
  }
  return NextResponse.json({ ok: true, saved: false, ignoredLegs: IGNORED_COMPATIBILITY_LEGS });
}
