import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import type { TaskManageErrorCode } from "@/lib/task-manage";
import type { TaskConfigErrorCode } from "@/lib/task-config";
import type {
  SnapshotConfigOperationReceipt,
  SnapshotData,
  SnapshotOperationReceipt,
  SnapshotRevision,
} from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";

/**
 * The pure operation-payload contract shared by the client command store and
 * the server-side command queue: which route+action pairs exist, which payload
 * keys each admits on the wire, how a credential attaches to a request body,
 * and the reason vocabularies used to classify a route's answer.
 *
 * This module is STORAGE-FREE and EVENT-FREE on purpose: the browser command
 * store (`task-command-store.ts`) and the server queue (`task-command-queue-server.ts`)
 * both build on it, and neither may pull the other's concerns in.
 */

export type TaskOperationRoute =
  | "/api/tasks/claim"
  | "/api/tasks/approve"
  | "/api/tasks/manage"
  | "/api/tasks/config"
  | "/api/tasks/ledger"
  | "/api/rewards/redeem";

export const TASK_OPERATION_ROUTES: readonly TaskOperationRoute[] = [
  "/api/tasks/claim",
  "/api/tasks/approve",
  "/api/tasks/manage",
  "/api/tasks/config",
  "/api/tasks/ledger",
  "/api/rewards/redeem",
];

const ROUTES = new Set<string>(TASK_OPERATION_ROUTES);

export type TaskOutboxErrorCategory =
  | "network"
  | "server"
  | "unauthorized"
  | "validation"
  | "semantic-duplicate"
  | "projection";

/**
 * The command statuses a client store entry can hold. A wrong PIN answers at
 * TAP time (a terminal `failed`), so `auth-required` is only ever set when a
 * PIN-requiring command has NO credential at all — the reload case: the entry
 * survives in localStorage, the in-memory PIN does not, so the send asks the
 * family for the PIN again instead of dying as an anonymous refusal.
 */
export type TaskOutboxStatus =
  | "queued"
  | "retrying"
  | "auth-required"
  | "reconciling"
  | "failed";

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
  lastErrorMessage?: string;
  credentialMissing?: boolean;
  nextAttemptAt?: string;
  status: TaskOutboxStatus;
  displayTarget: TaskOutboxDisplayTarget;
  /**
   * Server-queue marker (client entries only): the intake route answered
   * 202 { queued: true }, so PocketBase owns the retry ladder and this entry
   * now reflects the server's row state rather than a local send.
   */
  serverQueued?: boolean;
  /** The server row's status the last time the queue was polled. */
  serverStatus?: "pending" | "failed";
}

export interface TaskOutboxAcknowledgement {
  operationId: string;
  weekData?: WeekData;
  task?: Task;
  /** Every row a batched command (approve-all) cleared, one leg per task. */
  clearedTasks?: Task[];
  /**
   * The instant the command this ack answers was created (the client entry's
   * `createdAt`, or the server queue row's `created`). The ack-clear guard
   * refuses to clear a local row that was tapped AFTER this instant.
   */
  commandCreatedAt?: string;
  /** The tombstoned task on a delete ack (attached by the store). */
  taskId?: number;
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

export interface TaskOutboxSendResult {
  status: number;
  body: TaskOutboxAcknowledgement;
}

export interface FlushTaskOutboxResult {
  acknowledged: number;
  retryable: number;
  permanent: number;
}

export interface TaskOutboxAcknowledgedEvent {
  operationId?: string;
  action?: string;
  /**
   * The task row this acknowledgement belongs to, when the command names one
   * (`payload.taskId`, else the first of `payload.taskIds`, else the display
   * target). Consumers use it to release per-task guards for THIS task only;
   * an ack with no task id (config/redeem) legitimately names none.
   */
  taskId?: number;
  paid?: number;
  cleared?: number;
  skipped?: number;
  failed?: boolean;
  evicted?: boolean;
  reason?: string;
  category?: TaskOutboxErrorCategory;
  /** The server's own sentence on a 2xx that still needs to be told (D4). */
  error?: string;
}

const CLAIM_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  claim: ["taskId", "memberName", "assigneeEmoji"],
  complete: ["taskId", "memberName", "assigneeEmoji"],
  undo: ["taskId", "memberName", "assigneeEmoji"],
  "crew-join": ["taskId", "memberName", "assigneeEmoji"],
  "crew-checkin": ["taskId", "memberName", "assigneeEmoji"],
  "crew-remove": ["taskId", "memberName", "targetName"],
  "crew-close": ["taskId", "memberName"],
};

const APPROVE_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  approve: ["taskId", "memberName"],
  "approve-all": ["taskIds", "memberName"],
  "send-back": ["taskId", "memberName"],
};

