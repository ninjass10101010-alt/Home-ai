import { withAdmin } from "@/lib/pb-auth";
import { withKeyedLock } from "@/lib/keyed-lock";
import { persistedTaskEmoji, persistedCrewEmoji } from "@/lib/task-emoji";
import { parseCanonicalTransactions, recomputeWeekPoints } from "@/lib/task-ledger";
import { normalizeOperationId, normalizeTimestamp } from "@/lib/task-operation-contract";
import {
  applyTaskConfigCommand,
  taskConfigCommandFingerprint,
  TASK_CONFIG_ACTIONS,
  TASK_CONFIG_RECEIPT_MAX_AGE_MS,
  TASK_CONFIG_RECEIPT_MAX_COUNT,
  TASK_CONFIG_DATA_KEYS,
  TASK_CONFIG_KINDS,
  TASK_CONFIG_STAMP_KEYS,
  type TaskConfigCommand,
  type TaskConfigItem,
  type TaskConfigKind,
} from "@/lib/task-config";
import type { WeekData, Transaction } from "@/types/tasks";

/**
 * Server-side access to the TASKS SNAPSHOT — the single source of truth the
 * dashboard actually renders (`consuela_data_snapshots`, key `tasks-snapshot`).
 *
 * Background (2026-09-21): the chat task tools used to read/write the PB
 * `tasks` COLLECTION, while the dashboard renders the browser-owned snapshot.
 * The two never met: chat completions/deletes were invisible in the Tasks UI,
 * and the browser's periodic `syncTasksToPB()` re-upserted its snapshot rows
 * back into the collection, resurrecting whatever chat had deleted. These
 * helpers make the chat operate on the SAME store the UI reads.
 *
 * Deletions need a tombstone: the client merge is add-only, so a plainly
 * removed row is re-pushed by any device that still has it. `deletedTaskIds`
 * records removals so every device honours them (see `mergeTasksSnapshot`).
 */

export const SNAPSHOT_KEY = "tasks-snapshot";
export const SNAPSHOT_COLLECTION = "consuela_data_snapshots";

export type SnapshotTask = Record<string, any> & {
  id: number;
  title: string;
  assignee?: string;
};

export interface SnapshotRevision {
  revision: string;
  updatedAt: string;
}

export interface SnapshotOperationReceipt {
  operationId: string;
  action: string;
  taskId: number;
  deleted?: boolean;
  createdAt: string;
}

export interface SnapshotConfigOperationReceipt {
  kind: TaskConfigKind;
  action: "replace" | "upsert" | "delete";
  updatedAt: string;
  fingerprint?: string;
  reconcileRequired?: boolean;
}

export interface SnapshotConfigMutationResult {
  items: TaskConfigItem[];
  updatedAt: string;
  revision: SnapshotRevision;
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
  conflict: boolean;
  reconcile: boolean;
  clearRepairMarker: boolean;
}

export interface SnapshotProjectionRepair {
  operationId: string;
  taskIds: number[];
  createdAt: string;
}

export interface SnapshotWriteResult {
  ok: boolean;
  revision: SnapshotRevision;
  error?: string;
}

export interface SnapshotMutationResult<T> {
  result: T;
  revision: SnapshotRevision;
}

export type SnapshotData = Record<string, any> & {
  tasks?: SnapshotTask[];
  deletedTaskIds?: number[];
  revision?: string;
  taskWeekStart?: string;
  operationReceipts?: Record<string, SnapshotOperationReceipt[]>;
  configOperationReceipts?: Record<string, SnapshotConfigOperationReceipt>;
  pendingProjectionRepairs?: SnapshotProjectionRepair[];
};

/** Live (non-tombstoned) tasks from a snapshot blob. */
export function liveSnapshotTasks(data: SnapshotData | null | undefined): SnapshotTask[] {
  const tasks = Array.isArray(data?.tasks) ? (data!.tasks as SnapshotTask[]) : [];
  const dead = new Set((data?.deletedTaskIds || []).map((n) => Number(n)));
  return tasks.filter((t) => !dead.has(Number(t?.id)));
}

