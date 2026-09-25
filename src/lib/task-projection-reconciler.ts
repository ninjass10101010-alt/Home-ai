import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { repairApprovalOperation } from "@/lib/task-approval";
import { normalizeOperationId } from "@/lib/task-operation-contract";
import { persistedCrewEmoji, persistedTaskEmoji } from "@/lib/task-emoji";
import { recomputeWeekPoints } from "@/lib/task-ledger";
import {
  liveSnapshotTasks,
  getSnapshotOperationReceipts,
  mutateSnapshotWithMeta,
  normalizeWeekData,
  projectCanonicalTaskToPB,
  readSnapshotStateWithRevision,
  replaceSnapshotWeekData,
  SNAPSHOT_KEY,
  type AdminPB,
  type SnapshotData,
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
  weekData: WeekData | null;
  revision?: SnapshotRevision;
}

type Row = Record<string, any>;

interface CanonicalLedger {
  weekData: WeekData;
  currentRows: Row[];
  archiveRows: Row[];
  allTransactions: Transaction[];
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

function normalizeCurrentWeekRows(rows: Row[], weekStart: string): WeekData[] {
  return rows.map((row) => {
    const week = normalizeWeekData(row);
    if (!week || week.weekStart !== weekStart) throw new Error("invalid_week_data");
    return week;
  });
}

function normalizeArchiveRows(rows: Row[]): WeekData[] {
  return rows.map((row) => {
    const week = normalizeWeekData(row);
    if (!week || !validWeekStart(week.weekStart)) throw new Error("invalid_archive_week_data");
    return week;
  });
}

async function readCanonicalLedger(pb: AdminPB, weekStart: string): Promise<CanonicalLedger> {
  const allWeekRows = await pb.collection("week_data").getFullList({ requestKey: null });
  const currentRows = (Array.isArray(allWeekRows) ? allWeekRows : []).filter(
    (row: Row) => validWeekStart(row?.weekStart) === weekStart,
  ) as Row[];
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
  const archiveWeeks = normalizeArchiveRows((Array.isArray(archiveRows) ? archiveRows : []) as Row[]);
  const allTransactions = mergeHistories([
    history,
    ...archiveWeeks.map((week) => week.history),
  ]);
  const needsWeekWrite = currentRows.length !== 1 || currentWeeks.some((week) => !sameStoredWeek(week, weekData));
  return {
    weekData,
    currentRows,
    archiveRows: (Array.isArray(archiveRows) ? archiveRows : []) as Row[],
    allTransactions,
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
  if (rows.length === 0) {
    await collection.create(payload, { requestKey: null });
  } else {
    await collection.update(rows[0].id, payload, { requestKey: null });
    for (const duplicate of rows.slice(1)) {
      await collection.delete(duplicate.id, { requestKey: null });
    }
  }
  const verifiedRows = (await collection.getFullList({ requestKey: null }) as Row[])
    .filter((row) => validWeekStart(row?.weekStart) === ledger.weekData.weekStart);
  if (verifiedRows.length !== 1) return false;
  const verified = normalizeWeekData(verifiedRows[0]);
  return Boolean(verified && sameWeek(verified, ledger.weekData));
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

function projectionRecord(task: SnapshotTask): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title,
    assignee: task.assignee ?? "All",
    assigneeEmoji: persistedTaskEmoji(task.assigneeEmoji) || "👤",
    assigned: task.assignee ?? "All",
    status: task.completed === true ? "done" : "pending",
    due: task.due ?? null,
    points: task.points ?? 0,
    recurring: task.recurring ?? null,
    category: task.category ?? "chores",
    priority: task.priority ?? "medium",
    universal: task.universal === true,
    stealable: task.stealable === true,
    completed: task.completed === true,
    completedBy: task.completedBy ?? null,
    completedAt: task.completedAt ?? null,
    completedInWeek: task.completedInWeek ?? null,
    pendingApproval: task.pendingApproval ?? null,
    sentBackAt: task.sentBackAt ?? null,
    crewSize: task.crewSize ?? null,
    crew: persistedCrewEmoji(task.crew as any),
    speedBonus: task.speedBonus ?? null,
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

async function taskRows(pb: AdminPB, taskId: number): Promise<Row[]> {
  const rows = await pb.collection("tasks").getFullList({ requestKey: null });
  return (Array.isArray(rows) ? rows : []).filter((row: Row) => Number(row?.taskId) === taskId);
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
): Promise<{ ok: boolean; repaired: boolean; category: string }> {
  const rows = await taskRows(pb, taskId);
  if (task === null) {
    if (rows.length === 0) return { ok: true, repaired: false, category: `task:${taskId}:tombstone` };
    const ok = await projectCanonicalTaskToPB(pb, null, taskId);
    return { ok, repaired: ok, category: `task:${taskId}:tombstone` };
  }
  const projectionTask = taskProjectionForPB(task);
  if (!projectionTask) {
    return { ok: false, repaired: false, category: `task:${taskId}:crew` };
  }
  const expected = projectionRecord(projectionTask);
  const alreadyMatches = rows.length === 1 && projectionMatches(rows[0], expected);
  if (alreadyMatches) return { ok: true, repaired: false, category: `task:${taskId}:projection` };
  const ok = await projectCanonicalTaskToPB(pb, projectionTask, taskId);
  const category = crewDiffers(expected, rows[0] ?? {})
    ? `task:${taskId}:crew`
    : completionDiffers(expected, rows[0] ?? {})
      ? `task:${taskId}:completion`
      : `task:${taskId}:projection`;
  return { ok, repaired: ok, category };
}

async function verifyProjectedTasks(
  pb: AdminPB,
  snapshot: SnapshotData,
  taskIds: number[],
): Promise<boolean> {
  const live = liveSnapshotTasks(snapshot);
  const tombstones = new Set(validTaskIds(snapshot.deletedTaskIds));
  for (const taskId of taskIds) {
    const task = live.find((candidate) => Number(candidate.id) === taskId) ?? null;
    if (!task && !tombstones.has(taskId)) return false;
    const rows = await taskRows(pb, taskId);
    if (!task) {
      if (rows.length !== 0) return false;
      continue;
    }
    const projectionTask = taskProjectionForPB(task);
    if (!projectionTask) return false;
    const expected = projectionRecord(projectionTask);
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
  repair: { ok: boolean; reconciled: boolean; noCurrentTask?: boolean },
): Promise<boolean> {
  if (!repair.ok) return false;
  const state = await snapshotRead(pb);
  const receipts = getSnapshotOperationReceipts(state.data, operationId);
  if (receipts.length === 0) return false;
  if (!await verifyProjectedTasks(pb, state.data, taskIds)) return false;
  if (repair.reconciled) return true;
  if (!repair.noCurrentTask) return false;
  return true;
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
): ReconcileTaskProjectionResult {
  return {
    ok: false,
    reconciled: false,
    repaired: [],
    failed: [...new Set(failed)],
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
): ReconcileTaskProjectionResult {
  return {
    ok: failed.length === 0 && reconciled,
    reconciled,
    repaired: [...new Set(repaired)],
    failed: [...new Set(failed)],
    weekData,
    revision,
  };
}

export async function reconcileTaskProjectionLocked(
  pb: AdminPB,
  options: Omit<ReconcileTaskProjectionOptions, "pb"> = {},
): Promise<ReconcileTaskProjectionResult> {
  const weekStart = validWeekStart(options.weekStart);
  if (!weekStart) return failure(["week:invalid"], null);
  const requestedTaskIds = validTaskIds(options.taskIds);
  const requestedOperationId = normalizeOperationId(options.operationId);

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
      .filter((marker) => !requestedOperationId || marker.operationId === requestedOperationId)
      .flatMap((marker) => validTaskIds(marker.taskIds));
    let discoveryLedger: CanonicalLedger | null = null;
    try {
      discoveryLedger = await readCanonicalLedger(pb, weekStart);
    } catch {
      discoveryLedger = null;
    }
    const evidenceIds = requestedOperationId && discoveryLedger
      ? markerTransactions(discoveryLedger, requestedOperationId)
        .map((transaction) => transaction.taskId)
        .filter((taskId): taskId is number => taskId !== undefined)
      : [];
    let pbTaskIds: number[] = [];
    try {
      const rows = await pb.collection("tasks").getFullList({ requestKey: null });
      pbTaskIds = validTaskIds((Array.isArray(rows) ? rows : []).map((row: Row) => Number(row.taskId)));
    } catch {
      pbTaskIds = [];
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
      let snapshot: Awaited<ReturnType<typeof readSnapshotStateWithRevision>>;
      try {
        snapshot = await snapshotRead(pb);
      } catch {
        return failure(["snapshot:read"], null, discovery.revision);
      }
      let ledger: CanonicalLedger;
      try {
        ledger = await readCanonicalLedger(pb, weekStart);
      } catch {
        return failure(["week:ledger"], null, snapshot.revision);
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

      const existingSnapshotWeek = normalizeWeekData(snapshot.data.weekData);
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
        .filter((marker) => !requestedOperationId || marker.operationId === requestedOperationId)
        .sort((left, right) => left.operationId.localeCompare(right.operationId));
      const markers = requestedOperationId && !storedMarkers.some(
        (marker) => marker.operationId === requestedOperationId,
      )
        ? [...storedMarkers, {
            operationId: requestedOperationId,
            taskIds: [...new Set([
              ...requestedTaskIds,
              ...markerTransactions(ledger, requestedOperationId)
                .map((transaction) => transaction.taskId)
                .filter((taskId): taskId is number => taskId !== undefined),
            ])].sort((left, right) => left - right),
            createdAt: new Date().toISOString(),
          }].sort((left, right) => left.operationId.localeCompare(right.operationId))
        : storedMarkers;
      for (const marker of markers) {
        const markerTaskIds = validTaskIds(marker.taskIds);
        const markerWasPresent = Array.isArray(snapshot.data.pendingProjectionRepairs) && snapshot.data.pendingProjectionRepairs.some(
          (candidate) => candidate.operationId === marker.operationId,
        );
        if (approvalMarker(ledger, snapshot.data, marker.operationId)) {
          const projectionWasCurrent = await verifyProjectedTasks(pb, snapshot.data, markerTaskIds);
          const repair = await repairApprovalOperation({
            pb,
            weekStart,
            operationId: marker.operationId,
            taskIds: markerTaskIds,
            locked: true,
          });
          const verified = await approvalRepairVerified(
            pb,
            marker.operationId,
            markerTaskIds,
            repair,
          );
          if (!verified) {
            failed.push(repair.reason === "ledger_unavailable" ? "approval:unproven" : "approval:projection");
            continue;
          }
          if (!projectionWasCurrent) repaired.push("approval:projection");
          const afterRepair = await snapshotRead(pb);
          const stillMarked = Array.isArray(afterRepair.data.pendingProjectionRepairs) && afterRepair.data.pendingProjectionRepairs.some(
            (candidate) => candidate.operationId === marker.operationId,
          );
          if (stillMarked) {
            const consumed = await consumeProjectionMarker(pb, marker.operationId);
            if (!consumed) failed.push("approval:marker");
            else repaired.push("approval:marker");
          } else if (markerWasPresent) {
            repaired.push("approval:marker");
          }
          snapshot = await snapshotRead(pb);
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
          const projected = await projectTask(pb, taskId, task);
          if (!projected.ok) {
            allProjected = false;
            failed.push(projected.category);
          } else if (projected.repaired) {
            repaired.push(projected.category);
          }
        }
        if (allProjected && await verifyProjectedTasks(pb, snapshot.data, markerTaskIds)) {
          const consumed = await consumeProjectionMarker(pb, marker.operationId);
          if (consumed) repaired.push("projection:marker");
          else failed.push("projection:marker");
          snapshot = await snapshotRead(pb);
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
          const rows = await taskRows(pb, taskId);
          if (rows.length > 0) {
            const projected = await projectTask(pb, taskId, null);
            if (!projected.ok) failed.push(`task:${taskId}:projection`);
            else repaired.push(`task:${taskId}:tombstone`);
          }
          continue;
        }
        const projected = await projectTask(pb, taskId, task);
        if (!projected.ok) failed.push(projected.category);
        else if (projected.repaired) repaired.push(projected.category);
      }

      snapshot = await snapshotRead(pb);
      const remainingMarkers = Array.isArray(snapshot.data.pendingProjectionRepairs)
        ? snapshot.data.pendingProjectionRepairs
        : [];
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
      const result = success(repaired, failed, finalLedger.weekData, snapshot.revision, failed.length === 0);
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
  const run = (pb: AdminPB) => reconcileTaskProjectionLocked(pb, {
    weekStart,
    taskIds: options.taskIds,
    operationId: options.operationId,
    now: options.now,
  });
  try {
    return options.pb ? await run(options.pb) : await withAdmin(run);
  } catch {
    return failure(["projection:unavailable"], rollover.currentWeekData ?? null);
  }
}
