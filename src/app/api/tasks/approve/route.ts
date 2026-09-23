import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyPinFromPB } from "@/lib/server-auth";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import {
  SNAPSHOT_KEY,
  SNAPSHOT_COLLECTION,
  liveSnapshotTasks,
  persistSnapshotWeek,
} from "@/lib/snapshot-tasks";
import { isPendingApproval } from "@/lib/task-utils";
import type { Transaction, WeekData, PendingApproval } from "@/types/tasks";

export const dynamic = "force-dynamic";

type PB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

type ApproveAction = "approve" | "approve-all" | "send-back";

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

/** Reversal-aware per-member idempotency (same contract as the client). */
function memberAlreadyPaid(history: Transaction[], taskId: number, member: string): boolean {
  const earns = history.filter(
    (tx) => tx.type === "earn" && tx.taskId === taskId && tx.member === member
  );
  const latest = earns[earns.length - 1];
  if (!latest) return false;
  const reversed = history.some(
    (tx) =>
      tx.taskId === taskId &&
      tx.type === "adjust" &&
      tx.amount < 0 &&
      tx.member === member &&
      tx.timestamp >= latest.timestamp
  );
  return !reversed;
}

type TaskLike = {
  id: number;
  title?: string;
  points?: number;
  completed?: boolean;
  completedInWeek?: string;
  pendingApproval?: PendingApproval;
  crew?: { members?: any[]; removed?: string[] } | null;
  crewSize?: number | null;
};

type ApproveResult =
  | { ok: true; weekData?: WeekData; paid: number; cleared: number; skipped: number; task?: TaskLike }
  | { ok: false; reason: string };

async function loadSnapshotData(pb: PB): Promise<any> {
  const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
    requestKey: null,
    filter: `key = "${SNAPSHOT_KEY}"`,
  });
  const row: any = rows[0];
  const raw = row?.data;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

async function findTask(
  pb: PB,
  taskId: number,
  snapshotData: any
): Promise<{ task: TaskLike; pbRecordId?: string } | null> {
  // Snapshot-primary: under-10 PIN-free taps live here first (D2).
  const snap = liveSnapshotTasks(snapshotData).find((t) => Number(t.id) === Number(taskId));
  const rows = await pb.collection("tasks").getFullList({ requestKey: null });
  const rec = rows.find((r: any) => Number(r.taskId) === Number(taskId));
  if (snap) {
    return {
      task: {
        id: Number(snap.id),
        title: snap.title,
        points: snap.points,
        completed: snap.completed,
        completedInWeek: snap.completedInWeek,
        pendingApproval: snap.pendingApproval,
        crew: snap.crew,
        crewSize: snap.crewSize,
      },
      pbRecordId: rec ? String(rec.id) : undefined,
    };
  }
  if (rec) {
    return {
      task: {
        id: Number(rec.taskId),
        title: rec.title,
        points: rec.points,
        completed: rec.completed,
        completedInWeek: rec.completedInWeek,
        pendingApproval: parseJSON<PendingApproval | null>(rec.pendingApproval, null as any) ?? undefined,
        crew: parseJSON(rec.crew, null),
        crewSize: rec.crewSize,
      },
      pbRecordId: String(rec.id),
    };
  }
  return null;
}

/** Pay one pending row. Mutates `week` (points/history). Returns counters. */
function payOne(
  task: TaskLike,
  week: WeekData
): { paid: number; cleared: number; skipped: number; week: WeekData } {
  const approval = task.pendingApproval;
  if (!approval || !isPendingApproval(task as any)) {
    return { paid: 0, cleared: 0, skipped: 0, week };
  }
  const crewRoster =
    Array.isArray(approval.crew) && approval.crew.length > 0 ? approval.crew : null;
  const payees = (crewRoster ?? [approval.byName]).filter(Boolean);
  const isCrew = !!crewRoster;
  // B1: pay the recorded amount (base + speed bonus).
  const amount = approval.points ?? task.points ?? 0;
  const sameWeek = task.completedInWeek === week.weekStart;
  const pointsMsg = amount > 0 ? ` (+${amount}pts)` : "";

  let paid = 0;
  let skipped = 0;
  let next = week;
  for (const owner of payees) {
    if (memberAlreadyPaid(next.history, task.id, owner)) {
      skipped += 1;
      continue;
    }
    const tx: Transaction = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      member: owner,
      type: "earn",
      amount,
      description: `${isCrew ? "Crew" : sameWeek ? "Completed" : "Approved"}: ${task.title || "task"}${pointsMsg}`,
      taskId: task.id,
    };
    next = {
      ...next,
      points: { ...next.points, [owner]: (next.points[owner] || 0) + amount },
      history: [...next.history, tx],
    };
    paid += 1;
  }
  return { paid, cleared: 1, skipped, week: next };
}