/** taskId-first, then exact title (case-insensitive), optional assignee filter. */
export function findSnapshotTask(
  tasks: SnapshotTask[],
  args: { taskId?: number; title?: string; assignee?: string }
): SnapshotTask | null {
  if (args.taskId !== undefined && args.taskId !== null) {
    const id = Number(args.taskId);
    return tasks.find((t) => Number(t.id) === id) || null;
  }
  if (args.title) {
    const t = String(args.title).trim().toLowerCase();
    const a = args.assignee ? String(args.assignee).trim().toLowerCase() : undefined;
    const matches = (row: SnapshotTask) =>
      String(row.title || "").trim().toLowerCase() === t &&
      (!a || String(row.assignee || "").toLowerCase().includes(a));
    return tasks.find(matches) || null;
  }
  return null;
}

/** Apply a patch to one task row (by id). Returns a new array. */
export function patchSnapshotTask(
  tasks: SnapshotTask[],
  id: number,
  patch: Partial<SnapshotTask>
): SnapshotTask[] {
  return tasks.map((t) => (Number(t.id) === Number(id) ? { ...t, ...patch } : t));
}

/**
 * Remove a task and record the tombstone so every device drops it. The row is
 * also pulled out of `tasks` (a tombstoned row must not re-enter via a merge).
 */
export function deleteSnapshotTask(data: SnapshotData, id: number): SnapshotData {
  const n = Number(id);
  const tomb = new Set((data.deletedTaskIds || []).map((x) => Number(x)));
  tomb.add(n);
  return {
    ...data,
    tasks: (data.tasks || []).filter((t) => Number(t?.id) !== n),
    deletedTaskIds: [...tomb],
  };
}

/** Add-or-replace a task row (upsert by id) and clear any tombstone on it. */
export function upsertSnapshotTask(data: SnapshotData, task: SnapshotTask): SnapshotData {
  const n = Number(task.id);
  const tasks = (data.tasks || []).filter((t) => Number(t?.id) !== n);
  const tomb = (data.deletedTaskIds || []).map((x) => Number(x)).filter((x) => x !== n);
  return { ...data, tasks: [...tasks, task], deletedTaskIds: tomb };
}

/**
 * Push-side guard for POST /api/tasks/sync's tasks leg (2026-09-23 review).
 *
 * The snapshot's completion state now has TWO writers: the browser push (a
 * device's full local list) and the server claim/approve routes (pending
 * taps land via persistSnapshotWeek). Kid devices never push the snapshot,
 * so a parent's stale local list — captured before a kid's claim landed —
 * used to REPLACE the tasks leg verbatim and silently erase the just-written
 * `pendingApproval`: the kid's "on the way" row never reached the parent
 * queue, the points were never paid, and nothing self-healed (the weekData
 * leg union-merges by tx id, the tasks leg did not).
 *
 * Mirrors the pull-side proof gates in `mergeTasksSnapshot` (task-utils): a
 * pushed row may only CLEAR a stored live pending when the PUSH carries
 * proof — an earn tx for that task in the pusher's own weekData.history
 * (approval happened on the pushing device) or a sentBackAt stamp that does
 * not pre-date the stored tap — or carries an even FRESHER claim
 * (newest-claim-wins). Symmetrically, a pushed row may not RE-INTRODUCE a
 * pending the stored row has already resolved (paid in the stored history,
 * or sent back after the pushed tap) — that is a stale device resurrecting a
 * ghost approval.
 *
 * Rows with no pendingApproval on either side pass through verbatim.
 */
