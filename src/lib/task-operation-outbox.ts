import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import type {
  SnapshotConfigOperationReceipt,
  SnapshotData,
  SnapshotOperationReceipt,
  SnapshotRevision,
} from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";

export const TASK_OUTBOX_STORAGE_KEY = "consuela-task-operation-outbox-v1";
export const TASK_OUTBOX_ENTRY_PREFIX = `${TASK_OUTBOX_STORAGE_KEY}:entry:`;
export const TASK_OUTBOX_MAX_ENTRIES = 50;
export const TASK_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TASK_OUTBOX_MAX_ATTEMPTS = 8;
export const TASK_OUTBOX_BASE_BACKOFF_MS = 2_000;
export const TASK_OUTBOX_MAX_BACKOFF_MS = 5 * 60_000;
export const TASK_OUTBOX_MAX_AUTH_BACKOFF_MS = 30 * 60_000;
export const TASK_OUTBOX_MAX_RECONCILE_BACKOFF_MS = 30 * 60_000;
export const TASK_OUTBOX_REQUEST_TIMEOUT_MS = 30_000;
export const TASK_OUTBOX_STORAGE_WRITE_ATTEMPTS = 2;

export type TaskOperationRoute =
  | "/api/tasks/claim"
  | "/api/tasks/approve"
  | "/api/tasks/manage"
  | "/api/tasks/config"
  | "/api/tasks/ledger"
  | "/api/rewards/redeem";

export type TaskOutboxErrorCategory =
  | "network"
  | "server"
  | "unauthorized"
  | "validation"
  | "semantic-duplicate"
  | "projection";

export type TaskOutboxStatus =
  | "queued"
  | "retrying"
  | "auth-required"
  | "reconciling"
  | "failed";

export interface TaskOutboxDisplayTarget {
  taskId?: number;
  temporaryId?: number;
  title?: string;
  kind: "task" | "claim" | "approval" | "crew" | "undo" | "config";
}

export interface TaskOutboxCredential {
  pin?: string;
  parentPin?: string;
}

export interface TaskOutboxEntry {
  version: 1;
  operationId: string;
  route: TaskOperationRoute;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attemptCount: number;
  authAttemptCount?: number;
  reconcileAttemptCount?: number;
  lastErrorCategory?: TaskOutboxErrorCategory;
  lastErrorReason?: string;
  nextAttemptAt?: string;
  status: TaskOutboxStatus;
  displayTarget: TaskOutboxDisplayTarget;
}

export interface TaskOutboxAcknowledgement {
  operationId: string;
  weekData?: WeekData;
  task?: Task;
  revision?: SnapshotRevision;
  paid?: number;
  cleared?: number;
  skipped?: number;
  reconciled?: boolean;
  [key: string]: unknown;
}

export interface SnapshotRead {
  snapshot: SnapshotData | null;
  reconciled?: boolean;
  revision?: SnapshotRevision;
  weekData?: WeekData;
  operationReceipts?: Record<string, SnapshotOperationReceipt[]>;
  configOperationReceipts?: Record<string, SnapshotConfigOperationReceipt>;
}

export type TaskOutboxSendResult = { status: number; body: TaskOutboxAcknowledgement };

export interface TaskOutboxDriver {
  send: (entry: TaskOutboxEntry, credential?: TaskOutboxCredential) => Promise<TaskOutboxSendResult>;
  getCredential?: (entry: TaskOutboxEntry) => TaskOutboxCredential | string | undefined;
  releaseCredential?: (operationId: string) => void;
  pullSnapshot?: () => Promise<SnapshotRead>;
  adoptSnapshot?: (read: SnapshotRead) => void | Promise<void>;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
}

export interface TaskOutboxFetchDriverOptions extends Partial<TaskOutboxDriver> {
  requestTimeoutMs?: number;
}

export type FlushTaskOutboxOptions = TaskOutboxDriver;

export interface FlushTaskOutboxResult {
  acknowledged: number;
  retryable: number;
  permanent: number;
}

const ROUTES = new Set<string>([
  "/api/tasks/claim",
  "/api/tasks/approve",
  "/api/tasks/manage",
  "/api/tasks/config",
  "/api/tasks/ledger",
  "/api/rewards/redeem",
]);

const STATUSES = new Set<string>(["queued", "retrying", "auth-required", "reconciling", "failed"]);

const ERROR_CATEGORIES = new Set<string>([
  "network",
  "server",
  "unauthorized",
  "validation",
  "semantic-duplicate",
  "projection",
]);

const DISPLAY_KINDS = new Set<string>(["task", "claim", "approval", "crew", "undo", "config"]);

const CLAIM_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  claim: ["taskId", "memberName", "assigneeEmoji"],
  complete: ["taskId", "memberName", "assigneeEmoji"],
  undo: ["taskId", "memberName", "assigneeEmoji"],
  "crew-join": ["taskId", "memberName", "assigneeEmoji"],
  "crew-checkin": ["taskId", "memberName", "assigneeEmoji"],
  "crew-remove": ["taskId", "memberName", "targetName"],
};

const APPROVE_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  approve: ["taskId", "memberName"],
  "approve-all": ["taskIds", "memberName"],
  "send-back": ["taskId", "memberName"],
};

// A parent-authoritative point movement: a catalog penalty or a manual adjust.
// A penalty carries an item id ONLY — the route refuses a client `points`
// outright and reads the canonical value from the config leg, so admitting the
// key here would advertise a field that can never be honoured. An adjust
// carries the signed amount and its reason. The resulting BALANCE is never a
// client input: the server re-derives it under the week-ledger lock.
const LEDGER_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  penalty: ["memberName", "itemId"],
  adjust: ["memberName", "amount", "reason"],
};

// A redemption names the reward and the member; the stored reward row decides
// the cost, so there is no amount key here either.
const REDEEM_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  redeem: ["rewardId", "memberName", "parentName"],
};

const MANAGE_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  add: ["task"],
  update: ["taskId", "patch"],
  delete: ["taskId"],
};

const MANAGE_ADD_TASK_KEYS = [
  "title",
  "assignee",
  "assigneeEmoji",
  "due",
  "points",
  "recurring",
  "category",
  "priority",
  "universal",
  "stealable",
  "crewSize",
  "speedBonus",
] as const;

const MANAGE_UPDATE_PATCH_KEYS = [
  "title",
  "assignee",
  "due",
  "points",
  "recurring",
  "category",
  "priority",
  "universal",
  "stealable",
  "speedBonus",
  "crewSize",
] as const;

const CONFIG_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  replace: ["kind", "updatedAt", "items"],
  upsert: ["kind", "updatedAt", "item"],
  delete: ["kind", "updatedAt", "itemId"],
};

const CONFIG_ITEM_KEYS: Record<string, readonly string[]> = {
  rewards: ["id", "name", "emoji", "cost", "category"],
  penalties: ["id", "name", "emoji", "points"],
  "weekly-prizes": ["id", "rank", "emoji", "text"],
};

const CONFIG_KIND_LEGS: Record<string, { items: string; stamp: string }> = {
  rewards: { items: "rewards", stamp: "rewardsUpdatedAt" },
  penalties: { items: "penalties", stamp: "penaltiesUpdatedAt" },
  "weekly-prizes": { items: "weeklyPrizes", stamp: "weeklyPrizesStamp" },
};

// Which credential fields each route's own parser accepts on the wire. A
// bundle field that is NOT listed here can never reach the network, so a
// parent PIN cannot leak into a route that would reject the unknown key.
// The canonical ledger SOURCE each ledger-capable route writes, and the
// transaction TYPE each action records. A pulled transaction only proves a
// command when all four fields — operationId, source, member, type, amount —
// line up, so these are the contract the proof checks against.
const REDEEM_LEDGER_SOURCE = "reward-redeem";

