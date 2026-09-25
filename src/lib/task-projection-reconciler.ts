import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { repairApprovalOperation } from "@/lib/task-approval";
import { normalizeOperationId } from "@/lib/task-operation-contract";
import { recomputeWeekPoints } from "@/lib/task-ledger";
import {
  liveSnapshotTasks,
  getSnapshotOperationReceipts,
  mutateSnapshotWithMeta,
  normalizeWeekData,
  projectCanonicalTaskToPB,
  readSnapshotStateWithRevision,
  replaceSnapshotWeekData,
  taskProjectionRecord,
  SNAPSHOT_KEY,
  type AdminPB,
  type SnapshotData,
  type SnapshotProjectionRepair,
  type SnapshotRevision,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import type { Transaction, WeekData } from "@/types/tasks";

export interface ReconcileTaskProjectionOptions {
  pb?: AdminPB;
  weekStart?: string;
  taskIds?: number[];
  operationId?: string;
  now?: Date;
}

export interface ReconcileTaskProjectionResult {
  ok: boolean;
  reconciled: boolean;
  repaired: string[];
  failed: string[];
  warnings: string[];
  weekData: WeekData | null;
  revision?: SnapshotRevision;
}

type Row = Record<string, any>;

interface ApprovalLedgerIntent {
  operationId: string;
  action: "approve" | "approve-all" | "send-back";
  actorId: string;
  fingerprint: string;
  taskIds: number[];
}

interface CanonicalLedger {
  weekData: WeekData;
  currentRows: Row[];
  archiveRows: Row[];
  allTransactions: Transaction[];
  approvalIntents: ApprovalLedgerIntent[];
  invalidApprovalOperations: string[];
  archiveWarnings: string[];
  weekWarnings: string[];
  needsWeekWrite: boolean;
}

function validWeekStart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const weekStart = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === weekStart
    ? weekStart
    : null;
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function mergeHistories(histories: Transaction[][]): Transaction[] {
  const byId = new Map<number, Transaction>();
  const result: Transaction[] = [];
  const candidates = histories
    .flat()
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id - right.id);
  for (const transaction of candidates) {
    const previous = byId.get(transaction.id);
    if (previous) {
      if (!sameValue(previous, transaction)) throw new Error("conflicting_transaction");
      continue;
    }
    byId.set(transaction.id, transaction);
    result.push(transaction);
  }
  return result;
}

function sameWeek(left: WeekData, right: WeekData): boolean {
  return sameValue(
    { ...left, points: recomputeWeekPoints(left.history) },
    { ...right, points: recomputeWeekPoints(right.history) },
  );
}

function sameStoredWeek(left: WeekData, right: WeekData): boolean {
  return sameValue(left, right);
}

function parseStoredField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rawWeekRow(row: Row): Row {
  return {
    id: String(row.id),
    weekStart: row.weekStart,
    points: parseStoredField(row.points),
    streak: parseStoredField(row.streak),
    lastActive: parseStoredField(row.lastActive),
    history: parseStoredField(row.history),
  };
}

function sameRawWeekRows(left: Row[], right: Row[]): boolean {
  const normalize = (rows: Row[]) => rows.map(rawWeekRow).sort((a, b) => a.id.localeCompare(b.id));
  return sameValue(normalize(left), normalize(right));
}

function persistedWeekMatches(row: Row, expected: WeekData): boolean {
  return sameValue(
    {
      weekStart: row.weekStart,
      points: parseStoredField(row.points),
      streak: parseStoredField(row.streak),
      lastActive: parseStoredField(row.lastActive),
      history: parseStoredField(row.history),
    },
    {
      weekStart: expected.weekStart,
      points: expected.points,
      streak: expected.streak,
      lastActive: expected.lastActive,
      history: expected.history,
    },
  );
}

function normalizeCurrentWeekRows(rows: Row[], weekStart: string): WeekData[] {
  return rows.map((row) => {
    const week = normalizeWeekData(row);
    if (!week || week.weekStart !== weekStart) throw new Error("invalid_week_data");
    return week;
  });
}

function normalizeArchiveRows(rows: Row[]): { weeks: WeekData[]; warnings: string[] } {
  const weeks: WeekData[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const week = normalizeWeekData(row);
    if (!week || !validWeekStart(week.weekStart)) {
      warnings.push("week_archive:invalid");
      continue;
    }
    weeks.push(week);
  }
  return { weeks, warnings };
}

