import {
  DUPLICATE_REASONS,
  RETRYABLE_REASONS,
  buildTaskOperationRequestBody,
  createTaskOperationId,
  isSupportedTaskOperation,
  parseTaskOperationEntry,
  reasonOf,
  sanitizeDisplayTarget,
  sanitizeTaskOperationPayload,
  serverMessageOf,
  taskOperationRequiresCredential,
  taskOutboxBackoffMs,
  type FlushTaskOutboxResult,
  type SnapshotRead,
  type TaskOperationRoute,
  type TaskOutboxAcknowledgedEvent,
  type TaskOutboxAcknowledgement,
  type TaskOutboxCredential,
  type TaskOutboxDisplayTarget,
  type TaskOutboxEntry,
  type TaskOutboxSendResult,
} from "@/lib/task-operation-payload";
import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import type { SnapshotData, SnapshotOperationReceipt, SnapshotConfigOperationReceipt } from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";

/**
 * The browser command store — the PocketBase-queue successor to the
 * localStorage outbox pump.
 *
 * A tap still enqueues SYNCHRONOUSLY (the entry exists before the caller
 * returns, so optimistic marks key on it immediately), but the send is now a
 * direct POST to the command route with the credential in the body:
 *
 *   · 2xx success            → the entry leaves and the terminal event fires
 *                              FIRST, then the ack body is adopted (adoption
 *                              runs after release; adopt-before-release is a
 *                              tracked follow-up). No proof-polling — the body
 *                              already carries the authoritative week.
 *   · 202 { queued: true }   → the SERVER owns the command (a PocketBase
 *                              queue row): the entry stays as a live mirror
 *                              of the queue poll, visible on every device.
 *   · 4xx refusal            → immediate terminal failure with the server's
 *                              reason. A wrong PIN answers AT TAP TIME — the
 *                              "waiting on a PIN forever" class is gone.
 *   · network / 5xx          → the THIN replay buffer: the entry backs off
 *                              locally (2s → 5 min, 8 attempts) and replays
 *                              into the route on online/visibility/mount.
 *                              Parked entries older than 24h go terminal
 *                              `failed` — a banner can never outlive a day.
 *
 * Entries persist in localStorage under the SAME key the old outbox used, so
 * every family device rehydrates its old rows on first load: parked sends are
 * re-sent best-effort, and a PIN-requiring command whose credential died with
 * the page is parked `auth-required` so the family can enter the PIN again.
 */
export const TASK_OUTBOX_STORAGE_KEY = "consuela-task-operation-outbox-v1";
export const TASK_COMMAND_STORE_STORAGE_KEY = TASK_OUTBOX_STORAGE_KEY;
export const TASK_OUTBOX_MAX_ENTRIES = 50;
export const TASK_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TASK_OUTBOX_MAX_ATTEMPTS = 8;
export const TASK_OUTBOX_REQUEST_TIMEOUT_MS = 30_000;
export const TASK_OUTBOX_STORAGE_WRITE_ATTEMPTS = 2;
/** A locally parked (unsent) entry older than this is terminal `failed`. */
export const TASK_STORE_LOCAL_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** Poll cadence while the store knows about server-queue rows. */
export const TASK_QUEUE_POLL_INTERVAL_MS = 30_000;

/**
 * Containment for the wave's riskiest change. `false` restores the pre-B1a
 * pull-gate clear path exactly: an acknowledgement merges through
 * `mergeTasksSnapshot` and its clear is refused unless it carries ledger proof
 * (a paid earn for the row, or a send-back stamp newer than the tap). One edit.
 */
export const ACK_CLEAR_AUTHORITATIVE = true;

export type {
  FlushTaskOutboxResult,
  SnapshotRead,
  TaskOperationRoute,
  TaskOutboxAcknowledgedEvent,
  TaskOutboxAcknowledgement,
  TaskOutboxCredential,
  TaskOutboxDisplayTarget,
  TaskOutboxEntry,
  TaskOutboxSendResult,
};

export { createTaskOperationId, isSupportedTaskOperation, sanitizeTaskOperationPayload, taskOutboxBackoffMs };

// ---------------------------------------------------------------------------
// Credential registry (ephemeral, in-memory only — a PIN is never persisted)
// ---------------------------------------------------------------------------

const ephemeralCredentials = new Map<string, TaskOutboxCredential>();

export function rememberTaskCommandCredential(
  operationId: string,
  credential?: TaskOutboxCredential,
): TaskOutboxCredential | undefined {
  const value = credential ?? undefined;
  if (!value || typeof value !== "object") {
    ephemeralCredentials.delete(operationId);
    return undefined;
  }
  const pin = typeof value.pin === "string" && value.pin.trim() ? value.pin.trim() : "";
  const parentPin =
    typeof value.parentPin === "string" && value.parentPin.trim() ? value.parentPin.trim() : "";
  if (!pin && !parentPin) {
    ephemeralCredentials.delete(operationId);
    return undefined;
  }
  const normalized = { ...(pin ? { pin } : {}), ...(parentPin ? { parentPin } : {}) };
  ephemeralCredentials.set(operationId, normalized);
  return normalized;
}

