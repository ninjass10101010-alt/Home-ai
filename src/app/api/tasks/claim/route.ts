import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyPinFromPB, findMemberByName, namesMatch } from "@/lib/server-auth";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import {
  isCrewTask,
  normalizeCrew,
  normalizeSpeedBonus,
  crewAllCheckedIn,
  PIN_FREE_MAX_AGE,
} from "@/lib/task-utils";
import type { Transaction, WeekData, CrewMember, Task } from "@/types/tasks";

export const dynamic = "force-dynamic";

function currentWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

// Day-precision "today" from the server's local clock (the host carries
// TZ=America/Detroit) for the stealable-late gate — due dates are date-only.
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function normalizeMemberName(member: any): string {
  return member?.name || "";
}

type RouteResult =
  | { ok: true; task?: any; weekData?: WeekData; pending?: boolean; claimedBy?: string; alreadyJoined?: boolean }
  | { ok: false; reason: string; claimedBy?: string };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "claim";
    const { taskId, assigneeEmoji } = body || {};
    const memberName = body?.memberName || body?.claimantName;
    const pin = body?.pin || body?.claimantPin;
    const targetName = body?.targetName;

    if (taskId === undefined || !memberName) {
      return NextResponse.json({ error: "taskId and memberName are required" }, { status: 400 });
    }
    if (action !== "claim" && action !== "crew-join" && action !== "crew-checkin" && action !== "crew-remove") {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }

    // Identity: a PIN verifies the named member. A MISSING pin is accepted ONLY
    // for crew-join/crew-checkin where the SESSION is an under-10 child whose
    // name matches — the same server-side pin-free rule as /api/auth/quick-login
    // (age read from PB, fail closed on anything else). Claims/removals always
    // need a real PIN.
    let claimant: any = null;
    if (pin) {
      claimant = await verifyPinFromPB(memberName, pin);
    } else if (action === "crew-join" || action === "crew-checkin") {
      const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
      if (session?.role === "child" && namesMatch(session.name, String(memberName))) {
        const member = await findMemberByName(session.name);
        const age = Number(member?.age);
        if (
          member?.role === "child" &&
          Number.isFinite(age) &&
          age > 0 &&
          age < PIN_FREE_MAX_AGE &&
          namesMatch(member.name, String(memberName))
        ) {
          claimant = member;
        }
      }
    }
    if (!claimant) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }
    // Pets never claim/join/check in (points can't be stranded on a dog).
    if (claimant.role === "pet") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const currentWeek = currentWeekKey();
    const normalizedName = normalizeMemberName(claimant);

    // Serialize the ENTIRE flow (task-row guard + ledger write) against every
    // other week-ledger writer in-process — a request that waits here re-reads
    // the row fresh and sees the winner's transaction (or completed row).
    const result: RouteResult = await withWeekLedgerLock(currentWeek, () =>
      withAdmin(async (pb) => {
        const taskRecords = await pb.collection("tasks").getFullList({ requestKey: null });
        const task = taskRecords.find((r: any) => r.taskId === Number(taskId));
        if (!task) return { ok: false, reason: "unknown-task" } as const;

        if (action === "crew-join") {
          return crewJoin(pb, task, normalizedName, claimant);
        }
        if (action === "crew-checkin") {
          return crewCheckin(pb, task, normalizedName, currentWeek);
        }
        if (action === "crew-remove") {
          return crewRemove(pb, task, targetName, claimant);
        }

        // action === "claim"
        // A crew task is joined member-by-member, never single-claimed.
        if (isCrewTask(task as Pick<Task, "crewSize">)) {
          return { ok: false, reason: "crew_task" } as const;
        }

        // Server-authoritative task lookup FIRST: the stored row decides the
        // points value. The request body is never trusted for scoring.
        const universalOk = task.universal !== false;
        const stealableLate =
          task.stealable === true &&
          typeof task.due === "string" &&
          task.due.length === 10 &&
          task.due < localTodayISO();
        if (!universalOk && !stealableLate) {
          return { ok: false, reason: task.stealable === true ? "not_late_yet" : "not_universal" } as const;
        }

        // Already done? `completed: true` always blocks. A bare `status:"done"`
        // only blocks when it belongs to THIS week — the weekly rollover clears
        // `completed` but leaves the stale `status` from last week on the PB row
        // (syncTasksToPB never resets it), and trusting that string forever made
        // every rolled-over task permanently unclaimable (the points-display
        // bug's second half). The week_data history guard below catches a real
        // duplicate claim within the current week.
        const doneThisWeek =
          task.completed === true ||
          (task.status === "done" &&
            (task.completedInWeek === undefined || task.completedInWeek === null || task.completedInWeek === "" || task.completedInWeek === currentWeek));
        if (doneThisWeek) {
          return { ok: false, reason: "already_completed" } as const;
        }

        const weekRecords = await pb.collection("week_data").getFullList({ requestKey: null });
        const week = weekRecords.find((r: any) => r.weekStart === currentWeek) || null;

        const points = parseJSON<Record<string, number>>(week?.points, {});
        const history = parseJSON<Transaction[]>(week?.history, []);

        const existingTx = history.find(
          (tx) => tx.taskId === Number(taskId) && tx.type === "earn"
        );
        if (existingTx) {
          const reversed = history.some(
            (tx) =>
              tx.taskId === Number(taskId) &&
              tx.type === "adjust" &&
              tx.amount < 0 &&
              tx.timestamp >= existingTx.timestamp
          );
          if (!reversed) {
            return { ok: false, reason: "already-claimed", claimedBy: existingTx.member } as const;
          }
        }

        const now = new Date().toISOString();
        const isSnatch = !universalOk && stealableLate;
        // Open ("up for grabs") tasks carry a first-claim speed bonus (0–5).
        const speedBonus = !isSnatch ? normalizeSpeedBonus(task.speedBonus) : 0;
        const amount = (Number(task.points) || 0) + speedBonus;
        const label = isSnatch ? "Snatched" : speedBonus > 0 ? "Fast grab" : "Completed";

        // A child's claim is pending-approval (points wait for a parent); the
        // pending record includes the speed bonus so approval pays the total.
        const claimantIsChild = claimant.role === "child";
        if (claimantIsChild) {
          const pending = { byName: normalizedName, at: now, points: amount };
          await pb.collection("tasks").update(task.id, {
            assignee: normalizedName,
            assigned: normalizedName,
            assigneeEmoji: assigneeEmoji || claimant.emoji || "",
            completed: true,
            status: "done",
            completedBy: normalizedName,
            completedAt: now,
            completedInWeek: currentWeek,
            pendingApproval: pending,
            sentBackAt: null,
          });
          // Mirror the done-but-unpaid row into the snapshot (no ledger change —
          // kid points land only on parent approval).
          await persistSnapshotWeek(pb, null, {
            id: Number(taskId),
            completed: true,
            completedBy: normalizedName,
            completedAt: now,
            completedInWeek: currentWeek,
            pendingApproval: pending,
          });
          return { ok: true, pending: true, claimedBy: normalizedName } as const;
        }

        const tx: Transaction = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          timestamp: now,
          member: normalizedName,
          type: "earn",
          amount,
          description: `${label}: ${task.title || "task"}${amount > 0 ? ` (+${amount}pts)` : ""}`,
          taskId: Number(taskId),
        };

        const updatedPoints = { ...points, [normalizedName]: (points[normalizedName] || 0) + amount };
        const updatedWeek: WeekData = {
          weekStart: currentWeek,
          points: updatedPoints,
          streak: parseJSON<Record<string, number>>(week?.streak, {}),
          lastActive: parseJSON<Record<string, string>>(week?.lastActive, {}),
          history: [...history, tx],
        };

        if (week) {
          await pb.collection("week_data").update(week.id, updatedWeek);
        } else {
          await pb.collection("week_data").create(updatedWeek);
        }

        // Lost-update detection: PB has no conditional updates, so a concurrent
        // claim can overwrite ours after both passed the guard above.
        const verifyRow: any = week
          ? await pb.collection("week_data").getOne(week.id, { requestKey: null })
          : (await pb.collection("week_data").getFullList({ requestKey: null }))
              .find((r: any) => r.weekStart === currentWeek);
        const verifiedHistory = parseJSON<Transaction[]>(verifyRow?.history, []);
        if (!verifiedHistory.some((t) => t.id === tx.id)) {
          const winnerTx = verifiedHistory.find(
            (t) => t.taskId === Number(taskId) && t.type === "earn"
          );
          const winnerReversed = winnerTx
            ? verifiedHistory.some(
                (t) =>
                  t.taskId === Number(taskId) &&
                  t.type === "adjust" &&
                  t.amount < 0 &&
                  t.timestamp >= winnerTx.timestamp
              )
            : false;
          return {
            ok: false,
            reason: "already-claimed",
            claimedBy: winnerTx && !winnerReversed ? winnerTx.member : undefined,
          } as const;
        }

        await pb.collection("tasks").update(task.id, {
          assignee: normalizedName,
          assigned: normalizedName,
          assigneeEmoji: assigneeEmoji || claimant.emoji || "",
          completed: true,
          status: "done",
          completedBy: normalizedName,
          completedAt: now,
          completedInWeek: currentWeek,
        }).catch(() => {});

        // Mirror the earn + completion into the snapshot the UI reads.
        await persistSnapshotWeek(pb, updatedWeek, {
          id: Number(taskId),
          completed: true,
          completedBy: normalizedName,
          completedAt: now,
          completedInWeek: currentWeek,
        });

        return { ok: true, claimedBy: normalizedName, weekData: updatedWeek } as const;
      })
    );

    if (!result.ok) {
      const status =
        result.reason === "unknown-task" ? 404 :
        result.reason === "not_allowed" || result.reason === "adult_only" || result.reason === "not_in_crew" ? 403 :
        result.reason === "not_universal" ||
        result.reason === "not_late_yet" ||
        result.reason === "not_crew_task" ||
        result.reason === "crew_task" ||
        result.reason === "target_required" ? 400 :
        409;
      return NextResponse.json({
        success: false,
        reason: result.reason,
        claimedBy: (result as any).claimedBy,
      }, { status });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Task claim API error:", error);
    return NextResponse.json({ error: "Failed to claim task" }, { status: 500 });
  }
}