const LEDGER_ACTION_TYPES: Record<string, string> = {
  penalty: "penalty",
  adjust: "adjust",
  redeem: "redeem",
};

const CREDENTIAL_BODY_KEYS: Record<string, readonly (keyof TaskOutboxCredential)[]> = {
  "/api/tasks/claim": ["pin"],
  "/api/tasks/approve": ["pin"],
  "/api/tasks/ledger": ["pin"],
  "/api/rewards/redeem": ["pin", "parentPin"],
};

// A credential is required only when the server ALWAYS needs a PIN. `undo` is
// deliberately absent from the claim set: a kid taking back their own PENDING
// tap is a session-only self-cancel that never moved points, and forcing a PIN
// for it is what used to strand under-10 taps. The server owns the real rule —
// it refuses a PAID undo (a ledger reversal) without the member PIN, for a
// parent and for a child alike — so a session undo that should have needed a
// PIN is refused there, not here.
const CREDENTIAL_REQUIRED_ACTIONS: Record<string, Set<string>> = {
  "/api/tasks/approve": new Set(["approve", "approve-all", "send-back"]),
  "/api/tasks/claim": new Set(["claim", "crew-remove"]),
  "/api/tasks/manage": new Set(),
  "/api/tasks/config": new Set(),
  "/api/tasks/ledger": new Set(["penalty", "adjust"]),
  "/api/rewards/redeem": new Set(),
};

const RETRYABLE_REASONS = new Set([
  "member_roster_unavailable",
  "ledger_unavailable",
  "snapshot_write_failed",
  "task_store_unavailable",
  "config_store_unreachable",
  "rollover_unavailable",
  "projection_reconcile_unavailable",
  "snapshot_unavailable",
  "projection_reconcile_pending",
]);

const PERMANENT_REASONS = new Set(["operation_conflict", "stale_config"]);

const DUPLICATE_REASONS = new Set([
  "semantic_duplicate",
  "already_completed",
  "already_claimed",
  "already_undone",
  "nothing_to_undo",
  "member_checked_in",
]);

const EMPTY_SERVER_SNAPSHOT: TaskOutboxEntry[] = Object.freeze<TaskOutboxEntry[]>([]) as TaskOutboxEntry[];

const RETAINED: FlushTaskOutboxResult = { acknowledged: 0, retryable: 1, permanent: 0 };

function cappedLadder(baseMs: number, capMs: number, step: number): number {
  const attempt = Math.max(1, Math.floor(step));
  return Math.min(baseMs * 2 ** (attempt - 1), capMs);
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const configItemKeysFor = (kind: string): readonly string[] | undefined => CONFIG_ITEM_KEYS[kind];

const PAYLOAD_TABLES: Record<string, Record<string, readonly string[]>> = {
  "/api/tasks/claim": CLAIM_PAYLOAD_KEYS,
  "/api/tasks/approve": APPROVE_PAYLOAD_KEYS,
  "/api/tasks/manage": MANAGE_PAYLOAD_KEYS,
  "/api/tasks/config": CONFIG_PAYLOAD_KEYS,
  "/api/tasks/ledger": LEDGER_PAYLOAD_KEYS,
  "/api/rewards/redeem": REDEEM_PAYLOAD_KEYS,
};

export function isSupportedTaskOperation(route: unknown, action: unknown): boolean {
  if (typeof route !== "string" || !ROUTES.has(route) || typeof action !== "string") return false;
  const table = PAYLOAD_TABLES[route];
  return table !== undefined && hasOwn(table, action);
}

function pickKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (hasOwn(value, key)) picked[key] = value[key];
  }
  return picked;
}

function sanitizeConfigPayload(action: string, payload: Record<string, unknown>): Record<string, unknown> {
  const picked = pickKeys(payload, CONFIG_PAYLOAD_KEYS[action] ?? []);
  const itemKeys = configItemKeysFor(String(picked.kind ?? ""));
  if (!itemKeys) return picked;
  if (Array.isArray(picked.items)) {
    picked.items = picked.items.map((item) => pickKeys(item, itemKeys));
  }
  if (picked.item !== undefined) picked.item = pickKeys(picked.item, itemKeys);
  return picked;
}

export function sanitizeTaskOperationPayload(
  route: string,
  action: string,
  payload: unknown,
): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  if (route === "/api/tasks/claim") return pickKeys(payload, CLAIM_PAYLOAD_KEYS[action] ?? []);
  if (route === "/api/tasks/approve") return pickKeys(payload, APPROVE_PAYLOAD_KEYS[action] ?? []);
  if (route === "/api/tasks/manage") {
    const picked = pickKeys(payload, MANAGE_PAYLOAD_KEYS[action] ?? []);
    if (action === "add") picked.task = pickKeys(picked.task, MANAGE_ADD_TASK_KEYS);
    if (action === "update") picked.patch = pickKeys(picked.patch, MANAGE_UPDATE_PATCH_KEYS);
    return picked;
  }
  if (route === "/api/tasks/config") return sanitizeConfigPayload(action, payload);
  if (route === "/api/tasks/ledger") return pickKeys(payload, LEDGER_PAYLOAD_KEYS[action] ?? []);
  if (route === "/api/rewards/redeem") return pickKeys(payload, REDEEM_PAYLOAD_KEYS[action] ?? []);
  return {};
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeDisplayTarget(value: unknown): TaskOutboxDisplayTarget {
  const source = isRecord(value) ? value : {};
  const kind = String(source.kind ?? "");
  return {
    ...(optionalNumber(source.taskId) !== undefined ? { taskId: optionalNumber(source.taskId) } : {}),
    ...(optionalNumber(source.temporaryId) !== undefined
      ? { temporaryId: optionalNumber(source.temporaryId) }
      : {}),
    ...(optionalText(source.title) !== undefined ? { title: optionalText(source.title) } : {}),
    kind: DISPLAY_KINDS.has(kind) ? (kind as TaskOutboxDisplayTarget["kind"]) : "task",
  };
}

function parseEntry(value: unknown): TaskOutboxEntry | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const operationId = normalizeOperationId(value.operationId);
  const route = String(value.route ?? "");
  const action = String(value.action ?? "").trim();
  const createdAt = normalizeIso(value.createdAt);
  if (!operationId || !createdAt || !isSupportedTaskOperation(route, action)) return null;
  const status = STATUSES.has(String(value.status)) ? (value.status as TaskOutboxStatus) : "queued";
  const attemptCount = Math.max(
    0,
    Math.min(1_000, Math.floor(typeof value.attemptCount === "number" ? value.attemptCount : 0)),
  );
  const boundedCount = (candidate: unknown): number | undefined =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(0, Math.min(1_000, Math.floor(candidate)))
      : undefined;
  const authAttemptCount = boundedCount(value.authAttemptCount);
  const reconcileAttemptCount = boundedCount(value.reconcileAttemptCount);
  const category = ERROR_CATEGORIES.has(String(value.lastErrorCategory))
    ? (value.lastErrorCategory as TaskOutboxErrorCategory)
    : undefined;
  const nextAttemptAt = normalizeIso(value.nextAttemptAt);
  return {
    version: 1,
    operationId,
    route: route as TaskOperationRoute,
    action,
    payload: sanitizeTaskOperationPayload(route, action, value.payload),
    createdAt,
    attemptCount,
    ...(authAttemptCount !== undefined ? { authAttemptCount } : {}),
    ...(reconcileAttemptCount !== undefined ? { reconcileAttemptCount } : {}),
    ...(category ? { lastErrorCategory: category } : {}),
    ...(optionalText(value.lastErrorReason) ? { lastErrorReason: optionalText(value.lastErrorReason) } : {}),
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    status,
    displayTarget: sanitizeDisplayTarget(value.displayTarget),
  };
}

function createdMs(entry: TaskOutboxEntry): number {
  const epoch = Date.parse(entry.createdAt);
  return Number.isFinite(epoch) ? epoch : 0;
}