export function protectPendingOnPush(args: {
  storedTasks: SnapshotTask[];
  pushedTasks: SnapshotTask[];
  /** Pusher's weekData.history — parent pushes only (kids never approve). */
  pushedHistory?: unknown[];
  /** The stored snapshot's weekData.history (server-side resolution proof). */
  storedHistory?: unknown[];
}): SnapshotTask[] {
  const { storedTasks, pushedTasks, pushedHistory, storedHistory } = args;
  const byId = new Map(storedTasks.map((t) => [Number(t?.id), t]));
  const hasEarnFor = (history: unknown[] | undefined, id: number) =>
    Array.isArray(history) &&
    history.some((tx: any) => tx?.type === "earn" && Number(tx?.taskId) === id);
  const ts = (v: unknown): number | null => {
    const n = Date.parse(String(v ?? ""));
    return Number.isNaN(n) ? null : n;
  };
  // The stored row's completion stamps travel with whichever pending wins —
  // a live pending implies its own completion, a resolved row implies its
  // own reopen. A protected pushed row keeps every OTHER pushed field (a
  // parent's legitimate title/points edits still land).
  const storedCompletion = (s: SnapshotTask) => ({
    completed: (s as any).completed ?? false,
    completedBy: (s as any).completedBy ?? null,
    completedAt: (s as any).completedAt ?? null,
    completedInWeek: (s as any).completedInWeek ?? null,
  });
  return pushedTasks.map((p) => {
    const s = byId.get(Number(p?.id));
    if (!s) return p; // fresh row the server doesn't know — the push owns it
    const id = Number(p.id);
    const storedPending = (s as any).pendingApproval ?? null;
    const pushedPending = (p as any).pendingApproval ?? null;
    if (!storedPending && !pushedPending) return p;

    if (storedPending && !pushedPending) {
      const storedAt = ts((storedPending as any)?.at);
      const pushedSentBack = ts((p as any).sentBackAt);
      const mayClear =
        hasEarnFor(pushedHistory, id) ||
        (pushedSentBack !== null && (storedAt === null || pushedSentBack >= storedAt));
      if (mayClear) return p;
      // Protect the live stored tap. sentBackAt: null — a live pending has
      // no send-back in effect (also clears pre-parity stale stamps).
      return {
        ...p,
        ...storedCompletion(s),
        pendingApproval: storedPending,
        sentBackAt: null,
      };
    }

    if (!storedPending && pushedPending) {
      const pushedAt = ts((pushedPending as any)?.at);
      const storedSentBack = ts((s as any).sentBackAt);
      const resolved =
        hasEarnFor(storedHistory, id) ||
        (storedSentBack !== null && (pushedAt === null || storedSentBack >= pushedAt));
      if (!resolved) return p; // genuinely fresh pending the server lacks — accept (self-heal)
      // Ghost: strip the stale pending and restore the stored resolution state.
      return {
        ...p,
        ...storedCompletion(s),
        pendingApproval: null,
        sentBackAt: (s as any).sentBackAt ?? null,
      };
    }

    // Both sides claim a pending — newest claim wins.
    const storedAt = ts((storedPending as any)?.at) ?? 0;
    const pushedAt = ts((pushedPending as any)?.at) ?? 0;
    if (pushedAt >= storedAt) return p;
    return {
      ...p,
      ...storedCompletion(s),
      pendingApproval: storedPending,
      sentBackAt: null,
    };
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as T;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }
  return isObjectRecord(value) || Array.isArray(value) ? (value as T) : fallback;
}

function parseSnapshotData(value: unknown): SnapshotData {
  const parsed = parseJSON<unknown>(value, {});
  return isObjectRecord(parsed) ? (parsed as SnapshotData) : {};
}

function decimalRevision(value: unknown): string {
  const revision = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : value;
  return typeof revision === "string" && /^\d+$/.test(revision) ? BigInt(revision).toString() : "0";
}

function nextRevision(value: unknown): string {
  return (BigInt(decimalRevision(value)) + BigInt(1)).toString();
}

function rowUpdatedAt(row: any, data: SnapshotData): string {
  const updatedAt = row?.updated_at ?? row?.updatedAt ?? data.updatedAt;
  return typeof updatedAt === "string" ? updatedAt : "";
}

function isPositiveTaskId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sanitizeOperationReceipt(value: unknown): SnapshotOperationReceipt | null {
  if (!isObjectRecord(value)) return null;
  const operationId = normalizeOperationId(value.operationId);
  const action = typeof value.action === "string" ? value.action.trim() : "";
  const taskId = value.taskId;
  const createdAt = normalizeTimestamp(value.createdAt);
  if (
    !operationId ||
    !action ||
    !isPositiveTaskId(taskId) ||
    !createdAt ||
    (value.deleted !== undefined && typeof value.deleted !== "boolean")
  ) {
    return null;
  }
  return {
    operationId,
    action,
    taskId,
    ...(typeof value.deleted === "boolean" ? { deleted: value.deleted } : {}),
    createdAt,
  };
}

function sanitizeOperationReceipts(
  value: unknown,
): Record<string, SnapshotOperationReceipt[]> {
  const parsed = parseJSON<unknown>(value, {});
  const grouped = new Map<string, Map<number, SnapshotOperationReceipt>>();
  if (!isObjectRecord(parsed)) return Object.create(null) as Record<string, SnapshotOperationReceipt[]>;

  for (const stored of Object.values(parsed)) {
    const candidates = Array.isArray(stored) ? stored : [stored];
    for (const candidate of candidates) {
      const receipt = sanitizeOperationReceipt(candidate);
      if (!receipt) continue;
      const byTask = grouped.get(receipt.operationId) ?? new Map<number, SnapshotOperationReceipt>();
      byTask.set(receipt.taskId, receipt);
      grouped.set(receipt.operationId, byTask);
    }
  }

  const receipts = Object.create(null) as Record<string, SnapshotOperationReceipt[]>;
  for (const [operationId, byTask] of grouped) {
    receipts[operationId] = [...byTask.values()].sort((left, right) => left.taskId - right.taskId);
  }
  return receipts;
}

export function getSnapshotOperationReceipts(
  data: SnapshotData,
  operationId: unknown,
): SnapshotOperationReceipt[] {
  const normalizedOperationId = normalizeOperationId(operationId);
  if (!normalizedOperationId) return [];
  const receipts = sanitizeOperationReceipts(data.operationReceipts);
  return [...(receipts[normalizedOperationId] ?? [])];
}

function sanitizeConfigOperationReceipts(
  value: unknown,
  now = Date.now(),
): Record<string, SnapshotConfigOperationReceipt> {
  const parsed = parseJSON<unknown>(value, {});
  const retained: Array<[string, SnapshotConfigOperationReceipt]> = [];
  if (!isObjectRecord(parsed)) {
    return Object.create(null) as Record<string, SnapshotConfigOperationReceipt>;
  }

  for (const [storedId, candidate] of Object.entries(parsed)) {
    const operationId = normalizeOperationId(storedId);
    if (!operationId || !isObjectRecord(candidate)) continue;
    const kind = TASK_CONFIG_KINDS.includes(candidate.kind as TaskConfigKind)
      ? candidate.kind as TaskConfigKind
      : null;
    const action = TASK_CONFIG_ACTIONS.includes(candidate.action as SnapshotConfigOperationReceipt["action"])
      ? candidate.action as SnapshotConfigOperationReceipt["action"]
      : null;
    const updatedAt = normalizeTimestamp(candidate.updatedAt);
    if (
      !kind ||
      !action ||
      !updatedAt ||
      Date.parse(updatedAt) < now - TASK_CONFIG_RECEIPT_MAX_AGE_MS
    ) continue;
    const fingerprint = typeof candidate.fingerprint === "string" && /^[a-f0-9]{64}$/.test(candidate.fingerprint)
      ? candidate.fingerprint
      : undefined;
    const reconcileRequired = fingerprint && candidate.reconcileRequired === true
      ? true
      : undefined;
    retained.push([operationId, {
      kind,
      action,
      updatedAt,
      ...(fingerprint ? { fingerprint } : {}),
      ...(reconcileRequired ? { reconcileRequired } : {}),
    }]);
  }

  retained.sort((left, right) => (
    right[1].updatedAt.localeCompare(left[1].updatedAt) ||
    left[0].localeCompare(right[0])
  ));
  const receipts = Object.create(null) as Record<string, SnapshotConfigOperationReceipt>;
  for (const [operationId, receipt] of retained.slice(0, TASK_CONFIG_RECEIPT_MAX_COUNT)) {
    receipts[operationId] = receipt;
  }
  return receipts;
}

function sanitizeProjectionRepairs(value: unknown): SnapshotProjectionRepair[] {
  const parsed = parseJSON<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const repairs: SnapshotProjectionRepair[] = [];

  for (const candidate of parsed) {
    if (!isObjectRecord(candidate)) continue;
    const operationId = normalizeOperationId(candidate.operationId);
    const createdAt = normalizeTimestamp(candidate.createdAt);
    const taskIds = Array.isArray(candidate.taskIds)
      ? [
          ...new Set(
            candidate.taskIds.filter(isPositiveTaskId),
          ),
        ]
      : [];
    if (!operationId || !createdAt || taskIds.length === 0) continue;
    repairs.push({ operationId, taskIds, createdAt });
  }

  return repairs;
}

function sanitizeSnapshotMetadata(data: SnapshotData): SnapshotData {
  const next = { ...data };
  if ("operationReceipts" in data) {
    next.operationReceipts = sanitizeOperationReceipts(data.operationReceipts);
  }
  if ("configOperationReceipts" in data) {
    next.configOperationReceipts = sanitizeConfigOperationReceipts(data.configOperationReceipts);
  }
  if ("pendingProjectionRepairs" in data) {
    next.pendingProjectionRepairs = sanitizeProjectionRepairs(data.pendingProjectionRepairs);
  }
  return next;
}

function canonicalSnapshotData(
  data: SnapshotData,
  revision: string,
  normalizeWeek = true,
  sanitizeMetadata = true,
): SnapshotData {
  const next: SnapshotData = {
    ...(sanitizeMetadata ? sanitizeSnapshotMetadata(data) : data),
    revision,
  };
  if (normalizeWeek && next.weekData != null) {
    const weekData = normalizeWeekData(next.weekData);
    if (!weekData) throw new TypeError("invalid_week_data");
    next.weekData = {
      ...weekData,
      points: recomputeWeekPoints(weekData.history),
    };
  }
  return next;
}

export async function readSnapshotWithRevision(): Promise<{
  data: SnapshotData;
  revision: SnapshotRevision;
  rowId: string | null;
}> {
  return withAdmin(async (pb) => {
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const row = rows[0] as any;
    const data = sanitizeSnapshotMetadata(parseSnapshotData(row?.data));
    return {
      data,
      revision: {
        revision: decimalRevision(data.revision),
        updatedAt: rowUpdatedAt(row, data),
      },
      rowId: row?.id ?? null,
    };
  });
}

async function readRow(): Promise<{ id: string | null; data: SnapshotData }> {
  const result = await readSnapshotWithRevision();
  return { id: result.rowId, data: result.data };
}

/** Read the live task list (tombstones already applied). */
export async function readSnapshotTasks(): Promise<SnapshotTask[]> {
  const { data } = await readRow();
  return liveSnapshotTasks(data);
}

export async function mutateSnapshotWithMeta<T>(
  fn: (data: SnapshotData) => { data: SnapshotData; result: T },
  pb?: AdminPB,
): Promise<SnapshotMutationResult<T>> {
  return withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, async () => {
    const mutate = async (client: AdminPB): Promise<SnapshotMutationResult<T>> => {
      const rows = await client.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      });
      const row = rows[0] as any;
      const current = sanitizeSnapshotMetadata(parseSnapshotData(row?.data));
      const { data, result } = fn(current);
      const revision = nextRevision(current.revision);
      const updatedAt = new Date().toISOString();
      const payload = {
        key: SNAPSHOT_KEY,
        data: canonicalSnapshotData(data, revision),
        updated_at: updatedAt,
      };
      if (row) {
        await client.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
      } else {
        await client.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
      }
      return { result, revision: { revision, updatedAt } };
    };

    return pb ? mutate(pb) : withAdmin(mutate);
  });
}

