import { withAdmin } from "@/lib/pb-auth";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { localTodayISO, localWeekStartISO, weekdayOfISO } from "@/lib/local-date";
import { addDaysISO } from "@/lib/due-date-utils";
import {
  liveSnapshotTasks,
  mutateSnapshotWithMeta,
  readSnapshotWithRevision,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import { isDailyRecurrence, isWeekdayRecurrence, recurringClone, recurringLineage } from "@/lib/task-recurrence";
import { issueServerTaskId } from "@/lib/task-week-rollover";
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

/** Stage: real daily/weekday recurrence (spec §2). Consume every non-pending
 *  stale instance of a daily lineage (completed or merely missed — the day is
 *  the unit), then spawn exactly one clone due today. Pending-approval rows are
 *  immune; a lineage that already has a row due today never spawns twice.
 *  Weekday lineages freeze over the weekend: on Sat/Sun no consume and no
 *  spawn, so Friday's row stays visible until Monday's sweep replaces it. */
export function regenerateRecurringOnTasks(
  tasks: SnapshotTask[],
  today: string,
  _weekStart: string,
  _nowIso: string,
  issueId: (existing: ReadonlySet<number>) => number,
): { tasks: SnapshotTask[]; deletedIds: number[] } {
  const groups = new Map<string, SnapshotTask[]>();
  for (const task of tasks) {
    const id = Number(task?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (!isDailyRecurrence(task.recurring) && !isWeekdayRecurrence(task.recurring)) continue;
    const key = recurringLineage(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const deletedIds: number[] = [];
  const removed = new Set<number>();
  const added: SnapshotTask[] = [];
  const existing = new Set(tasks.map((task) => Number(task.id)));
  const weekday = weekdayOfISO(today);
  const weekend = weekday === "Sat" || weekday === "Sun";
  for (const group of groups.values()) {
    if (isWeekdayRecurrence(group[0]?.recurring) && weekend) continue;
    if (group.some((task) => task.due === today)) continue;
    if (group.some((task) => !task.pendingApproval && typeof task.due === "string" && task.due > today)) continue;
    for (const task of group) {
      if (task.pendingApproval) continue;
      if (typeof task.due !== "string" || task.due >= today) continue;
      removed.add(Number(task.id));
      deletedIds.push(Number(task.id));
    }
    // Pending-approval rows are immune from consumption but still seed today's
    // instance (spec §2: left alone, not a lineage pause — the day is the unit).
    const source =
      group.find((task) => !task.pendingApproval && typeof task.due === "string" && task.due < today) ??
      group.find((task) => typeof task.due === "string" && task.due < today);
    if (!source) continue;
    const id = issueId(existing);
    existing.add(id);
    added.push(recurringClone(source, id, today));
  }
  return {
    tasks: [...tasks.filter((task) => !removed.has(Number(task.id))), ...added],
    deletedIds,
  };
}

/** Stage: one-time expiry (spec §3). Tombstones incomplete one-time tasks
 *  whose local day is past due + expiresAfterDays. Completed, pending-approval
 *  and recurring rows are immune; no due date = never expires. */
export function cullExpiredTasksOnTasks(
  tasks: SnapshotTask[],
  today: string,
): { tasks: SnapshotTask[]; deletedIds: number[] } {
  const deletedIds: number[] = [];
  const kept: SnapshotTask[] = [];
  for (const task of tasks) {
    const id = Number(task?.id);
    const due = typeof task.due === "string" ? task.due : "";
    const expires = task.expiresAfterDays;
    const eligible =
      Number.isSafeInteger(id) && id > 0 &&
      !task.recurring && task.completed !== true && !task.pendingApproval &&
      /^\d{4}-\d{2}-\d{2}$/.test(due) &&
      typeof expires === "number" && Number.isSafeInteger(expires) && expires >= 1 && expires <= 30;
    if (eligible) {
      const deadline = addDaysISO(due, expires);
      if (deadline && today >= deadline) {
        deletedIds.push(id);
        continue;
      }
    }
    kept.push(task);
  }
  return { tasks: kept, deletedIds };
}

/** All sweep stages, in order. Plan 2 prepends recurrence + expiry here. */
function runDaySweepStages(
  tasks: SnapshotTask[],
  today: string,
  weekStart: string,
  nowIso: string,
  issueId: (existing: ReadonlySet<number>) => number,
): { tasks: SnapshotTask[]; closedIds: number[]; deletedIds: number[] } {
  const regenerated = regenerateRecurringOnTasks(tasks, today, weekStart, nowIso, issueId);
  const culled = cullExpiredTasksOnTasks(regenerated.tasks, today);
  const closed = closeDeadlineCrewsOnTasks(culled.tasks, today, weekStart, nowIso);
  return {
    tasks: closed.tasks,
    closedIds: closed.closedIds,
    deletedIds: [...regenerated.deletedIds, ...culled.deletedIds],
  };
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
        const live = liveSnapshotTasks(data);
        const tombstoned = Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds.map(Number) : [];
        const allocated: number[] = [];
        const applied = runDaySweepStages(live, today, weekStart, nowIso, (existing) => {
          const reserved = new Set([...existing, ...tombstoned, ...allocated]);
          const id = issueServerTaskId(reserved, Date.now());
          allocated.push(id);
          return id;
        });
        const deletedTaskIds = [...new Set([...tombstoned, ...applied.deletedIds])];
        return {
          data: {
            ...data,
            tasks: applied.tasks,
            deletedTaskIds,
            lastDaySweep: { day: today, at: nowIso },
          },
          result: { closedIds: applied.closedIds, deletedIds: applied.deletedIds },
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
      const deletedOk = mutation.result.deletedIds.every((id) =>
        (verified.data.deletedTaskIds ?? []).map(Number).includes(id),
      );
      const reconciled = !!verifiedMarker && verifiedMarker.day === today && closedOk && deletedOk;
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
