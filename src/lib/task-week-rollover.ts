import { withAdmin } from "@/lib/pb-auth";
import { localWeekStartISO } from "@/lib/local-date";
import { ensureArchivedWeeksEnshrined } from "@/lib/hall-of-fame-backfill";
import { recurringClone, recurringLineage } from "@/lib/task-recurrence";
import {
  mergeCanonicalTransactions,
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
import { isRecord } from "@/lib/task-operation-contract";
import type { Transaction, WeekData } from "@/types/tasks";

export interface ArchivedTaskDef {
  title: string;
  points: number;
  category: string;
  priority: string;
  assigneeName?: string;
  universal?: boolean;
  crewSize?: number;
  crewCloseMode?: string;
}

export interface TaskWeekRolloverResult {
  weekStart: string;
  previousWeekStart: string | null;
  archived: boolean;
  tasksReset: boolean;
  hallOfFameRecorded: boolean;
  currentWeekData: WeekData;
  revision: SnapshotRevision;
  reconciled: boolean;
  /**
   * Honest failure categories for the legs that failed soft instead of
   * throwing — `week_archive:invalid` for an unreadable prior week, and
   * `week_data:invalid` for an unreadable current week. Empty on a fully
   * reconciled run. The sync route renders these as repair hints; they are
   * never a silent "looks fine".
   */
  failed: string[];
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
    left.meta?.source === right.meta?.source &&
    left.meta?.fingerprint === right.meta?.fingerprint &&
    left.meta?.actorId === right.meta?.actorId &&
    left.meta?.action === right.meta?.action &&
    JSON.stringify(left.meta?.taskIds ?? []) === JSON.stringify(right.meta?.taskIds ?? [])
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
  return mergeCanonicalTransactions(rowWeeks.map((week) => week.history));
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
      return !sameHistory(stored.history, history) || !sameWeek(stored, canonical);
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
  const afterUpdate = (await readRows(pb, collectionName)).filter(
    (row) => normalizeWeekStart(row.weekStart) === group.week.weekStart,
  );
  const verifiedPrimary = afterUpdate.find((row) => row.id === primary.id);
  if (!verifiedPrimary) throw new TypeError("week_primary_write_missing");
  const primaryState = canonicalizeRows([verifiedPrimary], group.week.weekStart);
  if (primaryState.needsRepair || !sameWeek(primaryState.week, group.week)) {
    throw new TypeError("week_primary_verification_failed");
  }
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

// A pre-existing current-week row is authoritative: pre-rollover ledger writers
// (task-claim's ledger operation creates it when missing, task-manage runs under
// the same week-ledger lock) may act before the rollover, so a row found here is
// reconciled in place and never reseeded.
async function ensureCurrentWeekRow(
  pb: AdminPB,
  weekStart: string,
): Promise<{ week: WeekData | null; changed: boolean; reconciled: boolean }> {
  try {
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
      return { week: verified.week, changed: true, reconciled: true };
    }
    const group = canonicalizeRows(rows, weekStart);
    await reconcileCanonicalRows(pb, "week_data", group);
    return { week: group.week, changed: group.needsRepair, reconciled: true };
  } catch {
    return { week: null, changed: false, reconciled: false };
  }
}

/**
 * B3 — the canonical a `week_archive` row must converge to.
 *
 * `week_data` and `week_archive` are two stores of the same week that can
 * legitimately disagree: the archive is written once at the rollover, while
 * week_data stays live and can still receive a late claim at the boundary (a
 * chore approved seconds before Monday). `all-time` reads ONLY the archive
 * (plus the current week's own row), so a transaction that exists on either
 * side and not on the other is worth zero to the family forever.
 *
 * The old repair passed the week_data read as the archive's authoritative
 * payload, so an archive-only transaction was deleted along with its row —
 * silently, and with `historyComplete: true`. The canonical is therefore the
 * LOSSLESS union of both sides (via `mergeCanonicalTransactions`, which drops
 * only a genuine double-earn of the same task — never a distinct
 * transaction), and the frozen archive wins on the scalar maps it owns.
 *
 * `conflicting_transaction_id` (the two sides disagree about the CONTENT of one
 * transaction id) is genuinely unknowable, so it is reported as unreadable data
 * (`ok: false`) instead of picking a winner.
 */
function mergedArchiveWeek(prior: CanonicalRows, observed: CanonicalRows): WeekData {
  const history = mergeCanonicalTransactions([prior.week.history, observed.week.history]);
  return {
    weekStart: observed.week.weekStart,
    points: recomputeWeekPoints(history),
    streak: { ...prior.week.streak, ...observed.week.streak },
    lastActive: { ...prior.week.lastActive, ...observed.week.lastActive },
    history,
  };
}

type ArchiveOutcome =
  | { ok: true; week: WeekData; changed: boolean }
  /**
   * B7: the stored archive row for this week cannot be READ (an unparseable
   * transaction, a duplicate id with conflicting content). Nothing is written —
   * a corrupt archive is never accepted as authoritative — and the caller
   * retries on the next sync with the current week still usable.
   */
  | { ok: false };

/**
 * Store-INTEGRITY failures (our own write did not persist, or did not verify)
 * still throw out of here: PocketBase is not holding writes, and that is a hard
 * outage every caller must see. Only unreadable stored DATA fails soft.
 */
async function archiveCanonicalWeek(
  pb: AdminPB,
  prior: CanonicalRows,
  archiveRows: Row[],
  now: Date,
): Promise<ArchiveOutcome> {
  const rows = archiveRows.filter(
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
    return { ok: true, week: verified.week, changed: true };
  }
  let observed: CanonicalRows;
  let week: WeekData;
  try {
    observed = canonicalizeRows(rows, prior.week.weekStart);
    week = mergedArchiveWeek(prior, observed);
  } catch {
    return { ok: false };
  }
  const group: CanonicalRows = {
    rows: observed.rows,
    week,
    // Structural drift (duplicate rows, an unparseable row, a stale points
    // map) OR a divergence between the two stores — both are repaired to the
    // union, so a repair can only ever ADD the missing side, never drop one.
    needsRepair: observed.needsRepair || !sameWeek(observed.week, week),
  };
  if (!group.needsRepair) return { ok: true, week, changed: false };
  const archivedAt =
    typeof observed.rows[0].archivedAt === "string" && observed.rows[0].archivedAt
      ? observed.rows[0].archivedAt
      : now.toISOString();
  await reconcileCanonicalRows(pb, "week_archive", group, { archivedAt });
  return { ok: true, week, changed: true };
}

function validCompletedWeek(value: unknown): string | null {
  const week = typeof value === "string" ? value.trim() : "";
  return normalizeWeekStart(week);
}

/**
 * B8 — a recurring LINEAGE is one chore, not a title coincidence.
 *
 * `recurringLineage` (title + recurrence + owner) treated two identically
 * titled chores as one lineage. The sweep then tombstoned EVERY stale row in
 * the group and spawned ONE clone, and a tombstone is not an undo: the second
 * chore — and the points value a kid was earning on it — was gone for good.
 * The weekly rollover deduped the same way but kept the LAST clone, silently
 * dropping the other lineage's field differences.
 *
 * Two rows now only merge when they are provably the same chore: a clone
 * records the row it came from (`recurringOriginId`) and the lineage keys on
 * that, so the key is stable across generations; a legacy row predating the
 * stamp falls back to the distinguishing fields below. Every field listed here
 * is one `recurringClone` copies through VERBATIM — the crew roster, the crew
 * speed bonus and the assignee emoji are deliberately excluded because the
 * clone rewrites them, and `due` because it is the regeneration target.
 */
const LINEAGE_DISCRIMINATORS = [
  "points",
  "category",
  "priority",
  "crewSize",
  "crewCloseMode",
  "universal",
  "stealable",
  "expiresAfterDays",
] as const;

function lineageStamp(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

export function recurringLineageKey(task: SnapshotTask): string {
  const origin = Number(task?.recurringOriginId);
  if (Number.isSafeInteger(origin) && origin > 0) return `origin:${origin}`;
  return [
    recurringLineage(task),
    ...LINEAGE_DISCRIMINATORS.map(
      (key) => `${key}:${lineageStamp((task as Record<string, unknown>)[key])}`,
    ),
  ].join("\u0000");
}

/** A recurring clone that remembers the row it continues, so its lineage never
 *  merges with a same-titled chore that happens to share its title. */
export function recurringCloneWithOrigin(task: SnapshotTask, id: number, due: string): SnapshotTask {
  const recorded = Number(task?.recurringOriginId);
  const origin = Number.isSafeInteger(recorded) && recorded > 0 ? recorded : Number(task?.id);
  return {
    ...recurringClone(task, id, due),
    recurringOriginId: Number.isSafeInteger(origin) && origin > 0 ? origin : null,
  } as SnapshotTask;
}

export function resetRecurringTasksForWeek(
  tasks: SnapshotTask[],
  currentWeekStart: string,
  issueId: (existing: ReadonlySet<number>) => number,
): { tasks: SnapshotTask[]; deletedTaskIds: number[] } {
  const current = normalizeWeekStart(currentWeekStart);
  if (!current || typeof issueId !== "function") throw new TypeError("invalid_recurring_reset");
  const dueWeekOf = (task: SnapshotTask): string | null => {
    if (typeof task.due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return null;
    return localWeekStartISO(new Date(`${task.due}T12:00:00`));
  };
  const sourceTasks: SnapshotTask[] = [];
  const consumedIds = new Set<number>();
  for (const task of tasks) {
    const id = Number(task?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    consumedIds.add(id);
    if (!task.recurring || task.pendingApproval) continue;
    const completedWeek = validCompletedWeek(task.completedInWeek);
    const completedEarlier = task.completed === true && !!completedWeek && completedWeek < current;
    const dueWeek = dueWeekOf(task);
    const missedEarlier = task.completed !== true && !!dueWeek && dueWeek < current;
    if (!completedEarlier && !missedEarlier) continue;
    sourceTasks.push(task);
  }

  const lineageSources: SnapshotTask[] = [];
  const seenLineages = new Set<string>();
  for (const task of sourceTasks) {
    const lineage = recurringLineageKey(task);
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
    return recurringCloneWithOrigin(task, id, current);
  });

  return {
    tasks: [...tasks.filter((task) => !sourceIds.has(Number(task.id))), ...clones],
    deletedTaskIds: sourceTasks.map((task) => Number(task.id)),
  };
}

export function issueServerTaskId(existing: ReadonlySet<number>, nowMs: number): number {
  let candidate = nowMs;
  for (const id of existing) {
    if (id >= candidate) candidate = id + 1;
  }
  while (existing.has(candidate)) candidate += 1;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError("task_id_exhausted");
  }
  return candidate;
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

function taskResetMatches(stored: SnapshotTask | undefined, expected: SnapshotTask): boolean {
  if (!stored || Number(stored.id) !== Number(expected.id)) return false;
  return (
    stored.title === expected.title &&
    stored.assignee === expected.assignee &&
    stored.assigneeEmoji === expected.assigneeEmoji &&
    stored.due === expected.due &&
    stored.points === expected.points &&
    stored.recurring === expected.recurring &&
    stored.category === expected.category &&
    stored.priority === expected.priority &&
    stored.universal === expected.universal &&
    stored.stealable === expected.stealable &&
    stored.crewSize === expected.crewSize &&
    stored.speedBonus === expected.speedBonus &&
    stored.completed === false &&
    stored.status === "pending" &&
    stored.completedBy === undefined &&
    stored.completedAt === undefined &&
    stored.completedInWeek === undefined &&
    stored.pendingApproval === undefined &&
    stored.sentBackAt === undefined &&
    JSON.stringify(stored.crew ?? null) === JSON.stringify(expected.crew ?? null)
  );
}

export function familyWeekStart(now: Date = new Date()): string {
  return localWeekStartISO(validNow(now));
}

/**
 * LOCK ORDER (B3, the Monday boundary).
 *
 * The rollover is the ONLY path that takes more than one week-ledger lock; every
 * other ledger writer (claim, approval, redeem, manage, the projection
 * reconciler, the day sweep) takes exactly one, keyed by the week it writes.
 * It therefore acquires its locks in one total order — ASCENDING weekStart, so
 * the OLDEST week first and the current week LAST — and holds them for the whole
 * body.
 *
 * That closes the boundary race: a claim landing at Sun 23:59:59.9 holds the
 * OLDER week's lock, so it either commits before the rollover's read (its
 * transaction is archived with the week) or after it (the next run's merged
 * repair pulls it into the archive). Ascending order is the deadlock-free
 * direction: no single-lock path can invert it, and this path is the only one
 * that takes two.
 */
function withWeekLocksInOrder<T>(weeks: readonly string[], fn: () => Promise<T>): Promise<T> {
  const [head, ...rest] = weeks;
  if (!head) return fn();
  return withWeekLedgerLock(head, () => withWeekLocksInOrder(rest, fn));
}

/**
 * Which prior weeks might need archiving. Read-only and unlocked, purely to
 * learn the lock set before any write; the body re-reads under the locks and
 * only archives a week whose lock this run actually holds, so a peek that is
 * stale or fails outright costs only deferred work, never a lost lock.
 */
async function peekPriorWeekStarts(weekStart: string): Promise<string[]> {
  try {
    return await withAdmin(async (pb): Promise<string[]> => {
      const rows = await readRows(pb, "week_data");
      return priorWeekStarts(rows, weekStart);
    });
  } catch {
    return [];
  }
}

function priorWeekStarts(rows: Row[], weekStart: string): string[] {
  return [
    ...new Set(
      rows
        .map((row) => normalizeWeekStart(row.weekStart))
        .filter((value): value is string => value !== null && value < weekStart),
    ),
  ].sort();
}

export async function ensureCurrentTaskWeek(
  options: { now?: Date } = {},
): Promise<TaskWeekRolloverResult> {
  const now = validNow(options?.now ?? new Date());
  const weekStart = familyWeekStart(now);
  const peeked = await peekPriorWeekStarts(weekStart);
  const lockOrder = [...new Set([...peeked, weekStart])].sort();
  const lockedWeeks = new Set(peeked);

  return withWeekLocksInOrder(lockOrder, () =>
    withAdmin(async (pb): Promise<TaskWeekRolloverResult> => {
      const initialSnapshot = await readSnapshotWithRevision();
      if (initialSnapshot.rowId != null && !Array.isArray(initialSnapshot.data.tasks)) {
        return {
          weekStart,
          previousWeekStart: null,
          archived: false,
          tasksReset: false,
          hallOfFameRecorded: false,
          currentWeekData: emptyWeekData(weekStart),
          revision: initialSnapshot.revision,
          reconciled: false,
          failed: [],
        };
      }
      // ONE read of each store, taken under every lock held above: the
      // per-week work below is already serialized against every writer that
      // could touch those rows.
      const weekRows = await readRows(pb, "week_data");
      const archiveRows = await readRows(pb, "week_archive");
      const normalizedRows = weekRows
        .map((row) => ({ row, weekStart: normalizeWeekStart(row.weekStart) }))
        .filter((entry): entry is { row: Row; weekStart: string } => entry.weekStart !== null);
      // B2: EVERY week older than the current one is archived, not just the
      // most recent. `ensureCurrentWeekRow` can fail soft (and does, whenever
      // the snapshot's task list is malformed), which skips a week entirely —
      // with only the newest week archived, every older row stayed orphaned
      // forever and its points vanished from all-time behind
      // `historyComplete: true`. Nothing else ever deletes a week_data row.
      const priorStarts = priorWeekStarts(weekRows, weekStart);
      const previousWeekStart = priorStarts.at(-1) ?? null;
      const archiveFailures: string[] = [];
      let archived = false;

      for (const priorStart of priorStarts) {
        // Not in this run's lock set (created after the peek): next run. It is
        // deferred, never archived outside a lock.
        if (!lockedWeeks.has(priorStart)) continue;
        const priorRows = normalizedRows
          .filter((entry) => entry.weekStart === priorStart)
          .map((entry) => entry.row);
        let prior: CanonicalRows;
        try {
          prior = canonicalizeRows(priorRows, priorStart);
        } catch (error) {
          // B7, the fail-soft contract `ensureCurrentWeekRow` already uses: ONE
          // unreadable prior week must not throw out of the rollover. A throw
          // here 503s every sync and fails `task_store_unavailable` on claim,
          // approve and ledger, so a single malformed transaction (a blank
          // description, a non-integer id, an unknown type) left the family
          // unable to complete a chore at all — indefinitely, with no
          // self-heal. The current week is still created and usable, the
          // archive is retried on the next sync, and the category below is the
          // honest signal that it is still wrong.
          archiveFailures.push("week_archive:invalid");
          console.warn(
            `[task-week-rollover] week_archive:invalid weekStart=${priorStart} rows=${priorRows.length} error=${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        // A store that will not hold a write still throws, as it always did.
        await reconcileCanonicalRows(pb, "week_data", prior);
        const outcome = await archiveCanonicalWeek(pb, prior, archiveRows, now);
        if (!outcome.ok) {
          archiveFailures.push("week_archive:invalid");
          console.warn(
            `[task-week-rollover] week_archive:invalid weekStart=${priorStart} archive_failed`,
          );
          continue;
        }
        archived = archived || outcome.changed;
      }

      const currentResult = await ensureCurrentWeekRow(pb, weekStart);
      let projection: ProjectionResult;
      try {
        const changed = await ensureArchivedWeeksEnshrined(pb);
        projection = { recorded: changed > 0, reconciled: true };
      } catch {
        console.warn("[task-week-rollover] projection reconciliation pending");
        projection = { recorded: false, reconciled: false };
      }

      const existingSnapshot = await readSnapshotWithRevision();
      if (!currentResult.week || !currentResult.reconciled) {
        const stored = normalizeWeekData(existingSnapshot.data.weekData);
        const fallback = stored?.weekStart === weekStart
          ? { ...stored, points: recomputeWeekPoints(stored.history) }
          : emptyWeekData(weekStart);
        return {
          weekStart,
          previousWeekStart,
          archived,
          tasksReset: false,
          hallOfFameRecorded: projection.recorded,
          currentWeekData: fallback,
          revision: existingSnapshot.revision,
          reconciled: false,
          failed: [...archiveFailures, "week_data:invalid"],
        };
      }

      const currentWeek = currentResult.week;
      const tombstoneProbeIds = normalizeTaskIds(existingSnapshot.data.deletedTaskIds);
      const allocatedProbeIds: number[] = [];
      const resetProbe = resetRecurringTasksForWeek(
        liveSnapshotTasks(existingSnapshot.data),
        weekStart,
        (existing) => {
          const reserved = new Set([...existing, ...tombstoneProbeIds, ...allocatedProbeIds]);
          const id = issueServerTaskId(reserved, now.getTime());
          allocatedProbeIds.push(id);
          return id;
        },
      );
      const storedWeek = normalizeWeekData(existingSnapshot.data.weekData);
      const canonicalStoredWeek = storedWeek
        ? { ...storedWeek, points: recomputeWeekPoints(storedWeek.history) }
        : null;
      if (
        existingSnapshot.data.taskWeekStart === weekStart &&
        resetProbe.deletedTaskIds.length === 0 &&
        canonicalStoredWeek &&
        sameWeek(canonicalStoredWeek, currentWeek)
      ) {
        return {
          weekStart,
          previousWeekStart,
          archived,
          tasksReset: false,
          hallOfFameRecorded: projection.recorded,
          currentWeekData: currentWeek,
          revision: existingSnapshot.revision,
          reconciled: archiveFailures.length === 0 && projection.reconciled,
          failed: archiveFailures,
        };
      }

      const snapshotMutation = await mutateSnapshotWithMeta(
        (data) => {
          const liveBefore = liveSnapshotTasks(data);
          const existingIds = new Set(liveBefore.map((task) => Number(task.id)));
          const tombstoneIds = normalizeTaskIds(data.deletedTaskIds);
          const allocatedIds: number[] = [];
          const needsReset = data.taskWeekStart !== weekStart;
          const reset = resetRecurringTasksForWeek(
            liveBefore,
            weekStart,
            (existing) => {
              const reserved = new Set([...existing, ...tombstoneIds, ...allocatedIds]);
              const id = issueServerTaskId(reserved, now.getTime());
              allocatedIds.push(id);
              return id;
            },
          );
          const deletedTaskIds = [...new Set([...tombstoneIds, ...reset.deletedTaskIds])];
          const defs: ArchivedTaskDef[] = liveBefore
            .filter((task) =>
              !task.recurring &&
              task.completed === true &&
              task.completedInWeek === previousWeekStart,
            )
            .map((task) => ({
              title: String(task.title ?? ""),
              points: Number(task.points ?? 0),
              category: String(task.category ?? "chores"),
              priority: String(task.priority ?? "medium"),
              ...(task.universal
                ? { universal: true }
                : { assigneeName: String(task.assignee ?? "") }),
              ...(typeof task.crewSize === "number" && task.crewSize >= 2
                ? {
                    crewSize: task.crewSize,
                    ...(task.crewCloseMode ? { crewCloseMode: String(task.crewCloseMode) } : {}),
                  }
                : {}),
            }))
            .filter((def) => def.title);
          const priorArchived = isRecord((data as any).archivedTasks) ? (data as any).archivedTasks as Record<string, ArchivedTaskDef[]> : {};
          const nextArchived = previousWeekStart
            ? { ...priorArchived, [previousWeekStart]: defs }
            : priorArchived;
          const keptKeys = Object.keys(nextArchived).sort().slice(-4);
          const archivedTasks = Object.fromEntries(keptKeys.map((key) => [key, nextArchived[key]]));
          const expectedTasks = reset.tasks.filter((task) => !existingIds.has(Number(task.id)));
          return {
            data: {
              ...data,
              tasks: reset.tasks,
              deletedTaskIds,
              archivedTasks,
              weekData: currentWeek,
              taskWeekStart: weekStart,
            },
            result: {
              tasksReset: needsReset || reset.deletedTaskIds.length > 0,
              deletedTaskIds: reset.deletedTaskIds,
              expectedTasks,
            },
          };
        },
        pb,
      );

      const verifiedSnapshot = await readSnapshotWithRevision();
      const verifiedWeek = normalizeWeekData(verifiedSnapshot.data.weekData);
      const canonicalVerifiedWeek = verifiedWeek
        ? { ...verifiedWeek, points: recomputeWeekPoints(verifiedWeek.history) }
        : null;
      const verifiedTombstones = new Set(normalizeTaskIds(verifiedSnapshot.data.deletedTaskIds));
      const verifiedTasks = liveSnapshotTasks(verifiedSnapshot.data);
      const storedRawIds = new Set(
        (Array.isArray(verifiedSnapshot.data.tasks) ? verifiedSnapshot.data.tasks : [])
          .map((task: SnapshotTask) => Number(task.id)),
      );
      const expected = snapshotMutation.result;
      const snapshotReconciled =
        verifiedSnapshot.data.taskWeekStart === weekStart &&
        Boolean(canonicalVerifiedWeek) &&
        sameWeek(canonicalVerifiedWeek!, currentWeek) &&
        expected.deletedTaskIds.every((id) => verifiedTombstones.has(id)) &&
        expected.deletedTaskIds.every((id) => !storedRawIds.has(id)) &&
        expected.expectedTasks.every((task) =>
          taskResetMatches(
            verifiedTasks.find((candidate) => Number(candidate.id) === Number(task.id)),
            task,
          )
        );

      return {
        weekStart,
        previousWeekStart,
        archived,
        tasksReset: expected.tasksReset,
        hallOfFameRecorded: projection.recorded,
        currentWeekData: currentWeek,
        revision: verifiedSnapshot.revision,
        reconciled: archiveFailures.length === 0 && projection.reconciled && snapshotReconciled,
        failed: archiveFailures,
      };
    }),
  );
}