/**
 * Read-modify-write the snapshot under the SAME keyed lock the sync route and
 * claim route use, so a chat mutation can never be interleaved away by a
 * browser push. `fn` receives the full blob and returns the next blob.
 */
export async function mutateSnapshot<T>(
  fn: (data: SnapshotData) => { data: SnapshotData; result: T }
): Promise<T> {
  const mutation = await mutateSnapshotWithMeta(fn);
  return mutation.result;
}

/**
 * Best-effort mirror of a task mutation into the PB `tasks` collection so
 * server-side readers (Home widget SSR, crons) stay roughly consistent. The
 * snapshot is authoritative; a failure here is logged, never thrown.
 */
export async function mirrorTaskToCollection(
  op: "upsert" | "delete",
  task: SnapshotTask | { id: number }
): Promise<void> {
  try {
    await withAdmin(async (pb) => {
      const rows = await pb.collection("tasks").getFullList({ requestKey: null });
      const existing = rows.find((r: any) => Number(r.taskId) === Number((task as any).id));
      if (op === "delete") {
        if (existing) await pb.collection("tasks").delete((existing as any).id, { requestKey: null });
        return;
      }
      const t = task as SnapshotTask;
      const rec = {
        taskId: Number(t.id),
        title: t.title,
        assignee: t.assignee ?? "All",
        // Snapshot may hold a full photo avatar; PB tasks.assigneeEmoji max=5000.
        assigneeEmoji: persistedTaskEmoji(t.assigneeEmoji) || "👤",
        assigned: t.assignee ?? "All",
        status: t.completed ? "done" : "pending",
        due: t.due ?? null,
        points: t.points ?? 0,
        recurring: t.recurring ?? null,
        category: t.category ?? "chores",
        priority: t.priority ?? "medium",
        universal: t.universal ?? false,
        stealable: t.stealable ?? false,
        completed: t.completed ?? false,
        completedBy: t.completedBy ?? null,
        completedAt: t.completedAt ?? null,
        completedInWeek: t.completedInWeek ?? null,
        pendingApproval: t.pendingApproval ?? null,
        sentBackAt: t.sentBackAt ?? null,
        crewSize: t.crewSize ?? null,
        // Crew member emojis ride the same PB json field — photo avatars
        // from members.emoji must be gated exactly like assigneeEmoji.
        crew: persistedCrewEmoji(t.crew as any),
        speedBonus: t.speedBonus ?? null,
      };
      if (existing) await pb.collection("tasks").update((existing as any).id, rec, { requestKey: null });
      else await pb.collection("tasks").create(rec, { requestKey: null });
    });
  } catch (e: any) {
    console.warn("[snapshot-tasks] collection mirror failed:", e?.data ?? e?.message ?? e);
  }
}

