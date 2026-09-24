import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import * as liveMember from "@/lib/live-member";
import type { LiveMember } from "@/lib/live-member";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import { persistedCrewEmoji, persistedTaskEmoji } from "@/lib/task-emoji";
import {
  deleteSnapshotTask,
  getSnapshotOperationReceipts,
  liveSnapshotTasks,
  mutateSnapshotWithMeta,
  readSnapshotWithRevision,
  type SnapshotData,
  type SnapshotOperationReceipt,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import {
  hasForbiddenTaskCommandPayloadKey,
  isRecord,
  normalizeOperationId,
} from "@/lib/task-operation-contract";
import {
  registerInternalTaskCommandHandler,
  type InternalTaskCommand,
  type InternalTaskCommandContext,
  type InternalTaskCommandResult,
} from "@/lib/task-commands";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import type { Task } from "@/types/tasks";

export type ManageAction = "add" | "update" | "delete";

export type AddTaskCommand = {
  action: "add";
  operationId: string;
  task: Omit<
    Task,
    | "id"
    | "completed"
    | "completedBy"
    | "completedAt"
    | "completedInWeek"
    | "pendingApproval"
    | "sentBackAt"
  >;
};

export type UpdateTaskCommand = {
  action: "update";
  operationId: string;
  taskId: number;
  patch: Partial<
    Pick<
      Task,
      | "title"
      | "assignee"
      | "due"
      | "points"
      | "recurring"
      | "category"
      | "priority"
      | "universal"
      | "stealable"
      | "speedBonus"
      | "crewSize"
    >
  >;
};

export type DeleteTaskCommand = {
  action: "delete";
  operationId: string;
  taskId: number;
};

export type ManageTaskCommand = AddTaskCommand | UpdateTaskCommand | DeleteTaskCommand;

export type TaskManageErrorCode =
  | "invalid_task_command"
  | "forbidden_task_field"
  | "pet_assignee"
  | "unknown_assignee"
  | "unknown_task"
  | "operation_conflict"
  | "adult_only"
  | "member_roster_unavailable"
  | "snapshot_write_failed"
  | "task_store_unavailable";

export type TaskManageParseResult =
  | ManageTaskCommand
  | { error: TaskManageErrorCode };

export const TASK_MANAGE_MAX_TITLE_LENGTH = 200;
export const TASK_MANAGE_MAX_CATEGORY_LENGTH = 40;
export const TASK_MANAGE_MAX_EMOJI_LENGTH = 400_000;
export const TASK_MANAGE_MAX_TRANSPORT_LENGTH = 500_000;
export const TASK_MANAGE_MAX_POINTS = 100;
export const TASK_MANAGE_MAX_SPEED_BONUS = 5;
export const TASK_MANAGE_MIN_CREW_SIZE = 2;
export const TASK_MANAGE_MAX_CREW_SIZE = 5;
export const TASK_MANAGE_MAX_OPERATION_ID_LENGTH = 200;

const ADD_TASK_KEYS = new Set([
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
]);

const UPDATE_PATCH_KEYS = new Set([
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
]);

const TOP_LEVEL_KEYS: Record<ManageAction, Set<string>> = {
  add: new Set(["action", "operationId", "task"]),
  update: new Set(["action", "operationId", "taskId", "patch"]),
  delete: new Set(["action", "operationId", "taskId"]),
};

const FORBIDDEN_KEYS = new Set([
  "id",
  "taskid",
  "member",
  "memberid",
  "amount",
  "payee",
  "userid",
  "role",
  "claimant",
  "actor",
  "operationidentity",
  "status",
  "created",
  "createdat",
  "updated",
  "updatedat",
  "collectionid",
  "collectionname",
  "completed",
  "completedby",
  "completedat",
  "completedinweek",
  "completion",
  "pending",
  "pendingapproval",
  "sentbackat",
  "approval",
  "approvals",
  "deleted",
  "deletedtaskids",
  "tombstone",
  "tombstones",
  "weekdata",
  "history",
  "ledger",
  "ledgerdata",
  "transaction",
  "transactions",
  "transactionhistory",
  "pin",
  "pincode",
  "password",
  "passcode",
  "token",
  "secret",
  "authorization",
  "cookie",
  "bearer",
  "apikey",
  "session",
  "operationid",
  "opid",
]);

function invalidCommand(): TaskManageParseResult {
  return { error: "invalid_task_command" };
}

function forbiddenCommand(): TaskManageParseResult {
  return { error: "forbidden_task_field" };
}

function compactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenKey(key: string): boolean {
  const compact = compactKey(key);
  return (
    FORBIDDEN_KEYS.has(compact) ||
    compact.startsWith("member") ||
    compact.startsWith("amount") ||
    compact.startsWith("payee") ||
    compact.startsWith("user") ||
    compact.startsWith("role") ||
    compact.startsWith("claimant") ||
    compact.startsWith("actor") ||
    compact.startsWith("completed") ||
    compact.startsWith("completion") ||
    compact.includes("tombstone") ||
    compact.includes("approval") ||
    compact.includes("operationid") ||
    compact.startsWith("pin") ||
    compact.startsWith("password") ||
    compact.startsWith("passcode") ||
    compact.startsWith("token") ||
    compact.startsWith("secret") ||
    compact.startsWith("authorization") ||
    compact.startsWith("cookie") ||
    compact.startsWith("bearer") ||
    compact.startsWith("apikey") ||
    compact.startsWith("session")
  );
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => isForbiddenKey(key) || containsForbiddenKey(nested));
}