function boundEntries(entries: TaskOutboxEntry[]): TaskOutboxEntry[] {
  const floor = Date.now() - TASK_OUTBOX_RETENTION_MS;
  const kept = entries
    .filter((entry) => entry.status === "failed" || createdMs(entry) >= floor)
    .sort((left, right) => createdMs(left) - createdMs(right));
  return kept.length > TASK_OUTBOX_MAX_ENTRIES
    ? kept.slice(kept.length - TASK_OUTBOX_MAX_ENTRIES)
    : kept;
}

function mergeByOperationId(
  stored: TaskOutboxEntry[],
  extras: TaskOutboxEntry[],
): TaskOutboxEntry[] {
  if (!extras.length) return stored;
  const extrasById = new Map(extras.map((entry) => [entry.operationId, entry]));
  const kept = stored.filter((entry) => !extrasById.has(entry.operationId));
  return boundEntries([...kept, ...extras]);
}

interface TaskOutboxIndex {
  rev: number;
  ids: string[];
  legacy: boolean;
}

let cache: TaskOutboxEntry[] | null = null;
let cacheIndexRaw: string | null = null;
let unpersisted = new Map<string, TaskOutboxEntry>();
let inFlightByDriver = new WeakMap<TaskOutboxDriver, Promise<FlushTaskOutboxResult>>();

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function taskOutboxEntryStorageKey(operationId: string): string {
  return `${TASK_OUTBOX_ENTRY_PREFIX}${operationId}`;
}

function isEntryKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(TASK_OUTBOX_ENTRY_PREFIX);
}

function readIndexRaw(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseIndex(raw: string | null): TaskOutboxIndex {
  if (!raw) return { rev: 0, ids: [], legacy: false };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rev: 0, ids: [], legacy: false };
  }
  if (Array.isArray(parsed)) {
    const legacy = parsed
      .map((value) => parseEntry(value))
      .filter((entry): entry is TaskOutboxEntry => Boolean(entry));
    return {
      rev: 1,
      ids: [...new Set(legacy.map((entry) => entry.operationId))],
      legacy: true,
    };
  }
  if (!isRecord(parsed)) return { rev: 0, ids: [], legacy: false };
  const rev = Number.isSafeInteger(parsed.rev) ? Number(parsed.rev) : 0;
  const ids = Array.isArray(parsed.ids)
    ? parsed.ids
        .map((value) => normalizeOperationId(value))
        .filter((value): value is string => Boolean(value))
    : [];
  return { rev, ids: [...new Set(ids)], legacy: false };
}

function readStoredEntry(operationId: string): TaskOutboxEntry | null {
  if (!isBrowser()) return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(taskOutboxEntryStorageKey(operationId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseEntry(parsed);
}

function loadStoredEntries(index: TaskOutboxIndex): {
  entries: TaskOutboxEntry[];
  orphanIds: string[];
} {
  const entries: TaskOutboxEntry[] = [];
  const orphanIds: string[] = [];
  for (const id of index.ids) {
    const entry = readStoredEntry(id);
    if (entry) entries.push(entry);
    else orphanIds.push(id);
  }
  return { entries, orphanIds };
}

let orphanIds: string[] = [];
let evictedEntryIds: string[] = [];
let evictionPruneScheduled = false;

function scheduleEvictionPrune(): void {
  if (evictionPruneScheduled || typeof window === "undefined") return;
  evictionPruneScheduled = true;
  const run = () => {
    evictionPruneScheduled = false;
    const ids = evictedEntryIds;
    evictedEntryIds = [];
    if (!ids.length) return;
    try {
      for (const id of ids) {
        unpersisted.delete(id);
        window.localStorage.removeItem(taskOutboxEntryStorageKey(id));
      }
    } catch {
      /* storage unavailable — the index prune on the next write still wins */
    }
  };
  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else Promise.resolve().then(run);
}

function readRaw(): TaskOutboxEntry[] {
  if (!isBrowser()) return EMPTY_SERVER_SNAPSHOT;
  const raw = readIndexRaw();
  if (cache && raw === cacheIndexRaw) return cache;
  const index = parseIndex(raw);
  const extras = index.legacy && cache ? [...cache, ...unpersisted.values()] : [...unpersisted.values()];
  const loaded = loadStoredEntries(index);
  orphanIds = loaded.orphanIds;
  const merged = mergeByOperationId(loaded.entries, extras);
  const bounded = boundEntries(merged);
  const evicted = collectEvictedEntryIds(merged, bounded);
  releaseEvictedCredentials(merged, bounded);
  if (evicted.length > 0) {
    // A bounded list is re-anchored through the normal write path so the index
    // and the per-entry keys agree again. It is coalesced behind the cached
    // index so a read loop cannot turn into a write loop.
    evictedEntryIds = [...new Set([...evictedEntryIds, ...evicted])];
    scheduleEvictionPrune();
  }
  cache = bounded;
  cacheIndexRaw = raw;
  return cache;
}

// The credential for an evicted entry must die with it, or a tab that ages
// entries out would keep PINs in memory forever.
function releaseEvictedCredentials(merged: TaskOutboxEntry[], bounded: TaskOutboxEntry[]): void {
  if (merged.length === bounded.length) return;
  const kept = new Set(bounded.map((entry) => entry.operationId));
  for (const entry of merged) {
    if (!kept.has(entry.operationId)) forgetTaskCommandCredential(entry.operationId);
  }
}

/**
 * A READ must not write SYNCHRONOUSLY. The evicted per-entry keys are therefore
 * not removed inline; the ids are collected here and the removal is DEFERRED to
 * a microtask (see scheduleEvictionPrune), coalesced behind the cached index so
 * a read loop cannot turn into a write loop. The next real mutation also drops
 * them, because commitEntries diffs against the bounded list — so the deferred
 * prune is a promptness fix, not a correctness one.
 */
function collectEvictedEntryIds(
  merged: TaskOutboxEntry[],
  bounded: TaskOutboxEntry[],
): string[] {
  if (merged.length === bounded.length) return [];
  const kept = new Set(bounded.map((entry) => entry.operationId));
  return merged.filter((entry) => !kept.has(entry.operationId)).map((entry) => entry.operationId);
}

function migrateLegacyIndex(): void {
  if (!isBrowser()) return;
  let parsed: unknown = null;
  try {
    const raw = readIndexRaw();
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const value of parsed) {
    const entry = parseEntry(value);
    if (!entry) continue;
    try {
      window.localStorage.setItem(taskOutboxEntryStorageKey(entry.operationId), JSON.stringify(entry));
      unpersisted.delete(entry.operationId);
    } catch {
      unpersisted.set(entry.operationId, entry);
    }
  }
}

function rememberUnpersisted(entries: TaskOutboxEntry[]): void {
  for (const entry of entries) unpersisted.set(entry.operationId, entry);
}

function sameStoredShape(left: TaskOutboxEntry, right: TaskOutboxEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commitEntries(next: TaskOutboxEntry[], previous: TaskOutboxEntry[]): boolean {
  const previousById = new Map(previous.map((entry) => [entry.operationId, entry]));
  const previousIds = new Set(previousById.keys());
  const nextIds = new Set(next.map((entry) => entry.operationId));
  try {
    for (const entry of next) {
      const before = previousById.get(entry.operationId);
      if (before && sameStoredShape(before, entry)) continue;
      window.localStorage.setItem(taskOutboxEntryStorageKey(entry.operationId), JSON.stringify(entry));
      unpersisted.delete(entry.operationId);
    }
    for (const id of previousIds) {
      if (!nextIds.has(id)) window.localStorage.removeItem(taskOutboxEntryStorageKey(id));
    }
    const removed = [...previousIds].filter((id) => !nextIds.has(id));
    const fresh = parseIndex(readIndexRaw());
    const pruned = fresh.ids.filter(
      (id) => nextIds.has(id) || (readStoredEntry(id) !== null && !removed.includes(id)),
    );
    orphanIds = [];
    window.localStorage.setItem(
      TASK_OUTBOX_STORAGE_KEY,
      JSON.stringify({ rev: fresh.rev + 1, ids: [...new Set([...pruned, ...nextIds])] }),
    );
  } catch {
    warnTaskOutboxStorageFailure();
    cache = next;
    cacheIndexRaw = null;
    rememberUnpersisted(next);
    return false;
  }
  cache = next;
  cacheIndexRaw = null;
  return true;
}

function writeSurvived(next: TaskOutboxEntry[]): boolean {
  const stored = parseIndex(readIndexRaw());
  const storedIds = new Set(stored.ids);
  return next.every((entry) => storedIds.has(entry.operationId) && readStoredEntry(entry.operationId));
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      continue;
    }
  }
}

function mutateOutbox(reducer: (fresh: TaskOutboxEntry[]) => TaskOutboxEntry[]): TaskOutboxEntry[] {
  if (!isBrowser()) return EMPTY_SERVER_SNAPSHOT;
  migrateLegacyIndex();
  let next: TaskOutboxEntry[] = cache ?? EMPTY_SERVER_SNAPSHOT;
  let previous: TaskOutboxEntry[] = cache ?? EMPTY_SERVER_SNAPSHOT;
  for (let attempt = 0; attempt < TASK_OUTBOX_STORAGE_WRITE_ATTEMPTS; attempt += 1) {
    previous = readRaw();
    next = boundEntries(reducer(previous));
    if (!commitEntries(next, previous)) {
      notify();
      return cache ?? next;
    }
    if (writeSurvived(next)) {
      cacheIndexRaw = null;
      notify();
      return readRaw();
    }
  }
  cache = next;
  cacheIndexRaw = null;
  rememberUnpersisted(next);
  notify();
  return next;
}

// Acknowledgment events live here, next to the code that raises them, so a
// caller can observe "operation X landed" without mounting the React hook.
export interface TaskOutboxAcknowledgedEvent {
  operationId?: string;
}

// A separate signal from the acknowledgment: the canonical STORES were just
// rewritten (an acknowledgment, or a refusal that carried the authoritative
// catalog). A rendered list must re-read on this — a 409 that repaired the
// cache never acknowledges the operation, so listening only for the
// acknowledgment would leave the screen stale until the next pull.
const adoptionListeners = new Set<() => void>();

export function onTaskOutboxAdopted(listener: () => void): () => void {
  adoptionListeners.add(listener);
  return () => {
    adoptionListeners.delete(listener);
  };
}

function notifyAdopted(): void {
  for (const listener of [...adoptionListeners]) {
    try {
      listener();
    } catch {
      continue;
    }
  }
}

const acknowledgmentListeners = new Set<(event: TaskOutboxAcknowledgedEvent) => void>();

export function onTaskOutboxAcknowledged(
  listener: (event: TaskOutboxAcknowledgedEvent) => void,
): () => void {
  acknowledgmentListeners.add(listener);
  return () => {
    acknowledgmentListeners.delete(listener);
  };
}

function notifyAcknowledged(event: TaskOutboxAcknowledgedEvent): void {
  for (const listener of [...acknowledgmentListeners]) {
    try {
      listener(event);
    } catch {
      continue;
    }
  }
}

const listeners = new Set<() => void>();
let storageAttached = false;

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== TASK_OUTBOX_STORAGE_KEY && !isEntryKey(event.key)) {
    return;
  }
  if (event.storageArea && isBrowser() && event.storageArea !== window.localStorage) return;
  cache = null;
  cacheIndexRaw = null;
  notify();
}