export type AdminPB = ReturnType<typeof import("@/lib/pb").getAdminPB>;

export type SnapshotConfigItemsSanitizer = (
  kind: TaskConfigKind,
  value: unknown,
) => TaskConfigItem[] | null;

export class InvalidStoredTaskConfigError extends Error {
  constructor(readonly kind: TaskConfigKind) {
    super("invalid_current_config");
    this.name = "InvalidStoredTaskConfigError";
  }
}

export class InvalidResultingTaskConfigError extends Error {
  constructor(readonly kind: TaskConfigKind) {
    super("invalid_resulting_config");
    this.name = "InvalidResultingTaskConfigError";
  }
}

export async function mutateSnapshotConfig(
  command: TaskConfigCommand,
  pb: AdminPB,
  sanitizeItems: SnapshotConfigItemsSanitizer,
): Promise<SnapshotConfigMutationResult> {
  return withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, async () => {
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const row = rows[0] as any;
    const current = parseSnapshotData(row?.data);
    const dataKey = TASK_CONFIG_DATA_KEYS[command.kind];
    const stampKey = TASK_CONFIG_STAMP_KEYS[command.kind];
    const storedItems = current[dataKey];
    const currentItems = Array.isArray(storedItems)
      ? sanitizeItems(command.kind, storedItems)
      : null;
    const currentChanged = Boolean(
      Array.isArray(storedItems) &&
      currentItems &&
      JSON.stringify(storedItems) !== JSON.stringify(currentItems),
    );
    if (command.action !== "replace" && !currentItems) {
      throw new InvalidStoredTaskConfigError(command.kind);
    }
    const revision = decimalRevision(current.revision);
    const revisionUpdatedAt = rowUpdatedAt(row, current);
    const currentStamp = normalizeTimestamp(current[stampKey]) ?? "";
    const fingerprint = taskConfigCommandFingerprint(command);
    const receipt = sanitizeConfigOperationReceipts(current.configOperationReceipts)[command.operationId];
    const persistSanitizedCurrent = async (
      repairMarker?: SnapshotConfigOperationReceipt,
    ) => {
      const updatedRevision = nextRevision(revision);
      const updatedAt = new Date().toISOString();
      const configOperationReceipts = sanitizeConfigOperationReceipts(current.configOperationReceipts);
      if (repairMarker) configOperationReceipts[command.operationId] = repairMarker;
      const payload = {
        key: SNAPSHOT_KEY,
        data: canonicalSnapshotData({
          ...current,
          [dataKey]: currentItems!,
          ...("configOperationReceipts" in current || repairMarker
            ? { configOperationReceipts }
            : {}),
        }, updatedRevision, false, false),
        updated_at: updatedAt,
      };
      if (row) {
        await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
      } else {
        await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
      }
      return { revision: updatedRevision, updatedAt };
    };

    if (receipt) {
      const matches = receipt.kind === command.kind &&
        receipt.action === command.action &&
        receipt.updatedAt === command.updatedAt &&
        receipt.fingerprint === fingerprint;
      if (matches && !currentItems) {
        throw new InvalidStoredTaskConfigError(command.kind);
      }
      const sanitizedWrite = matches && currentChanged
        ? await persistSanitizedCurrent()
        : null;
      return {
        items: currentItems!,
        updatedAt: currentStamp || receipt.updatedAt,
        revision: sanitizedWrite ?? { revision, updatedAt: revisionUpdatedAt },
        applied: false,
        duplicate: matches,
        stale: false,
        conflict: !matches,
        reconcile: true,
        clearRepairMarker: matches && receipt.reconcileRequired === true,
      };
    }

    if (currentStamp && command.updatedAt <= currentStamp) {
      if (!currentItems) throw new InvalidStoredTaskConfigError(command.kind);
      const sanitizedWrite = currentChanged
        ? await persistSanitizedCurrent({
            kind: command.kind,
            action: command.action,
            updatedAt: command.updatedAt,
            fingerprint,
            reconcileRequired: true,
          })
        : null;
      return {
        items: currentItems,
        updatedAt: currentStamp,
        revision: sanitizedWrite ?? { revision, updatedAt: revisionUpdatedAt },
        applied: false,
        duplicate: false,
        stale: true,
        conflict: false,
        reconcile: currentChanged,
        clearRepairMarker: currentChanged,
      };
    }

    const baseItems = command.action === "replace" ? [] : currentItems!;
    const items = sanitizeItems(command.kind, applyTaskConfigCommand(baseItems, command));
    if (!items) throw new InvalidResultingTaskConfigError(command.kind);
    const configOperationReceipts = sanitizeConfigOperationReceipts({
      ...sanitizeConfigOperationReceipts(current.configOperationReceipts),
      [command.operationId]: {
        kind: command.kind,
        action: command.action,
        updatedAt: command.updatedAt,
        fingerprint,
      },
    });
    const updatedRevision = nextRevision(revision);
    const updatedAt = new Date().toISOString();
    const payload = {
      key: SNAPSHOT_KEY,
      data: canonicalSnapshotData({
        ...current,
        [dataKey]: items,
        [stampKey]: command.updatedAt,
        configOperationReceipts,
      }, updatedRevision, false, false),
      updated_at: updatedAt,
    };
    if (row) {
      await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
    } else {
      await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
    }

    return {
      items,
      updatedAt: command.updatedAt,
      revision: { revision: updatedRevision, updatedAt },
      applied: true,
      duplicate: false,
      stale: false,
      conflict: false,
      reconcile: true,
      clearRepairMarker: false,
    };
  });
}