function positiveTaskId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseTaskId(value: unknown): number | null {
  return positiveTaskId(value) ? value : null;
}

function normalizedOperationId(value: unknown): string | null {
  const operationId = normalizeOperationId(value);
  return operationId && operationId.length <= TASK_MANAGE_MAX_OPERATION_ID_LENGTH
    ? operationId
    : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    Number(date.slice(0, 4)) < 1
  ) {
    return null;
  }
  return date;
}

function normalizedText(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
}

function canonicalEmoji(value: unknown, fallback = "👤"): string {
  if (typeof value !== "string") return fallback;
  const emoji = value.trim();
  if (
    !emoji ||
    emoji.length > TASK_MANAGE_MAX_EMOJI_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(emoji)
  ) {
    return fallback;
  }
  return emoji;
}

function normalizedRecurring(value: unknown): { ok: true; value: string | null } | null {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return null;
  const recurring = value.trim().toLowerCase();
  if (recurring === "" || recurring === "none") return { ok: true, value: null };
  if (recurring === "daily" || recurring === "weekdays" || recurring === "weekly") {
    return { ok: true, value: recurring };
  }
  return null;
}

function normalizedBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : null;
}

function normalizedPoints(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= TASK_MANAGE_MAX_POINTS
    ? value
    : null;
}

function normalizedSpeedBonus(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= TASK_MANAGE_MAX_SPEED_BONUS
    ? value
    : null;
}

function normalizedCrewSize(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value === null ? null : undefined;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= TASK_MANAGE_MIN_CREW_SIZE &&
    value <= TASK_MANAGE_MAX_CREW_SIZE
    ? value
    : null;
}

function findLiveMember(members: LiveMember[], value: unknown): LiveMember | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (!name) return null;
  const exactMatches = members.filter((member) => member.name.trim().toLowerCase() === name);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;
  const firstName = name.split(/\s+/)[0];
  const firstNameMatches = members.filter(
    (member) => member.name.trim().toLowerCase().split(/\s+/)[0] === firstName,
  );
  return firstNameMatches.length === 1 ? firstNameMatches[0] : null;
}

function isPetMember(member: LiveMember | null): boolean {
  return member?.role.trim().toLowerCase() === "pet";
}

function pseudoAssignee(value: unknown): "open" | "crew" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "open" || normalized === "all") return "open";
  if (normalized === "crew") return "crew";
  return null;
}

type TaskMode = "assigned" | "open" | "crew";

type TaskShapeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: TaskManageErrorCode };

