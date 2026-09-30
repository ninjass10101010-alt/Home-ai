import type { PendingApproval, Task } from "@/types/tasks";
import { crewMembers, crewCloseModeOf, isCrewTask } from "@/lib/task-utils";

/**
 * Parent crew close (spec 2026-09-29 §3 "parent" mode): pure decision logic
 * shared by the claim-route branch and the page's confirmation copy. Never
 * touches storage — the claim handler owns the write.
 */
export type CrewCloseRefusal = "not_crew_task" | "already_completed" | "strict_mode" | "no_checkins";

export function crewCloseAwardList(
  task: Task,
): { ok: true; awardList: string[] } | { ok: false; reason: CrewCloseRefusal } {
  if (!isCrewTask(task)) return { ok: false, reason: "not_crew_task" };
  if (task.completed || task.pendingApproval) return { ok: false, reason: "already_completed" };
  // The UI button only renders for "parent"; anything else refused keeps the
  // close surface a single-mode affair.
  if (crewCloseModeOf(task) !== "parent") return { ok: false, reason: "strict_mode" };
  const removed = new Set(Array.isArray(task.crew?.removed) ? task.crew!.removed : []);
  const awardList = crewMembers(task)
    .filter((member) => member.checkedInAt && !removed.has(member.name))
    .map((member) => member.name);
  if (awardList.length === 0) return { ok: false, reason: "no_checkins" };
  return { ok: true, awardList };
}

export function buildCrewClosePending(task: Task, awardList: string[], nowIso: string): PendingApproval {
  return { byName: "Crew", at: nowIso, points: task.points ?? 0, crew: [...awardList] };
}
