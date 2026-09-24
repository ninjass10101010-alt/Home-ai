import { withAdmin } from "@/lib/pb-auth";
import { localWeekStartISO } from "@/lib/local-date";
import { hallEntriesForWeek } from "@/lib/hall-of-fame-backfill";
import {
  hasUnreversedTaskEarn,
  parseCanonicalTransactions,
  recomputeWeekPoints,
} from "@/lib/task-ledger";
import {
  liveSnapshotTasks,
  mutateSnapshotWithMeta,
  normalizeWeekData,
  readSnapshotWithRevision,
  type AdminPB,
  type SnapshotRevision,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import type { HallOfFameEntry, Transaction, WeekData, WeeklyPrize } from "@/types/tasks";

export interface TaskWeekRolloverResult {
  weekStart: string;
  previousWeekStart: string | null;
  archived: boolean;
  tasksReset: boolean;
  hallOfFameRecorded: boolean;
  currentWeekData: WeekData;
  revision: SnapshotRevision;
  reconciled: boolean;
}

type Row = Record<string, any>;

interface CanonicalRows {
  rows: Row[];
  week: WeekData;
  needsRepair: boolean;
}

interface ProjectionResult {
  recorded: boolean;
  reconciled: boolean;
}

let taskIdSequence = 0;

function normalizeWeekStart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const weekStart = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === weekStart
    ? weekStart
    : null;
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date)) throw new TypeError("invalid_now");
  const time = value.getTime();
  if (!Number.isSafeInteger(time) || time <= 0) throw new TypeError("invalid_now");
  return new Date(time);
}

function emptyWeekData(weekStart: string): WeekData {
  return {
    weekStart,
    points: {},
    streak: {},
    lastActive: {},
    history: [],
  };
}

function weekPayload(week: WeekData): Row {
  return {
    weekStart: week.weekStart,
    points: week.points,
    streak: week.streak,
    lastActive: week.lastActive,
    history: week.history,
  };
}