function approvalLedgerIntents(transactions: Transaction[]): {
  intents: ApprovalLedgerIntent[];
  invalid: string[];
} {
  const grouped = new Map<string, ApprovalLedgerIntent | null>();
  for (const transaction of transactions) {
    const meta = transaction.meta;
    if (!meta || meta.source !== "task-approval" || !meta.operationId) continue;
    const valid = meta.actorId &&
      (meta.action === "approve" || meta.action === "approve-all" || meta.action === "send-back") &&
      typeof meta.fingerprint === "string" &&
      Array.isArray(meta.taskIds) &&
      meta.taskIds.length > 0 &&
      meta.taskIds.every((taskId) => Number.isSafeInteger(taskId) && taskId > 0);
    if (!valid) {
      grouped.set(meta.operationId, null);
      continue;
    }
    const intent: ApprovalLedgerIntent = {
      operationId: meta.operationId,
      action: meta.action as ApprovalLedgerIntent["action"],
      actorId: meta.actorId as string,
      fingerprint: meta.fingerprint as string,
      taskIds: [...(meta.taskIds as number[])].sort((left, right) => left - right),
    };
    const previous = grouped.get(meta.operationId);
    if (previous === null) continue;
    if (previous && !sameValue(previous, intent)) grouped.set(meta.operationId, null);
    else if (!previous) grouped.set(meta.operationId, intent);
  }
  const intents: ApprovalLedgerIntent[] = [];
  const invalid: string[] = [];
  for (const [operationId, intent] of grouped) {
    if (intent) intents.push(intent);
    else invalid.push(operationId);
  }
  intents.sort((left, right) => left.operationId.localeCompare(right.operationId));
  invalid.sort();
  return { intents, invalid };
}

function expectedWeekChanged(expected: WeekData | null | undefined, ledger: CanonicalLedger): boolean {
  if (!expected) return false;
  if (expected.weekStart !== ledger.weekData.weekStart) return true;
  if (!sameValue(expected.history, ledger.weekData.history)) return true;
  if (!sameValue(expected.points, recomputeWeekPoints(expected.history))) return false;
  return ledger.currentRows.some(
    (row) => !sameValue(parseStoredField(row.points), expected.points),
  );
}

async function readCanonicalLedger(pb: AdminPB, weekStart: string): Promise<CanonicalLedger> {
  const allWeekRows = await pb.collection("week_data").getFullList({ requestKey: null });
  if (!Array.isArray(allWeekRows)) throw new Error("week_data_read_failed");
  const weekWarnings: string[] = [];
  const currentRows: Row[] = [];
  for (const row of allWeekRows as Row[]) {
    const rowWeek = validWeekStart(row?.weekStart);
    if (!rowWeek) {
      weekWarnings.push("week:unrelated_row");
      continue;
    }
    if (rowWeek !== weekStart) continue;
    currentRows.push(row);
  }
  currentRows.sort((left: Row, right: Row) => String(left.id).localeCompare(String(right.id)));
  const currentWeeks = normalizeCurrentWeekRows(currentRows, weekStart);
  const history = mergeHistories(currentWeeks.map((week) => week.history));
  const points = recomputeWeekPoints(history);
  const streak = Object.assign({}, ...currentWeeks.map((week) => week.streak));
  const lastActive = Object.assign({}, ...currentWeeks.map((week) => week.lastActive));
  const weekData: WeekData = {
    weekStart,
    points,
    streak,
    lastActive,
    history,
  };
  const archiveRows = await pb.collection("week_archive").getFullList({ requestKey: null });
  if (!Array.isArray(archiveRows)) throw new Error("week_archive_read_failed");
  const archive = normalizeArchiveRows(archiveRows as Row[]);
  const archiveWeeks = archive.weeks;
  const allTransactions = mergeHistories([
    history,
    ...archiveWeeks.map((week) => week.history),
  ]);
  const approvalMetadata = approvalLedgerIntents(allTransactions);
  const needsWeekWrite = currentRows.length !== 1 || currentWeeks.some((week) => !sameStoredWeek(week, weekData));
  return {
    weekData,
    currentRows,
    archiveRows: archiveRows as Row[],
    allTransactions,
    approvalIntents: approvalMetadata.intents,
    invalidApprovalOperations: approvalMetadata.invalid,
    archiveWarnings: archive.warnings,
    weekWarnings,
    needsWeekWrite,
  };
}

async function writeCanonicalWeek(
  pb: AdminPB,
  ledger: CanonicalLedger,
): Promise<boolean> {
  if (!ledger.needsWeekWrite) return true;
  const collection = pb.collection("week_data");
  const rows = ledger.currentRows.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const payload = {
    weekStart: ledger.weekData.weekStart,
    points: ledger.weekData.points,
    streak: ledger.weekData.streak,
    lastActive: ledger.weekData.lastActive,
    history: ledger.weekData.history,
  };
  const verifyPrimary = async (primaryId: string | null): Promise<boolean> => {
    const verifiedRows = await collection.getFullList({ requestKey: null });
    if (!Array.isArray(verifiedRows)) return false;
    const matching = verifiedRows.filter((row: Row) => validWeekStart(row?.weekStart) === ledger.weekData.weekStart);
    if (primaryId !== null) {
      const primary = matching.find((row: Row) => String(row.id) === primaryId);
      if (!primary) return false;
      if (!persistedWeekMatches(primary, ledger.weekData)) return false;
      return matching.length >= 1;
    }
    if (matching.length !== 1) return false;
    return persistedWeekMatches(matching[0], ledger.weekData);
  };
  if (rows.length === 0) {
    await collection.create(payload, { requestKey: null });
    return verifyPrimary(null);
  }
  const primaryId = String(rows[0].id);
  await collection.update(rows[0].id, payload, { requestKey: null });
  if (!await verifyPrimary(primaryId)) return false;
  for (const duplicate of rows.slice(1)) {
    await collection.delete(duplicate.id, { requestKey: null });
    if (!await verifyPrimary(primaryId)) return false;
  }
  return verifyPrimary(null);
}