async function approveOne(
  pb: PB,
  task: TaskLike,
  pbRecordId: string | undefined,
  week: WeekData
): Promise<ApproveResult> {
  if (!isPendingApproval(task as any)) {
    // Idempotent no-op — client still adopts weekData.
    return { ok: true, paid: 0, cleared: 0, skipped: 0, weekData: week };
  }
  const { paid, cleared, skipped, week: nextWeek } = payOne(task, week);

  if (pbRecordId) {
    await pb.collection("tasks").update(pbRecordId, {
      pendingApproval: null,
      sentBackAt: null,
    }).catch(() => {});
  }
  await persistSnapshotWeek(pb, nextWeek, {
    id: task.id,
    pendingApproval: null,
    sentBackAt: null,
  });
  return { ok: true, paid, cleared, skipped, weekData: nextWeek };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action: ApproveAction | undefined =
      body?.action === "approve" || body?.action === "approve-all" || body?.action === "send-back"
        ? body.action
        : undefined;
    const memberName = body?.memberName;
    const pin = body?.pin;

    if (!action || !memberName || !pin) {
      return NextResponse.json({ success: false, reason: "invalid_body" }, { status: 400 });
    }
    if (action === "approve" || action === "send-back") {
      if (body?.taskId === undefined || body?.taskId === null) {
        return NextResponse.json({ success: false, reason: "invalid_body" }, { status: 400 });
      }
    }
    if (action === "approve-all") {
      const ids = body?.taskIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n: unknown) => Number.isFinite(Number(n)))) {
        return NextResponse.json({ success: false, reason: "invalid_body" }, { status: 400 });
      }
    }

    const approver = await verifyPinFromPB(String(memberName), String(pin));
    if (!approver) {
      return NextResponse.json({ success: false, error: "Invalid PIN" }, { status: 401 });
    }
    if (approver.role !== "parent") {
      return NextResponse.json({ success: false, reason: "adult_only" }, { status: 403 });
    }

    const currentWeek = currentWeekKey();

    const result: ApproveResult = await withWeekLedgerLock(currentWeek, () =>
      withAdmin(async (pb) => {
        const snapshotData = await loadSnapshotData(pb);

        if (action === "approve") {
          const found = await findTask(pb, Number(body.taskId), snapshotData);
          if (!found) return { ok: false as const, reason: "unknown-task" };
          const weekRecords = await pb.collection("week_data").getFullList({ requestKey: null });
          const weekRow = weekRecords.find((r: any) => r.weekStart === currentWeek) || null;
          const week: WeekData = {
            weekStart: currentWeek,
            points: parseJSON<Record<string, number>>(weekRow?.points, {}),
            streak: parseJSON<Record<string, number>>(weekRow?.streak, {}),
            lastActive: parseJSON<Record<string, string>>(weekRow?.lastActive, {}),
            history: parseJSON<Transaction[]>(weekRow?.history, []),
          };
          const approved = await approveOne(pb, found.task, found.pbRecordId, week);
          if (!approved.ok) return approved;
          if (approved.weekData && approved.paid > 0) {
            if (weekRow) await pb.collection("week_data").update(weekRow.id, approved.weekData);
            else await pb.collection("week_data").create(approved.weekData);
          }
          return approved;
        }

        // Tasks 4–5 land here: send-back / approve-all (added in those tasks).
        return { ok: false as const, reason: "not_implemented" };
      })
    );

    if (!result.ok) {
      const status =
        result.reason === "unknown-task" ? 404 :
        result.reason === "adult_only" ? 403 :
        result.reason === "invalid_body" ? 400 : 400;
      return NextResponse.json({ success: false, reason: result.reason }, { status });
    }

    return NextResponse.json({
      success: true,
      weekData: (result as any).weekData,
      paid: (result as any).paid ?? 0,
      cleared: (result as any).cleared ?? 0,
      skipped: (result as any).skipped ?? 0,
      task: (result as any).task,
    });
  } catch (error) {
    console.error("Task approve API error:", error);
    return NextResponse.json({ error: "Failed to approve task" }, { status: 500 });
  }
}