function sameNumberRecord(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function sameStringRecord(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function sameTransaction(left: Transaction, right: Transaction): boolean {
  return (
    left.id === right.id &&
    left.timestamp === right.timestamp &&
    left.member === right.member &&
    left.type === right.type &&
    left.amount === right.amount &&
    left.description === right.description &&
    left.taskId === right.taskId &&
    left.appliedBy === right.appliedBy &&
    left.meta?.operationId === right.meta?.operationId &&
    left.meta?.source === right.meta?.source
  );
}

function sameHistory(left: Transaction[], right: Transaction[]): boolean {
  return (
    left.length === right.length &&
    left.every((transaction, index) => sameTransaction(transaction, right[index]))
  );
}

function sameWeek(left: WeekData, right: WeekData): boolean {
  return (
    left.weekStart === right.weekStart &&
    sameNumberRecord(left.points, right.points) &&
    sameNumberRecord(left.streak, right.streak) &&
    sameStringRecord(left.lastActive, right.lastActive) &&
    sameHistory(left.history, right.history)
  );
}

function mergeHistory(rowWeeks: WeekData[]): Transaction[] {
  const candidates = rowWeeks
    .flatMap((week) => week.history)
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.id - right.id,
    );
  const byId = new Map<number, Transaction>();
  const history: Transaction[] = [];
  for (const transaction of candidates) {
    const existing = byId.get(transaction.id);
    if (existing) {
      if (!sameTransaction(existing, transaction)) {
        throw new TypeError("conflicting_transaction_id");
      }
      continue;
    }
    if (
      transaction.type === "earn" &&
      transaction.taskId !== undefined &&
      hasUnreversedTaskEarn(history, transaction.taskId, transaction.member)
    ) {
      continue;
    }
    byId.set(transaction.id, transaction);
    history.push(transaction);
  }
  return history;
}

function canonicalizeRows(rows: Row[], weekStart: string): CanonicalRows {
  if (rows.length === 0) throw new TypeError("missing_week_rows");
  const sortedRows = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  for (const row of sortedRows) {
    if (typeof row.id !== "string" || !row.id) throw new TypeError("invalid_week_row_id");
  }
  const storedWeeks: WeekData[] = sortedRows.map((row) => {
    const week = normalizeWeekData(row);
    if (!week || week.weekStart !== weekStart) throw new TypeError("invalid_week_data");
    const history = parseCanonicalTransactions(week.history);
    if (!history) throw new TypeError("invalid_transaction_history");
    return { ...week, history };
  });
  const history = mergeHistory(storedWeeks);
  const week: WeekData = {
    weekStart,
    points: recomputeWeekPoints(history),
    streak: Object.assign({}, ...storedWeeks.map((candidate) => candidate.streak)),
    lastActive: Object.assign({}, ...storedWeeks.map((candidate) => candidate.lastActive)),
    history,
  };
  const needsRepair =
    sortedRows.length > 1 ||
    storedWeeks.some((stored) => {
      const canonical = { ...stored, points: recomputeWeekPoints(stored.history) };
      return !sameWeek(stored, canonical);
    });
  return { rows: sortedRows, week, needsRepair };
}

async function readRows(pb: AdminPB, collectionName: string): Promise<Row[]> {
  const rows = await pb.collection(collectionName).getFullList({ requestKey: null });
  if (!Array.isArray(rows)) throw new TypeError("invalid_collection_rows");
  return rows as Row[];
}

async function reconcileCanonicalRows(
  pb: AdminPB,
  collectionName: string,
  group: CanonicalRows,
  extra: Row = {},
): Promise<void> {
  if (!group.needsRepair) return;
  const collection = pb.collection(collectionName);
  const [primary, ...duplicates] = group.rows;
  await collection.update(
    primary.id,
    { ...weekPayload(group.week), ...extra },
    { requestKey: null },
  );
  for (const duplicate of duplicates) {
    await collection.delete(duplicate.id, { requestKey: null });
  }
  const rows = (await readRows(pb, collectionName)).filter(
    (row) => normalizeWeekStart(row.weekStart) === group.week.weekStart,
  );
  if (rows.length !== 1) throw new TypeError("week_row_reconciliation_failed");
  const verified = canonicalizeRows(rows, group.week.weekStart);
  if (verified.needsRepair || !sameWeek(verified.week, group.week)) {
    throw new TypeError("week_row_verification_failed");
  }
}

async function ensureCurrentWeekRow(
  pb: AdminPB,
  weekStart: string,
): Promise<{ week: WeekData; changed: boolean }> {
  const rows = (await readRows(pb, "week_data")).filter(
    (row) => normalizeWeekStart(row.weekStart) === weekStart,
  );
  if (rows.length === 0) {
    const week = emptyWeekData(weekStart);
    await pb.collection("week_data").create(weekPayload(week), { requestKey: null });
    const created = (await readRows(pb, "week_data")).filter(
      (row) => normalizeWeekStart(row.weekStart) === weekStart,
    );
    if (created.length !== 1) throw new TypeError("current_week_create_failed");
    const verified = canonicalizeRows(created, weekStart);
    if (verified.needsRepair || !sameWeek(verified.week, week)) {
      throw new TypeError("current_week_verification_failed");
    }
    return { week: verified.week, changed: true };
  }
  const group = canonicalizeRows(rows, weekStart);
  await reconcileCanonicalRows(pb, "week_data", group);
  return { week: group.week, changed: group.needsRepair };
}

async function archiveCanonicalWeek(
  pb: AdminPB,
  prior: CanonicalRows,
  now: Date,
): Promise<{ week: WeekData; changed: boolean }> {
  const rows = (await readRows(pb, "week_archive")).filter(
    (row) => normalizeWeekStart(row.weekStart) === prior.week.weekStart,
  );
  if (rows.length === 0) {
    await pb.collection("week_archive").create(
      {
        ...weekPayload(prior.week),
        archivedAt: now.toISOString(),
      },
      { requestKey: null },
    );
    const created = (await readRows(pb, "week_archive")).filter(
      (row) => normalizeWeekStart(row.weekStart) === prior.week.weekStart,
    );
    if (created.length !== 1) throw new TypeError("week_archive_create_failed");
    const verified = canonicalizeRows(created, prior.week.weekStart);
    if (verified.needsRepair || !sameWeek(verified.week, prior.week)) {
      throw new TypeError("week_archive_verification_failed");
    }
    return { week: verified.week, changed: true };
  }
  const group = canonicalizeRows(rows, prior.week.weekStart);
  const archivedAt =
    typeof group.rows[0].archivedAt === "string" && group.rows[0].archivedAt
      ? group.rows[0].archivedAt
      : now.toISOString();
  await reconcileCanonicalRows(pb, "week_archive", group, { archivedAt });
  return { week: group.week, changed: group.needsRepair };
}

function taskIsCrew(task: SnapshotTask): boolean {
  return typeof task.crewSize === "number" && task.crewSize >= 2;
}

function recurringLineage(task: SnapshotTask): string {
  const owner = task.universal
    ? "universal"
    : taskIsCrew(task)
      ? `crew:${task.crewSize}`
      : `assigned:${String(task.assignee ?? "")}`;
  return [String(task.title ?? ""), String(task.recurring ?? ""), owner].join("\u0000");
}

function validCompletedWeek(value: unknown): string | null {
  const week = typeof value === "string" ? value.trim() : "";
  return normalizeWeekStart(week);
}

export function resetRecurringTasksForWeek(
  tasks: SnapshotTask[],
  currentWeekStart: string,
  issueId: (existing: ReadonlySet<number>) => number,
): { tasks: SnapshotTask[]; deletedTaskIds: number[] } {
  const current = normalizeWeekStart(currentWeekStart);
  if (!current || typeof issueId !== "function") throw new TypeError("invalid_recurring_reset");
  const sourceTasks: SnapshotTask[] = [];
  const consumedIds = new Set<number>();
  for (const task of tasks) {
    const id = Number(task?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    consumedIds.add(id);
    const completedWeek = validCompletedWeek(task.completedInWeek);
    if (
      !task.completed ||
      !task.recurring ||
      !completedWeek ||
      completedWeek >= current ||
      task.pendingApproval
    ) {
      continue;
    }
    sourceTasks.push(task);
  }

  const lineageSources: SnapshotTask[] = [];
  const seenLineages = new Set<string>();
  for (const task of sourceTasks) {
    const lineage = recurringLineage(task);
    if (seenLineages.has(lineage)) continue;
    seenLineages.add(lineage);
    lineageSources.push(task);
  }

  const sourceIds = new Set(sourceTasks.map((task) => Number(task.id)));
  const existing = new Set<number>(consumedIds);
  const clones = lineageSources.map((task) => {
    let id = Number(issueId(existing));
    let attempts = 0;
    while (!Number.isSafeInteger(id) || id <= 0 || existing.has(id)) {
      if (++attempts > 10000) throw new TypeError("task_id_exhausted");
      id = Number(issueId(existing));
    }
    existing.add(id);
    return {
      ...task,
      id,
      completed: false,
      completedBy: undefined,
      completedAt: undefined,
      completedInWeek: undefined,
      pendingApproval: undefined,
      sentBackAt: undefined,
      crew: taskIsCrew(task) ? { members: [], removed: [] } : task.crew,
      assignee: task.universal ? "All" : task.assignee,
      assigneeEmoji: task.universal ? "🤝" : task.assigneeEmoji,
      due: current,
    } as SnapshotTask;
  });

  return {
    tasks: [...tasks.filter((task) => !sourceIds.has(Number(task.id))), ...clones],
    deletedTaskIds: sourceTasks.map((task) => Number(task.id)),
  };
}

function issueServerTaskId(existing: ReadonlySet<number>, nowMs: number): number {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const candidate = nowMs + taskIdSequence;
    taskIdSequence += 1;
    if (Number.isSafeInteger(candidate) && candidate > 0 && !existing.has(candidate)) {
      return candidate;
    }
  }
  throw new TypeError("task_id_exhausted");
}

function normalizeTaskIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
}

