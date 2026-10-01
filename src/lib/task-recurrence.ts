import type { SnapshotTask } from "@/lib/snapshot-tasks";

function taskIsCrew(task: Record<string, unknown>): boolean {
  return typeof task.crewSize === "number" && Number.isSafeInteger(task.crewSize) && task.crewSize >= 2;
}

export function recurringLineage(task: {
  title?: unknown; recurring?: unknown; universal?: unknown; crewSize?: unknown; assignee?: unknown;
}): string {
  const owner = task.universal
    ? "universal"
    : taskIsCrew(task)
      ? `crew:${task.crewSize}`
      : `assigned:${String(task.assignee ?? "")}`;
  return [String(task.title ?? ""), String(task.recurring ?? ""), owner].join("\u0000");
}

export function isDailyRecurrence(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "daily";
}

export function isWeekdayRecurrence(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "weekdays";
}

export function recurringClone(task: SnapshotTask, id: number, due: string): SnapshotTask {
  const crew = taskIsCrew(task);
  return {
    ...task,
    id,
    completed: false,
    status: "pending",
    completedBy: undefined,
    completedAt: undefined,
    completedInWeek: undefined,
    pendingApproval: undefined,
    sentBackAt: undefined,
    crew: crew ? { members: [], removed: [] } : task.crew,
    assignee: task.universal ? "All" : task.assignee,
    assigneeEmoji: task.universal ? "🤝" : task.assigneeEmoji,
    speedBonus: crew ? 0 : task.speedBonus,
    due,
  } as SnapshotTask;
}