export function readTaskCommandCredential(operationId: string): TaskOutboxCredential | undefined {
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

// ---------------------------------------------------------------------------
// Terminal events (the ONLY releaser of optimistic marks — four ways to land)
// ---------------------------------------------------------------------------

const acknowledgmentListeners = new Set<(event: TaskOutboxAcknowledgedEvent) => void>();
const adoptionListeners = new Set<() => void>();
const storeListeners = new Set<() => void>();

export function onTaskOutboxAcknowledged(
  listener: (event: TaskOutboxAcknowledgedEvent) => void,
): () => void {
  acknowledgmentListeners.add(listener);
  return () => acknowledgmentListeners.delete(listener);
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

export function onTaskOutboxAdopted(listener: () => void): () => void {
  adoptionListeners.add(listener);
  return () => adoptionListeners.delete(listener);
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

function notify(): void {
  for (const listener of [...storeListeners]) {
    try {
      listener();
    } catch {
      continue;
    }
  }
}

export function subscribeTaskOutbox(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Storage (same key; the legacy index+per-entry layout rehydrates on cold read)
// ---------------------------------------------------------------------------

const EMPTY_SERVER_SNAPSHOT: TaskOutboxEntry[] = Object.freeze<TaskOutboxEntry[]>([]) as TaskOutboxEntry[];
const LEGACY_ENTRY_PREFIX = `${TASK_OUTBOX_STORAGE_KEY}:entry:`;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

let cache: TaskOutboxEntry[] | null = null;
let unpersisted = new Map<string, TaskOutboxEntry>();
let legacyRehydrated = false;
let storageAttached = false;

function createdMs(entry: TaskOutboxEntry): number {
  const epoch = Date.parse(entry.createdAt);
  return Number.isFinite(epoch) ? epoch : 0;
}

function readLegacyIndexIds(): string[] {
  if (!isBrowser()) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return [];
  if (!isRecord(parsed) || !Array.isArray(parsed.ids)) return [];
  return parsed.ids
    .map((value) => normalizeOperationId(value))
    .filter((value): value is string => Boolean(value));
}

function readLegacyArrayEntries(): TaskOutboxEntry[] {
  if (!isBrowser()) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => parseTaskOperationEntry(value))
    .filter((entry): entry is TaskOutboxEntry => Boolean(entry));
}

function readLegacyPerEntryEntries(ids: string[]): TaskOutboxEntry[] {
  if (!isBrowser()) return [];
  const entries: TaskOutboxEntry[] = [];
  for (const id of ids) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(`${LEGACY_ENTRY_PREFIX}${id}`);
    } catch {
      continue;
    }
    if (!raw) continue;
    try {
      const entry = parseTaskOperationEntry(JSON.parse(raw));
      if (entry) entries.push(entry);
    } catch {
      continue;
    }
  }
  return entries;
}

/** The per-device one-time rehydration: the old outbox's index + per-entry
 * rows fold into the store's array format. `auth-required` rows survive as
 * themselves — the PIN is gone by design, so the family re-enters it. */
function rehydrateLegacyOnce(): void {
  if (legacyRehydrated || !isBrowser()) return;
  legacyRehydrated = true;
  try {
    const ids = readLegacyIndexIds();
    if (!ids.length) return;
    const legacy = readLegacyPerEntryEntries(ids);
    if (!legacy.length) return;
    const current = [...readRaw(), ...legacy];
    const byId = new Map<string, TaskOutboxEntry>();
    for (const entry of current) byId.set(entry.operationId, entry);
    writeRaw([...byId.values()]);
    for (const id of ids) {
      try {
        window.localStorage.removeItem(`${LEGACY_ENTRY_PREFIX}${id}`);
      } catch {
        continue;
      }
    }
  } catch {
    /* the next cold load tries again */
  }
}

function readRaw(): TaskOutboxEntry[] {
  if (!isBrowser()) return EMPTY_SERVER_SNAPSHOT as unknown as TaskOutboxEntry[];
  if (!legacyRehydrated) rehydrateLegacyOnce();
  if (cache) return cache;
  const fromArray = readLegacyArrayEntries();
  cache = fromArray;
  return cache;
}

function writeRaw(entries: TaskOutboxEntry[]): void {
  cache = entries;
  rememberUnpersisted(entries);
  if (!isBrowser()) return;
  for (let attempt = 0; attempt < TASK_OUTBOX_STORAGE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify(entries));
      warnOnce();
      return;
    } catch {
      continue;
    }
  }
  warnTaskOutboxStorageFailure();
}

let storageWarned = false;
function warnOnce(): void {
  storageWarned = false;
}

function rememberUnpersisted(entries: TaskOutboxEntry[]): void {
  unpersisted = new Map(entries.map((entry) => [entry.operationId, entry]));
}

export function listTaskOutbox(): TaskOutboxEntry[] {
  return readRaw();
}

export function getTaskOutboxSnapshot(): TaskOutboxEntry[] {
  return readRaw();
}

export function getTaskOutboxServerSnapshot(): TaskOutboxEntry[] {
  return EMPTY_SERVER_SNAPSHOT as unknown as TaskOutboxEntry[];
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== TASK_OUTBOX_STORAGE_KEY) return;
  cache = null;
  notify();
}

function attachStorageListener(): void {
  if (storageAttached || !isBrowser()) return;
  storageAttached = true;
  window.addEventListener("storage", onStorageEvent);
}

interface BoundedEntries {
  kept: TaskOutboxEntry[];
  evicted: TaskOutboxEntry[];
}

function boundEntries(entries: TaskOutboxEntry[]): BoundedEntries {
  const floor = Date.now() - TASK_OUTBOX_RETENTION_MS;
  const kept = entries
    .filter((entry) => entry.status === "failed" || createdMs(entry) >= floor)
    .sort((left, right) => createdMs(left) - createdMs(right));
  if (kept.length <= TASK_OUTBOX_MAX_ENTRIES) return { kept, evicted: [] };
  const boundary = kept.length - TASK_OUTBOX_MAX_ENTRIES;
  return { kept: kept.slice(boundary), evicted: kept.slice(0, boundary) };
}