function taskProjectionForPB(task: SnapshotTask): SnapshotTask | null {
  const source = task.crew;
  const value = typeof source === "string" ? parseProjection(source) : source;
  if (value === undefined || value === null) return { ...task };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.members)) return null;
  const removed = raw.removed === undefined
    ? []
    : Array.isArray(raw.removed)
      ? raw.removed.filter((name): name is string => typeof name === "string" && name.length > 0)
      : null;
  if (removed === null) return null;
  const removedSet = new Set(removed);
  const members = raw.members.filter((member) => {
    if (!member || typeof member !== "object" || Array.isArray(member)) return false;
    const name = (member as Record<string, unknown>).name;
    return typeof name === "string" && name.length > 0 && !removedSet.has(name);
  });
  return {
    ...task,
    crew: {
      ...raw,
      members,
      ...(raw.removed !== undefined ? { removed } : {}),
    },
  };
}

function parseProjection(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function projectionMatches(row: Row, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actual = ["crew", "pendingApproval"].includes(key)
      ? parseProjection(row[key])
      : row[key];
    if (["crew", "pendingApproval"].includes(key)) return sameValue(actual, expectedValue);
    if (["crewSize", "speedBonus", "completedBy", "completedAt", "completedInWeek", "sentBackAt", "recurring", "due"].includes(key)) {
      const actualEmpty = actual === null || actual === undefined || actual === "";
      const expectedEmpty = expectedValue === null || expectedValue === undefined || expectedValue === "";
      if (actualEmpty && expectedEmpty) return true;
      if ((key === "crewSize" || key === "speedBonus") && Number(actual) === 0 && Number(expectedValue) === 0) return true;
    }
    return actual === expectedValue;
  });
}

async function taskRows(
  pb: AdminPB,
  taskId: number,
  preloadedRows?: Row[],
): Promise<Row[]> {
  if (preloadedRows) {
    return preloadedRows
      .filter((row: Row) => Number(row?.taskId) === taskId)
      .sort((left: Row, right: Row) => String(left.id).localeCompare(String(right.id)));
  }
  const rows = await pb.collection("tasks").getFullList({ requestKey: null });
  if (!Array.isArray(rows)) throw new Error("tasks_read_failed");
  return rows
    .filter((row: Row) => Number(row?.taskId) === taskId)
    .sort((left: Row, right: Row) => String(left.id).localeCompare(String(right.id)));
}

function completionDiffers(expected: Record<string, unknown>, row: Row): boolean {
  return ["completed", "completedBy", "completedAt", "completedInWeek", "pendingApproval", "sentBackAt", "status"]
    .some((key) => !sameValue(parseProjection(row[key]), expected[key]));
}

function crewDiffers(expected: Record<string, unknown>, row: Row): boolean {
  return !sameValue(parseProjection(row.crew), expected.crew) ||
    Number(row.crewSize) !== Number(expected.crewSize) ||
    Number(row.speedBonus) !== Number(expected.speedBonus);
}

async function projectTask(
  pb: AdminPB,
  taskId: number,
  task: SnapshotTask | null,
  preloadedRows?: Row[],
): Promise<{ ok: boolean; repaired: boolean; category: string }> {
  const rows = await taskRows(pb, taskId, preloadedRows);
  if (task === null) {
    if (rows.length === 0) return { ok: true, repaired: false, category: `task:${taskId}:tombstone` };
    const ok = await projectCanonicalTaskToPB(pb, null, taskId, preloadedRows);
    return { ok, repaired: ok, category: `task:${taskId}:tombstone` };
  }
  const projectionTask = taskProjectionForPB(task);
  if (!projectionTask) {
    return { ok: false, repaired: false, category: `task:${taskId}:crew` };
  }
  const expected = taskProjectionRecord(projectionTask);
  const alreadyMatches = rows.length === 1 && projectionMatches(rows[0], expected);
  if (alreadyMatches) return { ok: true, repaired: false, category: `task:${taskId}:projection` };
  const ok = await projectCanonicalTaskToPB(pb, projectionTask, taskId, preloadedRows);
  const category = crewDiffers(expected, rows[0] ?? {})
    ? `task:${taskId}:crew`
    : completionDiffers(expected, rows[0] ?? {})
      ? `task:${taskId}:completion`
      : `task:${taskId}:projection`;
  return { ok, repaired: ok, category };
}