// A parent-authoritative point movement: a catalog penalty or a manual adjust.
// `memberName` is the ACTOR whose PIN this command presents; `targetMemberName`
// is the member whose balance actually moves and is OPTIONAL, defaulting to the
// actor. Both must be admitted: a sanitizer that keeps only `memberName` turns a
// queued child-target command into a SELF-adjust against the parent on replay —
// the one thing the actor/target split exists to prevent, applied silently and
// only while the device was offline.
// A penalty carries an item id ONLY — the route refuses a client `points`
// outright and reads the canonical value from the config leg, so admitting the
// key here would advertise a field that can never be honoured. An adjust
// carries the signed amount and its reason. The resulting BALANCE is never a
// client input: the server re-derives it under the week-ledger lock.
const LEDGER_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  penalty: ["memberName", "targetMemberName", "itemId"],
  adjust: ["memberName", "targetMemberName", "amount", "reason"],
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
  "crewCloseMode",
  "expiresAfterDays",
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
  "crewCloseMode",
  "expiresAfterDays",
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
  "task-templates": [
    "id",
    "title",
    "points",
    "category",
    "priority",
    "mode",
    "assigneeName",
    "crewSize",
    "speedBonus",
    "expiresAfterDays",
  ],
};

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
  return table !== undefined && Object.prototype.hasOwnProperty.call(table, action);
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function pickKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (hasOwn(value, key)) picked[key] = value[key];
  }
  return picked;
}

const configItemKeysFor = (kind: string): readonly string[] | undefined => CONFIG_ITEM_KEYS[kind];

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

export const RETRYABLE_REASON_CODES = [
  "member_roster_unavailable",
  "ledger_unavailable",
  "snapshot_write_failed",
  "task_store_unavailable",
  "config_store_unreachable",
  "rollover_unavailable",
  "projection_reconcile_unavailable",
  "snapshot_unavailable",
  "projection_reconcile_pending",
] as const;

export const PERMANENT_REASON_CODES = ["operation_conflict", "stale_config"] as const;

export const DUPLICATE_REASON_CODES = [
  "semantic_duplicate",
  "already_completed",
  "already_claimed",
  "already_undone",
  "nothing_to_undo",
  "member_checked_in",
] as const;

export const RETRYABLE_REASONS: ReadonlySet<string> = new Set(RETRYABLE_REASON_CODES);
export const PERMANENT_REASONS: ReadonlySet<string> = new Set(PERMANENT_REASON_CODES);
export const DUPLICATE_REASONS: ReadonlySet<string> = new Set(DUPLICATE_REASON_CODES);

/**
 * The codes accepted as a MACHINE reason when a route delivers it through the
 * DISPLAY channel (`error`) rather than `reason` / `code`. A human sentence is
 * never a member, so a display string cannot impersonate a code and strand a
 * queued command. The hand-written list is kept honest against the manage and
 * config error unions by the two `AssertNever` guards below (tsc failures, not
 * silent degradations).
 */
const ERROR_CHANNEL_CODE_LIST = [
  ...RETRYABLE_REASON_CODES,
  ...PERMANENT_REASON_CODES,
  ...DUPLICATE_REASON_CODES,
  "adult_only",
  "config_natural_key_conflict",
  "forbidden_config_field",
  "forbidden_task_field",
  "invalid_body",
  "invalid_config_command",
  "invalid_current_config",
  "invalid_resulting_config",
  "invalid_task_command",
  "member_lookup_failed",
  "member_missing",
  "pet_assignee",
  "pet_target",
  "pin_required",
  "unknown_assignee",
  "unknown_task",
  "unsupported_task_command",
  "unauthorized",
] as const;

const ERROR_CHANNEL_MACHINE_CODES: ReadonlySet<string> = new Set(ERROR_CHANNEL_CODE_LIST);

type ErrorChannelMachineCode = (typeof ERROR_CHANNEL_CODE_LIST)[number];
type AssertNever<T extends never> = T;
export type EveryManageCodeIsClassified = AssertNever<
  Exclude<TaskManageErrorCode, ErrorChannelMachineCode>
>;
export type EveryConfigCodeIsClassified = AssertNever<
  Exclude<TaskConfigErrorCode, ErrorChannelMachineCode>
>;

function machineCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function reasonOf(body: TaskOutboxAcknowledgement): string {
  const declared = machineCode(body.reason) || machineCode(body.code);
  if (declared) return declared;
  const fallback = machineCode(body.error);
  return ERROR_CHANNEL_MACHINE_CODES.has(fallback) ? fallback : "";
}

const MAX_SERVER_MESSAGE_CHARS = 240;

function clampServerMessage(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_SERVER_MESSAGE_CHARS
    ? trimmed.slice(0, MAX_SERVER_MESSAGE_CHARS)
    : trimmed;
}

export function serverMessageOf(body: TaskOutboxAcknowledgement): string {
  const raw = typeof body.error === "string" ? body.error : "";
  return raw ? clampServerMessage(raw) : "";
}

// Which credential fields each route's own parser accepts on the wire. A
// bundle field that is NOT listed here can never reach the network, so a
// parent PIN cannot leak into a route that would reject the unknown key.
const CREDENTIAL_BODY_KEYS: Record<string, readonly (keyof TaskOutboxCredential)[]> = {
  "/api/tasks/claim": ["pin"],
  "/api/tasks/approve": ["pin"],
  "/api/tasks/ledger": ["pin"],
  "/api/rewards/redeem": ["pin", "parentPin"],
};