function patchEntry(operationId: string, patch: Partial<TaskOutboxEntry>): TaskOutboxEntry | null {
  const current = readRaw();
  const index = current.findIndex((entry) => entry.operationId === operationId);
  if (index < 0) return null;
  const next: TaskOutboxEntry = { ...current[index], ...patch };
  const updated = [...current];
  updated[index] = next;
  writeRaw(updated);
  notify();
  return next;
}

function removeEntry(operationId: string): TaskOutboxEntry | null {
  const current = readRaw();
  const index = current.findIndex((entry) => entry.operationId === operationId);
  if (index < 0) return null;
  const removed = current[index];
  const { kept, evicted } = boundEntries([...current.slice(0, index), ...current.slice(index + 1)]);
  writeRaw(kept);
  scheduleEvictionNotify(evicted);
  notify();
  return removed;
}

let pendingEvictions: TaskOutboxEntry[] = [];

function scheduleEvictionNotify(evicted: TaskOutboxEntry[]): void {
  if (!evicted.length) return;
  // The credential for an evicted entry must die with it, or a tab that ages
  // entries out would keep PINs in memory forever.
  for (const entry of evicted) forgetTaskCommandCredential(entry.operationId);
  pendingEvictions = [...pendingEvictions, ...evicted];
  const run = () => {
    const dropped = pendingEvictions;
    pendingEvictions = [];
    const seen = new Set<string>();
    for (const entry of dropped) {
      if (seen.has(entry.operationId)) continue;
      seen.add(entry.operationId);
      notifyAcknowledged({
        operationId: entry.operationId,
        action: entry.action,
        failed: true,
        evicted: true,
        reason: "outbox_evicted",
      });
    }
  };
  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else Promise.resolve().then(run);
}

// ---------------------------------------------------------------------------
// Queue poll (the server-owned mirror)
// ---------------------------------------------------------------------------

interface QueueStateRow {
  operationId: string;
  route: TaskOperationRoute;
  action: string;
  status: "pending" | "failed" | "resolved" | "cancelled";
  nextAttemptAt: string | null;
  lastErrorReason: string | null;
  lastErrorMessage: string | null;
  result: Record<string, unknown> | null;
  displayTarget: TaskOutboxDisplayTarget | null;
  attemptCount: number;
  /** The server row's own `created` — exists on the wire (the queue route
   * returns rows verbatim); stamped onto a resolved ack as `commandCreatedAt`
   * so the freshness guard compares against the command's instant, not the
   * poll's. */
  createdAt?: string;
}

function rowToEntryPatch(row: QueueStateRow): Partial<TaskOutboxEntry> {
  if (row.status === "pending") {
    const due = !row.nextAttemptAt || Date.parse(row.nextAttemptAt) <= Date.now();
    return {
      status: due ? "queued" : "retrying",
      serverQueued: true,
      serverStatus: "pending",
      attemptCount: row.attemptCount,
      ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : { nextAttemptAt: undefined }),
      ...(row.lastErrorReason ? { lastErrorReason: row.lastErrorReason } : {}),
    };
  }
  if (row.status === "failed") {
    return {
      status: "failed",
      serverQueued: true,
      serverStatus: "failed",
      nextAttemptAt: undefined,
      lastErrorCategory: "server",
      ...(row.lastErrorReason ? { lastErrorReason: row.lastErrorReason } : {}),
      ...(row.lastErrorMessage ? { lastErrorMessage: row.lastErrorMessage } : {}),
    };
  }
  return {};
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleQueuePoll(delayMs: number): void {
  if (!isBrowser()) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollQueue().catch(() => {});
  }, Math.max(0, delayMs));
}

const seenResolvedOperationIds = new Set<string>();

