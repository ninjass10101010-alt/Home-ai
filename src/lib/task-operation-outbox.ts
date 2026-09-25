import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import type { SnapshotData, SnapshotRevision } from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";

/**
 * Durable client outbox for the four server-authoritative task write routes.
 *
 * Every task/config write is persisted BEFORE its first request, carries a
 * stable operation ID so a replayed request is idempotent on the server, and
 * is only removed once the authoritative state proves it landed. Entries are
 * credential-free: an ephemeral PIN is supplied by the caller at send time
 * (TaskOutboxDriver.getCredential) and never written to storage.
 */

export const TASK_OUTBOX_STORAGE_KEY = "consuela-task-operation-outbox-v1";
export const TASK_OUTBOX_MAX_ENTRIES = 50;
export const TASK_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TASK_OUTBOX_MAX_ATTEMPTS = 8;
export const TASK_OUTBOX_BASE_BACKOFF_MS = 2_000;
export const TASK_OUTBOX_MAX_BACKOFF_MS = 5 * 60_000;

export type TaskOperationRoute =
  | "/api/tasks/claim"
  | "/api/tasks/approve"
  | "/api/tasks/manage"
  | "/api/tasks/config";

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

export interface TaskOutboxEntry {
  version: 1;
  operationId: string;
  route: TaskOperationRoute;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attemptCount: number;
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
  reconciled: boolean;
  [key: string]: unknown;
}

export interface SnapshotRead {
  snapshot: SnapshotData | null;
  reconciled?: boolean;
  revision?: SnapshotRevision;
  weekData?: WeekData;
}

export type TaskOutboxSendResult = { status: number; body: TaskOutboxAcknowledgement };

export interface TaskOutboxDriver {
  send: (entry: TaskOutboxEntry, credential?: string) => Promise<TaskOutboxSendResult>;
  getCredential?: (entry: TaskOutboxEntry) => string | undefined;
  pullSnapshot?: () => Promise<SnapshotRead>;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
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

const CREDENTIAL_ACCEPTING_ROUTES = new Set<string>(["/api/tasks/claim", "/api/tasks/approve"]);

const CREDENTIAL_REQUIRED_ACTIONS: Record<string, Set<string>> = {
  "/api/tasks/approve": new Set(["approve", "approve-all", "send-back"]),
  "/api/tasks/claim": new Set(["claim", "undo", "crew-remove"]),
  "/api/tasks/manage": new Set(),
  "/api/tasks/config": new Set(),
};

const RETRYABLE_REASONS = new Set([
  "operation_conflict",
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

const DUPLICATE_REASONS = new Set([
  "semantic_duplicate",
  "already_completed",
  "already_claimed",
  "already_undone",
  "nothing_to_undo",
  "member_checked_in",
]);

const EMPTY_SERVER_SNAPSHOT: TaskOutboxEntry[] = Object.freeze<TaskOutboxEntry[]>([]) as TaskOutboxEntry[];

const configItemKeysFor = (kind: string): readonly string[] | undefined => CONFIG_ITEM_KEYS[kind];

function pickKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) picked[key] = value[key];
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
  if (!operationId || !ROUTES.has(route) || !action || !createdAt) return null;
  const status = STATUSES.has(String(value.status)) ? (value.status as TaskOutboxStatus) : "queued";
  const attemptCount = Math.max(
    0,
    Math.min(1_000, Math.floor(typeof value.attemptCount === "number" ? value.attemptCount : 0)),
  );
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
    .filter((entry) => createdMs(entry) >= floor)
    .sort((left, right) => createdMs(left) - createdMs(right));
  return kept.length > TASK_OUTBOX_MAX_ENTRIES
    ? kept.slice(kept.length - TASK_OUTBOX_MAX_ENTRIES)
    : kept;
}

let cache: TaskOutboxEntry[] | null = null;
let cacheRaw: string | null = null;
let cacheDirty = false;
let inFlight: Promise<FlushTaskOutboxResult> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRaw(): TaskOutboxEntry[] {
  if (!isBrowser()) return EMPTY_SERVER_SNAPSHOT;
  if (cache && cacheDirty) return cache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  } catch {
    return cache ?? EMPTY_SERVER_SNAPSHOT;
  }
  if (cache && !cacheDirty && raw === cacheRaw) return cache;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  const entries = boundEntries(
    (Array.isArray(parsed) ? parsed : []).map(parseEntry).filter((entry): entry is TaskOutboxEntry => Boolean(entry)),
  );
  cache = entries;
  cacheRaw = raw;
  cacheDirty = false;
  return entries;
}