export async function clearTaskConfigRepairMarker(
  operationId: string,
  pb: AdminPB,
): Promise<SnapshotRevision | null> {
  const normalizedOperationId = normalizeOperationId(operationId);
  if (!normalizedOperationId) return null;
  return withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, async () => {
    const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
      requestKey: null,
      filter: `key = "${SNAPSHOT_KEY}"`,
    });
    const row = rows[0] as any;
    const current = parseSnapshotData(row?.data);
    const configOperationReceipts = sanitizeConfigOperationReceipts(current.configOperationReceipts);
    if (configOperationReceipts[normalizedOperationId]?.reconcileRequired !== true) {
      return null;
    }
    delete configOperationReceipts[normalizedOperationId];
    const revision = nextRevision(current.revision);
    const updatedAt = new Date().toISOString();
    const payload = {
      key: SNAPSHOT_KEY,
      data: canonicalSnapshotData({
        ...current,
        configOperationReceipts,
      }, revision, false, false),
      updated_at: updatedAt,
    };
    if (row) {
      await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
    } else {
      await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
    }
    return { revision, updatedAt };
  });
}

export type SnapshotWeekTaskPatch = {
  id: number;
  crew?: unknown;
  completed?: boolean;
  completedBy?: string;
  completedAt?: string;
  completedInWeek?: string;
  pendingApproval?: unknown;
  sentBackAt?: unknown;
};

