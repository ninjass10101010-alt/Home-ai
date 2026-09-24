import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import * as liveMember from "@/lib/live-member";
import type { LiveMember } from "@/lib/live-member";
import { localWeekStartISO } from "@/lib/local-date";
import { applyWeekLedgerOperationLocked } from "@/lib/ledger-operations";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { hasUnreversedTaskEarn } from "@/lib/task-ledger";
import {
  findCanonicalTask,
  getSnapshotOperationReceipts,
  liveSnapshotTasks,
  mutateSnapshotWithMeta,
  normalizeWeekData,
  projectCanonicalTaskToPB,
  readSnapshotStateWithRevision,
  type AdminPB,
  type CanonicalTaskLookup,
  type SnapshotData,
  type SnapshotOperationReceipt,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import {
  isRecord,
  normalizeOperationId,
  normalizeTimestamp,
} from "@/lib/task-operation-contract";
import {
  registerInternalTaskCommandHandler,
  type InternalTaskCommand,
  type InternalTaskCommandContext,
  type InternalTaskCommandResult,
} from "@/lib/task-commands";
import type {
  LedgerEntryInput,
  Transaction,
  WeekData,
} from "@/types/tasks";

export type ApproveAction = "approve" | "approve-all" | "send-back";

export interface ApproveCommand {
  operationId: string;
  action: ApproveAction;
  taskId?: number;
  taskIds?: number[];
  memberName: string;
  pin: string;
}

export interface ApproveResponse {
  success: true;
  operationId: string;
  weekData: WeekData;
  paid: number;
  cleared: number;
  skipped: number;
  reconciled: boolean;
  projectionFailures?: number[];
}

export type ApprovalFailureReason =
  | "invalid_body"
  | "invalid_action"
  | "invalid_task_id"
  | "forbidden_approval_payload"
  | "unauthorized"
  | "adult_only"
  | "member_roster_unavailable"
  | "unknown_task"
  | "ambiguous_task"
  | "invalid_task_state"
  | "operation_conflict"
  | "semantic_duplicate"
  | "ledger_unavailable"
  | "snapshot_write_failed"
  | "task_store_unavailable";

export interface ApprovalServiceResult {
  ok: boolean;
  operationId: string;
  action: ApproveAction;
  weekData: WeekData;
  paid: number;
  cleared: number;
  skipped: number;
  reconciled: boolean;
  duplicate?: boolean;
  projectionFailures?: number[];
  reason?: ApprovalFailureReason;
  task?: SnapshotTask;
}

export type ApproveParseResult =
  | ApproveCommand
  | { error: Extract<ApprovalFailureReason, "invalid_body" | "invalid_action" | "invalid_task_id" | "forbidden_approval_payload"> };

interface ApprovalActor {
  memberId: string;
  name: string;
  role: string;
}

interface ApprovalParseOptions {
  requireCredentials?: boolean;
}

const APPROVAL_ACTIONS = new Set<ApproveAction>(["approve", "approve-all", "send-back"]);
const TOP_LEVEL_KEYS = new Set(["action", "operationId", "taskId", "taskIds", "memberName", "pin"]);
const MAX_APPROVAL_TASKS = 500;

function parseError(
  error: Extract<ApprovalFailureReason, "invalid_body" | "invalid_action" | "invalid_task_id" | "forbidden_approval_payload">,
): ApproveParseResult {
  return { error };
}

function parseTaskId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseCredential(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

export function parseApproveCommand(
  value: unknown,
  options: ApprovalParseOptions = {},
): ApproveParseResult {
  if (!isRecord(value)) return parseError("invalid_body");
  const keys = Object.keys(value);
  if (keys.some((key) => !TOP_LEVEL_KEYS.has(key))) return parseError("forbidden_approval_payload");
  const action = value.action;
  if (typeof action !== "string" || !APPROVAL_ACTIONS.has(action as ApproveAction)) {
    return parseError("invalid_action");
  }
  const operationId = normalizeOperationId(value.operationId);
  if (!operationId || operationId.length > 200) return parseError("invalid_body");

  const requireCredentials = options.requireCredentials !== false;
  const memberName = requireCredentials ? parseCredential(value.memberName, 256) : undefined;
  const pin = requireCredentials ? parseCredential(value.pin, 128) : undefined;
  if (requireCredentials && (!memberName || !pin)) return parseError("invalid_body");
  if (!requireCredentials && (value.memberName !== undefined || value.pin !== undefined)) {
    return parseError("forbidden_approval_payload");
  }

  if (action === "approve" || action === "send-back") {
    if (value.taskIds !== undefined) return parseError("forbidden_approval_payload");
    const taskId = parseTaskId(value.taskId);
    if (!taskId) return parseError("invalid_task_id");
    return {
      operationId,
      action,
      taskId,
      ...(memberName ? { memberName } : {}),
      ...(pin ? { pin } : {}),
    } as ApproveCommand;
  }

  if (value.taskId !== undefined) return parseError("forbidden_approval_payload");
  if (!Array.isArray(value.taskIds) || value.taskIds.length === 0 || value.taskIds.length > MAX_APPROVAL_TASKS) {
    return parseError("invalid_task_id");
  }
  const taskIds: number[] = [];
  const seen = new Set<number>();
  for (const candidate of value.taskIds) {
    const taskId = parseTaskId(candidate);
    if (!taskId) return parseError("invalid_task_id");
    if (seen.has(taskId)) return parseError("invalid_task_id");
    seen.add(taskId);
    taskIds.push(taskId);
  }
  return {
    operationId,
    action,
    taskIds,
    ...(memberName ? { memberName } : {}),
    ...(pin ? { pin } : {}),
  } as ApproveCommand;
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

export function approvalCommandFingerprint(
  command: Pick<ApproveCommand, "operationId" | "action" | "taskId" | "taskIds">,
  actorId: string,
): string {
  const taskIds = command.action === "approve-all"
    ? [...(command.taskIds ?? [])].sort((left, right) => left - right)
    : command.taskId !== undefined
      ? [command.taskId]
      : [];
  return createHash("sha256")
    .update(JSON.stringify(stableValue({
      operationId: command.operationId,
      action: command.action,
      taskIds,
      actorId,
    })))
    .digest("hex");
}

export const taskApprovalCommandFingerprint = approvalCommandFingerprint;

export function approvalTaskIds(command: Pick<ApproveCommand, "action" | "taskId" | "taskIds">): number[] {
  return command.action === "approve-all"
    ? [...(command.taskIds ?? [])].sort((left, right) => left - right)
    : command.taskId !== undefined
      ? [command.taskId]
      : [];
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

function canonicalWeekStart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const weekStart = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === weekStart ? weekStart : null;
}

async function readWeek(pb: AdminPB, weekStart: string): Promise<WeekData> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const matching = (Array.isArray(rows) ? rows : []).filter(
    (row: any) => canonicalWeekStart(row?.weekStart) === weekStart,
  );
  if (matching.length > 1) throw new Error("ledger_write_conflict");
  if (matching.length === 0) return emptyWeekData(weekStart);
  const week = normalizeWeekData(matching[0]);
  if (!week || week.weekStart !== weekStart) throw new Error("invalid_week_data");
  return week;
}

function normalizeLiveRoster(value: unknown): LiveMember[] | null {
  if (!Array.isArray(value)) return null;
  const roster: LiveMember[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const role = typeof candidate.role === "string" ? candidate.role.trim() : "";
    if (!id || !name || !role || ids.has(id)) return null;
    ids.add(id);
    roster.push({
      id,
      name,
      role,
      ...(typeof candidate.emoji === "string" ? { emoji: candidate.emoji } : {}),
      ...(typeof candidate.age === "number" && Number.isFinite(candidate.age) ? { age: candidate.age } : {}),
    });
  }
  return roster;
}

async function loadLiveParent(actor: ApprovalActor): Promise<{ roster: LiveMember[]; parent: LiveMember } | ApprovalFailureReason> {
  let raw: unknown;
  try {
    raw = typeof liveMember.getLiveMembers === "function"
      ? await liveMember.getLiveMembers()
      : await withAdmin(async (pb) => {
          const rows = await pb.collection("members").getFullList({ requestKey: null });
          return Array.isArray(rows) ? rows : [];
        });
  } catch {
    return "member_roster_unavailable";
  }
  const roster = normalizeLiveRoster(raw);
  if (!roster) return "member_roster_unavailable";
  const parent = roster.find((member) => member.id === actor.memberId);
  if (!parent) return "unauthorized";
  if (parent.role.toLowerCase() !== "parent") return "adult_only";
  return { roster, parent };
}

function resolveHumanMember(roster: LiveMember[], value: unknown): LiveMember | null {
  if (typeof value !== "string") return null;
  const query = value.trim();
  if (!query) return null;
  const humans = roster.filter((member) => member.role.toLowerCase() !== "pet");
  const exact = humans.filter((member) => member.name.toLocaleLowerCase() === query.toLocaleLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const firstName = query.split(/\s+/)[0].toLocaleLowerCase();
  const firstMatches = humans.filter((member) => member.name.split(/\s+/)[0].toLocaleLowerCase() === firstName);
  return firstMatches.length === 1 ? firstMatches[0] : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function taskIsPending(task: SnapshotTask): boolean {
  return task.completed === true && recordValue(task.pendingApproval) !== null;
}

function pendingTimestamp(task: SnapshotTask): string | null {
  const pending = recordValue(task.pendingApproval);
  return pending ? normalizeTimestamp(pending.at) : null;
}

function parsePending(task: SnapshotTask): PendingIntent | "invalid" | null {
  const pending = recordValue(task.pendingApproval);
  if (!pending) return null;
  const raw = pending;
  const byName = typeof raw.byName === "string" ? raw.byName.trim() : "";
  const at = normalizeTimestamp(raw.at);
  if (!byName || !at) return "invalid";
  const amount = raw.points === undefined ? task.points : raw.points;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return "invalid";
  const crew = raw.crew === undefined
    ? null
    : Array.isArray(raw.crew)
      ? raw.crew
      : "invalid";
  if (crew === "invalid") return "invalid";
  if (crew !== null) {
    if (crew.length === 0) return "invalid";
    const names: string[] = [];
    const seen = new Set<string>();
    for (const name of crew) {
      if (typeof name !== "string" || !name.trim()) return "invalid";
      const trimmed = name.trim();
      if (seen.has(trimmed)) return "invalid";
      seen.add(trimmed);
      names.push(trimmed);
    }
    return { byName, at, amount, crew: names };
  }
  return { byName, at, amount, crew: null };
}

interface PendingIntent {
  byName: string;
  at: string;
  amount: number;
  crew: string[] | null;
}

function taskCrewMembers(task: SnapshotTask): Array<Record<string, unknown>> | null {
  const crew = recordValue(task.crew);
  if (!crew || !Array.isArray(crew.members) || !crew.members.every(isRecord)) return null;
  return crew.members;
}

function resolvePayees(
  task: SnapshotTask,
  pending: PendingIntent,
  roster: LiveMember[],
): string[] | "invalid" {
  if (pending.crew === null) {
    const member = resolveHumanMember(roster, pending.byName);
    if (!member) return "invalid";
    if (task.crewSize !== undefined && task.crewSize !== null && Number(task.crewSize) > 0) return "invalid";
    const ownerNames = [task.completedBy, task.assignee]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => resolveHumanMember(roster, value)?.name)
      .filter((value): value is string => Boolean(value));
    if (ownerNames.some((value) => value !== member.name)) return "invalid";
    return [member.name];
  }

  if (pending.byName !== "Crew") return "invalid";
  const members = taskCrewMembers(task);
  if (!members || typeof task.crewSize !== "number" || !Number.isSafeInteger(task.crewSize) || task.crewSize <= 0) {
    return "invalid";
  }
  const activeNames = new Set<string>();
  for (const member of members) {
    const name = typeof member.name === "string" ? member.name.trim() : "";
    if (!name || typeof member.joinedAt !== "string" || !member.joinedAt.trim()) return "invalid";
    if (activeNames.has(name)) return "invalid";
    activeNames.add(name);
  }
  const crew = recordValue(task.crew);
  const removed = crew && Array.isArray(crew.removed)
    ? crew.removed.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    : [];
  const removedNames = new Set(
    removed
      .map((name) => resolveHumanMember(roster, name)?.name ?? name.trim()),
  );
  if (pending.crew.length !== activeNames.size) return "invalid";
  const payees: string[] = [];
  for (const requested of pending.crew) {
    const member = resolveHumanMember(roster, requested);
    if (!member || !activeNames.has(member.name) || removedNames.has(member.name)) return "invalid";
    if (payees.includes(member.name)) return "invalid";
    payees.push(member.name);
  }
  for (const name of activeNames) {
    if (!payees.includes(name)) return "invalid";
  }
  return payees;
}

interface PreparedTask {
  id: number;
  lookup: CanonicalTaskLookup;
  task: SnapshotTask | null;
  receipt: SnapshotOperationReceipt | null;
  transactions: Transaction[];
  intent: PendingIntent | null;
  payees: string[];
  entries: LedgerEntryInput[];
  replay: boolean;
  skip: boolean;
}

interface PreparedCommand {
  tasks: PreparedTask[];
  week: WeekData;
  fingerprint: string;
  receipts: Map<number, SnapshotOperationReceipt>;
}

function operationTransactions(week: WeekData, operationId: string): Transaction[] {
  return week.history.filter((transaction) => transaction.meta?.operationId === operationId);
}

function validateOperationTransactions(
  transactions: Transaction[],
  command: ApproveCommand,
  fingerprint: string,
): { entries: LedgerEntryInput[]; byTask: Map<number, Transaction[]> } | "conflict" {
  if (transactions.length === 0) return { entries: [], byTask: new Map() };
  const requested = new Set(approvalTaskIds(command));
  const byTask = new Map<number, Transaction[]>();
  const entries: LedgerEntryInput[] = [];
  const seen = new Set<string>();
  for (const transaction of transactions) {
    if (
      transaction.type !== "earn" ||
      transaction.meta?.source !== "task-approval" ||
      transaction.meta?.fingerprint !== fingerprint ||
      transaction.taskId === undefined ||
      !requested.has(transaction.taskId) ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount < 0
    ) return "conflict";
    const key = `${transaction.taskId}:${transaction.member}`;
    if (seen.has(key)) return "conflict";
    seen.add(key);
    const entry: LedgerEntryInput = {
      type: transaction.type,
      member: transaction.member,
      amount: transaction.amount,
      description: transaction.description,
      taskId: transaction.taskId,
      ...(transaction.appliedBy === undefined ? {} : { appliedBy: transaction.appliedBy }),
    };
    entries.push(entry);
    const current = byTask.get(transaction.taskId) ?? [];
    current.push(transaction);
    byTask.set(transaction.taskId, current);
  }
  return { entries, byTask };
}

function receiptMap(
  data: SnapshotData,
  command: ApproveCommand,
  fingerprint: string,
): { receipts: Map<number, SnapshotOperationReceipt>; conflict: boolean } {
  const receipts = getSnapshotOperationReceipts(data, command.operationId);
  const requested = new Set(approvalTaskIds(command));
  const result = new Map<number, SnapshotOperationReceipt>();
  for (const receipt of receipts) {
    if (
      !requested.has(receipt.taskId) ||
      receipt.action !== command.action ||
      !receipt.fingerprint ||
      receipt.fingerprint !== fingerprint
    ) return { receipts: result, conflict: true };
    result.set(receipt.taskId, receipt);
  }
  return { receipts: result, conflict: false };
}

function entryDescription(task: SnapshotTask, pending: PendingIntent, weekStart: string, crew: boolean): string {
  const title = typeof task.title === "string" && task.title.trim() ? task.title.trim() : "task";
  const prefix = crew ? "Crew" : task.completedInWeek === weekStart ? "Completed" : "Approved";
  return `${prefix}: ${title}${pending.amount > 0 ? ` (+${pending.amount}pts)` : ""}`;
}

function freshEntries(
  task: SnapshotTask,
  pending: PendingIntent,
  payees: string[],
  weekStart: string,
): LedgerEntryInput[] {
  const description = entryDescription(task, pending, weekStart, pending.crew !== null);
  return payees.map((member) => ({
    type: "earn",
    member,
    amount: pending.amount,
    description,
    taskId: Number(task.id),
  }));
}

async function resolveTasks(
  pb: AdminPB,
  ids: number[],
  command: ApproveCommand,
  week: WeekData,
  fingerprint: string,
  roster: LiveMember[],
  snapshotData: SnapshotData,
  weekStart: string,
): Promise<PreparedCommand | ApprovalFailureReason> {
  const receiptState = receiptMap(snapshotData, command, fingerprint);
  if (receiptState.conflict) return "operation_conflict";
  const transactionState = validateOperationTransactions(
    operationTransactions(week, command.operationId),
    command,
    fingerprint,
  );
  if (transactionState === "conflict") return "operation_conflict";
  const byTransactionTask = transactionState.byTask;
  const prepared: PreparedTask[] = [];
  for (const id of ids) {
    let lookup: CanonicalTaskLookup;
    try {
      lookup = await findCanonicalTask(pb, id);
    } catch {
      return "task_store_unavailable";
    }
    const receipt = receiptState.receipts.get(id) ?? null;
    const transactions = byTransactionTask.get(id) ?? [];
    const task = lookup.task;
    if (lookup.ambiguous) return "ambiguous_task";
    if (command.action === "send-back") {
      if (receipt) {
        if (!task && !lookup.tombstoned) return "task_store_unavailable";
        prepared.push({ id, lookup, task, receipt, transactions, intent: null, payees: [], entries: [], replay: true, skip: false });
        continue;
      }
      if (lookup.ambiguous) return "ambiguous_task";
      if (lookup.tombstoned || !task) return "unknown_task";
      const pending = parsePending(task);
      if (pending === null) {
        prepared.push({ id, lookup, task, receipt, transactions, intent: null, payees: [], entries: [], replay: false, skip: true });
        continue;
      }
      if (pending === "invalid" || !taskIsPending(task as any)) return "invalid_task_state";
      prepared.push({ id, lookup, task, receipt, transactions, intent: pending, payees: [], entries: [], replay: false, skip: false });
      continue;
    }

    if (transactions.length > 0) {
      if (!task && !lookup.tombstoned) return "task_store_unavailable";
      const entries = transactions.map((transaction) => ({
        type: transaction.type,
        member: transaction.member,
        amount: transaction.amount,
        description: transaction.description,
        taskId: transaction.taskId,
        ...(transaction.appliedBy === undefined ? {} : { appliedBy: transaction.appliedBy }),
      })) as LedgerEntryInput[];
      prepared.push({ id, lookup, task, receipt, transactions, intent: null, payees: [], entries, replay: true, skip: false });
      continue;
    }
    if (receipt) return "ledger_unavailable";
    if (lookup.ambiguous) return "ambiguous_task";
    if (lookup.tombstoned || !task) return "unknown_task";
    const pending = parsePending(task);
    if (pending === null) {
      prepared.push({ id, lookup, task, receipt, transactions, intent: null, payees: [], entries: [], replay: false, skip: true });
      continue;
    }
    if (pending === "invalid" || !taskIsPending(task as any)) return "invalid_task_state";
    const payees = resolvePayees(task, pending, roster);
    if (payees === "invalid") return "invalid_task_state";
    const entries = freshEntries(task, pending, payees, weekStart);
    prepared.push({ id, lookup, task, receipt, transactions, intent: pending, payees, entries, replay: false, skip: false });
  }
  return { tasks: prepared, week, fingerprint, receipts: receiptState.receipts };
}

function mergeWeekData(storedValue: unknown, incoming: WeekData): WeekData {
  if (storedValue === undefined || storedValue === null) return incoming;
  const stored = normalizeWeekData(storedValue);
  if (!stored) throw new Error("invalid_stored_week_data");
  if (stored.weekStart > incoming.weekStart) return stored;
  if (stored.weekStart < incoming.weekStart) return incoming;
  const byId = new Map<number, Transaction>();
  for (const transaction of stored.history) byId.set(transaction.id, transaction);
  for (const transaction of incoming.history) byId.set(transaction.id, transaction);
  return {
    ...incoming,
    history: [...byId.values()].sort(
      (left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || left.id - right.id,
    ),
  };
}

function appendReceipt(
  data: SnapshotData,
  receipt: SnapshotOperationReceipt,
): SnapshotData {
  const existing = getSnapshotOperationReceipts(data, receipt.operationId)
    .filter((candidate) => candidate.taskId !== receipt.taskId);
  existing.push(receipt);
  existing.sort((left, right) => left.taskId - right.taskId);
  const operationReceipts: Record<string, SnapshotOperationReceipt[]> = Object.create(null) as Record<string, SnapshotOperationReceipt[]>;
  if (isRecord(data.operationReceipts)) {
    for (const [key, value] of Object.entries(data.operationReceipts)) {
      if (Array.isArray(value)) operationReceipts[key] = value as SnapshotOperationReceipt[];
    }
  }
  operationReceipts[receipt.operationId] = existing;
  return { ...data, operationReceipts };
}

function withoutRepairMarker(data: SnapshotData, operationId: string): SnapshotData {
  if (!("pendingProjectionRepairs" in data)) return data;
  const markers = Array.isArray(data.pendingProjectionRepairs)
    ? data.pendingProjectionRepairs.filter((marker) => marker.operationId !== operationId)
    : [];
  return { ...data, pendingProjectionRepairs: markers };
}

function withRepairMarker(data: SnapshotData, operationId: string, taskIds: number[]): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  const next = current.filter((marker) => marker.operationId !== operationId);
  next.push({ operationId, taskIds: [...new Set(taskIds)].sort((left, right) => left - right), createdAt: new Date().toISOString() });
  return { ...data, pendingProjectionRepairs: next };
}

interface SnapshotPatch {
  id: number;
  task: SnapshotTask | null;
  values: Record<string, unknown>;
  allowInsert: boolean;
  shouldApply: (task: SnapshotTask) => boolean;
}

interface SnapshotWriteOutcome {
  ok: boolean;
  cleared: number;
  conflict: boolean;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyApprovalSnapshot(
  pb: AdminPB,
  command: ApproveCommand,
  fingerprint: string,
  patches: SnapshotPatch[],
  weekData: WeekData | null,
): Promise<boolean> {
  const state = await readSnapshotStateWithRevision(pb);
  const receipts = getSnapshotOperationReceipts(state.data, command.operationId);
  if (weekData) {
    const snapshotWeek = normalizeWeekData(state.data.weekData);
    if (!snapshotWeek) return false;
    const ids = new Set(snapshotWeek.history.map((transaction) => transaction.id));
    if (weekData.history.some((transaction) => !ids.has(transaction.id))) return false;
  }
  for (const patch of patches) {
    if (patch.task === null) continue;
    const receipt = receipts.find(
      (candidate) => candidate.taskId === patch.id && candidate.fingerprint === fingerprint,
    );
    if (!receipt) return false;
    if (!patch.shouldApply(patch.task)) continue;
    const current = liveSnapshotTasks(state.data).find((task) => Number(task.id) === patch.id);
    if (!current) return false;
    for (const [key, expected] of Object.entries(patch.values)) {
      if (key === "crew") {
        if (!sameJson(current.crew, expected)) return false;
      } else if (current[key] !== expected) {
        const leftEmpty = current[key] === undefined || current[key] === null || current[key] === "";
        const rightEmpty = expected === undefined || expected === null || expected === "";
        if (!leftEmpty || !rightEmpty) return false;
      }
    }
  }
  return true;
}

function snapshotTaskMatchesValues(task: SnapshotTask, values: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(values)) {
    if (key === "crew") {
      if (!sameJson(task.crew, expected)) return false;
      continue;
    }
    if (task[key] === expected) continue;
    const leftEmpty = task[key] === undefined || task[key] === null || task[key] === "";
    const rightEmpty = expected === undefined || expected === null || expected === "";
    if (!leftEmpty || !rightEmpty) return false;
  }
  return true;
}

function snapshotHasRepairMarker(data: SnapshotData, operationId: string): boolean {
  return Array.isArray(data.pendingProjectionRepairs) && data.pendingProjectionRepairs.some(
    (marker) => marker.operationId === operationId,
  );
}

async function snapshotWriteAlreadySatisfied(
  pb: AdminPB,
  command: ApproveCommand,
  fingerprint: string,
  patches: SnapshotPatch[],
  weekData: WeekData | null,
): Promise<boolean> {
  const state = await readSnapshotStateWithRevision(pb);
  if (snapshotHasRepairMarker(state.data, command.operationId)) return false;
  const deletedTaskIds = new Set(
    Array.isArray(state.data.deletedTaskIds) ? state.data.deletedTaskIds.map((id) => Number(id)) : [],
  );
  if (patches.some((patch) => deletedTaskIds.has(patch.id))) return false;
  const receipts = getSnapshotOperationReceipts(state.data, command.operationId);
  if (patches.some((patch) => {
    if (patch.task === null) return false;
    const hasReceipt = receipts.some(
      (receipt) => receipt.taskId === patch.id && receipt.fingerprint === fingerprint,
    );
    if (!hasReceipt) return true;
    if (!patch.shouldApply(patch.task)) return false;
    const current = liveSnapshotTasks(state.data).find((task) => Number(task.id) === patch.id);
    return !current || !snapshotTaskMatchesValues(current, patch.values);
  })) return false;
  if (weekData) {
    const snapshotWeek = normalizeWeekData(state.data.weekData);
    if (!snapshotWeek) return false;
    const ids = new Set(snapshotWeek.history.map((transaction) => transaction.id));
    if (weekData.history.some((transaction) => !ids.has(transaction.id))) return false;
  }
  return true;
}

async function writeApprovalSnapshot(
  pb: AdminPB,
  command: ApproveCommand,
  fingerprint: string,
  patches: SnapshotPatch[],
  weekData: WeekData | null,
): Promise<SnapshotWriteOutcome> {
  try {
    if (await snapshotWriteAlreadySatisfied(pb, command, fingerprint, patches, weekData)) {
      return { ok: true, cleared: 0, conflict: false };
    }
    const mutation = await mutateSnapshotWithMeta<SnapshotWriteOutcome>((data) => {
      const receiptState = receiptMap(data, command, fingerprint);
      if (receiptState.conflict) return { data, result: { ok: false, cleared: 0, conflict: true } };
      let next = withoutRepairMarker(data, command.operationId);
      if (weekData) {
        next = { ...next, weekData: mergeWeekData(next.weekData, weekData), taskWeekStart: weekData.weekStart };
      }
      if ("tasks" in next && !Array.isArray(next.tasks)) {
        return { data, result: { ok: false, cleared: 0, conflict: true } };
      }
      const tasks = Array.isArray(next.tasks) ? [...next.tasks] : [];
      const tombstoned = new Set(
        Array.isArray(next.deletedTaskIds) ? next.deletedTaskIds.map((id) => Number(id)) : [],
      );
      let cleared = 0;
      for (const patch of patches) {
        if (tombstoned.has(patch.id)) {
          return { data, result: { ok: false, cleared: 0, conflict: true } };
        }
        const matching = tasks.filter((task) => Number(task.id) === patch.id);
        if (matching.length > 1) return { data, result: { ok: false, cleared: 0, conflict: true } };
        const current = matching[0];
        if (!current) {
          if (!patch.allowInsert || !patch.task) {
            continue;
          }
          tasks.push({ ...patch.task, ...patch.values } as SnapshotTask);
          cleared += 1;
          continue;
        }
        if (!patch.shouldApply(current)) continue;
        const index = tasks.findIndex((task) => Number(task.id) === patch.id);
        tasks[index] = { ...current, ...patch.values } as SnapshotTask;
        cleared += 1;
      }
      next = { ...next, tasks };
      for (const patch of patches) {
        if (patch.task === null && !tasks.some((task) => Number(task.id) === patch.id)) continue;
        if (patch.task === null && patch.values.pendingApproval === null) continue;
        const existing = getSnapshotOperationReceipts(next, command.operationId).find(
          (receipt) => receipt.taskId === patch.id,
        );
        if (existing) continue;
        next = appendReceipt(next, {
          operationId: command.operationId,
          action: command.action,
          taskId: patch.id,
          fingerprint,
          createdAt: new Date().toISOString(),
        });
      }
      return { data: next, result: { ok: true, cleared, conflict: false } };
    }, pb);
    if (!mutation.result.ok) return mutation.result;
    const verified = await verifyApprovalSnapshot(pb, command, fingerprint, patches, weekData);
    return verified
      ? mutation.result
      : { ok: false, cleared: 0, conflict: false };
  } catch {
    return { ok: false, cleared: 0, conflict: false };
  }
}

async function addRepairMarker(
  pb: AdminPB,
  operationId: string,
  taskIds: number[],
): Promise<boolean> {
  try {
    await mutateSnapshotWithMeta((data) => ({
      data: withRepairMarker(data, operationId, taskIds),
      result: null,
    }), pb);
    return true;
  } catch {
    return false;
  }
}

function stripCrewCheckins(task: SnapshotTask): unknown {
  const crew = recordValue(task.crew);
  if (!crew || !Array.isArray(crew.members)) return task.crew ?? null;
  const members = crew.members.filter(isRecord).map((member) => ({
    name: member.name,
    emoji: member.emoji,
    joinedAt: member.joinedAt,
  }));
  return {
    members,
    ...(Array.isArray(crew.removed) ? { removed: [...crew.removed] } : {}),
  };
}

function approvalPatch(prepared: PreparedTask, sendBack: boolean): SnapshotPatch | null {
  const task = prepared.task;
  if (sendBack) {
    if (!task) return null;
    const crew = stripCrewCheckins(task);
    return {
      id: prepared.id,
      task,
      allowInsert: true,
      values: {
        completed: false,
        status: "pending",
        completedBy: null,
        completedAt: null,
        completedInWeek: null,
        pendingApproval: null,
        sentBackAt: new Date().toISOString(),
        ...(crew !== undefined ? { crew } : {}),
      },
      shouldApply: (current) => {
        if (prepared.receipt) {
          if (!taskIsPending(current as any)) return false;
          const pendingAt = pendingTimestamp(current);
          return pendingAt !== null && Date.parse(pendingAt) <= Date.parse(prepared.receipt.createdAt);
        }
        return taskIsPending(current as any);
      },
    };
  }
  if (!task) return null;
  const values = { pendingApproval: null, sentBackAt: null };
  return {
    id: prepared.id,
    task,
    allowInsert: true,
    values,
    shouldApply: (current) => {
      if (prepared.replay) {
        if (!taskIsPending(current as any)) return false;
        const pendingAt = pendingTimestamp(current);
        const proofAt = prepared.transactions.reduce(
          (latest, transaction) => Date.parse(transaction.timestamp) > latest ? Date.parse(transaction.timestamp) : latest,
          0,
        );
        return pendingAt !== null && Date.parse(pendingAt) <= proofAt;
      }
      return taskIsPending(current as any);
    },
  };
}

function projectedTaskForPatch(prepared: PreparedTask, patch: SnapshotPatch | null | undefined): SnapshotTask | null {
  if (!prepared.task) return null;
  if (!patch) return prepared.task;
  return patch.shouldApply(prepared.task)
    ? { ...prepared.task, ...patch.values } as SnapshotTask
    : prepared.task;
}

function failure(
  operationId: string,
  action: ApproveAction,
  reason: ApprovalFailureReason,
  weekData: WeekData,
): ApprovalServiceResult {
  return {
    ok: false,
    operationId,
    action,
    weekData,
    paid: 0,
    cleared: 0,
    skipped: 0,
    reconciled: false,
    reason,
  };
}

function success(
  command: ApproveCommand,
  weekData: WeekData,
  paid: number,
  cleared: number,
  skipped: number,
  reconciled: boolean,
  projectionFailures: number[] = [],
  duplicate = false,
  task?: SnapshotTask,
): ApprovalServiceResult {
  return {
    ok: true,
    operationId: command.operationId,
    action: command.action,
    weekData,
    paid,
    cleared,
    skipped,
    reconciled,
    ...(projectionFailures.length > 0 ? { projectionFailures } : {}),
    ...(duplicate ? { duplicate: true } : {}),
    ...(task ? { task } : {}),
  };
}

async function executeSendBack(
  command: ApproveCommand,
  prepared: PreparedCommand,
): Promise<ApprovalServiceResult> {
  const activeItems = prepared.tasks.filter((item) => !item.skip);
  const patches: SnapshotPatch[] = [];
  for (const item of activeItems) {
    const patch = approvalPatch(item, true);
    if (patch) patches.push(patch);
  }
  if (activeItems.length === 0) {
    return success(command, prepared.week, 0, 0, 0, true);
  }
  let cleared = 0;
  let projectionFailures: number[] = [];
  let outcome = await withAdmin(async (pb) => {
    const snapshot = await writeApprovalSnapshot(pb, command, prepared.fingerprint, patches, null);
    if (!snapshot.ok) {
      projectionFailures = activeItems.map((item) => item.id);
      await addRepairMarker(pb, command.operationId, projectionFailures);
      return false;
    }
    cleared = snapshot.cleared;
    const failed: number[] = [];
    for (const item of prepared.tasks) {
      if (item.skip) continue;
      const patch = patches.find((candidate) => candidate.id === item.id);
      const projected = await projectCanonicalTaskToPB(
        pb,
        projectedTaskForPatch(item, patch),
        item.id,
      );
      if (!projected) failed.push(item.id);
    }
    if (failed.length > 0) {
      projectionFailures = failed;
      await addRepairMarker(pb, command.operationId, failed);
      return false;
    }
    return true;
  });
  if (!outcome) {
    return success(command, prepared.week, 0, cleared, 0, false, projectionFailures);
  }
  return success(command, prepared.week, 0, cleared, 0, true, [], false, prepared.tasks[0]?.task ?? undefined);
}

function hasUnreplayedSemanticDuplicate(
  week: WeekData,
  operationId: string,
  entries: LedgerEntryInput[],
): boolean {
  const operationEntries = new Set(
    week.history
      .filter((transaction) => transaction.meta?.operationId === operationId && transaction.taskId !== undefined)
      .map((transaction) => `${transaction.taskId}:${transaction.member}`),
  );
  return entries.some((entry) =>
    entry.type === "earn" &&
    entry.taskId !== undefined &&
    !operationEntries.has(`${entry.taskId}:${entry.member}`) &&
    hasUnreversedTaskEarn(week.history, entry.taskId, entry.member),
  );
}

async function executeApproval(
  command: ApproveCommand,
  prepared: PreparedCommand,
): Promise<ApprovalServiceResult> {
  const active = prepared.tasks.filter((item) => !item.skip);
  if (active.length === 0) {
    return success(command, prepared.week, 0, 0, 0, true);
  }
  const beforeIds = new Set(prepared.week.history.map((transaction) => transaction.id));
  const entries = active.flatMap((item) => item.entries);
  if (entries.length === 0) {
    return success(command, prepared.week, 0, 0, 0, true);
  }
  if (hasUnreplayedSemanticDuplicate(prepared.week, command.operationId, entries)) {
    return failure(command.operationId, command.action, "semantic_duplicate", prepared.week);
  }
  const weekStart = localWeekStartISO();
  let cleared = 0;
  let projectionFailures: number[] = [];
  let projectionConflict = false;
  const result = await applyWeekLedgerOperationLocked({
    weekStart,
    operation: {
      operationId: command.operationId,
      source: "task-approval",
      fingerprint: prepared.fingerprint,
      entries,
    },
    project: async ({ pb, weekData, semanticDuplicate }) => {
      if (semanticDuplicate) return true;
      const patches = active
        .map((item) => approvalPatch(item, false))
        .filter((patch): patch is SnapshotPatch => patch !== null);
      const snapshot = await writeApprovalSnapshot(pb, command, prepared.fingerprint, patches, weekData);
      if (!snapshot.ok) {
        projectionConflict = snapshot.conflict;
        projectionFailures = active.map((item) => item.id);
        await addRepairMarker(pb, command.operationId, projectionFailures);
        return false;
      }
      cleared = snapshot.cleared;
      const failed: number[] = [];
      for (const item of active) {
        const patch = patches.find((candidate) => candidate.id === item.id);
        const target = projectedTaskForPatch(item, patch);
        const projected = await projectCanonicalTaskToPB(pb, target, item.id);
        if (!projected) failed.push(item.id);
      }
      if (failed.length > 0) {
        projectionFailures = failed;
        await addRepairMarker(pb, command.operationId, failed);
        return false;
      }
      return true;
    },
  });
  if (!result.ok) {
    const reason: ApprovalFailureReason = result.code === "operation_conflict"
      ? "operation_conflict"
      : result.code === "invalid_ledger_operation"
        ? "invalid_task_state"
        : "ledger_unavailable";
    return failure(command.operationId, command.action, reason, result.weekData);
  }
  if (result.semanticDuplicate) {
    return failure(command.operationId, command.action, "semantic_duplicate", result.weekData);
  }
  if (projectionConflict) {
    return failure(command.operationId, command.action, "operation_conflict", result.weekData);
  }
  const paid = result.weekData.history.filter(
    (transaction) => transaction.meta?.operationId === command.operationId && !beforeIds.has(transaction.id),
  ).length;
  const skipped = paid === 0 && result.duplicate ? 0 : Math.max(0, entries.length - paid);
  return success(
    command,
    result.weekData,
    paid,
    cleared,
    skipped,
    result.reconciled,
    projectionFailures,
    result.duplicate,
    active[0]?.task ?? undefined,
  );
}

function withTaskLocks<T>(ids: number[], index: number, fn: () => Promise<T>): Promise<T> {
  if (index >= ids.length) return fn();
  return withTaskCommandLock(ids[index], () => withTaskLocks(ids, index + 1, fn));
}

export function executeApprovalCommand(
  command: ApproveCommand,
  actor: ApprovalActor,
): Promise<ApprovalServiceResult> {
  const parsed = parseApproveCommand(command, { requireCredentials: false });
  if ("error" in parsed) {
    return Promise.resolve(failure(
      command.operationId,
      command.action,
      parsed.error,
      emptyWeekData(localWeekStartISO()),
    ));
  }
  if (typeof actor?.memberId !== "string" || !actor.memberId.trim()) {
    return Promise.resolve(failure(command.operationId, command.action, "unauthorized", emptyWeekData(localWeekStartISO())));
  }
  const ids = approvalTaskIds(parsed);
  const weekStart = localWeekStartISO();
  return withWeekLedgerLock(weekStart, () => withTaskLocks(ids, 0, async () => {
    const live = await loadLiveParent(actor);
    if (typeof live === "string") return failure(command.operationId, parsed.action, live, emptyWeekData(weekStart));
    const fingerprint = approvalCommandFingerprint(parsed, live.parent.id);
    let prepared: PreparedCommand | ApprovalFailureReason;
    try {
      prepared = await withAdmin(async (pb) => {
        const week = await readWeek(pb, weekStart);
        const snapshot = await readSnapshotStateWithRevision(pb);
        return resolveTasks(pb, ids, parsed, week, fingerprint, live.roster, snapshot.data, weekStart);
      });
    } catch {
      return failure(command.operationId, parsed.action, "ledger_unavailable", emptyWeekData(weekStart));
    }
    if (typeof prepared === "string") {
      const week = emptyWeekData(weekStart);
      return failure(command.operationId, parsed.action, prepared, week);
    }
    try {
      if (parsed.action === "send-back") return await executeSendBack(parsed, prepared);
      return await executeApproval(parsed, prepared);
    } catch {
      return failure(command.operationId, parsed.action, "ledger_unavailable", prepared.week);
    }
  })).catch(() => failure(
    command.operationId,
    parsed.action,
    "task_store_unavailable",
    emptyWeekData(weekStart),
  ));
}

export function taskApprovalInternalPayload(command: ApproveCommand): Record<string, unknown> {
  return command.action === "approve-all" ? { taskIds: approvalTaskIds(command) } : { taskId: approvalTaskIds(command)[0] };
}

function decodeInternalCommand(command: InternalTaskCommand): ApproveCommand | null {
  if (!isRecord(command.payload)) return null;
  const allowed = command.kind === "approve-all"
    ? new Set(["taskIds"])
    : new Set(["taskId"]);
  if (Object.keys(command.payload).some((key) => !allowed.has(key))) return null;
  const parsed = parseApproveCommand({
    action: command.kind,
    operationId: command.operationId,
    ...command.payload,
  }, { requireCredentials: false });
  return "error" in parsed ? null : parsed;
}

async function handleCommand(
  command: InternalTaskCommand,
  context: InternalTaskCommandContext,
): Promise<InternalTaskCommandResult> {
  const parsed = decodeInternalCommand(command);
  if (!parsed) {
    return {
      ok: false,
      operationId: command.operationId,
      reason: "invalid_approval_command",
      reconciled: false,
    };
  }
  if (context.source !== "server") {
    return {
      ok: false,
      operationId: command.operationId,
      reason: "adult_only",
      reconciled: false,
    } as InternalTaskCommandResult;
  }
  const result = await executeApprovalCommand(parsed, {
    memberId: command.actor.memberId,
    name: command.actor.name,
    role: command.actor.role,
  });
  return result as unknown as InternalTaskCommandResult;
}

let handlersRegistered = false;
const cleanups: Array<() => void> = [];

export function ensureTaskApprovalHandlersRegistered(): void {
  if (handlersRegistered) return;
  cleanups.push(
    registerInternalTaskCommandHandler("approve", handleCommand),
    registerInternalTaskCommandHandler("approve-all", handleCommand),
    registerInternalTaskCommandHandler("send-back", handleCommand),
  );
  handlersRegistered = true;
}

export function unregisterTaskApprovalHandlersForTests(): void {
  while (cleanups.length) cleanups.pop()?.();
  handlersRegistered = false;
}

ensureTaskApprovalHandlersRegistered();