export function subscribeTaskOutbox(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageAttached && isBrowser()) {
    storageAttached = true;
    window.addEventListener("storage", onStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageAttached) {
      storageAttached = false;
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}

export function listTaskOutbox(): TaskOutboxEntry[] {
  return readRaw();
}

export function getTaskOutboxSnapshot(): TaskOutboxEntry[] {
  return readRaw();
}

export function getTaskOutboxServerSnapshot(): TaskOutboxEntry[] {
  return EMPTY_SERVER_SNAPSHOT;
}

export function createTaskOperationId(): string {
  const time = Date.now().toString(36);
  let random = "";
  if (typeof globalThis.crypto?.randomUUID === "function") {
    random = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } else {
    random = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  }
  return `task-op-${time}-${random}`.slice(0, 200);
}

const ephemeralCredentials = new Map<string, TaskOutboxCredential>();

function normalizeCredentialBundle(value: TaskOutboxCredential | undefined): TaskOutboxCredential | null {
  if (!value || typeof value !== "object") return null;
  const pin = typeof value.pin === "string" && value.pin.trim() ? value.pin.trim() : "";
  const parentPin =
    typeof value.parentPin === "string" && value.parentPin.trim() ? value.parentPin.trim() : "";
  if (!pin && !parentPin) return null;
  return { ...(pin ? { pin } : {}), ...(parentPin ? { parentPin } : {}) };
}

export function rememberTaskCommandCredential(
  operationId: string,
  credential?: TaskOutboxCredential,
): TaskOutboxCredential | undefined {
  const normalized = normalizeCredentialBundle(credential);
  if (!normalized) {
    ephemeralCredentials.delete(operationId);
    return undefined;
  }
  ephemeralCredentials.set(operationId, normalized);
  return normalized;
}

export function readTaskCommandCredential(
  operationId: string,
): TaskOutboxCredential | undefined {
  return ephemeralCredentials.get(operationId);
}

export function forgetTaskCommandCredential(operationId: string): boolean {
  return ephemeralCredentials.delete(operationId);
}

export function listTaskCommandCredentialIds(): string[] {
  return [...ephemeralCredentials.keys()];
}

export function resolveTaskOutboxCredential(
  entry: Pick<TaskOutboxEntry, "operationId">,
): TaskOutboxCredential | undefined {
  return ephemeralCredentials.get(entry.operationId);
}

export function __resetTaskCommandCredentialsForTests(): void {
  ephemeralCredentials.clear();
}

export function enqueueTaskOperation(
  input: Omit<TaskOutboxEntry, "version" | "createdAt" | "attemptCount" | "status">,
): TaskOutboxEntry {
  const action = String(input.action ?? "").trim();
  if (!isSupportedTaskOperation(input.route, action)) {
    throw new TypeError(`unsupported_task_operation:${String(input.route)}:${action}`);
  }
  const operationId = normalizeOperationId(input.operationId) ?? createTaskOperationId();
  const entry: TaskOutboxEntry = {
    version: 1,
    operationId,
    route: input.route,
    action,
    payload: sanitizeTaskOperationPayload(input.route, action, input.payload),
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: "queued",
    displayTarget: sanitizeDisplayTarget(input.displayTarget),
    ...(input.lastErrorCategory ? { lastErrorCategory: input.lastErrorCategory } : {}),
    ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
  };
  mutateOutbox((current) => [
    ...current.filter((candidate) => candidate.operationId !== operationId),
    entry,
  ]);
  return entry;
}

export function removeTaskOutboxEntry(operationId: string): boolean {
  let removed = false;
  mutateOutbox((fresh) => {
    removed = fresh.some((entry) => entry.operationId === operationId);
    return fresh.filter((entry) => entry.operationId !== operationId);
  });
  return removed;
}

export function cancelTaskOutboxEntry(operationId: string): boolean {
  const entry = readRaw().find((candidate) => candidate.operationId === operationId);
  if (!entry) return false;
  if (entry.status === "reconciling") return false;
  const removed = removeTaskOutboxEntry(operationId);
  if (removed) {
    forgetTaskCommandCredential(operationId);
    notifyAcknowledged({ operationId });
  }
  return removed;
}

function patchEntry(operationId: string, patch: Partial<TaskOutboxEntry>): TaskOutboxEntry | null {
  let updated: TaskOutboxEntry | null = null;
  mutateOutbox((fresh) =>
    fresh.map((entry) => {
      if (entry.operationId !== operationId) return entry;
      updated = { ...entry, ...patch };
      return updated;
    }),
  );
  return updated;
}

export function taskOutboxBackoffMs(attemptCount: number): number {
  return cappedLadder(TASK_OUTBOX_BASE_BACKOFF_MS, TASK_OUTBOX_MAX_BACKOFF_MS, attemptCount);
}

export function taskOutboxAuthBackoffMs(authAttemptCount: number): number {
  return cappedLadder(
    TASK_OUTBOX_BASE_BACKOFF_MS,
    TASK_OUTBOX_MAX_AUTH_BACKOFF_MS,
    authAttemptCount,
  );
}

export function taskOutboxReconcileBackoffMs(reconcileAttemptCount: number): number {
  return cappedLadder(
    TASK_OUTBOX_BASE_BACKOFF_MS,
    TASK_OUTBOX_MAX_RECONCILE_BACKOFF_MS,
    reconcileAttemptCount,
  );
}

function reasonOf(body: TaskOutboxAcknowledgement): string {
  const raw = body.reason ?? body.error ?? body.code;
  return typeof raw === "string" ? raw.trim() : "";
}

const MAX_SERVER_MESSAGE_CHARS = 240;

function serverMessageOf(body: TaskOutboxAcknowledgement): string {
  const raw = body.error;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > MAX_SERVER_MESSAGE_CHARS
    ? trimmed.slice(0, MAX_SERVER_MESSAGE_CHARS)
    : trimmed;
}

function refusalReason(body: TaskOutboxAcknowledgement, fallback: string): string {
  return serverMessageOf(body) || reasonOf(body) || fallback;
}

function requiresCredential(entry: TaskOutboxEntry): boolean {
  return CREDENTIAL_REQUIRED_ACTIONS[entry.route]?.has(entry.action) ?? false;
}

function markRetryable(
  entry: TaskOutboxEntry,
  category: TaskOutboxErrorCategory,
  reason: string,
): FlushTaskOutboxResult {
  const attemptCount = entry.attemptCount + 1;
  if (attemptCount >= TASK_OUTBOX_MAX_ATTEMPTS) return markFailed(entry, category, reason);
  patchEntry(entry.operationId, {
    attemptCount,
    status: "retrying",
    lastErrorCategory: category,
    lastErrorReason: reason,
    authAttemptCount: 0,
    reconcileAttemptCount: 0,
    nextAttemptAt: new Date(Date.now() + taskOutboxBackoffMs(attemptCount)).toISOString(),
  });
  return RETAINED;
}

function markFailed(
  entry: TaskOutboxEntry,
  category: TaskOutboxErrorCategory,
  reason: string,
): FlushTaskOutboxResult {
  patchEntry(entry.operationId, {
    status: "failed",
    lastErrorCategory: category,
    lastErrorReason: reason,
    nextAttemptAt: undefined,
  });
  return { acknowledged: 0, retryable: 0, permanent: 1 };
}

function markAuthRequired(
  entry: TaskOutboxEntry,
  reason: string,
  deferred: boolean,
): FlushTaskOutboxResult {
  if (!deferred) {
    patchEntry(entry.operationId, {
      status: "auth-required",
      lastErrorCategory: "unauthorized",
      lastErrorReason: reason,
      nextAttemptAt: undefined,
    });
    return RETAINED;
  }
  const authAttemptCount = (entry.authAttemptCount ?? 0) + 1;
  patchEntry(entry.operationId, {
    status: "auth-required",
    lastErrorCategory: "unauthorized",
    lastErrorReason: reason,
    authAttemptCount,
    nextAttemptAt: new Date(Date.now() + taskOutboxAuthBackoffMs(authAttemptCount)).toISOString(),
  });
  return RETAINED;
}

function markReconciling(entry: TaskOutboxEntry, reason: string): FlushTaskOutboxResult {
  const reconcileAttemptCount = (entry.reconcileAttemptCount ?? 0) + 1;
  patchEntry(entry.operationId, {
    status: "reconciling",
    lastErrorCategory: "projection",
    lastErrorReason: reason,
    authAttemptCount: 0,
    reconcileAttemptCount,
    nextAttemptAt: new Date(
      Date.now() + taskOutboxReconcileBackoffMs(reconcileAttemptCount),
    ).toISOString(),
  });
  return RETAINED;
}

async function acknowledge(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
  options: FlushTaskOutboxOptions,
): Promise<FlushTaskOutboxResult> {
  if (!options.onAcknowledged) return markReconciling(entry, "adoption_unavailable");
  try {
    await options.onAcknowledged(body);
  } catch {
    return markRetryable(entry, "projection", "adoption_failed");
  }
  notifyAdopted();
  // Release the credential BEFORE announcing the landing, and before the
  // entry is observable as gone: a reader that sees an empty outbox must
  // never still be holding a PIN.
  try {
    options.releaseCredential?.(entry.operationId);
  } catch {
    /* the credential registry is best-effort cleanup */
  }
  forgetTaskCommandCredential(entry.operationId);
  removeTaskOutboxEntry(entry.operationId);
  notifyAcknowledged({ operationId: entry.operationId });
  return { acknowledged: 1, retryable: 0, permanent: 0 };
}

async function classifyConflict(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
): Promise<FlushTaskOutboxResult> {
  const reason = reasonOf(body);
  if (body.retryable === true || RETRYABLE_REASONS.has(reason)) {
    return markRetryable(entry, "server", reason || "retryable_conflict");
  }
  if (PERMANENT_REASONS.has(reason)) {
    // A refused config write still carries the AUTHORITATIVE catalog. Adopt it
    // BEFORE marking the entry failed, so the list on screen repairs itself at
    // the moment of the refusal rather than 60s later on the next pull.
    if (reason === "stale_config") {
      try {
        await adoptTaskOutboxAcknowledgement(body);
        notifyAdopted();
      } catch {
        /* the retained entry is the honest signal; adoption is best effort */
      }
    }
    return markFailed(entry, "validation", reason);
  }
  if (body.semanticDuplicate === true || DUPLICATE_REASONS.has(reason)) {
    return markFailed(entry, "semantic-duplicate", reason || "semantic_duplicate");
  }
  return markFailed(entry, "validation", refusalReason(body, "operation_conflict"));
}

function classifyFailure(
  entry: TaskOutboxEntry,
  status: number,
  body: TaskOutboxAcknowledgement,
): FlushTaskOutboxResult {
  const reason = reasonOf(body);
  if (status === 401) return markAuthRequired(entry, reason || "unauthorized", true);
  if (status === 403) return markFailed(entry, "unauthorized", reason || "adult_only");
  if (body.retryable === true || RETRYABLE_REASONS.has(reason)) {
    return markRetryable(entry, "server", reason || `http_${status}`);
  }
  if (status >= 500 || status === 408 || status === 425 || status === 429) {
    return markRetryable(entry, "server", reason || `http_${status}`);
  }
  return markFailed(entry, "validation", refusalReason(body, `http_${status}`));
}

interface SnapshotView {
  hasTasks: boolean;
  tasks: Record<string, unknown>[];
  history: Record<string, unknown>[];
  receipts: Record<string, SnapshotOperationReceipt[]>;
  configReceipts: Record<string, SnapshotConfigOperationReceipt>;
  legs: Record<string, unknown>;
}

function snapshotView(read: SnapshotRead | null | undefined): SnapshotView | null {
  const data = read?.snapshot;
  if (!isRecord(data)) return null;
  const hasTasks = Array.isArray(data.tasks);
  const deleted = new Set(
    (Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds : []).map((value) => Number(value)),
  );
  const tasks = hasTasks
    ? ((data.tasks as unknown[]).filter(
        (task) => isRecord(task) && !deleted.has(Number((task as Record<string, unknown>).id)),
      ) as Record<string, unknown>[])
    : [];
  const weekData = isRecord(read?.weekData)
    ? read.weekData
    : isRecord(data.weekData)
      ? data.weekData
      : null;
  const receipts = isRecord(read?.operationReceipts)
    ? (read.operationReceipts as Record<string, SnapshotOperationReceipt[]>)
    : isRecord(data.operationReceipts)
      ? (data.operationReceipts as Record<string, SnapshotOperationReceipt[]>)
      : {};
  const configReceipts = isRecord(read?.configOperationReceipts)
    ? (read.configOperationReceipts as Record<string, SnapshotConfigOperationReceipt>)
    : isRecord(data.configOperationReceipts)
      ? (data.configOperationReceipts as Record<string, SnapshotConfigOperationReceipt>)
      : {};
  return {
    hasTasks,
    tasks,
    history: Array.isArray(weekData?.history)
      ? (weekData.history as Record<string, unknown>[])
      : [],
    receipts,
    configReceipts,
    legs: data,
  };
}

function findTask(view: SnapshotView, taskId: unknown): Record<string, unknown> | null {
  const id = Number(taskId);
  if (!Number.isSafeInteger(id)) return null;
  return view.tasks.find((task) => Number(task.id) === id) ?? null;
}

function crewMembers(task: Record<string, unknown>): Record<string, unknown>[] {
  const crew = task.crew;
  if (!isRecord(crew) || !Array.isArray(crew.members)) return [];
  return crew.members.filter(isRecord);
}

function crewRemoved(task: Record<string, unknown>): string[] {
  const crew = task.crew;
  if (!isRecord(crew) || !Array.isArray(crew.removed)) return [];
  return crew.removed.filter((name): name is string => typeof name === "string");
}

function sameName(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  return Boolean(a) && a === b;
}

function sameField(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || left === undefined || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (typeof left === "boolean" || typeof right === "boolean") return Boolean(left) === Boolean(right);
  if (typeof left === "string" && typeof right === "string") {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }
  return false;
}

function hasExactEarnLine(
  view: SnapshotView,
  taskId: unknown,
  memberName: unknown,
): boolean {
  const id = Number(taskId);
  const member = typeof memberName === "string" ? memberName : "";
  return view.history.some(
    (transaction) =>
      isRecord(transaction) &&
      transaction.type === "earn" &&
      Number(transaction.taskId) === id &&
      (!member || sameName(transaction.member, member)),
  );
}

function receiptsFor(view: SnapshotView, operationId: string): SnapshotOperationReceipt[] {
  const stored = view.receipts[operationId];
  return Array.isArray(stored) ? stored.filter(isRecord) : [];
}

function receiptProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  // A ledger command writes NO task receipt, so the ledger proof below is its
  // only path. Saying so here keeps the two proofs from ever disagreeing.
  if (entry.route === "/api/tasks/ledger" || entry.route === "/api/rewards/redeem") {
    return false;
  }
  if (entry.route === "/api/tasks/config") {
    const receipt = view.configReceipts[entry.operationId];
    if (!isRecord(receipt)) return false;
    return receipt.action === entry.action && receipt.kind === entry.payload.kind;
  }
  const receipts = receiptsFor(view, entry.operationId).filter(
    (receipt) => receipt.action === entry.action,
  );
  if (!receipts.length) return false;
  if (entry.route === "/api/tasks/manage" && entry.action === "add") {
    return receipts.some((receipt) => {
      const id = Number(receipt.taskId);
      return Number.isSafeInteger(id) && id > 0;
    });
  }
  const requested = Array.isArray(entry.payload.taskIds)
    ? entry.payload.taskIds.map(Number)
    : [Number(entry.payload.taskId)];
  if (!requested.every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  const perTask = new Map<number, SnapshotOperationReceipt>();
  for (const receipt of receipts) perTask.set(Number(receipt.taskId), receipt);
  if (!requested.every((id) => perTask.has(id))) return false;
  if (entry.action === "delete") {
    return requested.every((id) => perTask.get(id)?.deleted === true);
  }
  return true;
}

function approveProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  if (entry.action !== "send-back") return false;
  const task = findTask(view, entry.payload.taskId);
  if (!task || task.completed === true) return false;
  return typeof task.sentBackAt === "string" && task.sentBackAt.trim().length > 0;
}

function claimProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  const task = findTask(view, entry.payload.taskId);
  if (!task) return false;
  const memberName = entry.payload.memberName;
  const crew = crewMembers(task);
  const removed = crewRemoved(task);

  if (entry.action === "crew-join") {
    return crew.some((member) => sameName(member.name, memberName));
  }
  if (entry.action === "crew-checkin") {
    return crew.some(
      (member) =>
        sameName(member.name, memberName) &&
        typeof member.checkedInAt === "string" &&
        member.checkedInAt.trim().length > 0,
    );
  }
  if (entry.action === "crew-remove") {
    const target = entry.payload.targetName ?? memberName;
    if (removed.some((name) => sameName(name, target))) return true;
    return !crew.some((member) => sameName(member.name, target));
  }
  if (entry.action === "undo") {
    return task.completed !== true && !isRecord(task.pendingApproval);
  }
  if (task.completed !== true) return false;
  if (isRecord(task.pendingApproval)) return true;
  if (hasExactEarnLine(view, task.id, memberName)) return true;
  return Boolean(memberName) && sameName(task.completedBy, memberName);
}

function manageAddProvesResolved(
  entry: TaskOutboxEntry,
  acknowledgement: TaskOutboxAcknowledgement | undefined,
): boolean {
  const expected = entry.payload.task;
  const authoritative = isRecord(acknowledgement?.task) ? acknowledgement.task : null;
  if (!isRecord(expected) || !authoritative) return false;
  const id = Number(authoritative.id);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const temporaryId = Number(entry.displayTarget.temporaryId ?? 0);
  if (Number.isSafeInteger(temporaryId) && temporaryId > 0 && id === temporaryId) return false;
  return MANAGE_ADD_TASK_KEYS.every(
    (key) => !hasOwn(expected, key) || sameField(authoritative[key], expected[key]),
  );
}