/**
 * Operations whose route parser refuses a credential-less body outright
 * (`/api/tasks/approve` and `/api/tasks/ledger` both `requireCredentials`).
 * A stored entry for one of these can only ever send with a credential, so a
 * 401 with no credential in memory means "the PIN is gone, ask again" — never
 * a terminal refusal and never a network expiry.
 */
const CREDENTIAL_REQUIRED_OPERATIONS: ReadonlySet<string> = new Set([
  "/api/tasks/approve:approve",
  "/api/tasks/approve:approve-all",
  "/api/tasks/approve:send-back",
  "/api/tasks/ledger:penalty",
  "/api/tasks/ledger:adjust",
]);

export function taskOperationRequiresCredential(route: string, action: string): boolean {
  return CREDENTIAL_REQUIRED_OPERATIONS.has(`${route}:${action}`);
}

function normalizeCredentialBundle(value: TaskOutboxCredential | undefined): TaskOutboxCredential | null {
  if (!value || typeof value !== "object") return null;
  const pin = typeof value.pin === "string" && value.pin.trim() ? value.pin.trim() : "";
  const parentPin =
    typeof value.parentPin === "string" && value.parentPin.trim() ? value.parentPin.trim() : "";
  if (!pin && !parentPin) return null;
  return { ...(pin ? { pin } : {}), ...(parentPin ? { parentPin } : {}) };
}

export function normalizeCredential(
  route: string,
  credential: TaskOutboxCredential | string | undefined,
): TaskOutboxCredential | null {
  if (credential === undefined) return null;
  const bundle =
    typeof credential === "string" ? { pin: credential } : (credential ?? undefined);
  const normalized = normalizeCredentialBundle(bundle);
  if (!normalized) return null;
  const admitted = CREDENTIAL_BODY_KEYS[route] ?? [];
  const allowed: TaskOutboxCredential = {};
  for (const key of admitted) {
    if (normalized[key]) (allowed as Record<string, string>)[key] = normalized[key] as string;
  }
  return Object.keys(allowed).length > 0 ? allowed : null;
}

export function buildTaskOperationRequestBody(
  entry: Pick<TaskOutboxEntry, "payload" | "action" | "operationId" | "route">,
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

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sanitizeDisplayTarget(value: unknown): TaskOutboxDisplayTarget {
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

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

/**
 * Parse one persisted entry. `auth-required` survives a reload verbatim: the
 * entry is waiting for a PIN the process no longer holds, which is a state the
 * family can act on — not a terminal refusal.
 */
export function parseTaskOperationEntry(value: unknown): TaskOutboxEntry | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const operationId = normalizeOperationId(value.operationId);
  const route = String(value.route ?? "");
  const action = String(value.action ?? "").trim();
  const createdAt = normalizeIso(value.createdAt);
  if (!operationId || !createdAt || !isSupportedTaskOperation(route, action)) return null;
  const rawStatus = String(value.status);
  const status = STATUSES.has(rawStatus) ? rawStatus : "queued";
  const attemptCount = Math.max(
    0,
    Math.min(1_000, Math.floor(typeof value.attemptCount === "number" ? value.attemptCount : 0)),
  );
  const category = ERROR_CATEGORIES.has(String(value.lastErrorCategory))
    ? (value.lastErrorCategory as TaskOutboxErrorCategory)
    : undefined;
  const nextAttemptAt = normalizeIso(value.nextAttemptAt);
  const serverStatus =
    value.serverStatus === "pending" || value.serverStatus === "failed" ? value.serverStatus : undefined;
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
    ...(typeof value.lastErrorMessage === "string" && value.lastErrorMessage.trim()
      ? { lastErrorMessage: clampServerMessage(value.lastErrorMessage) }
      : {}),
    ...(value.credentialMissing === true ? { credentialMissing: true } : {}),
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(value.serverQueued === true ? { serverQueued: true } : {}),
    ...(serverStatus ? { serverStatus } : {}),
    status: status as TaskOutboxStatus,
    displayTarget: sanitizeDisplayTarget(value.displayTarget),
  };
}

function cappedLadder(baseMs: number, capMs: number, step: number): number {
  const attempt = Math.max(1, Math.floor(step));
  return Math.min(baseMs * 2 ** (attempt - 1), capMs);
}

export const TASK_OUTBOX_BASE_BACKOFF_MS = 2_000;
export const TASK_OUTBOX_MAX_BACKOFF_MS = 5 * 60_000;

export function taskOutboxBackoffMs(attemptCount: number): number {
  return cappedLadder(TASK_OUTBOX_BASE_BACKOFF_MS, TASK_OUTBOX_MAX_BACKOFF_MS, attemptCount);
}

/** Monotonic-enough operation id, stable across the client and server seams. */
export function createTaskOperationId(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `task-op-${time}-${random}`.slice(0, 200);
}
