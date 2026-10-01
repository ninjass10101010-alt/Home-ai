import { withAdmin } from "@/lib/pb-auth";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import {
  liveSnapshotTasks,
  mutateSnapshotWithMeta,
  readSnapshotWithRevision,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import { crewCloseModeOf } from "@/lib/task-utils";

/**
 * The daily sweep (spec 2026-09-29 crew-close-modes §2). Runs on the sync GET
 * path after ensureCurrentTaskWeek, under the same week-ledger lock. One
 * locked snapshot mutation, one revision, idempotent per local day (marker
 * `lastDaySweep.day`). Plan-2 stages (recurrence regen, expiry cull) mount in
 * runDaySweepStages — they are pure task-array transforms exactly like the
 * deadline stage below. Failure labels use the `tasks:daysweep:` prefix so the
 * existing repairCategories regex admits them.
 */
export interface TaskDaySweepResult {
  day: string;
  swept: boolean;
  closedTaskIds: number[];
  reconciled: boolean;
  failed: string[];
  /** Snapshot revision as the sweep last saw it (post-mutation when it
   *  wrote). The sync GET passes it to the reconciler as `expectedRevision` —
   *  the sweep is the writer between rollover and reconcile, so the CAS must
   *  be against this revision or every first GET of the local day fails
   *  `rollover:changed` before it can project the swept rows. */
  revision?: string;
}

function validNow(now: Date | undefined): Date {
  const value = now ?? new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("invalid_now");
  return value;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Stage: close past-due `deadline` crew tasks, staging crew pendingApprovals
 *  for the checked-in members only. Pure: input array is not mutated. */
export function closeDeadlineCrewsOnTasks(
  tasks: SnapshotTask[],
  today: string,
  weekStart: string,
  nowIso: string,
): { tasks: SnapshotTask[]; closedIds: number[] } {
  const closedIds: number[] = [];
  const next = tasks.map((task): SnapshotTask => {
    const id = Number(task?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return task;
    if (crewCloseModeOf({ crewCloseMode: task.crewCloseMode }) !== "deadline") return task;
    if (typeof task.crewSize !== "number" || !Number.isSafeInteger(task.crewSize) || task.crewSize < 2) return task;
    if (task.completed === true || task.pendingApproval) return task;
    const due = typeof task.due === "string" ? task.due : "";
    if (!ISO_DAY.test(due) || due >= today) return task;
    const removed = new Set(Array.isArray(task.crew?.removed) ? task.crew.removed : []);
    const members = Array.isArray((task.crew as any)?.members) ? (task.crew as any).members : [];
    const awardList = members
      .filter((m: any) => m && typeof m.name === "string" && typeof m.checkedInAt === "string" && !removed.has(m.name))
      .map((m: any) => m.name);
    if (awardList.length === 0) return task; // nobody showed up: leave it overdue
    closedIds.push(id);
    return {
      ...task,
      completed: true,
      status: "done",
      completedAt: nowIso,
      completedBy: "Crew",
      completedInWeek: weekStart,
      pendingApproval: { byName: "Crew", at: nowIso, points: task.points ?? 0, crew: awardList },
      // A prior Send back leaves sentBackAt set; closing here must clear it
      // exactly like the claim path's completedFields (task-claim.ts) or the
      // fresh approve 409s `operation_conflict` forever.
      sentBackAt: null,
    };
  });
  return { tasks: next, closedIds };
}

/** All sweep stages, in order. Plan 2 prepends recurrence + expiry here. */
function runDaySweepStages(
  tasks: SnapshotTask[],
  today: string,
  weekStart: string,
  nowIso: string,
): { tasks: SnapshotTask[]; closedIds: number[] } {
  return closeDeadlineCrewsOnTasks(tasks, today, weekStart, nowIso);
}

export async function ensureCurrentTaskDay(
  options: { now?: Date } = {},
): Promise<TaskDaySweepResult> {
  const now = validNow(options.now);
  const today = localTodayISO(now);
  const weekStart = localWeekStartISO(now);
  const nowIso = now.toISOString();
  return withWeekLedgerLock(weekStart, () =>
    withAdmin(async (pb): Promise<TaskDaySweepResult> => {
      const initial = await readSnapshotWithRevision();
      if (!Array.isArray(initial.data.tasks)) {
        return { day: today, swept: false, closedTaskIds: [], reconciled: false, failed: ["tasks:daysweep:snapshot"] };
      }
      const marker = initial.data.lastDaySweep as { day?: unknown } | undefined;
      if (marker && typeof marker === "object" && marker.day === today) {
        return { day: today, swept: false, closedTaskIds: [], reconciled: true, failed: [], revision: initial.revision.revision };
      }
      const mutation = await mutateSnapshotWithMeta((data) => {
        const applied = runDaySweepStages(liveSnapshotTasks(data), today, weekStart, nowIso);
        return {
          data: {
            ...data,
            tasks: applied.tasks,
            deletedTaskIds: Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds : [],
            lastDaySweep: { day: today, at: nowIso },
          },
          result: { closedIds: applied.closedIds },
        };
      }, pb);
      const verified = await readSnapshotWithRevision();
      const verifiedMarker = verified.data.lastDaySweep as { day?: unknown } | undefined;
      const stored = liveSnapshotTasks(verified.data);
      const closedOk = mutation.result.closedIds.every((id) => {
        const row = stored.find((t) => Number(t.id) === id) as any;
        return !!row && row.completed === true && !!row.pendingApproval
          && Array.isArray(row.pendingApproval.crew);
      });
      const reconciled = !!verifiedMarker && verifiedMarker.day === today && closedOk;
      return {
        day: today,
        swept: true,
        closedTaskIds: mutation.result.closedIds,
        reconciled,
        failed: reconciled ? [] : ["tasks:daysweep:verify"],
        revision: mutation.revision.revision,
      };
    }),
  );
}