function writeRaw(entries: TaskOutboxEntry[]): void {
  if (!isBrowser()) return;
  const bounded = boundEntries(entries);
  cache = bounded;
  cacheDirty = true;
  const serialized = JSON.stringify(bounded);
  try {
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, serialized);
    cacheRaw = serialized;
    cacheDirty = false;
  } catch {
    cacheRaw = null;
  }
  notify();
}

const listeners = new Set<() => void>();
let storageAttached = false;

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A throwing subscriber must never break an outbox write.
    }
  }
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== TASK_OUTBOX_STORAGE_KEY) return;
  cache = null;
  cacheRaw = null;
  cacheDirty = false;
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

export function __resetTaskOutboxForTests(): void {
  cache = null;
  cacheRaw = null;
  cacheDirty = false;
  inFlight = null;
  activeDriver = createFetchTaskOutboxDriver();
  listeners.clear();
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

export function enqueueTaskOperation(
  input: Omit<TaskOutboxEntry, "version" | "createdAt" | "attemptCount" | "status">,
): TaskOutboxEntry {
  const operationId = normalizeOperationId(input.operationId) ?? createTaskOperationId();
  const action = String(input.action ?? "").trim() || "unknown";
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
  const existing = readRaw().filter((candidate) => candidate.operationId !== operationId);
  writeRaw([...existing, entry]);
  return entry;
}

export function removeTaskOutboxEntry(operationId: string): boolean {
  const entries = readRaw();
  const remaining = entries.filter((entry) => entry.operationId !== operationId);
  if (remaining.length === entries.length) return false;
  writeRaw(remaining);
  return true;
}

export function cancelTaskOutboxEntry(operationId: string): boolean {
  const entry = readRaw().find((candidate) => candidate.operationId === operationId);
  if (!entry) return false;
  if (entry.status === "reconciling") return false;
  return removeTaskOutboxEntry(operationId);
}

function patchEntry(operationId: string, patch: Partial<TaskOutboxEntry>): TaskOutboxEntry | null {
  const entries = readRaw();
  let updated: TaskOutboxEntry | null = null;
  const next = entries.map((entry) => {
    if (entry.operationId !== operationId) return entry;
    updated = { ...entry, ...patch };
    return updated;
  });
  if (!updated) return null;
  writeRaw(next);
  return updated;
}

export function taskOutboxBackoffMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(TASK_OUTBOX_BASE_BACKOFF_MS * 2 ** (attempt - 1), TASK_OUTBOX_MAX_BACKOFF_MS);
}

function reasonOf(body: TaskOutboxAcknowledgement): string {
  const raw = body.reason ?? body.error ?? body.code;
  return typeof raw === "string" ? raw.trim() : "";
}

function requiresCredential(entry: TaskOutboxEntry): boolean {
  return CREDENTIAL_REQUIRED_ACTIONS[entry.route]?.has(entry.action) ?? false;
}