async function projectHallOfFame(
  pb: AdminPB,
  week: WeekData,
): Promise<boolean> {
  const [memberRows, rawPrizeRows, hallRows] = await Promise.all([
    readRows(pb, "members"),
    readRows(pb, "weekly_prizes"),
    readRows(pb, "hall_of_fame"),
  ]);
  const emojis: Record<string, string> = {};
  for (const member of memberRows) {
    if (typeof member.name === "string" && member.name && !emojis[member.name]) {
      emojis[member.name] = typeof member.emoji === "string" ? member.emoji : "🏅";
    }
  }
  const prizes = new Map<number, string>();
  for (const row of [...rawPrizeRows].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  )) {
    const rank = Number(row.rank);
    if (![1, 2, 3].includes(rank) || typeof row.text !== "string" || !row.text) continue;
    if (!prizes.has(rank)) prizes.set(rank, row.text);
  }
  const prizeCatalog: Array<Pick<WeeklyPrize, "rank" | "text">> = [...prizes].map(
    ([rank, text]) => ({ rank: rank as 1 | 2 | 3, text }),
  );
  const existing = new Set(
    hallRows
      .filter((row) => typeof row.member === "string" && normalizeWeekStart(row.weekStart))
      .map((row) => `${row.member}\u0000${normalizeWeekStart(row.weekStart)}`),
  );
  const entries: HallOfFameEntry[] = hallEntriesForWeek(
    week.points,
    week.weekStart,
    emojis,
    prizeCatalog,
  );
  let recorded = false;
  for (const entry of entries) {
    const key = `${entry.member}\u0000${entry.weekStart}`;
    if (existing.has(key)) continue;
    await pb.collection("hall_of_fame").create({ ...entry }, { requestKey: null });
    existing.add(key);
    recorded = true;
  }
  if (recorded) {
    const verified = await readRows(pb, "hall_of_fame");
    for (const entry of entries) {
      const key = `${entry.member}\u0000${entry.weekStart}`;
      if (!verified.some((row) => row.member === entry.member && normalizeWeekStart(row.weekStart) === entry.weekStart)) {
        throw new TypeError("hall_of_fame_verification_failed");
      }
    }
  }
  return recorded;
}

