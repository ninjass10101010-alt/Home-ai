import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";

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
export async function GET() {
  try {
    const rollover = await ensureCurrentTaskWeek();
    if (!rollover.reconciled) console.warn("[tasks/sync] rollover reconciliation pending");
    const result = await withAdmin(async (pb) => {
      const rows = await pb.collection(COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${KEY}"`,
      });
      const row = rows[0] as any;
      return row?.data ?? null;
    });
    return NextResponse.json({ ok: true, snapshot: result, reconciled: rollover.reconciled });
  } catch (e: any) {
    console.error("[tasks/sync] read failed:", e?.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 502 });
  }
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