/**
 * Persist weekData (and/or a task-row patch) into the snapshot blob under the
 * SNAPSHOT keyed lock. Callers MUST already hold the week-ledger lock so the
 * global order stays week-ledger → snapshot (never reversed).
 *
 * Union-merges history by transaction id so a concurrent claim's tx is never
 * dropped, and only adopts a week at least as new as what's stored.
 * Best-effort: week_data stays authoritative; failures are logged.
 */
export function normalizeWeekData(value: unknown): WeekData | null {
  const parsed = parseJSON<unknown>(value, null);
  if (!isObjectRecord(parsed) || typeof parsed.weekStart !== "string" || !parsed.weekStart.trim()) {
    return null;
  }
  const pointsValue = parseJSON<unknown>(parsed.points, {});
  const streakValue = parseJSON<unknown>(parsed.streak, {});
  const lastActiveValue = parseJSON<unknown>(parsed.lastActive, {});
  const history = parseCanonicalTransactions(parsed.history);
  if (!history) return null;
  return {
    weekStart: parsed.weekStart.trim(),
    points: isObjectRecord(pointsValue) ? (pointsValue as Record<string, number>) : {},
    streak: isObjectRecord(streakValue) ? (streakValue as Record<string, number>) : {},
    lastActive: isObjectRecord(lastActiveValue) ? (lastActiveValue as Record<string, string>) : {},
    history,
  };
}