function manageProvesResolved(
  entry: TaskOutboxEntry,
  view: SnapshotView,
  acknowledgement: TaskOutboxAcknowledgement | undefined,
): boolean {
  if (entry.action === "delete") {
    return findTask(view, entry.payload.taskId) === null;
  }
  if (entry.action === "add") {
    return manageAddProvesResolved(entry, acknowledgement);
  }
  const row = findTask(view, entry.payload.taskId);
  if (!row) return false;
  const patch = entry.payload.patch;
  if (!isRecord(patch)) return false;
  const fields = Object.keys(patch);
  if (!fields.length) return false;
  return fields.every((field) => sameField(row[field], patch[field]));
}

function configItemMatches(
  candidate: unknown,
  expected: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  if (!isRecord(candidate)) return false;
  return keys.every((key) => !hasOwn(expected, key) || sameField(candidate[key], expected[key]));
}

function configProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  const kind = String(entry.payload.kind ?? "");
  const leg = CONFIG_KIND_LEGS[kind];
  if (!leg) return false;
  const items = view.legs[leg.items];
  const stamp = view.legs[leg.stamp];
  if (!Array.isArray(items) || typeof stamp !== "string" || typeof entry.payload.updatedAt !== "string") {
    return false;
  }
  if (stamp < entry.payload.updatedAt) return false;
  const keys = configItemKeysFor(kind) ?? [];

  if (entry.action === "replace") {
    const expected = entry.payload.items;
    if (!Array.isArray(expected) || expected.length !== items.length) return false;
    return expected.every((item) =>
      items.some((candidate) => configItemMatches(candidate, item as Record<string, unknown>, keys)),
    );
  }
  if (entry.action === "upsert") {
    const item = entry.payload.item;
    if (!isRecord(item)) return false;
    return items.some((candidate) => configItemMatches(candidate, item, keys));
  }
  if (entry.action === "delete") {
    const itemId = entry.payload.itemId;
    if (itemId === undefined) return false;
    return !items.some((candidate) => configItemMatches(candidate, { id: itemId }, keys));
  }
  return false;
}