function taskMode(raw: Record<string, unknown>): { ok: true; value: TaskMode } | null {
  const universal = raw.universal;
  if (universal !== undefined && typeof universal !== "boolean") return null;
  const crewSize = normalizedCrewSize(raw.crewSize);
  if (raw.crewSize !== undefined && raw.crewSize !== null && crewSize === null) return null;
  if (universal === true && crewSize !== undefined && crewSize !== null) return null;
  if (universal === true) return { ok: true, value: "open" };
  if (crewSize !== undefined && crewSize !== null) return { ok: true, value: "crew" };
  return { ok: true, value: "assigned" };
}

function taskShape(
  raw: Record<string, unknown>,
  members: LiveMember[],
  id: number,
  existing?: SnapshotTask,
): TaskShapeResult {
  const title = normalizedText(raw.title, TASK_MANAGE_MAX_TITLE_LENGTH);
  if (!title) return { ok: false, reason: "invalid_task_command" };
  if (
    raw.assigneeEmoji !== undefined &&
    (typeof raw.assigneeEmoji !== "string" || !canonicalEmoji(raw.assigneeEmoji, ""))
  ) {
    return { ok: false, reason: "invalid_task_command" };
  }
  const points = normalizedPoints(raw.points);
  if (points === null) return { ok: false, reason: "invalid_task_command" };
  const due = raw.due === undefined ? localTodayISO() : validDate(raw.due);
  if (!due) return { ok: false, reason: "invalid_task_command" };
  const category = normalizedText(
    raw.category === undefined ? "chores" : raw.category,
    TASK_MANAGE_MAX_CATEGORY_LENGTH,
  );
  if (!category) return { ok: false, reason: "invalid_task_command" };
  const priority = raw.priority === undefined ? "medium" : raw.priority;
  if (priority !== "high" && priority !== "medium" && priority !== "low") {
    return { ok: false, reason: "invalid_task_command" };
  }
  const recurring = normalizedRecurring(raw.recurring);
  if (!recurring) return { ok: false, reason: "invalid_task_command" };
  const mode = taskMode(raw);
  if (!mode) return { ok: false, reason: "invalid_task_command" };
  const universal = normalizedBoolean(raw.universal, mode.value === "open");
  const stealable = normalizedBoolean(raw.stealable, false);
  const speedBonus = raw.speedBonus === undefined
    ? mode.value === "open" ? 2 : 0
    : normalizedSpeedBonus(raw.speedBonus);
  if (universal === null || stealable === null || speedBonus === null) {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (mode.value !== "assigned" && stealable) {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (mode.value !== "open" && speedBonus !== 0) {
    return { ok: false, reason: "invalid_task_command" };
  }

  const crewSize = normalizedCrewSize(raw.crewSize);
  const existingCrewMembers = existing && Array.isArray(existing.crew?.members)
    ? existing.crew.members
    : [];
  const existingCrewRemoved = existing && Array.isArray(existing.crew?.removed)
    ? existing.crew.removed
    : [];
  if (
    existing &&
    mode.value !== "crew" &&
    (existingCrewMembers.length > 0 || existingCrewRemoved.length > 0)
  ) {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (mode.value === "crew" && existingCrewMembers.length > Number(crewSize)) {
    return { ok: false, reason: "invalid_task_command" };
  }

  const requestedAssignee = raw.assignee;
  if (requestedAssignee !== undefined && typeof requestedAssignee !== "string") {
    return { ok: false, reason: "invalid_task_command" };
  }
  const requestedMember = findLiveMember(members, requestedAssignee);
  if (isPetMember(requestedMember)) return { ok: false, reason: "pet_assignee" };

  let assignee: string;
  let assigneeEmoji: string;
  if (mode.value === "open") {
    assignee = "Open";
    assigneeEmoji = "🤝";
  } else if (mode.value === "crew") {
    assignee = "Crew";
    assigneeEmoji = "🤝";
  } else {
    if (!requestedMember) {
      if (requestedAssignee && pseudoAssignee(requestedAssignee)) {
        return { ok: false, reason: "unknown_assignee" };
      }
      return { ok: false, reason: "unknown_assignee" };
    }
    assignee = requestedMember.name.trim();
    assigneeEmoji = canonicalEmoji(requestedMember.emoji);
  }

  const output: Record<string, unknown> = {
    id,
    title,
    assignee,
    assigneeEmoji,
    due,
    points,
    recurring: recurring.value,
    category,
    priority,
    completed: existing?.completed === true,
    universal: mode.value === "open",
    stealable: mode.value === "assigned" ? stealable : false,
    crewSize: mode.value === "crew" ? crewSize : null,
    crew: mode.value === "crew"
      ? existing?.crew && typeof existing.crew === "object"
        ? existing.crew
        : { members: [], removed: [] }
      : null,
  };
  if (mode.value === "open") output.speedBonus = speedBonus;
  if (existing) {
    for (const key of [
      "completedBy",
      "completedAt",
      "completedInWeek",
      "pendingApproval",
      "sentBackAt",
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(existing, key)) output[key] = existing[key];
    }
  }
  return { ok: true, value: output };
}

function addShape(raw: Record<string, unknown>, members: LiveMember[], data: SnapshotData): TaskShapeResult {
  const id = allocateTaskId(data, Date.now());
  return taskShape(raw, members, id);
}

function updateShape(
  patch: Record<string, unknown>,
  existing: SnapshotTask,
  members: LiveMember[],
): TaskShapeResult {
  const merged = { ...existing, ...patch };
  if (patch.crewSize === undefined && merged.crewSize === 0) merged.crewSize = null;
  return taskShape(merged, members, Number(existing.id), existing);
}

function allocateTaskId(data: SnapshotData, now: number): number {
  const used = new Set<number>();
  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    const id = Number(task?.id);
    if (Number.isSafeInteger(id) && id > 0) used.add(id);
  }
  for (const id of Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds : []) {
    const numeric = Number(id);
    if (Number.isSafeInteger(numeric) && numeric > 0) used.add(numeric);
  }
  let candidate = now;
  for (const id of used) {
    if (id >= candidate) candidate = id + 1;
  }
  while (used.has(candidate)) candidate += 1;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new TypeError("task_id_exhausted");
  return candidate;
}

function addReceipt(data: SnapshotData, receipt: SnapshotOperationReceipt): SnapshotData {
  const operationId = receipt.operationId;
  const existing = getSnapshotOperationReceipts(data, operationId);
  const next = existing.filter((candidate) => candidate.taskId !== receipt.taskId);
  next.push(receipt);
  next.sort((left, right) => left.taskId - right.taskId);
  const operationReceipts: Record<string, any> = Object.create(null) as Record<string, any>;
  if (isRecord(data.operationReceipts)) {
    for (const [key, value] of Object.entries(data.operationReceipts)) operationReceipts[key] = value;
  }
  operationReceipts[operationId] = next;
  return { ...data, operationReceipts };
}

function receiptFor(
  data: SnapshotData,
  action: ManageAction,
  operationId: string,
  taskId: number | undefined,
  fingerprint: string,
): { conflict: boolean; receipt: SnapshotOperationReceipt | null } {
  const receipts = getSnapshotOperationReceipts(data, operationId);
  if (!receipts.length) return { conflict: false, receipt: null };
  if (receipts.some((receipt) => !receipt.fingerprint || receipt.fingerprint !== fingerprint)) {
    return { conflict: true, receipt: null };
  }
  const matching = taskId === undefined
    ? receipts.filter((receipt) => receipt.action === action)
    : receipts.filter((receipt) => receipt.action === action && receipt.taskId === taskId);
  if (!matching.length) return { conflict: true, receipt: null };
  if (receipts.some((receipt) => receipt.action !== action || (taskId !== undefined && receipt.taskId !== taskId))) {
    return { conflict: true, receipt: null };
  }
  if (action === "delete" && matching.some((receipt) => receipt.deleted !== true)) {
    return { conflict: true, receipt: null };
  }
  return { conflict: false, receipt: matching[0] };
}

function canonicalComparable(task: SnapshotTask): Record<string, unknown> {
  const fields = [
    "id",
    "title",
    "assignee",
    "assigneeEmoji",
    "due",
    "points",
    "recurring",
    "category",
    "priority",
    "completed",
    "universal",
    "stealable",
    "crewSize",
    "crew",
    "speedBonus",
    "completedBy",
    "completedAt",
    "completedInWeek",
    "pendingApproval",
    "sentBackAt",
  ];
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(task, field)) result[field] = task[field] ?? null;
  }
  return result;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function fingerprintValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    if (key === "recurring") {
      const recurring = text.toLowerCase();
      return recurring === "" || recurring === "none" ? null : recurring;
    }
    return text;
  }
  if (Array.isArray(value)) return value.map((entry) => fingerprintValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((entry) => value[entry] !== undefined)
        .map((entry) => [entry, fingerprintValue(value[entry], entry)]),
    );
  }
  return value;
}