export async function pollQueue(): Promise<void> {
  attachStorageListener();
  let rows: QueueStateRow[] | null = null;
  try {
    const response = await fetch("/api/tasks/queue", {
      cache: "no-store",
      signal: AbortSignal.timeout(TASK_OUTBOX_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      scheduleFollowUpPoll();
      return;
    }
    const body = await response.json().catch(() => ({}));
    rows = isRecord(body) && Array.isArray(body.rows) ? (body.rows as QueueStateRow[]) : [];
  } catch {
    scheduleFollowUpPoll();
    return;
  }

  const rowByOperationId = new Map(rows.map((row) => [row.operationId, row]));
  const current = readRaw();
  const next: TaskOutboxEntry[] = [];
  let changed = false;

  for (const row of rows) {
    if (row.status === "resolved") {
      if (!seenResolvedOperationIds.has(row.operationId)) {
        seenResolvedOperationIds.add(row.operationId);
        const ack: TaskOutboxAcknowledgement = {
          ...(isRecord(row.result) ? (row.result as Record<string, unknown>) : {}),
          operationId: row.operationId,
          // The queue row's OWN creation instant. A mirror minted at poll time
          // would date a cross-device ack "now" and make the freshness test
          // meaningless.
          ...(row.createdAt ? { commandCreatedAt: row.createdAt } : {}),
        };
        await adoptTaskOutboxAcknowledgement(ack);
        const known = current.some((entry) => entry.operationId === row.operationId);
        if (known) {
          forgetTaskCommandCredential(row.operationId);
          notifyAcknowledged({ ...ack, operationId: row.operationId });
          notifyAdopted();
          changed = true;
        }
      }
      continue;
    }
    if (row.status === "cancelled") {
      if (!seenResolvedOperationIds.has(row.operationId)) {
        seenResolvedOperationIds.add(row.operationId);
        const known = current.some((entry) => entry.operationId === row.operationId);
        if (known) {
          forgetTaskCommandCredential(row.operationId);
          notifyAcknowledged({ operationId: row.operationId });
          changed = true;
        }
      }
      continue;
    }
    // pending / failed: mirror into the entry list.
    const existing = current.find((entry) => entry.operationId === row.operationId);
    const patch = rowToEntryPatch(row);
    if (existing) {
      const merged: TaskOutboxEntry = { ...existing, ...patch, displayTarget: existing.displayTarget };
      const wasFailed = existing.status === "failed";
      const isFailed = merged.status === "failed";
      next.push(merged);
      if (!wasFailed && isFailed) {
        forgetTaskCommandCredential(row.operationId);
        notifyAcknowledged({
          operationId: row.operationId,
          action: merged.action,
          failed: true,
          reason: merged.lastErrorReason,
          category: "server",
        });
      }
      if (
        wasFailed !== isFailed ||
        existing.status !== merged.status ||
        existing.serverStatus !== merged.serverStatus
      ) {
        changed = true;
      }
      continue;
    }
    // A row this device never queued — cross-device visibility. Only rows
    // whose route+action the payload contract knows mirror in.
    if (isSupportedTaskOperation(row.route, row.action)) {
      next.push({
        version: 1,
        operationId: row.operationId,
        route: row.route,
        action: row.action,
        payload: {},
        createdAt: new Date().toISOString(),
        attemptCount: row.attemptCount,
        ...patch,
        status: patch.status ?? "queued",
        displayTarget: row.displayTarget ?? { kind: "task" },
      });
      changed = true;
    }
  }

  // Local entries that referenced a server row which is now gone without a
  // terminal marker (retention swept it): release them so no mirror lingers.
  for (const entry of current) {
    if (next.some((candidate) => candidate.operationId === entry.operationId)) continue;
    if (entry.serverQueued && !seenResolvedOperationIds.has(entry.operationId)) {
      seenResolvedOperationIds.add(entry.operationId);
      forgetTaskCommandCredential(entry.operationId);
      notifyAcknowledged({ operationId: entry.operationId });
      changed = true;
      continue;
    }
    if (!rowByOperationId.has(entry.operationId)) next.push(entry);
  }

  if (changed) {
    writeRaw(next);
    notify();
  }
  scheduleFollowUpPoll();
}

function scheduleFollowUpPoll(): void {
  const hasServerRows = readRaw().some((entry) => entry.serverQueued);
  if (hasServerRows || seenResolvedOperationIds.size > 0) {
    scheduleQueuePoll(TASK_QUEUE_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// The send state machine
// ---------------------------------------------------------------------------

const inFlightOperationIds = new Set<string>();
const inFlightSends = new Set<Promise<FlushTaskOutboxResult>>();

export interface TaskCommandDriver {
  send?: (entry: TaskOutboxEntry, credential?: TaskOutboxCredential) => Promise<TaskOutboxSendResult>;
  pullSnapshot?: () => Promise<SnapshotRead>;
  adoptSnapshot?: (read: SnapshotRead) => void | Promise<void>;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
  requestTimeoutMs?: number;
}

export interface TaskOutboxDriver extends TaskCommandDriver {}

let driver: TaskCommandDriver = {};

export function registerTaskOutboxDriver(overrides: Partial<TaskCommandDriver> = {}): () => void {
  driver = { ...driver, ...overrides };
  return () => {
    driver = {};
  };
}

export function getTaskOutboxDriver(): TaskCommandDriver {
  return driver;
}

async function sendOperationRequest(
  entry: TaskOutboxEntry,
  credential: TaskOutboxCredential | undefined,
): Promise<TaskOutboxSendResult> {
  const send = driver.send;
  if (send) return send(entry, credential);
  const response = await fetch(entry.route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTaskOperationRequestBody(entry, credential)),
    signal: AbortSignal.timeout(driver.requestTimeoutMs ?? TASK_OUTBOX_REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: { operationId: entry.operationId, ...(isRecord(body) ? body : {}) } as TaskOutboxAcknowledgement,
  };
}

function markSendInFlight(entry: TaskOutboxEntry): void {
  inFlightOperationIds.add(entry.operationId);
  patchEntry(entry.operationId, {
    status: "reconciling",
    nextAttemptAt: undefined,
  });
}

function clearSendInFlight(operationId: string): void {
  inFlightOperationIds.delete(operationId);
}

function markFailed(
  entry: TaskOutboxEntry,
  category: TaskOutboxAcknowledgedEvent["category"],
  reason: string,
  message = "",
): FlushTaskOutboxResult {
  const failed = patchEntry(entry.operationId, {
    status: "failed",
    lastErrorCategory: category,
    lastErrorReason: reason,
    ...(message ? { lastErrorMessage: message } : {}),
    nextAttemptAt: undefined,
  });
  forgetTaskCommandCredential(entry.operationId);
  notifyAcknowledged({
    operationId: entry.operationId,
    action: entry.action,
    failed: true,
    reason,
    category,
  });
  return { acknowledged: 0, retryable: 0, permanent: 1 };
}

function markRetryable(entry: TaskOutboxEntry, reason: string, message = ""): FlushTaskOutboxResult {
  const attemptCount = entry.attemptCount + 1;
  if (attemptCount >= TASK_OUTBOX_MAX_ATTEMPTS) {
    return markFailed(entry, "network", reason, message);
  }
  patchEntry(entry.operationId, {
    attemptCount,
    status: "retrying",
    lastErrorCategory: "network",
    lastErrorReason: reason,
    ...(message ? { lastErrorMessage: message } : {}),
    nextAttemptAt: new Date(Date.now() + taskOutboxBackoffMs(attemptCount)).toISOString(),
  });
  return { acknowledged: 0, retryable: 1, permanent: 0 };
}

/**
 * A PIN-requiring command whose credential is gone is WAITING, not refused:
 * park it for a re-prompt. It never auto-retries (nothing on this device can
 * answer the 401 until a PIN is entered again) and it is not terminal, so no
 * failed/queue_expired banner can bury a tap the family can still save.
 */
function markAuthRequired(entry: TaskOutboxEntry, reason: string, message = ""): FlushTaskOutboxResult {
  patchEntry(entry.operationId, {
    status: "auth-required",
    lastErrorCategory: undefined,
    lastErrorReason: reason || "pin_required",
    ...(message ? { lastErrorMessage: message } : {}),
    nextAttemptAt: undefined,
  });
  return { acknowledged: 0, retryable: 1, permanent: 0 };
}

async function acknowledgeEntry(
  entry: TaskOutboxEntry,
  body: TaskOutboxAcknowledgement,
): Promise<FlushTaskOutboxResult> {
  removeEntry(entry.operationId);
  forgetTaskCommandCredential(entry.operationId);
  notifyAcknowledged({ action: entry.action, ...body, operationId: entry.operationId });
  try {
    // The ack answers the command this entry represents, so the entry's own
    // `createdAt` is the freshness proof the by-id clear compares a local tap
    // against (a server-supplied stamp, when present, wins).
    await (driver.onAcknowledged ?? adoptTaskOutboxAcknowledgement)({
      ...body,
      operationId: entry.operationId,
      commandCreatedAt: body.commandCreatedAt ?? entry.createdAt,
    });
  } catch {
    /* adoption is best-effort display state */
  }
  notifyAdopted();
  return { acknowledged: 1, retryable: 0, permanent: 0 };
}

async function processEntry(entry: TaskOutboxEntry): Promise<FlushTaskOutboxResult> {
  if (inFlightOperationIds.has(entry.operationId)) {
    return { acknowledged: 0, retryable: 1, permanent: 0 };
  }
  const credential = resolveTaskOutboxCredential(entry);
  const fresh = readRaw().find((candidate) => candidate.operationId === entry.operationId);
  if (!fresh) return { acknowledged: 0, retryable: 0, permanent: 0 };
  if (fresh.serverQueued && fresh.serverStatus === "pending") {
    // The server owns this command; the poll is its heartbeat.
    scheduleQueuePoll(0);
    return { acknowledged: 0, retryable: 1, permanent: 0 };
  }
  markSendInFlight(fresh);
  let status = 0;
  let body: TaskOutboxAcknowledgement = { operationId: fresh.operationId };
  try {
    const response = await sendOperationRequest(fresh, credential);
    status = Number(response?.status ?? 0);
    if (isRecord(response?.body)) body = response.body as TaskOutboxAcknowledgement;
  } catch {
    clearSendInFlight(fresh.operationId);
    return markRetryable(fresh, "send_failed");
  }
  clearSendInFlight(fresh.operationId);

  const reason = reasonOf(body);
  const message = serverMessageOf(body);
  const queued = body.queued === true;
  // A 2xx that did not reconcile is NOT a success the client may bank: the
  // ledger may hold the change while the kitchen display never received it.
  // Retry it with the server's own sentence so the honest state stays visible
  // (D4) — the entry leaves only once the server says it fully landed.
  const unreconciled = status >= 200 && status < 300 && !queued &&
    (body.reconciled === false || body.repairRequired === true);

  if (status >= 200 && status < 300 && !queued && !unreconciled) {
    return await acknowledgeEntry(fresh, body);
  }
  if (unreconciled) {
    return markRetryable(fresh, "projection_pending", message);
  }
  if (status >= 200 && status < 300 && queued) {
    // The server took the command into its PocketBase queue.
    patchEntry(fresh.operationId, {
      status: "queued",
      serverQueued: true,
      serverStatus: "pending",
      lastErrorReason: reason || undefined,
      nextAttemptAt: undefined,
      attemptCount: 0,
    });
    scheduleQueuePoll(0);
    return { acknowledged: 0, retryable: 1, permanent: 0 };
  }
  if (status === 401 || status === 403) {
    // A wrong PIN (or an expired session) answers AT TAP TIME — but only when
    // there WAS a credential to present. A PIN-requiring command re-sent after
    // a reload carries none: that is the "ask for the PIN again" case, not a
    // refusal, and it must survive overnight (a network expiry would bury a
    // tap the family can still complete).
    if (!credential && taskOperationRequiresCredential(fresh.route, fresh.action)) {
      return markAuthRequired(fresh, reason || "pin_required", message);
    }
    return markFailed(fresh, "unauthorized", reason || "unauthorized", message);
  }
  if (
    status === 400 &&
    reason === "invalid_body" &&
    !credential &&
    taskOperationRequiresCredential(fresh.route, fresh.action)
  ) {
    // `parseApproveCommand`/`parseLedgerCommand` require memberName+pin, so a
    // credential-less re-send is refused 400 invalid_body BEFORE auth ever
    // runs. Same missing-PIN state as the 401 above, same honest re-prompt.
    return markAuthRequired(fresh, "pin_required", message);
  }
  if (status === 404 && reason === "unknown_task") {
    // A stranded id, not a broken chore: the device kept an id the server
    // re-keyed away, so the row is on screen but unaddressable. The row
    // cannot exist on the server — dropping it locally is the user's actual
    // intent and invents no server state. Deliberately narrow: only this
    // exact reason, only a 404, only a usable numeric taskId.
    const taskId = Number(fresh.payload.taskId);
    if (Number.isSafeInteger(taskId)) {
      return await acknowledgeEntry(fresh, { ...body, taskId, deleted: true });
    }
  }
  if (RETRYABLE_REASONS.has(reason) || status >= 500 || status === 408 || status === 425 || status === 429) {
    return markRetryable(fresh, reason || `http_${status}`, message);
  }
  if (DUPLICATE_REASONS.has(reason)) {
    // The server says this already happened — that IS the ack.
    return await acknowledgeEntry(fresh, { ...body, duplicate: true });
  }
  return markFailed(fresh, "validation", reason || `http_${status}`, message);
}

/** Sweep the parked local entries: anything older than 24h goes terminal. */
function sweepLocalExpiry(): void {
  const now = Date.now();
  for (const entry of readRaw()) {
    if (entry.status === "auth-required" || entry.status === "reconciling" || entry.status === "failed") continue;
    if (entry.serverQueued) continue;
    if (entry.status === "queued" && inFlightOperationIds.has(entry.operationId)) continue;
    if (now - createdMs(entry) < TASK_STORE_LOCAL_EXPIRY_MS) continue;
    // A PIN-requiring command with no credential in memory cannot be sent by
    // anything on this device until the PIN is entered again — call it what it
    // is (waiting on a PIN) instead of a network expiry that reads as "lost".
    if (!resolveTaskOutboxCredential(entry) && taskOperationRequiresCredential(entry.route, entry.action)) {
      markAuthRequired(entry, "pin_required", "Enter the PIN again to send this one.");
      continue;
    }
    markFailed(entry, "network", "queue_expired", "The family server could not be reached for over a day — try again.");
  }
}

/** How many due passes one flush may run: the first, plus one bounded catch-up
 * for work that arrived while the first was in flight. */
const TASK_OUTBOX_FLUSH_MAX_PASSES = 2;

/** Every task row a command addresses: a manage/claim `taskId` or an approval
 * `taskIds` array. Entries without task ids (config, redeem) never order. */
function taskIdsOf(entry: TaskOutboxEntry): number[] {
  const ids: number[] = [];
  const single = Number(entry.payload.taskId);
  if (Number.isSafeInteger(single)) ids.push(single);
  const many = entry.payload.taskIds;
  if (Array.isArray(many)) {
    for (const value of many) {
      const id = Number(value);
      if (Number.isSafeInteger(id)) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function isDueEntry(entry: TaskOutboxEntry): boolean {
  if (inFlightOperationIds.has(entry.operationId)) return false;
  if (entry.status === "failed") return false;
  if (entry.serverQueued && entry.serverStatus === "pending") return false;
  if (entry.status === "retrying") {
    const next = entry.nextAttemptAt ? Date.parse(entry.nextAttemptAt) : 0;
    return Number.isFinite(next) && next <= Date.now();
  }
  return entry.status === "queued" || entry.status === "reconciling";
}

/**
 * Same-task ordering: a later command on a task row must not overtake an
 * earlier non-terminal command on the same row, or the server could apply the
 * OLD value after the new one while the app's own ledger showed the new one.
 * Creation order is the store's array order (evictions keep it sorted by
 * createdAt); a `failed` entry is terminal and no longer holds.
 */
function heldByEarlierTaskCommand(entry: TaskOutboxEntry, all: TaskOutboxEntry[]): boolean {
  const ids = taskIdsOf(entry);
  if (!ids.length) return false;
  const index = all.indexOf(entry);
  for (let position = 0; position < index; position += 1) {
    const earlier = all[position];
    if (earlier.status === "failed") continue;
    if (taskIdsOf(earlier).some((id) => ids.includes(id))) return true;
  }
  return false;
}

/**
 * The flush: run the due filter, await every send, and re-run the filter once
 * for work enqueued while the first pass was in flight (batched to a bounded
 * two passes). Then poll the server queue once while it holds rows. Returns the
 * same counts the old outbox did, so the RewardsShop await and the
 * action-runner's `acknowledged > 0` keep working.
 */
export async function flushTaskOutbox(): Promise<FlushTaskOutboxResult> {
  attachStorageListener();
  sweepLocalExpiry();
  const result: FlushTaskOutboxResult = { acknowledged: 0, retryable: 0, permanent: 0 };
  const attempted = new Set<string>();
  for (let pass = 0; pass < TASK_OUTBOX_FLUSH_MAX_PASSES; pass += 1) {
    const all = readRaw();
    const due = all.filter(
      (entry) =>
        !attempted.has(entry.operationId) &&
        isDueEntry(entry) &&
        !heldByEarlierTaskCommand(entry, all),
    );
    if (!due.length) break;
    const sends = due.map((entry) => {
      attempted.add(entry.operationId);
      const promise = processEntry(entry).then((outcome) => {
        result.acknowledged += outcome.acknowledged;
        result.retryable += outcome.retryable;
        result.permanent += outcome.permanent;
        return outcome;
      });
      inFlightSends.add(promise);
      return promise.finally(() => inFlightSends.delete(promise));
    });
    await Promise.allSettled(sends);
  }
  const hasServerRows = readRaw().some((entry) => entry.serverQueued);
  if (hasServerRows) {
    try {
      await pollQueue();
    } catch {
      /* the poll reschedules itself */
    }
  }
  return result;
}

let flushScheduled = false;

export function requestTaskOutboxFlush(): Promise<FlushTaskOutboxResult> {
  if (flushScheduled) return Promise.resolve({ acknowledged: 0, retryable: 0, permanent: 0 });
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    return flushTaskOutbox();
  };
  if (typeof queueMicrotask === "function") {
    return new Promise((resolve) => {
      queueMicrotask(() => {
        run().then(resolve, (error: unknown) => {
          warnTaskOutboxFlushFailure(error);
          resolve({ acknowledged: 0, retryable: 0, permanent: 0 });
        });
      });
    });
  }
  return run().catch((error: unknown) => {
    warnTaskOutboxFlushFailure(error);
    return { acknowledged: 0, retryable: 0, permanent: 0 };
  });
}

// ---------------------------------------------------------------------------
// Enqueue / cancel / retry
// ---------------------------------------------------------------------------

export function enqueueTaskOperation(
  input: Omit<TaskOutboxEntry, "version" | "createdAt" | "attemptCount" | "status">,
): TaskOutboxEntry {
  const action = String(input.action ?? "").trim();
  if (!isSupportedTaskOperation(input.route, action)) {
    // The entry never exists, so nothing would ever evict this credential and
    // nothing would ever release it — a PIN in memory keyed to an id with no
    // record. The remembered credential is only safe once the enqueue that
    // justifies it has landed.
    forgetTaskCommandCredential(String(input.operationId ?? ""));
    throw new TypeError(`unsupported_task_operation:${String(input.route)}:${action}`);
  }
  const operationId = normalizeOperationId(input.operationId) ?? createTaskOperationId();
  const fresh: TaskOutboxEntry = {
    version: 1,
    operationId,
    route: input.route,
    action,
    payload: sanitizeTaskOperationPayload(input.route, action, input.payload),
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: "queued",
    displayTarget: sanitizeDisplayTarget(input.displayTarget),
  };
  const current = readRaw();
  const existing = current.find((candidate) => candidate.operationId === operationId);
  if (existing) {
    // Re-queuing a KNOWN operation id is a retry of the SAME command (the
    // RewardsShop double-tap window), never a new one: the LOCAL replay budget
    // resets on a user re-queue; the SERVER row's budget is preserved by the
    // server's idempotent enqueue. The flush is the sender.
    patchEntry(operationId, {
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: undefined,
      serverQueued: undefined,
      serverStatus: undefined,
    });
    return { ...existing, status: "queued", attemptCount: 0 };
  }
  const bounded = boundEntries([...current, fresh]);
  writeRaw(bounded.kept);
  scheduleEvictionNotify(bounded.evicted);
  notify();
  return fresh;
}

/** Silent removal (test/cleanup seam): no terminal event, no server mirror. */
export function removeTaskOutboxEntry(operationId: string): TaskOutboxEntry | null {
  return removeEntry(operationId);
}

export function cancelTaskOutboxEntry(operationId: string): boolean {
  const entry = readRaw().find((candidate) => candidate.operationId === operationId);
  if (!entry) return false;
  // A send is on the wire — the command may already be applied, and a cancel
  // that retracts it would lie about the server's state.
  if (inFlightOperationIds.has(operationId) || entry.status === "reconciling") return false;
  const removed = removeEntry(operationId);
  if (!removed) return false;
  forgetTaskCommandCredential(operationId);
  if (removed.serverQueued) {
    // Mirror the intent to the server row so every device releases it.
    void fetch("/api/tasks/queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId }),
      signal: AbortSignal.timeout(TASK_OUTBOX_REQUEST_TIMEOUT_MS),
    }).catch(() => {});
    seenResolvedOperationIds.add(operationId);
  }
  notifyAcknowledged({ operationId, action: removed.action });
  return true;
}

/** The "Try again" affordance: a failed entry goes back to queued and its
 * POST re-fires with the remembered credential (if any). Session-auth
 * commands just work; PIN commands answer honestly at tap time when the
 * credential is gone. */
export function retryTaskCommand(operationId: string): boolean {
  const entry = readRaw().find((candidate) => candidate.operationId === operationId);
  if (!entry || entry.status === "reconciling") return false;
  if (inFlightOperationIds.has(operationId)) return false;
  patchEntry(operationId, {
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: undefined,
    lastErrorCategory: undefined,
    lastErrorReason: undefined,
    lastErrorMessage: undefined,
    serverQueued: undefined,
    serverStatus: undefined,
  });
  void processEntry({ ...entry, status: "queued", attemptCount: 0 }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Snapshot pull + acknowledgement adoption (unchanged semantics)
// ---------------------------------------------------------------------------

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

async function adoptConfigAcknowledgement(acknowledgement: TaskOutboxAcknowledgement): Promise<void> {
  const kind = typeof acknowledgement.kind === "string" ? acknowledgement.kind : "";
  const items = Array.isArray(acknowledgement.items) ? acknowledgement.items : null;
  if (
    !items ||
    (kind !== "rewards" &&
      kind !== "penalties" &&
      kind !== "weekly-prizes" &&
      kind !== "task-templates")
  ) return;
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
  if (kind === "task-templates") {
    stores.saveTaskTemplates(items as never);
    if (updatedAt) stores.writeTaskTemplatesStamp(updatedAt);
    return;
  }
  stores.saveWeeklyPrizes(items as never);
  if (updatedAt) stores.writeWeeklyPrizesStamp(updatedAt);
}

/**
 * The acknowledgement's own clear decision, mirroring the pull gate exactly:
 * a paid earn for the row in the ack's week, or a send-back stamp that does
 * not pre-date the local row's own completion stamp. Used as the fallback when
 * either timestamp in `ackClearIsFreshEnough` is unreadable.
 */
function ackPullGateWouldClear(
  local: Task,
  acknowledgement: TaskOutboxAcknowledgement,
  ackRow: Task | undefined,
): boolean {
  const history = Array.isArray(acknowledgement.weekData?.history)
    ? acknowledgement.weekData!.history
    : [];
  const paidElsewhere = history.some(
    (tx) => tx?.type === "earn" && Number(tx?.taskId) === Number(local.id),
  );
  const sentBackAt = (ackRow as any)?.sentBackAt;
  const localDoneAt = Date.parse(String((local as any).pendingApproval?.at ?? local.completedAt ?? ""));
  const sentBackElsewhere =
    !!sentBackAt && (Number.isNaN(localDoneAt) || Date.parse(String(sentBackAt)) >= localDoneAt);
  return paidElsewhere || sentBackElsewhere;
}

/** The ack's copy of a cleared row: the server's own post-command row where it
 *  names one, else the local row with its pending record dropped. */
function ackClearedRow(local: Task, ackRow: Task | undefined): Task {
  if (!ackRow) return { ...local, pendingApproval: undefined };
  const source = ackRow as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...local };
  for (const key of [
    "completed",
    "completedBy",
    "completedAt",
    "completedInWeek",
    "pendingApproval",
    "sentBackAt",
    "awardedPoints",
    "crewSize",
    "crew",
    "speedBonus",
  ]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = source[key] ?? undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(source, "completed")) next.completed = local.completed;
  if (!Object.prototype.hasOwnProperty.call(source, "pendingApproval")) next.pendingApproval = undefined;
  return next as unknown as Task;
}

export async function adoptTaskOutboxAcknowledgement(
  acknowledgement: TaskOutboxAcknowledgement,
): Promise<void> {
  await adoptConfigAcknowledgement(acknowledgement);
  // A delete ack names the tombstoned row. Apply it locally NOW so the row is
  // gone the moment its optimistic hide is released — never resurrected by a
  // later add-only merge.
  if (acknowledgement.deleted === true && typeof acknowledgement.taskId === "number") {
    const stores = await import("@/lib/task-utils");
    const tombstoned = stores.loadDeletedTaskIds();
    if (!tombstoned.includes(acknowledgement.taskId)) {
      stores.saveDeletedTaskIds([...tombstoned, acknowledgement.taskId]);
    }
    const rows = stores.loadTasks();
    const remaining = rows.filter((task) => Number(task.id) !== acknowledgement.taskId);
    if (remaining.length !== rows.length) stores.saveTasks(remaining);
    return;
  }

  const stores = await import("@/lib/task-utils");
  // The ack-clear contract: a SNAPSHOT may be stale, so its clear needs proof
  // (the pull gate above); an ACK is the server's own receipt for a command
  // this device issued, so it needs only to be newer than the tap it claims to
  // clear. An unreconciled ack never clears anything. `ACK_CLEAR_AUTHORITATIVE
  // = false` restores the pre-B1a pull-gate-only path.
  const ackClearsRows =
    ACK_CLEAR_AUTHORITATIVE &&
    acknowledgement.reconciled !== false &&
    acknowledgement.repairRequired !== true;
  const ackRowsById = new Map<number, Task>();
  if (ackClearsRows) {
    if (Array.isArray(acknowledgement.clearedTasks)) {
      for (const row of acknowledgement.clearedTasks) {
        const id = Number((row as any)?.id);
        if (Number.isSafeInteger(id)) ackRowsById.set(id, row);
      }
    }
    const single = acknowledgement.task;
    const singleId = Number((single as any)?.id);
    if (single && Number.isSafeInteger(singleId) && !ackRowsById.has(singleId)) {
      ackRowsById.set(singleId, single);
    }
  }
  let tasks = stores.loadTasks();
  if (ackRowsById.size > 0) {
    const weekData = stores.loadWeekData();
    let changed = false;
    const next = tasks.map((local) => {
      const id = Number(local.id);
      const ackRow = ackRowsById.get(id);
      if (!ackRow) return local;
      const hasSomethingToClear = local.completed === true || !!local.pendingApproval;
      if (!hasSomethingToClear) return local;
      const pullGateWouldClear = ackPullGateWouldClear(local, acknowledgement, ackRow);
      if (!stores.ackClearIsFreshEnough(local, acknowledgement.commandCreatedAt, pullGateWouldClear)) {
        return local;
      }
      changed = true;
      return ackClearedRow(local, ackRow);
    });
    if (changed) {
      tasks = next;
      stores.saveTasks(tasks);
    }
  }
  if (acknowledgement.task) {
    const merged = stores.mergeTasksSnapshot(tasks, stores.loadWeekData(), {
      tasks: [acknowledgement.task as Task],
    });
    if (merged.tasksChanged) stores.saveTasks(merged.tasks);
    if (merged.weekChanged) stores.saveWeekData(merged.weekData);
  }
  if (acknowledgement.weekData) {
    stores.saveWeekData(
      stores.adoptAuthoritativeWeekData(stores.loadWeekData(), acknowledgement.weekData as WeekData),
    );
  }
}

// ---------------------------------------------------------------------------
// Warnings + test hooks
// ---------------------------------------------------------------------------

export function warnTaskOutboxFlushFailure(error: unknown): void {
  if (typeof console === "undefined") return;
  const name = error instanceof Error && error.name ? error.name : "unknown";
  console.warn("[task-commands] flush failed", name);
}

export function warnTaskOutboxRefreshFailure(error: unknown): void {
  if (typeof console === "undefined") return;
  const name = error instanceof Error && error.name ? error.name : "unknown";
  console.warn("[task-commands] cache refresh failed", name);
}

export function warnTaskOutboxStorageFailure(): void {
  if (typeof console === "undefined") return;
  console.warn("[task-commands] storage write degraded to memory only");
}

export function taskOutboxOrphanStorageIds(): string[] {
  return [];
}

export function __resetTaskOutboxForTests(): void {
  cache = null;
  unpersisted = new Map();
  legacyRehydrated = false;
  pendingEvictions = [];
  seenResolvedOperationIds.clear();
  for (const id of [...inFlightOperationIds]) clearSendInFlight(id);
  inFlightSends.clear();
  driver = {};
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(TASK_OUTBOX_STORAGE_KEY);
    } catch {
      /* already clean */
    }
  }
  notify();
}