export async function persistSnapshotWeek(
  pb: AdminPB,
  weekData: WeekData | null,
  taskRow?: SnapshotWeekTaskPatch
): Promise<SnapshotWriteResult> {
  let currentRevision = "0";
  let currentUpdatedAt = "";

  try {
    return await withKeyedLock(`snapshot:${SNAPSHOT_KEY}`, async () => {
      const rows = await pb.collection(SNAPSHOT_COLLECTION).getFullList({
        requestKey: null,
        filter: `key = "${SNAPSHOT_KEY}"`,
      });
      const row = rows[0] as any;
      const data = sanitizeSnapshotMetadata(parseSnapshotData(row?.data));
      currentRevision = decimalRevision(data.revision);
      currentUpdatedAt = rowUpdatedAt(row, data);

      if (weekData) {
        const incoming = normalizeWeekData(weekData);
        if (!incoming) throw new TypeError("invalid_week_data");
        const hasStoredWeek = data.weekData != null;
        const stored = hasStoredWeek ? normalizeWeekData(data.weekData) : null;
        if (hasStoredWeek && !stored) throw new TypeError("invalid_stored_week_data");
        let mergedWeek = incoming;

        if (stored && stored.weekStart > incoming.weekStart) {
          mergedWeek = stored;
        } else if (stored && stored.weekStart === incoming.weekStart) {
          const byId = new Map<number, Transaction>();
          for (const transaction of stored.history) byId.set(transaction.id, transaction);
          for (const transaction of incoming.history) byId.set(transaction.id, transaction);
          mergedWeek = {
            ...incoming,
            history: [...byId.values()].sort(
              (left, right) =>
                String(left.timestamp).localeCompare(String(right.timestamp)) ||
                left.id - right.id,
            ),
          };
        }

        data.weekData = mergedWeek;
        data.taskWeekStart = mergedWeek.weekStart;
      }

      if (taskRow && Array.isArray(data.tasks)) {
        data.tasks = data.tasks.map((task: SnapshotTask) =>
          Number(task.id) === Number(taskRow.id)
            ? {
                ...task,
                ...(taskRow.crew !== undefined ? { crew: taskRow.crew } : {}),
                ...(taskRow.completed !== undefined ? { completed: taskRow.completed } : {}),
                ...(taskRow.completedBy !== undefined ? { completedBy: taskRow.completedBy } : {}),
                ...(taskRow.completedAt !== undefined ? { completedAt: taskRow.completedAt } : {}),
                ...(taskRow.completedInWeek !== undefined
                  ? { completedInWeek: taskRow.completedInWeek }
                  : {}),
                ...(taskRow.pendingApproval !== undefined
                  ? { pendingApproval: taskRow.pendingApproval }
                  : {}),
                ...(taskRow.sentBackAt !== undefined ? { sentBackAt: taskRow.sentBackAt } : {}),
              }
            : task,
        );
      }

      const revision = nextRevision(data.revision);
      const updatedAt = new Date().toISOString();
      const payload = {
        key: SNAPSHOT_KEY,
        data: canonicalSnapshotData(data, revision),
        updated_at: updatedAt,
      };
      if (row) {
        await pb.collection(SNAPSHOT_COLLECTION).update(row.id, payload, { requestKey: null });
      } else {
        await pb.collection(SNAPSHOT_COLLECTION).create(payload, { requestKey: null });
      }
      currentRevision = revision;
      currentUpdatedAt = updatedAt;
      return {
        ok: true,
        revision: { revision, updatedAt },
      };
    });
  } catch {
    console.warn("[persistSnapshotWeek] snapshot persist failed");
    return {
      ok: false,
      revision: { revision: currentRevision, updatedAt: currentUpdatedAt },
      error: "snapshot_write_failed",
    };
  }
}