export function taskManageCommandFingerprint(command: ManageTaskCommand): string {
  const payload = command.action === "add"
    ? { action: command.action, operationId: command.operationId, task: command.task }
    : command.action === "update"
      ? { action: command.action, operationId: command.operationId, taskId: command.taskId, patch: command.patch }
      : { action: command.action, operationId: command.operationId, taskId: command.taskId };
  return createHash("sha256")
    .update(JSON.stringify(fingerprintValue(payload)))
    .digest("hex");
}

function taskMatches(left: SnapshotTask, right: SnapshotTask): boolean {
  return sameValue(canonicalComparable(left), canonicalComparable(right));
}

function mutationVerified(
  data: SnapshotData,
  action: ManageAction,
  operationId: string,
  taskId: number,
  fingerprint: string,
  expectedTask: SnapshotTask | null,
): boolean {
  const receipt = receiptFor(data, action, operationId, taskId, fingerprint);
  if (receipt.conflict || !receipt.receipt) return false;
  if (action === "delete") {
    const tombstones = Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds.map(Number) : [];
    return tombstones.includes(taskId) && !liveSnapshotTasks(data).some((task) => Number(task.id) === taskId);
  }
  const task = liveSnapshotTasks(data).find((candidate) => Number(candidate.id) === taskId);
  return Boolean(task && expectedTask && taskMatches(task, expectedTask));
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function projectionValue(value: unknown): unknown {
  return parseJsonValue(value);
}

function optionalScalarEqual(key: string, left: unknown, right: unknown): boolean {
  if ((left === null || left === undefined || left === "") && (right === null || right === undefined || right === "")) return true;
  if ((key === "crewSize" || key === "speedBonus") && Number(left) === 0 && Number(right) === 0) return true;
  return left === right;
}

function projectionRecord(task: SnapshotTask): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title,
    assignee: task.assignee,
    assigneeEmoji: persistedTaskEmoji(task.assigneeEmoji) || "👤",
    assigned: task.assignee,
    status: task.completed ? "done" : "pending",
    due: task.due,
    points: task.points,
    recurring: task.recurring ?? null,
    category: task.category,
    priority: task.priority,
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

function projectionMatches(row: Record<string, any>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = ["crew", "pendingApproval"].includes(key)
      ? projectionValue(row[key])
      : row[key];
    if (["crew", "pendingApproval"].includes(key)) return sameValue(actualValue, expectedValue);
    if (["crewSize", "speedBonus", "completedBy", "completedAt", "completedInWeek", "sentBackAt", "recurring", "due"].includes(key)) {
      return optionalScalarEqual(key, actualValue, expectedValue);
    }
    return actualValue === expectedValue;
  });
}