/**
 * A ledger command (`penalty` / `adjust`, and a reward redemption) has no task
 * row, so its ONLY proof is the canonical ledger: the pulled weekData history
 * must carry a transaction whose `meta.operationId` IS this entry's operation
 * id AND whose source, member, type and amount match what the command asked
 * for. A balance change alone proves nothing — another device could have moved
 * it — and without this proof an unreconciled 202/409 would sit in the outbox
 * re-proving itself forever.
 */
function ledgerProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  const expectedSource = entry.route === "/api/tasks/ledger"
    ? entry.action === "penalty" ? "task-penalty" : "manual-adjust"
    : REDEEM_LEDGER_SOURCE;
  if (!expectedSource) return false;
  const member = entry.payload.memberName;
  if (typeof member !== "string" || !member) return false;
  const expectedType = LEDGER_ACTION_TYPES[entry.action];
  if (!expectedType) return false;

  // Only an `adjust` carries a client-known amount to check against; a
  // penalty's amount is the catalog's and a redemption's is the stored
  // reward's, so neither can be proven from the command body alone.
  const amount = entry.action === "adjust" && typeof entry.payload.amount === "number"
    ? entry.payload.amount
    : undefined;
  if (amount === undefined) return false;

  return view.history.some((transaction) => {
    const meta = isRecord(transaction.meta) ? transaction.meta : null;
    if (!meta || meta.operationId !== entry.operationId) return false;
    if (meta.source !== expectedSource) return false;
    if (transaction.member !== member) return false;
    if (transaction.type !== expectedType) return false;
    return transaction.amount === amount;
  });
}

export function snapshotProvesResolved(
  entry: TaskOutboxEntry,
  read: SnapshotRead | null | undefined,
  acknowledgement?: TaskOutboxAcknowledgement,
): boolean {
  const view = snapshotView(read);
  if (!view) return false;
  if (receiptProvesResolved(entry, view)) return true;
  if (entry.route === "/api/tasks/config") return configProvesResolved(entry, view);
  if (entry.route === "/api/tasks/ledger" || entry.route === "/api/rewards/redeem") {
    return ledgerProvesResolved(entry, view);
  }
  if (!view.hasTasks) return false;
  if (entry.route === "/api/tasks/approve") return approveProvesResolved(entry, view);
  if (entry.route === "/api/tasks/claim") return claimProvesResolved(entry, view);
  if (entry.route === "/api/tasks/manage") {
    return manageProvesResolved(entry, view, acknowledgement);
  }
  return false;
}

function normalizeCredential(
  route: string,
  value: TaskOutboxCredential | string | undefined,
): TaskOutboxCredential {
  const source: TaskOutboxCredential =
    typeof value === "string" ? { pin: value } : (value ?? {});
  const allowed = CREDENTIAL_BODY_KEYS[route] ?? [];
  const normalized: TaskOutboxCredential = {};
  for (const key of allowed) {
    const candidate = source[key];
    if (typeof candidate === "string" && candidate.trim()) normalized[key] = candidate.trim();
  }
  return normalized;
}

export function buildTaskOperationRequestBody(
  entry: TaskOutboxEntry,
  credential?: TaskOutboxCredential | string,
): Record<string, unknown> {
  const resolved = normalizeCredential(entry.route, credential);
  return {
    ...entry.payload,
    action: entry.action,
    operationId: entry.operationId,
    ...resolved,
  };
}

export async function sendTaskOperationRequest(
  entry: TaskOutboxEntry,
  credential?: TaskOutboxCredential | string,
  requestTimeoutMs: number = TASK_OUTBOX_REQUEST_TIMEOUT_MS,
): Promise<TaskOutboxSendResult> {
  const response = await fetch(entry.route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTaskOperationRequestBody(entry, credential)),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: { operationId: entry.operationId, ...(isRecord(body) ? body : {}) } as TaskOutboxAcknowledgement,
  };
}