type PB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

const SNAPSHOT_KEY = "tasks-snapshot";
const SNAPSHOT_COLLECTION = "consuela_data_snapshots";

/**
 * The dashboard reads points from the snapshot blob (`/api/tasks/sync` →
 * consuela_data_snapshots), NOT from the week_data collection. The claim route
 * writes week_data, so without this the earn lived in a store the UI never
 * reads — points showed only if a PARENT browser later pushed its own snapshot
 * (and a kid session can never push the weekData leg — `/api/tasks/sync`
 * ignores it for non-parents). Persist the ledger into the snapshot here, under
 * the same week-ledger lock as the write that produced it.
 *
 * Union-merges by transaction id so a concurrent claim's tx is never dropped,
 * and only adopts a week at least as new as what's stored (an older local blob
 * must not resurrect last week's points).
 */
async function persistSnapshotWeek(
  pb: PB,
  weekData: WeekData | null,
  taskRow?: { id: number; crew?: unknown; completed?: boolean; completedBy?: string; completedAt?: string; completedInWeek?: string; pendingApproval?: unknown }
): Promise<void> {
  try {
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const row: any = rows[0];
    const raw = row?.data;
    let data: any = {};
    if (typeof raw === "string") {
      try { data = JSON.parse(raw) || {}; } catch { data = {}; }
    } else if (raw && typeof raw === "object") {
      data = raw;
    }
    if (weekData) {
      const stored: any = data.weekData ?? {};
      const storedStart = typeof stored.weekStart === "string" ? stored.weekStart : "";
      // Only carry a week at least as new as the stored one.
      let mergedWeek: WeekData = weekData;
      if (storedStart && storedStart > weekData.weekStart) {
        mergedWeek = stored;
      } else if (storedStart === weekData.weekStart) {
        const byId = new Map<number, Transaction>();
        for (const t of Array.isArray(stored.history) ? stored.history : []) byId.set(t.id, t);
        for (const t of weekData.history) byId.set(t.id, t);
        const history = [...byId.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
        // Recompute points from the merged history so a unioned tx can't be lost.
        const points: Record<string, number> = {};
        for (const t of history) {
          if (t.type === "earn") points[t.member] = (points[t.member] || 0) + t.amount;
          else if (t.type === "redeem" || t.type === "penalty" || (t.type === "adjust" && t.amount < 0)) {
            points[t.member] = Math.max(0, (points[t.member] || 0) + t.amount);
          } else if (t.type === "adjust") {
            points[t.member] = (points[t.member] || 0) + t.amount;
          }
        }
        mergedWeek = { ...weekData, history, points };
      }
      data.weekData = mergedWeek;
    }
    // Mirror a task-row change (crew join/check-in/remove, completion) into the
    // snapshot's tasks leg so the UI sees it without waiting for a client push.
    if (taskRow && Array.isArray(data.tasks)) {
      data.tasks = data.tasks.map((t: any) =>
        Number(t.id) === Number(taskRow.id)
          ? {
              ...t,
              ...(taskRow.crew !== undefined ? { crew: taskRow.crew } : {}),
              ...(taskRow.completed !== undefined ? { completed: taskRow.completed } : {}),
              ...(taskRow.completedBy !== undefined ? { completedBy: taskRow.completedBy } : {}),
              ...(taskRow.completedAt !== undefined ? { completedAt: taskRow.completedAt } : {}),
              ...(taskRow.completedInWeek !== undefined ? { completedInWeek: taskRow.completedInWeek } : {}),
              ...(taskRow.pendingApproval !== undefined ? { pendingApproval: taskRow.pendingApproval } : {}),
            }
          : t
      );
    }
    const payload = { key: SNAPSHOT_KEY, data, updated_at: new Date().toISOString() };
    if (row) await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
    else await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
  } catch (e: any) {
    // Best-effort: the week_data ledger is still authoritative; the next
    // parent client push also reconciles the snapshot.
    console.warn("[tasks/claim] snapshot persist failed:", e?.message);
  }
}

// Join a crew: append the caller (self-join only) if there's room. Idempotent
// for an existing member; honest 409 crew_full on the last-slot race (the
// whole route runs under the week-ledger keyed lock, so two racers serialize).
async function crewJoin(
  pb: PB,
  task: any,
  normalizedName: string,
  claimant: any
): Promise<RouteResult> {
  if (task.completed === true || task.status === "done") {
    return { ok: false, reason: "already_completed" };
  }
  if (!isCrewTask(task)) {
    return { ok: false, reason: "not_crew_task" };
  }
  const members = normalizeCrew(task.crew);
  if (members.some((m) => m.name === normalizedName)) {
    return { ok: true, task: { ...task, crew: { members } }, alreadyJoined: true };
  }
  if (typeof task.crewSize === "number" && members.length >= task.crewSize) {
    return { ok: false, reason: "crew_full" };
  }
  const now = new Date().toISOString();
  const nextMembers: CrewMember[] = [
    ...members,
    { name: normalizedName, emoji: claimant?.emoji || "", joinedAt: now },
  ];
  await pb.collection("tasks").update(task.id, { crew: { members: nextMembers } });
  await persistSnapshotWeek(pb, null, { id: Number(task.taskId), crew: { members: nextMembers } });
  return { ok: true, task: { ...task, crew: { members: nextMembers } } };
}

// Check in ("done my part"): set-once per member. When the crew is full AND
// every member has checked in, the task flips to needs-parent-approval with
// the full crew roster so one approval can pay everyone.
async function crewCheckin(
  pb: PB,
  task: any,
  normalizedName: string,
  currentWeek: string
): Promise<RouteResult> {
  if (!isCrewTask(task)) {
    return { ok: false, reason: "not_crew_task" };
  }
  const members = normalizeCrew(task.crew);
  const idx = members.findIndex((m) => m.name === normalizedName);
  if (idx === -1) {
    return { ok: false, reason: "not_in_crew" };
  }
  const now = new Date().toISOString();
  const nextMembers = members.map((m, i) =>
    i === idx ? { ...m, checkedInAt: m.checkedInAt || now } : m
  );
  const nextTask = { ...task, crew: { members: nextMembers } };

  const patch: Record<string, unknown> = { crew: { members: nextMembers } };
  // Flip the approval trigger exactly once — a repeat check-in (or a second
  // device) must not overwrite the existing pendingApproval timestamp (the
  // snapshot merge's send-back proof is timestamp-gated on it).
  if (crewAllCheckedIn(nextTask) && !task.pendingApproval && task.completed !== true) {
    patch.completed = true;
    patch.status = "done";
    patch.completedBy = "Crew";
    patch.completedAt = now;
    patch.completedInWeek = currentWeek;
    patch.pendingApproval = {
      byName: "Crew",
      at: now,
      points: Number(task.points) || 0,
      crew: nextMembers.map((m) => m.name),
    };
    patch.sentBackAt = null;
  }
  await pb.collection("tasks").update(task.id, patch);
  await persistSnapshotWeek(pb, null, {
    id: Number(task.taskId),
    crew: { members: nextMembers },
    ...(patch.completed ? {
      completed: true,
      completedBy: "Crew",
      completedAt: now,
      completedInWeek: currentWeek,
      pendingApproval: patch.pendingApproval,
    } : {}),
  });
  return { ok: true, task: { ...nextTask, ...patch } };
}

// A parent removes a member who never checked in (before approval) so the rest
// aren't stuck. Parent-PIN-gated (the verified caller's role).
async function crewRemove(
  pb: PB,
  task: any,
  targetName: string,
  claimant: any
): Promise<RouteResult> {
  if (claimant?.role !== "parent") {
    return { ok: false, reason: "adult_only" };
  }
  if (!isCrewTask(task)) {
    return { ok: false, reason: "not_crew_task" };
  }
  if (task.completed === true || task.pendingApproval) {
    return { ok: false, reason: "already_completed" };
  }
  if (!targetName || typeof targetName !== "string") {
    return { ok: false, reason: "target_required" };
  }
  const members = normalizeCrew(task.crew);
  const target = members.find((m) => m.name === targetName);
  if (!target) {
    return { ok: false, reason: "not_in_crew" };
  }
  if (target.checkedInAt) {
    return { ok: false, reason: "member_checked_in" };
  }
  const nextMembers = members.filter((m) => m.name !== targetName);
  const removed = [...new Set([...(task.crew?.removed ?? []), targetName])];
  await pb.collection("tasks").update(task.id, { crew: { members: nextMembers, removed } });
  await persistSnapshotWeek(pb, null, { id: Number(task.taskId), crew: { members: nextMembers, removed } });
  return { ok: true, task: { ...task, crew: { members: nextMembers, removed } } };
}