async function taskRows(pb: any): Promise<Record<string, any>[]> {
  const rows = await pb.collection("tasks").getFullList({ requestKey: null });
  return Array.isArray(rows) ? rows as Record<string, any>[] : [];
}

async function projectUpsert(pb: any, task: SnapshotTask): Promise<boolean> {
  try {
    const collection = pb.collection("tasks");
    const before = await taskRows(pb);
    const matches = before
      .filter((row) => Number(row.taskId) === Number(task.id))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const expected = projectionRecord(task);
    if (matches.length === 1 && projectionMatches(matches[0], expected)) return true;
    if (matches[0] && !projectionMatches(matches[0], expected)) {
      await collection.update(matches[0].id, expected, { requestKey: null });
    } else if (!matches[0]) {
      await collection.create(expected, { requestKey: null });
    }
    const after = (await taskRows(pb)).filter((row) => Number(row.taskId) === Number(task.id));
    if (after.length === 0 || !projectionMatches(after[0], expected)) return false;
    for (const duplicate of after.slice(1)) {
      await collection.delete(duplicate.id, { requestKey: null });
    }
    const verified = (await taskRows(pb)).filter((row) => Number(row.taskId) === Number(task.id));
    return verified.length === 1 && projectionMatches(verified[0], expected);
  } catch {
    return false;
  }
}