function duplicateLiveTaskIds(data: SnapshotData): number[] {
  const counts = new Map<number, number>();
  for (const task of liveSnapshotTasks(data)) {
    const id = Number(task.id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort((left, right) => left - right);
}

async function verifyProjectedTasks(
  pb: AdminPB,
  snapshot: SnapshotData,
  taskIds: number[],
  preloadedRows?: Row[],
): Promise<boolean> {
  if (duplicateLiveTaskIds(snapshot).length > 0) return false;
  const live = liveSnapshotTasks(snapshot);
  const tombstones = new Set(validTaskIds(snapshot.deletedTaskIds));
  for (const taskId of taskIds) {
    const task = live.find((candidate) => Number(candidate.id) === taskId) ?? null;
    if (!task && !tombstones.has(taskId)) return false;
    const rows = await taskRows(pb, taskId, preloadedRows);
    if (!task) {
      if (rows.length !== 0) return false;
      continue;
    }
    const projectionTask = taskProjectionForPB(task);
    if (!projectionTask) return false;
    const expected = taskProjectionRecord(projectionTask);
    if (rows.length !== 1 || !projectionMatches(rows[0], expected)) return false;
  }
  return true;
}

function markerTransactions(
  ledger: CanonicalLedger,
  operationId: string,
): Transaction[] {
  return ledger.allTransactions.filter(
    (transaction) => transaction.meta?.operationId === operationId,
  );
}

async function approvalRepairVerified(
  pb: AdminPB,
  operationId: string,
  taskIds: number[],
  repair: {
    ok: boolean;
    reconciled: boolean;
    noCurrentTask?: boolean;
    projectionFailures?: number[];
  },
  preloadedRows?: Row[],
): Promise<boolean> {
  if (!repair.ok || ((repair.projectionFailures?.length ?? 0) > 0 && repair.noCurrentTask !== true)) return false;
  try {
    const state = await snapshotRead(pb);
    const receipts = getSnapshotOperationReceipts(state.data, operationId);
    if (receipts.length === 0) return false;
    if (!await verifyProjectedTasks(pb, state.data, taskIds, preloadedRows)) return false;
    if (repair.reconciled) return true;
    return repair.noCurrentTask === true;
  } catch {
    return false;
  }
}

function approvalMarker(
  _ledger: CanonicalLedger,
  snapshot: SnapshotData,
  operationId: string,
): boolean {
  const receipt = getSnapshotOperationReceipts(snapshot, operationId)[0];
  if (receipt?.action === "approve" || receipt?.action === "approve-all" || receipt?.action === "send-back") return true;
  return !receipt;
}

function discoveredApprovalMarkers(
  ledger: CanonicalLedger,
  snapshot: SnapshotData,
): SnapshotProjectionRepair[] {
  const byOperation = new Map<string, SnapshotProjectionRepair>();
  const invalid = new Set<string>();
  const add = (intent: ApprovalLedgerIntent) => {
    if (invalid.has(intent.operationId)) return;
    const marker: SnapshotProjectionRepair = {
      operationId: intent.operationId,
      action: intent.action,
      actorId: intent.actorId,
      fingerprint: intent.fingerprint,
      taskIds: [...intent.taskIds].sort((left, right) => left - right),
      createdAt: new Date(0).toISOString(),
    };
    const previous = byOperation.get(intent.operationId);
    if (previous && !sameValue(previous, marker)) {
      byOperation.delete(intent.operationId);
      invalid.add(intent.operationId);
    } else if (!previous) {
      byOperation.set(intent.operationId, marker);
    }
  };
  for (const intent of ledger.approvalIntents) add(intent);
  for (const operationId of Object.keys(snapshot.operationReceipts ?? {})) {
    const receipts = getSnapshotOperationReceipts(snapshot, operationId);
    const first = receipts[0];
    if (!first || !first.actorId || !first.fingerprint || !first.taskIds?.length) continue;
    if (first.action !== "approve" && first.action !== "approve-all" && first.action !== "send-back") continue;
    add({
      operationId,
      action: first.action,
      actorId: first.actorId,
      fingerprint: first.fingerprint,
      taskIds: first.taskIds,
    });
  }
  return [...byOperation.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
}

async function consumeProjectionMarker(
  pb: AdminPB,
  operationId: string,
): Promise<boolean> {
  const mutation = await mutateSnapshotWithMeta<{ present: boolean }>((data) => {
    const markers = Array.isArray(data.pendingProjectionRepairs)
      ? data.pendingProjectionRepairs
      : [];
    const present = markers.some((marker) => marker.operationId === operationId);
    if (!present) return { data, result: { present: false } };
    return {
      data: {
        ...data,
        pendingProjectionRepairs: markers.filter((marker) => marker.operationId !== operationId),
      },
      result: { present: true },
    };
  }, pb);
  if (!mutation.result.present) return true;
  const state = await readSnapshotStateWithRevision(pb);
  return !(Array.isArray(state.data.pendingProjectionRepairs) && state.data.pendingProjectionRepairs.some(
    (marker) => marker.operationId === operationId,
  ));
}

function validTaskIds(value: unknown): number[] {
  return [...new Set((Array.isArray(value) ? value : []).filter((id): id is number =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0,
  ))].sort((left, right) => left - right);
}

function withTaskLocks<T>(ids: number[], index: number, fn: () => Promise<T>): Promise<T> {
  if (index >= ids.length) return fn();
  return withTaskCommandLock(ids[index], () => withTaskLocks(ids, index + 1, fn));
}

async function snapshotRead(pb: AdminPB) {
  return withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, () => readSnapshotStateWithRevision(pb));
}

function failure(
  failed: string[],
  weekData: WeekData | null,
  revision?: SnapshotRevision,
  warnings: string[] = [],
): ReconcileTaskProjectionResult {
  return {
    ok: false,
    reconciled: false,
    repaired: [],
    failed: [...new Set(failed)],
    warnings: [...new Set(warnings)],
    weekData,
    ...(revision ? { revision } : {}),
  };
}

function success(
  repaired: string[],
  failed: string[],
  weekData: WeekData | null,
  revision: SnapshotRevision,
  reconciled: boolean,
  warnings: string[] = [],
): ReconcileTaskProjectionResult {
  return {
    ok: failed.length === 0 && reconciled,
    reconciled,
    repaired: [...new Set(repaired)],
    failed: [...new Set(failed)],
    warnings: [...new Set(warnings)],
    weekData,
    revision,
  };
}

type ReconcileLockedOptions = Omit<ReconcileTaskProjectionOptions, "pb"> & {
  expectedRevision?: string;
  expectedWeekData?: WeekData | null;
};

export async function reconcileTaskProjectionLocked(
  pb: AdminPB,
  options: ReconcileLockedOptions = {},
): Promise<ReconcileTaskProjectionResult> {
  const weekStart = validWeekStart(options.weekStart);
  if (!weekStart) return failure(["week:invalid"], null);
  const requestedTaskIds = validTaskIds(options.taskIds);
  const requestedOperationId = normalizeOperationId(options.operationId);
  const scopedTaskIds = requestedTaskIds.length > 0 ? new Set(requestedTaskIds) : null;

  return withWeekLedgerLock(weekStart, async () => {
    let discovery: Awaited<ReturnType<typeof readSnapshotStateWithRevision>>;
    try {
      discovery = await readSnapshotStateWithRevision(pb);
    } catch {
      return failure(["snapshot:read"], null);
    }
    const discoveryTasks = liveSnapshotTasks(discovery.data);
    const discoveryTombstones = validTaskIds(discovery.data.deletedTaskIds);
    const markerIds = (Array.isArray(discovery.data.pendingProjectionRepairs)
      ? discovery.data.pendingProjectionRepairs
      : [])
      .filter((marker) =>
        (!requestedOperationId || marker.operationId === requestedOperationId) &&
        (!scopedTaskIds || marker.taskIds.some((taskId) => scopedTaskIds.has(Number(taskId)))),
      )
      .flatMap((marker) => validTaskIds(marker.taskIds));
    let discoveryLedger: CanonicalLedger | null = null;
    try {
      discoveryLedger = await readCanonicalLedger(pb, weekStart);
    } catch {
      return failure(["week:read"], null, discovery.revision);
    }
    const scopedIntents = discoveryLedger.approvalIntents.filter((intent) =>
      requestedOperationId
        ? intent.operationId === requestedOperationId
        : !scopedTaskIds || intent.taskIds.some((taskId) => scopedTaskIds.has(taskId)),
    );
    const evidenceIds = discoveryLedger
      ? [
          ...markerTransactions(discoveryLedger, requestedOperationId ?? "").map((transaction) => transaction.taskId),
          ...scopedIntents.flatMap((intent) => intent.taskIds),
        ].filter((taskId): taskId is number => taskId !== undefined)
      : [];
    let pbTaskIds: number[] = [];
    try {
      const rows = await pb.collection("tasks").getFullList({ requestKey: null });
      if (!Array.isArray(rows)) return failure(["tasks:read"], null, discovery.revision);
      pbTaskIds = validTaskIds(rows.map((row: Row) => Number(row.taskId)));
    } catch {
      return failure(["tasks:read"], null, discovery.revision);
    }
    const discoveryWeek = normalizeWeekData(discovery.data.weekData);
    if (
      discovery.data.taskWeekStart !== weekStart ||
      !discoveryWeek ||
      discoveryWeek.weekStart !== weekStart ||
      (options.expectedRevision !== undefined && discovery.revision.revision !== options.expectedRevision)
    ) {
      return failure(["rollover:changed"], null, discovery.revision);
    }
    const discoveryDuplicateTasks = duplicateLiveTaskIds(discovery.data);
    if (discoveryDuplicateTasks.length > 0) {
      return failure(
        discoveryDuplicateTasks.map((taskId) => `task:${taskId}:ambiguous`),
        discoveryLedger.weekData,
        discovery.revision,
      );
    }
    const allIds = [...new Set([
      ...discoveryTasks.map((task) => Number(task.id)),
      ...discoveryTombstones,
      ...pbTaskIds,
      ...markerIds,
      ...evidenceIds,
    ])].filter((id) => Number.isSafeInteger(id) && id > 0).sort((left, right) => left - right);
    const lockIds = requestedTaskIds.length > 0
      ? [...new Set([...requestedTaskIds, ...markerIds, ...evidenceIds])].sort((left, right) => left - right)
      : allIds;

    return withTaskLocks(lockIds, 0, async () => {
      const repaired: string[] = [];
      const failed: string[] = [];
      const warnings: string[] = [];
      let snapshot: Awaited<ReturnType<typeof readSnapshotStateWithRevision>>;
      try {
        snapshot = await snapshotRead(pb);
      } catch {
        return failure(["snapshot:read"], null, discovery.revision);
      }
      if (
        ("tasks" in snapshot.data && snapshot.data.tasks !== undefined && !Array.isArray(snapshot.data.tasks)) ||
        ("deletedTaskIds" in snapshot.data && snapshot.data.deletedTaskIds !== undefined && !Array.isArray(snapshot.data.deletedTaskIds))
      ) {
        return failure(["snapshot:read"], null, snapshot.revision);
      }
      let ledger: CanonicalLedger;
      try {
        ledger = await readCanonicalLedger(pb, weekStart);
      } catch {
        return failure(["week:ledger"], null, snapshot.revision);
      }
      if (ledger.archiveWarnings.length > 0) failed.push(...ledger.archiveWarnings);
      if (ledger.weekWarnings.length > 0) warnings.push(...ledger.weekWarnings);
      if (ledger.invalidApprovalOperations.length > 0) {
        failed.push(...ledger.invalidApprovalOperations.map(() => "approval:metadata"));
      }
      const existingSnapshotWeek = normalizeWeekData(snapshot.data.weekData);
      if (snapshot.data.weekData !== undefined && snapshot.data.weekData !== null && !existingSnapshotWeek) {
        return failure(["week:snapshot"], null, snapshot.revision);
      }
      const postSnapshotWeek = normalizeWeekData(snapshot.data.weekData);
      let postTaskRows: Row[];
      try {
        const rows = await pb.collection("tasks").getFullList({ requestKey: null });
        if (!Array.isArray(rows)) return failure(["tasks:read"], null, snapshot.revision);
        postTaskRows = [...(rows as Row[])];
      } catch {
        return failure(["tasks:read"], null, snapshot.revision);
      }
      const allPostIds = [...new Set([
        ...liveSnapshotTasks(snapshot.data).map((task) => Number(task.id)),
        ...validTaskIds(snapshot.data.deletedTaskIds),
        ...validTaskIds(postTaskRows.map((row) => Number(row.taskId))),
        ...ledger.approvalIntents.flatMap((intent) => intent.taskIds),
      ])].filter((id) => Number.isSafeInteger(id) && id > 0).sort((left, right) => left - right);
      const postIds = scopedTaskIds
        ? allPostIds.filter((id) => scopedTaskIds.has(id))
        : allPostIds;
      const baselineIds = scopedTaskIds
        ? [...new Set([...lockIds, ...requestedTaskIds])].filter((id) => scopedTaskIds.has(id)).sort((left, right) => left - right)
        : [...new Set([...allIds, ...requestedTaskIds])].sort((left, right) => left - right);
      if (expectedWeekChanged(options.expectedWeekData ?? null, ledger)) {
        return failure(["week:changed"], null, snapshot.revision, warnings);
      }
      let finalStateChanged = false;
      try {
        finalStateChanged =
          snapshot.revision.revision !== discovery.revision.revision ||
          snapshot.data.taskWeekStart !== weekStart ||
          !postSnapshotWeek ||
          postSnapshotWeek.weekStart !== weekStart ||
          !sameStoredWeek(discoveryLedger.weekData, ledger.weekData) ||
          !sameRawWeekRows(discoveryLedger.currentRows, ledger.currentRows) ||
          !sameValue(postIds, baselineIds);
      } catch {
        finalStateChanged = true;
      }
      if (finalStateChanged) {
        return failure(["tasks:changed"], null, snapshot.revision, warnings);
      }
      const duplicateTasks = duplicateLiveTaskIds(snapshot.data);
      if (duplicateTasks.length > 0) {
        return failure(
          duplicateTasks.map((taskId) => `task:${taskId}:ambiguous`),
          ledger.weekData,
          snapshot.revision,
        );
      }
      if (ledger.needsWeekWrite) {
        try {
          const written = await writeCanonicalWeek(pb, ledger);
          if (!written) failed.push("week:ledger");
          else repaired.push(`week:${weekStart}:ledger`);
        } catch {
          failed.push("week:ledger");
        }
      }

      if (
        !existingSnapshotWeek ||
        !sameStoredWeek(existingSnapshotWeek, ledger.weekData) ||
        snapshot.data.taskWeekStart !== weekStart
      ) {
        const persisted = await replaceSnapshotWeekData(pb, ledger.weekData);
        if (!persisted.ok) failed.push("week:snapshot");
        else {
          repaired.push(`week:${weekStart}:fields`);
          snapshot = await snapshotRead(pb);
        }
      }

      const storedMarkers = (Array.isArray(snapshot.data.pendingProjectionRepairs)
        ? [...snapshot.data.pendingProjectionRepairs]
        : [])
        .filter((marker) =>
          (!requestedOperationId || marker.operationId === requestedOperationId) &&
          (!scopedTaskIds || marker.taskIds.some((taskId) => scopedTaskIds.has(Number(taskId)))),
        );
      const markerByOperation = new Map<string, SnapshotProjectionRepair>();
      for (const marker of storedMarkers) markerByOperation.set(marker.operationId, marker);
      for (const marker of discoveredApprovalMarkers(ledger, snapshot.data)) {
        if (scopedTaskIds && !marker.taskIds.some((taskId) => scopedTaskIds.has(taskId))) continue;
        if (!markerByOperation.has(marker.operationId)) markerByOperation.set(marker.operationId, marker);
      }
      if (
        requestedOperationId &&
        !markerByOperation.has(requestedOperationId)
      ) {
        markerByOperation.set(requestedOperationId, {
          operationId: requestedOperationId,
          taskIds: [...new Set([
            ...requestedTaskIds,
            ...markerTransactions(ledger, requestedOperationId)
              .map((transaction) => transaction.taskId)
              .filter((taskId): taskId is number => taskId !== undefined),
          ])].sort((left, right) => left - right),
          createdAt: new Date().toISOString(),
        });
      }
      const markers = [...markerByOperation.values()]
        .filter((marker) => !requestedOperationId || marker.operationId === requestedOperationId)
        .sort((left, right) => left.operationId.localeCompare(right.operationId));
      for (const marker of markers) {
        const markerTaskIds = validTaskIds(marker.taskIds);
        const markerWasPresent = Array.isArray(snapshot.data.pendingProjectionRepairs) && snapshot.data.pendingProjectionRepairs.some(
          (candidate) => candidate.operationId === marker.operationId,
        );
        if (approvalMarker(ledger, snapshot.data, marker.operationId)) {
          let projectionWasCurrent = false;
          try {
            projectionWasCurrent = await verifyProjectedTasks(pb, snapshot.data, markerTaskIds, postTaskRows);
          } catch {
            failed.push("approval:read");
            continue;
          }
          const repair = await repairApprovalOperation({
            pb,
            weekStart,
            operationId: marker.operationId,
            taskIds: markerTaskIds,
            action: marker.action,
            actorId: marker.actorId,
            fingerprint: marker.fingerprint,
            preloadedTaskRows: postTaskRows,
            locked: true,
          });
          let repairedRows: Row[] | null = null;
          try {
            const rows = await pb.collection("tasks").getFullList({ requestKey: null });
            if (!Array.isArray(rows)) throw new Error("tasks_read_failed");
            repairedRows = [...(rows as Row[])];
          } catch {
            failed.push("approval:read");
            continue;
          }
          const verified = await approvalRepairVerified(
            pb,
            marker.operationId,
            markerTaskIds,
            repair,
            repairedRows,
          );

          if (!verified) {
            failed.push(
              repair.reason === "ledger_unavailable" || repair.reason === "repair_required"
                ? "approval:unproven"
                : "approval:projection",
            );
            continue;
          }
          if (!projectionWasCurrent) repaired.push("approval:projection");
          let afterRepair: Awaited<ReturnType<typeof readSnapshotStateWithRevision>>;
          try {
            afterRepair = await snapshotRead(pb);
          } catch {
            failed.push("approval:read");
            continue;
          }
          const stillMarked = Array.isArray(afterRepair.data.pendingProjectionRepairs) && afterRepair.data.pendingProjectionRepairs.some(
            (candidate) => candidate.operationId === marker.operationId,
          );
          if (stillMarked) {
            let consumed = false;
            try {
              consumed = await consumeProjectionMarker(pb, marker.operationId);
            } catch {
              failed.push("approval:marker");
              continue;
            }
            if (!consumed) failed.push("approval:marker");
            else repaired.push("approval:marker");
          } else if (markerWasPresent) {
            repaired.push("approval:marker");
          }
          try {
            snapshot = await snapshotRead(pb);
          } catch {
            failed.push("approval:read");
          }
          continue;
        }
        let allProjected = true;
        for (const taskId of markerTaskIds) {
          const task = liveSnapshotTasks(snapshot.data).find((candidate) => Number(candidate.id) === taskId) ?? null;
          const tombstoned = validTaskIds(snapshot.data.deletedTaskIds).includes(taskId);
          if (!task && !tombstoned) {
            allProjected = false;
            failed.push(`task:${taskId}:missing`);
            continue;
          }
          let projected: Awaited<ReturnType<typeof projectTask>>;
          try {
            projected = await projectTask(pb, taskId, task, postTaskRows);
          } catch {
            allProjected = false;
            failed.push(`task:${taskId}:read`);
            continue;
          }
          if (!projected.ok) {
            allProjected = false;
            failed.push(projected.category);
          } else if (projected.repaired) {
            repaired.push(projected.category);
          }
        }
        let verifiedProjection = false;
        if (allProjected) {
          try {
            verifiedProjection = await verifyProjectedTasks(pb, snapshot.data, markerTaskIds, postTaskRows);
          } catch {
            failed.push("projection:read");
          }
        }
        if (verifiedProjection) {
          let consumed = false;
          try {
            consumed = await consumeProjectionMarker(pb, marker.operationId);
          } catch {
            failed.push("projection:marker");
          }
          if (consumed) repaired.push("projection:marker");
          else if (!failed.includes("projection:marker")) failed.push("projection:marker");
          try {
            snapshot = await snapshotRead(pb);
          } catch {
            failed.push("snapshot:read");
          }
        } else if (allProjected) {
          failed.push("projection:unverified");
        }
      }

      const currentIds = requestedTaskIds.length > 0
        ? [...new Set([...requestedTaskIds, ...validTaskIds(snapshot.data.deletedTaskIds)])].sort((left, right) => left - right)
        : [...new Set([
            ...allIds,
            ...validTaskIds(snapshot.data.deletedTaskIds),
            ...validTaskIds((Array.isArray(snapshot.data.tasks) ? snapshot.data.tasks : []).map((task) => Number(task.id))),
          ])].sort((left, right) => left - right);
      for (const taskId of currentIds) {
        const task = liveSnapshotTasks(snapshot.data).find((candidate) => Number(candidate.id) === taskId) ?? null;
        const tombstoned = validTaskIds(snapshot.data.deletedTaskIds).includes(taskId);
        if (!task && !tombstoned) {
          try {
            const rows = await taskRows(pb, taskId, postTaskRows);
            if (rows.length > 0) {
              const projected = await projectTask(pb, taskId, null, postTaskRows);
              if (!projected.ok) failed.push(`task:${taskId}:projection`);
              else repaired.push(`task:${taskId}:tombstone`);
            }
          } catch {
            failed.push(`task:${taskId}:read`);
          }
          continue;
        }
        try {
          const projected = await projectTask(pb, taskId, task, postTaskRows);
          if (!projected.ok) failed.push(projected.category);
          else if (projected.repaired) repaired.push(projected.category);
        } catch {
          failed.push(`task:${taskId}:read`);
        }
      }

      try {
        snapshot = await snapshotRead(pb);
      } catch {
        failed.push("snapshot:read");
      }
      const remainingMarkers = (Array.isArray(snapshot.data.pendingProjectionRepairs)
        ? snapshot.data.pendingProjectionRepairs
        : [])
        .filter((marker) =>
          (!requestedOperationId || marker.operationId === requestedOperationId) &&
          (!scopedTaskIds || marker.taskIds.some((taskId) => scopedTaskIds.has(Number(taskId)))),
        );
      if (remainingMarkers.length > 0) {
        for (const marker of remainingMarkers) {
          failed.push(approvalMarker(ledger, snapshot.data, marker.operationId) ? "approval:pending" : "projection:pending");
        }
      }
      let finalLedger: CanonicalLedger;
      try {
        finalLedger = await readCanonicalLedger(pb, weekStart);
      } catch {
        failed.push("week:ledger");
        finalLedger = ledger;
      }
      const result = success(repaired, failed, finalLedger.weekData, snapshot.revision, failed.length === 0, warnings);
      return result;
    });
  });
}

export async function reconcileTaskProjection(
  options: ReconcileTaskProjectionOptions = {},
): Promise<ReconcileTaskProjectionResult> {
  let rollover: Awaited<ReturnType<typeof ensureCurrentTaskWeek>>;
  try {
    rollover = await ensureCurrentTaskWeek({ now: options.now });
  } catch {
    return failure(["rollover:unavailable"], null);
  }
  const weekStart = validWeekStart(rollover.weekStart);
  if (!weekStart || !rollover.reconciled) {
    return failure(["rollover:pending"], null, rollover.revision);
  }
  if (options.weekStart) {
    const requestedWeekStart = validWeekStart(options.weekStart);
    if (!requestedWeekStart || requestedWeekStart !== weekStart) {
      return failure(["week_mismatch"], null, rollover.revision);
    }
  }
  const run = (pb: AdminPB) => reconcileTaskProjectionLocked(pb, {
    weekStart,
    taskIds: options.taskIds,
    operationId: options.operationId,
    now: options.now,
    expectedRevision: rollover.revision?.revision,
  });
  try {
    return options.pb ? await run(options.pb) : await withAdmin(run);
  } catch {
    return failure(["projection:read"], rollover.currentWeekData ?? null);
  }
}