export function familyWeekStart(now: Date = new Date()): string {
  return localWeekStartISO(validNow(now));
}

export async function ensureCurrentTaskWeek(
  options: { now?: Date } = {},
): Promise<TaskWeekRolloverResult> {
  const now = validNow(options?.now ?? new Date());
  const weekStart = familyWeekStart(now);

  return withWeekLedgerLock(weekStart, () =>
    withAdmin(async (pb): Promise<TaskWeekRolloverResult> => {
      const weekRows = await readRows(pb, "week_data");
      const normalizedRows = weekRows
        .map((row) => ({ row, weekStart: normalizeWeekStart(row.weekStart) }))
        .filter((entry): entry is { row: Row; weekStart: string } => entry.weekStart !== null);
      const priorStarts = normalizedRows
        .filter((entry) => entry.weekStart < weekStart)
        .map((entry) => entry.weekStart)
        .sort();
      const previousWeekStart = priorStarts.at(-1) ?? null;
      let previous: CanonicalRows | null = null;
      let archived = false;

      if (previousWeekStart) {
        previous = canonicalizeRows(
          normalizedRows
            .filter((entry) => entry.weekStart === previousWeekStart)
            .map((entry) => entry.row),
          previousWeekStart,
        );
        await reconcileCanonicalRows(pb, "week_data", previous);
        const archiveResult = await archiveCanonicalWeek(pb, previous, now);
        archived = archiveResult.changed;
      }

      const currentResult = await ensureCurrentWeekRow(pb, weekStart);
      const projection: ProjectionResult = previous
        ? await projectHallOfFame(pb, previous.week)
            .then((recorded) => ({ recorded, reconciled: true }))
            .catch(() => ({ recorded: false, reconciled: false }))
        : { recorded: false, reconciled: true };

      const existingSnapshot = await readSnapshotWithRevision();
      const resetProbe = resetRecurringTasksForWeek(
        liveSnapshotTasks(existingSnapshot.data),
        weekStart,
        (existing) => issueServerTaskId(existing, now.getTime()),
      );
      const storedWeek = normalizeWeekData(existingSnapshot.data.weekData);
      const canonicalStoredWeek = storedWeek
        ? { ...storedWeek, points: recomputeWeekPoints(storedWeek.history) }
        : null;
      if (
        existingSnapshot.data.taskWeekStart === weekStart &&
        resetProbe.deletedTaskIds.length === 0 &&
        canonicalStoredWeek &&
        sameWeek(canonicalStoredWeek, currentResult.week)
      ) {
        return {
          weekStart,
          previousWeekStart,
          archived,
          tasksReset: false,
          hallOfFameRecorded: projection.recorded,
          currentWeekData: currentResult.week,
          revision: existingSnapshot.revision,
          reconciled: projection.reconciled,
        };
      }

      const snapshotMutation = await mutateSnapshotWithMeta(
        (data) => {
          const needsReset = data.taskWeekStart !== weekStart;
          const reset = resetRecurringTasksForWeek(
            liveSnapshotTasks(data),
            weekStart,
            (existing) => issueServerTaskId(existing, now.getTime()),
          );
          const deletedTaskIds = [
            ...new Set([
              ...normalizeTaskIds(data.deletedTaskIds),
              ...reset.deletedTaskIds,
            ]),
          ];
          return {
            data: {
              ...data,
              tasks: reset.tasks,
              deletedTaskIds,
              weekData: currentResult.week,
              taskWeekStart: weekStart,
            },
            result: needsReset || reset.deletedTaskIds.length > 0,
          };
        },
        pb,
      );

      return {
        weekStart,
        previousWeekStart,
        archived,
        tasksReset: snapshotMutation.result,
        hallOfFameRecorded: projection.recorded,
        currentWeekData: currentResult.week,
        revision: snapshotMutation.revision,
        reconciled: projection.reconciled,
      };
    }),
  );
}