async function projectDelete(pb: any, taskId: number): Promise<boolean> {
  try {
    const collection = pb.collection("tasks");
    const rows = (await taskRows(pb))
      .filter((row) => Number(row.taskId) === taskId)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    for (const row of rows) await collection.delete(row.id, { requestKey: null });
    return !(await taskRows(pb)).some((row) => Number(row.taskId) === taskId);
  } catch {
    return false;
  }
}

function failure(operationId: string, reason: TaskManageErrorCode): InternalTaskCommandResult {
  return { ok: false, operationId, reason, reconciled: false };
}

function success(
  operationId: string,
  task: SnapshotTask | null,
  revision: { revision: string; updatedAt: string },
  reconciled: boolean,
): InternalTaskCommandResult {
  return {
    ok: true,
    operationId,
    task: task ? (task as unknown as Task) : undefined,
    revision,
    reconciled,
  };
}

type DecodedPayload =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: TaskManageErrorCode };

function decodePayload(payload: Record<string, unknown>, action: ManageAction): DecodedPayload {
  if (hasForbiddenTaskCommandPayloadKey(payload)) {
    return { ok: false, reason: "forbidden_task_field" };
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "taskData" || typeof payload.taskData !== "string") {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (payload.taskData.length > TASK_MANAGE_MAX_TRANSPORT_LENGTH) {
    return { ok: false, reason: "invalid_task_command" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.taskData) as unknown;
  } catch {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "invalid_task_command" };
  }
  const allowedKeys = action === "add"
    ? ["task"]
    : action === "update"
      ? ["taskId", "patch"]
      : ["taskId"];
  if (Object.keys(parsed).some((key) => !allowedKeys.includes(key))) {
    return { ok: false, reason: "forbidden_task_field" };
  }
  const nested = { ...parsed };
  if (action !== "add") delete nested.taskId;
  if (containsForbiddenKey(nested)) {
    return { ok: false, reason: "forbidden_task_field" };
  }
  return { ok: true, value: parsed };
}

function encodePayload(command: ManageTaskCommand): Record<string, unknown> {
  if (command.action === "add") return { taskData: JSON.stringify({ task: command.task }) };
  if (command.action === "update") {
    return { taskData: JSON.stringify({ taskId: command.taskId, patch: command.patch }) };
  }
  return { taskData: JSON.stringify({ taskId: command.taskId }) };
}