function markRetryable(entry: TaskOutboxEntry, category: TaskOutboxErrorCategory, reason: string): FlushTaskOutboxResult {
  const attemptCount = entry.attemptCount + 1;
  if (attemptCount >= TASK_OUTBOX_MAX_ATTEMPTS) return markFailed(entry, category, reason);
  patchEntry(entry.operationId, {
    attemptCount,
    status: "retrying",
    lastErrorCategory: category,
    lastErrorReason: reason,
    nextAttemptAt: new Date(Date.now() + taskOutboxBackoffMs(attemptCount)).toISOString(),
  });
  return { acknowledged: 0, retryable: 1, permanent: 0 };
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

function markAuthRequired(entry: TaskOutboxEntry, reason: string, deferred: boolean): FlushTaskOutboxResult {
  if (!deferred) {
    patchEntry(entry.operationId, {
      status: "auth-required",
      lastErrorCategory: "unauthorized",
      lastErrorReason: reason,
      nextAttemptAt: undefined,
    });
    return { acknowledged: 0, retryable: 0, permanent: 1 };
  }
  const attemptCount = entry.attemptCount + 1;
  if (attemptCount >= TASK_OUTBOX_MAX_ATTEMPTS) {
    return markFailed(entry, "unauthorized", reason || "unauthorized");
  }
  patchEntry(entry.operationId, {
    attemptCount,
    status: "auth-required",
    lastErrorCategory: "unauthorized",
    lastErrorReason: reason,
    nextAttemptAt: new Date(Date.now() + taskOutboxBackoffMs(attemptCount)).toISOString(),
  });
  return { acknowledged: 0, retryable: 0, permanent: 1 };
}

function markReconciling(entry: TaskOutboxEntry, reason: string): FlushTaskOutboxResult {
  const attemptCount = entry.attemptCount + 1;
  if (attemptCount >= TASK_OUTBOX_MAX_ATTEMPTS) {
    return markFailed(entry, "projection", reason || "projection_unresolved");
  }
  patchEntry(entry.operationId, {
    attemptCount,
    status: "reconciling",
    lastErrorCategory: "projection",
    lastErrorReason: reason,
    nextAttemptAt: new Date(Date.now() + taskOutboxBackoffMs(attemptCount)).toISOString(),
  });
  return { acknowledged: 0, retryable: 1, permanent: 0 };
}

async function acknowledge(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
  options: FlushTaskOutboxOptions,
): Promise<FlushTaskOutboxResult> {
  try {
    await options.onAcknowledged?.(body);
  } catch {
    return markRetryable(entry, "network", "adoption_failed");
  }
  removeTaskOutboxEntry(entry.operationId);
  return { acknowledged: 1, retryable: 0, permanent: 0 };
}

function classifyConflict(entry: TaskOutboxEntry, body: TaskOutboxAcknowledgement): FlushTaskOutboxResult {
  const reason = reasonOf(body);
  if (body.retryable === true || RETRYABLE_REASONS.has(reason)) {
    return markRetryable(entry, "server", reason || "retryable_conflict");
  }
  if (body.semanticDuplicate === true || DUPLICATE_REASONS.has(reason)) {
    return markFailed(entry, "semantic-duplicate", reason || "semantic_duplicate");
  }
  return markFailed(entry, "validation", reason || "operation_conflict");
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
  return markFailed(entry, "validation", reason || `http_${status}`);
}

interface SnapshotView {
  hasTasks: boolean;
  tasks: Record<string, unknown>[];
  history: Record<string, unknown>[];
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
    ? (data.tasks as unknown[]).filter(
        (task) => isRecord(task) && !deleted.has(Number((task as Record<string, unknown>).id)),
      ) as Record<string, unknown>[]
    : [];
  const weekData = isRecord(data.weekData)
    ? data.weekData
    : isRecord(read?.weekData)
      ? read.weekData
      : null;
  return {
    hasTasks,
    tasks,
    history: Array.isArray(weekData?.history) ? (weekData.history as Record<string, unknown>[]) : [],
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

function sameMember(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
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

function hasEarnLine(view: SnapshotView, taskId: unknown): boolean {
  const id = Number(taskId);
  return view.history.some(
    (transaction) =>
      isRecord(transaction) &&
      transaction.type === "earn" &&
      Number(transaction.taskId) === id,
  );
}

function approveProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  if (entry.action === "send-back") {
    const task = findTask(view, entry.payload.taskId);
    if (!task || task.completed === true) return false;
    return typeof task.sentBackAt === "string" && task.sentBackAt.trim().length > 0;
  }
  const taskIds = Array.isArray(entry.payload.taskIds)
    ? entry.payload.taskIds
    : [entry.payload.taskId];
  if (!taskIds.length) return false;
  return taskIds.every((taskId) => {
    const task = findTask(view, taskId);
    return Boolean(task) && !isRecord(task!.pendingApproval);
  });
}

function claimProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  const task = findTask(view, entry.payload.taskId);
  if (!task) return false;
  const memberName = entry.payload.memberName;
  const crew = crewMembers(task);
  const removed = isRecord(task.crew) && Array.isArray((task.crew as Record<string, unknown>).removed)
    ? ((task.crew as Record<string, unknown>).removed as unknown[]).filter((name) => typeof name === "string")
    : [];

  if (entry.action === "crew-join") {
    return crew.some((member) => sameMember(member.name, memberName));
  }
  if (entry.action === "crew-checkin") {
    return crew.some(
      (member) =>
        sameMember(member.name, memberName) &&
        typeof member.checkedInAt === "string" &&
        member.checkedInAt.trim().length > 0,
    );
  }
  if (entry.action === "crew-remove") {
    const target = entry.payload.targetName ?? memberName;
    if (removed.some((name) => sameMember(name, target))) return true;
    return !crew.some((member) => sameMember(member.name, target));
  }
  if (entry.action === "undo") {
    return task.completed !== true && !isRecord(task.pendingApproval);
  }
  if (task.completed !== true) return false;
  if (isRecord(task.pendingApproval)) return true;
  if (hasEarnLine(view, task.id)) return true;
  return Boolean(memberName) && sameMember(task.completedBy, memberName);
}

function manageProvesResolved(entry: TaskOutboxEntry, view: SnapshotView): boolean {
  if (entry.action === "delete") {
    return findTask(view, entry.payload.taskId) === null;
  }
  if (entry.action === "add") {
    const task = entry.payload.task;
    if (!isRecord(task) || typeof task.title !== "string") return false;
    return view.tasks.some(
      (row) =>
        sameField(row.title, task.title) &&
        (task.assignee === undefined || sameMember(row.assignee ?? row.assigned, task.assignee)),
    );
  }
  const row = findTask(view, entry.payload.taskId);
  if (!row) return false;
  const patch = entry.payload.patch;
  if (!isRecord(patch)) return false;
  const fields = Object.keys(patch);
  if (!fields.length) return false;
  return fields.every((field) => sameField(row[field], patch[field]));
}

function configItemMatches(candidate: unknown, expected: Record<string, unknown>, keys: readonly string[]): boolean {
  if (!isRecord(candidate)) return false;
  return keys.every((key) => !(key in expected) || sameField(candidate[key], expected[key]));
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

export function snapshotProvesResolved(
  entry: TaskOutboxEntry,
  read: SnapshotRead | null | undefined,
): boolean {
  const view = snapshotView(read);
  if (!view) return false;
  if (entry.route === "/api/tasks/config") return configProvesResolved(entry, view);
  if (!view.hasTasks) return false;
  if (entry.route === "/api/tasks/approve") return approveProvesResolved(entry, view);
  if (entry.route === "/api/tasks/claim") return claimProvesResolved(entry, view);
  if (entry.route === "/api/tasks/manage") return manageProvesResolved(entry, view);
  return false;
}

export function buildTaskOperationRequestBody(
  entry: TaskOutboxEntry,
  credential?: string,
): Record<string, unknown> {
  const pin =
    CREDENTIAL_ACCEPTING_ROUTES.has(entry.route) && typeof credential === "string" && credential.trim()
      ? credential.trim()
      : "";
  return {
    ...entry.payload,
    action: entry.action,
    operationId: entry.operationId,
    ...(pin ? { pin } : {}),
  };
}

export async function sendTaskOperationRequest(
  entry: TaskOutboxEntry,
  credential?: string,
): Promise<TaskOutboxSendResult> {
  const response = await fetch(entry.route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTaskOperationRequestBody(entry, credential)),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: { operationId: entry.operationId, reconciled: false, ...(isRecord(body) ? body : {}) },
  };
}

export async function pullTaskSnapshotDocument(): Promise<SnapshotRead> {
  const response = await fetch("/api/tasks/sync", { cache: "no-store" });
  if (!response.ok) throw new Error(`tasks_sync_${response.status}`);
  const body = await response.json().catch(() => ({}));
  const record = isRecord(body) ? body : {};
  return {
    snapshot: isRecord(record.snapshot) ? (record.snapshot as SnapshotData) : null,
    reconciled: record.reconciled === true,
  };
}

export function createFetchTaskOutboxDriver(
  overrides: Partial<TaskOutboxDriver> = {},
): TaskOutboxDriver {
  return {
    send: overrides.send ?? sendTaskOperationRequest,
    ...(overrides.getCredential ? { getCredential: overrides.getCredential } : {}),
    ...(overrides.pullSnapshot ? { pullSnapshot: overrides.pullSnapshot } : {}),
    ...(overrides.onAcknowledged ? { onAcknowledged: overrides.onAcknowledged } : {}),
  };
}

let activeDriver: TaskOutboxDriver = createFetchTaskOutboxDriver();

export function setTaskOutboxDriver(driver: TaskOutboxDriver | null): void {
  activeDriver = driver ?? createFetchTaskOutboxDriver();
}

export function getTaskOutboxDriver(): TaskOutboxDriver {
  return activeDriver;
}

async function proveFromSnapshot(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
  options: FlushTaskOutboxOptions,
): Promise<TaskOutboxAcknowledgement | null> {
  if (!options.pullSnapshot) return null;
  let read: SnapshotRead;
  try {
    read = await options.pullSnapshot();
  } catch {
    return null;
  }
  if (!snapshotProvesResolved(entry, read)) return null;
  return { ...body, reconciled: true };
}

async function processEntry(
  entry: TaskOutboxEntry,
  options: FlushTaskOutboxOptions,
): Promise<FlushTaskOutboxResult> {
  const credential = options.getCredential?.(entry);
  if (requiresCredential(entry) && !credential) {
    return markAuthRequired(entry, "credential_missing", false);
  }

  let status = 0;
  let body: TaskOutboxAcknowledgement = { operationId: entry.operationId, reconciled: false };
  try {
    const response = await options.send(entry, credential);
    status = Number(response?.status ?? 0);
    if (isRecord(response?.body)) body = response.body as TaskOutboxAcknowledgement;
  } catch {
    return markRetryable(entry, "network", "send_failed");
  }

  if (status === 200 && body.reconciled !== false) {
    return acknowledge(entry, body, options);
  }
  if (status === 200 || status === 202 || status === 409) {
    const proof = await proveFromSnapshot(entry, body, options);
    if (proof) return acknowledge(entry, proof, options);
    if (status === 409) return classifyConflict(entry, body);
    if (status === 200) return markRetryable(entry, "projection", "unreconciled_success");
    return markReconciling(entry, reasonOf(body) || "projection_pending");
  }
  return classifyFailure(entry, status, body);
}

async function runFlush(options: FlushTaskOutboxOptions): Promise<FlushTaskOutboxResult> {
  const result: FlushTaskOutboxResult = { acknowledged: 0, retryable: 0, permanent: 0 };
  const entries = readRaw();
  if (!entries.length) return result;
  for (const entry of entries) {
    if (entry.status === "failed") continue;
    if (
      entry.status === "auth-required" &&
      !(requiresCredential(entry) && options.getCredential?.(entry))
    ) {
      continue;
    }
    if (entry.nextAttemptAt) {
      const due = Date.parse(entry.nextAttemptAt);
      if (Number.isFinite(due) && Date.now() < due) continue;
    }
    const outcome = await processEntry(entry, options);
    result.acknowledged += outcome.acknowledged;
    result.retryable += outcome.retryable;
    result.permanent += outcome.permanent;
  }
  return result;
}

export function flushTaskOutbox(
  options: FlushTaskOutboxOptions = activeDriver,
): Promise<FlushTaskOutboxResult> {
  if (inFlight) return inFlight;
  const running = runFlush(options);
  const shared = running.finally(() => {
    if (inFlight === shared) inFlight = null;
  });
  inFlight = shared;
  return shared;
}

export function requestTaskOutboxFlush(): Promise<FlushTaskOutboxResult> {
  return flushTaskOutbox(activeDriver);
}