export async function pullTaskSnapshotDocument(
  requestTimeoutMs: number = TASK_OUTBOX_REQUEST_TIMEOUT_MS,
): Promise<SnapshotRead> {
  const response = await fetch("/api/tasks/sync", {
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`tasks_sync_${response.status}`);
  const body = await response.json().catch(() => ({}));
  const record = isRecord(body) ? body : {};
  const snapshot = isRecord(record.snapshot) ? (record.snapshot as SnapshotData) : null;
  const weekData = isRecord(snapshot?.weekData)
    ? (snapshot.weekData as unknown as WeekData)
    : undefined;
  const operationReceipts = isRecord(snapshot?.operationReceipts)
    ? (snapshot.operationReceipts as Record<string, SnapshotOperationReceipt[]>)
    : undefined;
  const configOperationReceipts = isRecord(snapshot?.configOperationReceipts)
    ? (snapshot.configOperationReceipts as Record<string, SnapshotConfigOperationReceipt>)
    : undefined;
  return {
    snapshot,
    reconciled: record.reconciled === true,
    ...(weekData ? { weekData } : {}),
    ...(operationReceipts ? { operationReceipts } : {}),
    ...(configOperationReceipts ? { configOperationReceipts } : {}),
  };
}

export async function adoptTaskOutboxSnapshot(read: SnapshotRead): Promise<void> {
  if (!read.snapshot) return;
  const stores = await import("@/lib/task-utils");
  stores.applyTasksSnapshotToStores(read.snapshot);
}

/**
 * A config acknowledgment is the catalog: adopt its items into the matching
 * local cache (with the stamp it carries) BEFORE the entry is removed, so the
 * list a parent sees is always the one the server accepted — and a stale 409,
 * which carries the same authoritative body, still repairs this device.
 */
async function adoptConfigAcknowledgement(acknowledgement: TaskOutboxAcknowledgement): Promise<void> {
  const kind = typeof acknowledgement.kind === "string" ? acknowledgement.kind : "";
  const items = Array.isArray(acknowledgement.items) ? acknowledgement.items : null;
  if (!items || (kind !== "rewards" && kind !== "penalties" && kind !== "weekly-prizes")) return;
  const updatedAt = typeof acknowledgement.updatedAt === "string" ? acknowledgement.updatedAt : "";
  const stores = await import("@/lib/task-utils");
  if (kind === "rewards") {
    stores.saveRewards(items);
    if (updatedAt) stores.writeRewardsStamp(updatedAt);
    return;
  }
  if (kind === "penalties") {
    stores.savePenalties(items);
    if (updatedAt) stores.writePenaltiesStamp(updatedAt);
    return;
  }
  stores.saveWeeklyPrizes(items as never);
  if (updatedAt) stores.writeWeeklyPrizesStamp(updatedAt);
}

export async function adoptTaskOutboxAcknowledgement(
  acknowledgement: TaskOutboxAcknowledgement,
): Promise<void> {
  await adoptConfigAcknowledgement(acknowledgement);
  if (!acknowledgement.task && !acknowledgement.weekData) return;
  const stores = await import("@/lib/task-utils");
  if (acknowledgement.task) {
    const merged = stores.mergeTasksSnapshot(stores.loadTasks(), stores.loadWeekData(), {
      tasks: [acknowledgement.task],
    });
    if (merged.tasksChanged) stores.saveTasks(merged.tasks);
    if (merged.weekChanged) stores.saveWeekData(merged.weekData);
  }
  if (acknowledgement.weekData) {
    stores.saveWeekData(
      stores.adoptAuthoritativeWeekData(stores.loadWeekData(), acknowledgement.weekData),
    );
  }
}

export function createFetchTaskOutboxDriver(
  overrides: TaskOutboxFetchDriverOptions = {},
): TaskOutboxDriver {
  const requestTimeoutMs = overrides.requestTimeoutMs ?? TASK_OUTBOX_REQUEST_TIMEOUT_MS;
  return {
    send:
      overrides.send ??
      ((entry, credential) => sendTaskOperationRequest(entry, credential, requestTimeoutMs)),
    getCredential: overrides.getCredential ?? resolveTaskOutboxCredential,
    releaseCredential: overrides.releaseCredential ?? forgetTaskCommandCredential,
    pullSnapshot: overrides.pullSnapshot ?? (() => pullTaskSnapshotDocument(requestTimeoutMs)),
    adoptSnapshot: overrides.adoptSnapshot ?? adoptTaskOutboxSnapshot,
    onAcknowledged: overrides.onAcknowledged ?? adoptTaskOutboxAcknowledgement,
  };
}

const driverStack: TaskOutboxDriver[] = [];
let fallbackDriver: TaskOutboxDriver | null = null;

export function registerTaskOutboxDriver(driver: Partial<TaskOutboxDriver>): () => void {
  const resolved = createFetchTaskOutboxDriver(driver);
  driverStack.push(resolved);
  return () => {
    const index = driverStack.indexOf(resolved);
    if (index >= 0) driverStack.splice(index, 1);
  };
}

export function getTaskOutboxDriver(): TaskOutboxDriver {
  const top = driverStack[driverStack.length - 1];
  if (top) return top;
  fallbackDriver ??= createFetchTaskOutboxDriver();
  return fallbackDriver;
}

export function warnTaskOutboxFlushFailure(error: unknown): void {
  if (typeof console === "undefined") return;
  const name = error instanceof Error && error.name ? error.name : "unknown";
  console.warn("[task-outbox] flush failed", name);
}

export function warnTaskOutboxRefreshFailure(error: unknown): void {
  if (typeof console === "undefined") return;
  const name = error instanceof Error && error.name ? error.name : "unknown";
  console.warn("[task-outbox] cache refresh failed", name);
}

export function warnTaskOutboxStorageFailure(): void {
  if (typeof console === "undefined") return;
  console.warn("[task-outbox] storage write degraded to memory only");
}

export function taskOutboxOrphanStorageIds(): string[] {
  return [...orphanIds];
}

type SnapshotProof =
  | { kind: "proven"; acknowledgement: TaskOutboxAcknowledgement }
  | { kind: "blocked" }
  | { kind: "unmatched" };

async function resolveSnapshotProof(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
  options: FlushTaskOutboxOptions,
): Promise<SnapshotProof> {
  if (!options.pullSnapshot || !options.adoptSnapshot) return { kind: "blocked" };
  let read: SnapshotRead;
  try {
    read = await options.pullSnapshot();
  } catch {
    return { kind: "blocked" };
  }
  if (read.reconciled === false) return { kind: "blocked" };
  try {
    await options.adoptSnapshot(read);
  } catch {
    return { kind: "blocked" };
  }
  if (!snapshotProvesResolved(entry, read, body)) return { kind: "unmatched" };
  return { kind: "proven", acknowledgement: { ...body, reconciled: true } };
}

function acknowledgedInFull(
  entry: TaskOutboxEntry,
  status: number,
  body: TaskOutboxAcknowledgement,
): boolean {
  if (status === 200) return body.reconciled !== false;
  if (status !== 202) return false;
  return entry.route === "/api/rewards/redeem" && isRecord(body.weekData);
}

async function processEntry(
  entry: TaskOutboxEntry,
  options: FlushTaskOutboxOptions,
): Promise<FlushTaskOutboxResult> {
  let rawCredential: TaskOutboxCredential | string | undefined;
  try {
    rawCredential = options.getCredential?.(entry);
  } catch {
    return markRetryable(entry, "network", "credential_resolver_failed");
  }
  const credential = normalizeCredential(entry.route, rawCredential);
  if (requiresCredential(entry) && !credential.pin) {
    return markAuthRequired(entry, "credential_missing", false);
  }

  let status = 0;
  let body: TaskOutboxAcknowledgement = { operationId: entry.operationId };
  try {
    const response = await options.send(entry, credential);
    status = Number(response?.status ?? 0);
    if (isRecord(response?.body)) body = response.body as TaskOutboxAcknowledgement;
  } catch {
    return markRetryable(entry, "network", "send_failed");
  }

  try {
    if (acknowledgedInFull(entry, status, body)) {
      return await acknowledge(entry, body, options);
    }
    if (status === 200 || status === 202 || status === 409) {
      const proof = await resolveSnapshotProof(entry, body, options);
      if (proof.kind === "proven") return await acknowledge(entry, proof.acknowledgement, options);
      if (proof.kind === "blocked") return markReconciling(entry, "projection_pending");
      if (status === 409) return await classifyConflict(entry, body);
      if (status === 200) return markRetryable(entry, "projection", "unreconciled_success");
      return markReconciling(entry, reasonOf(body) || "projection_pending");
    }
    return classifyFailure(entry, status, body);
  } catch {
    return markRetryable(entry, "network", "acknowledgement_failed");
  }
}

function mergeResults(
  target: FlushTaskOutboxResult,
  outcome: FlushTaskOutboxResult,
): void {
  target.acknowledged += outcome.acknowledged;
  target.retryable += outcome.retryable;
  target.permanent += outcome.permanent;
}

async function runFlush(options: FlushTaskOutboxOptions): Promise<FlushTaskOutboxResult> {
  const result: FlushTaskOutboxResult = { acknowledged: 0, retryable: 0, permanent: 0 };
  let entries: TaskOutboxEntry[] = [];
  try {
    entries = readRaw();
  } catch {
    return result;
  }
  for (const entry of entries) {
    try {
      if (entry.status === "failed") continue;
      if (
        entry.status === "auth-required" &&
        entry.lastErrorReason === "credential_missing" &&
        !options.getCredential?.(entry)
      ) {
        continue;
      }
      if (entry.nextAttemptAt) {
        const due = Date.parse(entry.nextAttemptAt);
        if (Number.isFinite(due) && Date.now() < due) continue;
      }
      let outcome: FlushTaskOutboxResult;
      try {
        outcome = await processEntry(entry, options);
      } catch {
        outcome = markRetryable(entry, "network", "entry_failed");
      }
      mergeResults(result, outcome);
    } catch {
      continue;
    }
  }
  return result;
}

export function flushTaskOutbox(
  options?: FlushTaskOutboxOptions,
): Promise<FlushTaskOutboxResult> {
  const driver = options ?? getTaskOutboxDriver();
  const existing = inFlightByDriver.get(driver);
  if (existing) return existing;
  const running = runFlush(driver);
  const shared = running.finally(() => {
    if (inFlightByDriver.get(driver) === shared) inFlightByDriver.delete(driver);
  });
  inFlightByDriver.set(driver, shared);
  return shared;
}

export function requestTaskOutboxFlush(): Promise<FlushTaskOutboxResult> {
  return flushTaskOutbox(getTaskOutboxDriver());
}

export function __resetTaskOutboxForTests(): void {
  cache = null;
  cacheIndexRaw = null;
  evictedEntryIds = [];
  evictionPruneScheduled = false;
  unpersisted = new Map<string, TaskOutboxEntry>();
  inFlightByDriver = new WeakMap<TaskOutboxDriver, Promise<FlushTaskOutboxResult>>();
  driverStack.length = 0;
  fallbackDriver = null;
  listeners.clear();
  acknowledgmentListeners.clear();
  adoptionListeners.clear();
}