function validateCommand(
  command: InternalTaskCommand,
  context: InternalTaskCommandContext,
): { ok: true; value: ManageTaskCommand; fingerprint: string } | { ok: false; reason: TaskManageErrorCode } {
  if (context.source !== "server" && context.source !== "hermes" && context.source !== "muse") {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (command.kind !== "add" && command.kind !== "update" && command.kind !== "delete") {
    return { ok: false, reason: "invalid_task_command" };
  }
  if (command.actor.role.trim().toLowerCase() !== "parent") {
    return { ok: false, reason: "adult_only" };
  }
  const operationId = normalizedOperationId(command.operationId);
  if (!operationId) return { ok: false, reason: "invalid_task_command" };
  const decoded = decodePayload(command.payload, command.kind);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const parsed = parseManageTaskCommand({
    action: command.kind,
    operationId,
    ...decoded.value,
  });
  if ("error" in parsed) return { ok: false, reason: parsed.error };
  return { ok: true, value: parsed, fingerprint: taskManageCommandFingerprint(parsed) };
}

type MutationResult = {
  duplicate: boolean;
  taskId: number;
  task: SnapshotTask | null;
  error?: TaskManageErrorCode;
  deleted?: boolean;
};

async function liveRoster(): Promise<LiveMember[]> {
  if (typeof liveMember.getLiveMembers === "function") return liveMember.getLiveMembers();
  return withAdmin(async (pb) => {
    const rows = await pb.collection("members").getFullList({ requestKey: null });
    return Array.isArray(rows) ? rows as unknown as LiveMember[] : [];
  });
}

async function handleCommand(
  command: InternalTaskCommand,
  context: InternalTaskCommandContext,
): Promise<InternalTaskCommandResult> {
  const operationId = normalizedOperationId(command.operationId) ?? "";
  const validated = validateCommand(command, context);
  if (!validated.ok) return failure(operationId, validated.reason);
  const parsed = validated.value;
  const fingerprint = validated.fingerprint;
  const action = parsed.action;
  let roster: LiveMember[] = [];
  if (action !== "delete") {
    try {
      roster = await liveRoster();
    } catch {
      return failure(operationId, "member_roster_unavailable");
    }
  }

  try {
    return await withWeekLedgerLock(localWeekStartISO(), () =>
      withAdmin(async (pb) => {
        const initial = await readSnapshotWithRevision();
        const requestedTaskId = action === "add" ? undefined : parsed.taskId;
        const existingReceipt = receiptFor(initial.data, action, operationId, requestedTaskId, fingerprint);
        if (existingReceipt.conflict) return failure(operationId, "operation_conflict");
        if (existingReceipt.receipt) {
          const taskId = existingReceipt.receipt.taskId;
          const task = action === "delete"
            ? null
            : liveSnapshotTasks(initial.data).find((candidate) => Number(candidate.id) === taskId) ?? null;
          if (action !== "delete" && !task) return failure(operationId, "snapshot_write_failed");
          const reconciled = action === "delete"
            ? await projectDelete(pb, taskId)
            : await projectUpsert(pb, task as SnapshotTask);
          return success(operationId, task, initial.revision, reconciled);
        }

        let preparedTask: SnapshotTask | null = null;
        let taskId: number;
        if (action === "add") {
          const shaped = addShape(parsed.task as Record<string, unknown>, roster, initial.data);
          if (!shaped.ok) return failure(operationId, shaped.reason);
          preparedTask = shaped.value as SnapshotTask;
          taskId = preparedTask.id;
        } else if (action === "update") {
          taskId = requestedTaskId!;
          const existing = liveSnapshotTasks(initial.data).find((candidate) => Number(candidate.id) === taskId);
          if (!existing) return failure(operationId, "unknown_task");
          const shaped = updateShape(parsed.patch as Record<string, unknown>, existing, roster);
          if (!shaped.ok) return failure(operationId, shaped.reason);
          preparedTask = shaped.value as SnapshotTask;
        } else {
          taskId = requestedTaskId!;
          const exists = liveSnapshotTasks(initial.data).some((candidate) => Number(candidate.id) === taskId);
          const deleted = (initial.data.deletedTaskIds || []).map(Number).includes(taskId);
          if (!exists && !deleted) return failure(operationId, "unknown_task");
        }

        const mutation = await mutateSnapshotWithMeta<MutationResult>(
          (data): { data: SnapshotData; result: MutationResult } => {
            const receipts = receiptFor(data, action, operationId, requestedTaskId, fingerprint);
            if (receipts.conflict) {
              return {
                data,
                result: { duplicate: false, error: "operation_conflict" as const, taskId: requestedTaskId ?? 0, task: null },
              };
            }
            const existingTaskReceipt = receipts.receipt;
            if (existingTaskReceipt) {
              const task = action === "delete"
                ? null
                : liveSnapshotTasks(data).find((candidate) => Number(candidate.id) === existingTaskReceipt.taskId) ?? null;
              return { data, result: { duplicate: true, taskId: existingTaskReceipt.taskId, task } };
            }
            if (action === "add") {
              const next = { ...(preparedTask as SnapshotTask) };
              next.id = allocateTaskId(data, Date.now());
              preparedTask = next;
              const receipt = {
                operationId,
                action,
                taskId: next.id,
                fingerprint,
                createdAt: new Date().toISOString(),
              };
              return { data: addReceipt({ ...data, tasks: [...(data.tasks || []), next] }, receipt), result: { duplicate: false, taskId: next.id, task: next } };
            }
            if (action === "update") {
              const current = liveSnapshotTasks(data).find((candidate) => Number(candidate.id) === taskId);
              if (!current) return { data, result: { duplicate: false, error: "unknown_task" as const, taskId, task: null } };
              const shaped = updateShape(parsed.patch as Record<string, unknown>, current, roster);
              if (!shaped.ok) return { data, result: { duplicate: false, error: shaped.reason, taskId, task: null } };
              const next = shaped.value as SnapshotTask;
              preparedTask = next;
              const receipt = {
                operationId,
                action,
                taskId,
                fingerprint,
                createdAt: new Date().toISOString(),
              };
              return { data: addReceipt({ ...data, tasks: (data.tasks || []).map((task) => Number(task.id) === taskId ? next : task) }, receipt), result: { duplicate: false, taskId, task: next } };
            }
            const tombstoned = deleteSnapshotTask(data, taskId);
            const receipt = {
              operationId,
              action,
              taskId,
              deleted: true,
              fingerprint,
              createdAt: new Date().toISOString(),
            };
            return { data: addReceipt(tombstoned, receipt), result: { duplicate: false, taskId, task: null, deleted: true } };
          },
          pb,
        );

        const mutationResult = mutation.result;
        if (mutationResult.error) return failure(operationId, mutationResult.error);
        if (mutationResult.duplicate) {
          const task = mutationResult.task;
          const reconciled = action === "delete"
            ? await projectDelete(pb, mutationResult.taskId)
            : await projectUpsert(pb, task as SnapshotTask);
          return success(operationId, task, mutation.revision, reconciled);
        }
        const verified = await readSnapshotWithRevision();
        const expectedTask = preparedTask;
        if (!mutationVerified(verified.data, action, operationId, mutationResult.taskId, fingerprint, expectedTask)) {
          return failure(operationId, "snapshot_write_failed");
        }
        const reconciled = action === "delete"
          ? await projectDelete(pb, mutationResult.taskId)
          : await projectUpsert(pb, expectedTask as SnapshotTask);
        return success(operationId, action === "delete" ? null : expectedTask, verified.revision, reconciled);
      }),
    );
  } catch {
    return failure(operationId, "snapshot_write_failed");
  }
}

let handlersRegistered = false;
const cleanups: Array<() => void> = [];

export function ensureTaskManageHandlersRegistered(): void {
  if (handlersRegistered) return;
  cleanups.push(
    registerInternalTaskCommandHandler("add", handleCommand),
    registerInternalTaskCommandHandler("update", handleCommand),
    registerInternalTaskCommandHandler("delete", handleCommand),
  );
  handlersRegistered = true;
}

export function unregisterTaskManageHandlersForTests(): void {
  while (cleanups.length) cleanups.pop()?.();
  handlersRegistered = false;
}

export function parseManageTaskCommand(value: unknown): TaskManageParseResult {
  if (!isRecord(value)) return invalidCommand();
  const action = value.action;
  if (action !== "add" && action !== "update" && action !== "delete") return invalidCommand();
  const allowedTopLevel = TOP_LEVEL_KEYS[action];
  if (Object.keys(value).some((key) => !allowedTopLevel.has(key))) return forbiddenCommand();
  const operationId = normalizedOperationId(value.operationId);
  if (!operationId) return invalidCommand();

  if (action === "add") {
    if (!isRecord(value.task)) return invalidCommand();
    if (Object.keys(value.task).some((key) => !ADD_TASK_KEYS.has(key))) return forbiddenCommand();
    if (containsForbiddenKey(value.task)) return forbiddenCommand();
    return { action, operationId, task: value.task as AddTaskCommand["task"] };
  }

  const taskId = parseTaskId(value.taskId);
  if (!taskId) return invalidCommand();
  if (action === "delete") return { action, operationId, taskId };
  if (!isRecord(value.patch) || Object.keys(value.patch).length === 0) return invalidCommand();
  if (Object.keys(value.patch).some((key) => !UPDATE_PATCH_KEYS.has(key))) return forbiddenCommand();
  if (containsForbiddenKey(value.patch)) return forbiddenCommand();
  return { action, operationId, taskId, patch: value.patch as UpdateTaskCommand["patch"] };
}

export function taskManageInternalPayload(command: ManageTaskCommand): Record<string, unknown> {
  return encodePayload(command);
}

ensureTaskManageHandlersRegistered();
