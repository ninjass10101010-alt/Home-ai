import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import * as liveMember from "@/lib/live-member";
import type { LiveMember } from "@/lib/live-member";
import { localWeekStartISO } from "@/lib/local-date";
import { applyWeekLedgerOperationLocked } from "@/lib/ledger-operations";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import { ensureCurrentTaskWeek } from "@/lib/task-week-rollover";
import { hasUnreversedTaskEarn, recomputeWeekPoints } from "@/lib/task-ledger";
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
  type TaskRowCache,
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
  LedgerOperationAction,
  Transaction,
  WeekData,
} from "@/types/tasks";

export type ApproveAction = "approve" | "approve-all" | "send-back";

const APPROVAL_REPAIR_ACTIONS = new Set<string>(["approve", "approve-all", "send-back"]);

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
  /** Award-list members dropped between close and approval (0 ⇒ omitted). */
  skipped?: number;
  reconciled: boolean;
  repairRequired: boolean;
  projectionFailures?: number[];
  task?: SnapshotTask | null;
  noCurrentTask?: boolean;
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
  | "repair_required"
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
  repairRequired: boolean;
  duplicate?: boolean;
  projectionFailures?: number[];
  reason?: ApprovalFailureReason;
  task?: SnapshotTask | null;
  noCurrentTask?: boolean;
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
  return { ...week, points: recomputeWeekPoints(week.history) };
}

function uniqueTransactions(groups: Transaction[][]): Transaction[] {
  const byId = new Map<number, Transaction>();
  for (const transaction of groups.flat()) {
    const previous = byId.get(transaction.id);
    if (previous && JSON.stringify(stableValue(previous)) !== JSON.stringify(stableValue(transaction))) {
      throw new Error("conflicting_transaction_id");
    }
    byId.set(transaction.id, transaction);
  }
  return [...byId.values()];
}

async function readOperationLedger(
  pb: AdminPB,
  authorityWeekStart: string,
  operationId: string,
): Promise<OperationLedgerSearch> {
  const currentWeek = await readWeek(pb, authorityWeekStart);
  const dataRows = await pb.collection("week_data").getFullList({ requestKey: null });
  const dataWeeks: WeekData[] = [];
  for (const row of Array.isArray(dataRows) ? dataRows : []) {
    const week = normalizeWeekData(row);
    if (!week) throw new Error("invalid_week_data");
    dataWeeks.push({ ...week, points: recomputeWeekPoints(week.history) });
  }
  const currentTransactions = currentWeek.history.filter(
    (transaction) => transaction.meta?.operationId === operationId,
  );
  const archiveRows = await pb.collection("week_archive").getFullList({ requestKey: null });
  const archiveWeeks: WeekData[] = [];
  for (const row of Array.isArray(archiveRows) ? archiveRows : []) {
    const week = normalizeWeekData(row);
    if (!week) throw new Error("invalid_archive_week_data");
    archiveWeeks.push({ ...week, points: recomputeWeekPoints(week.history) });
  }
  const allTransactions = uniqueTransactions([
    dataWeeks.flatMap((week) => week.history),
    archiveWeeks.flatMap((week) => week.history),
  ]).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) || left.id - right.id,
  );
  const archiveTransactions = uniqueTransactions(
    archiveWeeks.map((week) => week.history),
  ).filter((transaction) => transaction.meta?.operationId === operationId);
  return {
    currentWeek,
    currentTransactions,
    archiveTransactions,
    archiveWeeks,
    allTransactions,
  };
}

function normalizeLiveRoster(value: unknown): LiveMember[] | null {
  if (!Array.isArray(value)) return null;
  const roster: LiveMember[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
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

interface CanonicalCrew {
  members: LiveMember[];
  memberNames: Set<string>;
  removedNames: Set<string>;
}

function canonicalCrew(
  task: SnapshotTask,
  roster: LiveMember[],
  requireCheckedIn: boolean,
  requireFullSize = false,
  allowUnresolvedRemoved = false,
): CanonicalCrew | "invalid" {
  const rawCrew = task.crew;
  const crew = recordValue(rawCrew);
  const crewSize = task.crewSize;
  const hasCrewSize = crewSize !== undefined && crewSize !== null;
  if (hasCrewSize && (typeof crewSize !== "number" || !Number.isSafeInteger(crewSize) || crewSize < 0)) return "invalid";
  const hasCrew = rawCrew !== undefined && rawCrew !== null || (hasCrewSize && crewSize > 0);
  if (!hasCrew) {
    if (rawCrew !== undefined && rawCrew !== null) return "invalid";
    return { members: [], memberNames: new Set(), removedNames: new Set() };
  }
  if (!crew || !Array.isArray(crew.members) || !hasCrewSize || crewSize < 2) return "invalid";
  if (requireFullSize && crew.members.length < crewSize) return "invalid";
  const members: LiveMember[] = [];
  const memberNames = new Set<string>();
  const ids = new Set<string>();
  for (const rawMember of crew.members) {
    if (!isRecord(rawMember)) return "invalid";
    const name = typeof rawMember.name === "string" ? rawMember.name.trim() : "";
    const emoji = typeof rawMember.emoji === "string" ? rawMember.emoji : "";
    const joinedAt = typeof rawMember.joinedAt === "string" ? normalizeTimestamp(rawMember.joinedAt) : null;
    if (!name || !emoji || !joinedAt) return "invalid";
    if (requireCheckedIn && !normalizeTimestamp(rawMember.checkedInAt)) return "invalid";
    const live = resolveHumanMember(roster, name);
    if (!live || live.name !== name || ids.has(live.id) || memberNames.has(live.name)) return "invalid";
    ids.add(live.id);
    memberNames.add(live.name);
    members.push(live);
  }
  const removed = crew.removed === undefined ? [] : crew.removed;
  if (!Array.isArray(removed) || removed.some((name) => typeof name !== "string" || !name.trim())) return "invalid";
  const removedNames = new Set<string>();
  for (const name of removed) {
    const resolved = resolveHumanMember(roster, name);
    if (!resolved) {
      if (!allowUnresolvedRemoved) return "invalid";
      continue;
    }
    removedNames.add(resolved.name);
  }
  return { members, memberNames, removedNames };
}

function validateCrewForSendBack(task: SnapshotTask, roster: LiveMember[]): "valid" | "invalid" {
  // requireCheckedIn=false: send back must keep working on the partial pendings
  // this branch creates (spec §4) — a joined-but-never-checked-in member
  // (Bailey) would fail canonicalCrew's checkedInAt gate → 400
  // invalid_task_state on exactly the rows send-back exists to reopen.
  // Membership validation only, same rationale as resolvePayees below.
  return canonicalCrew(task, roster, false, false, true) === "invalid" ? "invalid" : "valid";
}

interface ResolvedPayees {
  payees: string[];
  skipped: string[];
}

function resolvePayees(
  task: SnapshotTask,
  pending: PendingIntent,
  roster: LiveMember[],
): ResolvedPayees | "invalid" {
  if (pending.crew === null) {
    const member = resolveHumanMember(roster, pending.byName);
    if (!member) return "invalid";
    if (task.crew !== undefined && task.crew !== null) return "invalid";
    if (task.crewSize !== undefined && task.crewSize !== null) {
      if (
        typeof task.crewSize !== "number" ||
        !Number.isSafeInteger(task.crewSize) ||
        task.crewSize < 0 ||
        task.crewSize > 0
      ) return "invalid";
    }
    const ownerValues = [task.completedBy, task.assignee];
    if (ownerValues.some((value) => typeof value !== "string" || !value.trim())) return "invalid";
    const owners = ownerValues.map((value) => resolveHumanMember(roster, value));
    if (owners.some((value) => !value || value.name !== member.name)) return "invalid";
    return { payees: [member.name], skipped: [] };
  }

  if (pending.byName !== "Crew") return "invalid";
  // requireCheckedIn=false, requireFullSize=false: pending.crew is the
  // AUTHORITATIVE award list (spec 2026-09-29 §4) — validate membership,
  // never recompute participation. The old (true, true) rejects partial
  // closes outright: a joined-but-never-checked-in member (Bailey) fails
  // canonicalCrew's checkedInAt gate → invalid_task_state on approve.
  const crewState = canonicalCrew(task, roster, false, false);
  if (crewState === "invalid") return "invalid";
  // pending.crew is the AUTHORITATIVE award list (spec 2026-09-29 §4):
  // strict closes list everyone, partial closes list the checked-in only.
  // Validate membership — do not recompute participation.
  const payees: string[] = [];
  const skipped: string[] = [];
  // Every requested entry is recorded in `seen` BEFORE the skip decisions:
  // a stored award list repeating a name — accepted or skipped, resolved or
  // not — is a malformed record = invalid (parsePending only catches
  // byte-identical strings, so "Bailey" + "Bailey Garcia" both reach here).
  const seen = new Set<string>();
  for (const requested of pending.crew) {
    const member = resolveHumanMember(roster, requested);
    const key = member ? member.name : requested.trim();
    if (seen.has(key)) return "invalid";
    seen.add(key);
    if (!member) { skipped.push(requested); continue; }
    if (!crewState.memberNames.has(member.name) || crewState.removedNames.has(member.name)) {
      skipped.push(member.name);
      continue;
    }
    payees.push(member.name);
  }
  if (payees.length === 0) return "invalid";
  return { payees, skipped };
}

interface OperationLedgerSearch {
  currentWeek: WeekData;
  currentTransactions: Transaction[];
  archiveTransactions: Transaction[];
  archiveWeeks: WeekData[];
  allTransactions: Transaction[];
}

interface PreparedTask {
  id: number;
  lookup: CanonicalTaskLookup;
  task: SnapshotTask | null;
  receipt: SnapshotOperationReceipt | null;
  transactions: Transaction[];
  intent: PendingIntent | null;
  payees: string[];
  skippedPayees: string[];
  entries: LedgerEntryInput[];
  expectedEntries: LedgerEntryInput[];
  replay: boolean;
  needsLedger: boolean;
  projectionInvalid: boolean;
  receiptOnly: boolean;
  skip: boolean;
}

interface PreparedCommand {
  tasks: PreparedTask[];
  week: WeekData;
  fingerprint: string;
  actorId?: string;
  action?: ApproveAction;
  taskIds?: number[];
  receipts: Map<number, SnapshotOperationReceipt>;
  search: OperationLedgerSearch;
}

function allOperationTransactions(
  search: OperationLedgerSearch,
  operationId: string,
): Transaction[] {
  return search.allTransactions.filter(
    (transaction) => transaction.meta?.operationId === operationId,
  );
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

function ledgerEntryKey(entry: Pick<LedgerEntryInput, "taskId" | "member">): string {
  return `${entry.taskId}:${entry.member}`;
}

function transactionMatchesEntry(transaction: Transaction, entry: LedgerEntryInput): boolean {
  return transaction.taskId === entry.taskId &&
    transaction.member === entry.member &&
    transaction.type === entry.type &&
    transaction.amount === entry.amount;
}

function replayLedgerEntries(
  prepared: PreparedCommand,
  operationId: string,
  expectedEntries: LedgerEntryInput[],
): { entries: LedgerEntryInput[]; conflict: boolean } {
  const allOperation = prepared.search.allTransactions.filter(
    (transaction) => transaction.meta?.operationId === operationId,
  );
  const currentOperation = prepared.search.currentTransactions;
  const allByKey = new Map<string, Transaction>();
  for (const transaction of allOperation) {
    const key = ledgerEntryKey(transaction);
    const previous = allByKey.get(key);
    if (previous && !transactionMatchesEntry(previous, {
      type: transaction.type,
      member: transaction.member,
      amount: transaction.amount,
      taskId: transaction.taskId,
      description: transaction.description,
    })) return { entries: [], conflict: true };
    allByKey.set(key, transaction);
  }
  const currentByKey = new Map(currentOperation.map((transaction) => [ledgerEntryKey(transaction), transaction]));
  const expectedKeys = new Set(expectedEntries.map(ledgerEntryKey));
  const entries: LedgerEntryInput[] = [];
  const seen = new Set<string>();
  for (const entry of expectedEntries) {
    const key = ledgerEntryKey(entry);
    const existing = allByKey.get(key);
    if (existing && !transactionMatchesEntry(existing, entry)) {
      return { entries: [], conflict: true };
    }
    if (currentByKey.has(key)) {
      const current = currentByKey.get(key)!;
      const currentEntry: LedgerEntryInput = {
        type: current.type,
        member: current.member,
        amount: current.amount,
        description: current.description,
        taskId: current.taskId,
        ...(current.appliedBy === undefined ? {} : { appliedBy: current.appliedBy }),
      };
      if (!seen.has(key)) {
        entries.push(currentEntry);
        seen.add(key);
      }
      continue;
    }
    if (!existing && !seen.has(key)) {
      entries.push(entry);
      seen.add(key);
    }
  }
  for (const key of allByKey.keys()) {
    if (!expectedKeys.has(key)) return { entries: [], conflict: true };
  }
  return { entries, conflict: false };
}

function operationEntriesComplete(
  prepared: PreparedCommand,
  operationId: string,
  expectedEntries: LedgerEntryInput[],
  currentWeek: WeekData,
): boolean {
  const transactions = [
    ...prepared.search.allTransactions,
    ...currentWeek.history,
  ].filter((transaction) => transaction.meta?.operationId === operationId);
  const byKey = new Map(transactions.map((transaction) => [ledgerEntryKey(transaction), transaction]));
  return expectedEntries.every((entry) => {
    const transaction = byKey.get(ledgerEntryKey(entry));
    return Boolean(transaction && transactionMatchesEntry(transaction, entry));
  });
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

function transactionEntries(transactions: Transaction[]): LedgerEntryInput[] {
  return transactions.map((transaction) => ({
    type: transaction.type,
    member: transaction.member,
    amount: transaction.amount,
    description: transaction.description,
    taskId: transaction.taskId,
    ...(transaction.appliedBy === undefined ? {} : { appliedBy: transaction.appliedBy }),
  })) as LedgerEntryInput[];
}

function hasLaterPending(task: SnapshotTask, transactions: Transaction[]): boolean {
  const pendingAt = pendingTimestamp(task);
  if (!pendingAt) return true;
  const proofAt = transactions.reduce(
    (latest, transaction) => Date.parse(transaction.timestamp) > latest ? Date.parse(transaction.timestamp) : latest,
    0,
  );
  return Date.parse(pendingAt) > proofAt;
}

async function resolveTasks(
  pb: AdminPB,
  ids: number[],
  command: ApproveCommand,
  week: WeekData,
  search: OperationLedgerSearch,
  fingerprint: string,
  roster: LiveMember[],
  snapshotData: SnapshotData,
  weekStart: string,
): Promise<PreparedCommand | ApprovalFailureReason> {
  const receiptState = receiptMap(snapshotData, command, fingerprint);
  if (receiptState.conflict) return "operation_conflict";
  const allTransactions = allOperationTransactions(search, command.operationId);
  const transactionState = validateOperationTransactions(allTransactions, command, fingerprint);
  if (transactionState === "conflict") return "operation_conflict";
  const byTransactionTask = transactionState.byTask;
  const hasCurrentTransactions = search.currentTransactions.length > 0;
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
    const committed = transactions.length > 0;
    const proofEntries = transactionEntries(transactions);
    if (lookup.ambiguous) {
      if (!committed) return "ambiguous_task";
      prepared.push({
        id, lookup, task: null, receipt, transactions, intent: null, payees: [], skippedPayees: [],
        entries: proofEntries, expectedEntries: proofEntries, replay: true,
        needsLedger: false, projectionInvalid: true, receiptOnly: true, skip: false,
      });
      continue;
    }
    if (command.action === "send-back") {
      if (receipt) {
        if (!task && !lookup.tombstoned) return "task_store_unavailable";
        prepared.push({
          id, lookup, task, receipt, transactions, intent: null, payees: [], skippedPayees: [],
          entries: [], expectedEntries: [], replay: true, needsLedger: false,
          projectionInvalid: false, receiptOnly: task === null, skip: false,
        });
        continue;
      }
      if (lookup.tombstoned || !task) return "unknown_task";
      const pending = parsePending(task);
      if (pending === null) {
        prepared.push({
          id, lookup, task, receipt, transactions, intent: null, payees: [], skippedPayees: [],
          entries: [], expectedEntries: [], replay: false, needsLedger: false,
          projectionInvalid: false, receiptOnly: false, skip: true,
        });
        continue;
      }
      if (pending === "invalid" || !taskIsPending(task as any) || validateCrewForSendBack(task, roster) === "invalid") {
        return "invalid_task_state";
      }
      prepared.push({
        id, lookup, task, receipt, transactions, intent: pending, payees: [], skippedPayees: [],
        entries: [], expectedEntries: [], replay: false, needsLedger: false,
        projectionInvalid: false, receiptOnly: false, skip: false,
      });
      continue;
    }

    if (committed) {
      if (task === null && !lookup.tombstoned) {
        prepared.push({
          id, lookup, task: null, receipt, transactions, intent: null, payees: [], skippedPayees: [],
          entries: proofEntries, expectedEntries: proofEntries, replay: true,
          needsLedger: hasCurrentTransactions, projectionInvalid: true,
          receiptOnly: true, skip: false,
        });
        continue;
      }
      let expectedEntries = proofEntries;
      let projectionInvalid = task === null || lookup.tombstoned;
      let intent: PendingIntent | null = null;
      let payees: string[] = [];
      let skippedPayees: string[] = [];
      if (task && !lookup.tombstoned) {
        const pending = parsePending(task);
        if (pending === "invalid") {
          projectionInvalid = true;
        } else if (pending && hasLaterPending(task, transactions)) {
          projectionInvalid = true;
        } else if (pending && task.sentBackAt != null) {
          projectionInvalid = true;
        } else if (pending) {
          const resolved = resolvePayees(task, pending, roster);
          if (resolved === "invalid") {
            projectionInvalid = true;
          } else {
            intent = pending;
            payees = resolved.payees;
            skippedPayees = resolved.skipped;
            expectedEntries = freshEntries(task, pending, resolved.payees, weekStart);
          }
        }
      }
      prepared.push({
        id, lookup, task, receipt, transactions, intent, payees,
        skippedPayees,
        entries: expectedEntries, expectedEntries, replay: true,
        needsLedger: hasCurrentTransactions, projectionInvalid,
        receiptOnly: task === null || lookup.tombstoned, skip: false,
      });
      continue;
    }
    if (receipt) return "ledger_unavailable";
    if (lookup.tombstoned || !task) return "unknown_task";
    const pending = parsePending(task);
    if (pending === null) {
      prepared.push({
        id, lookup, task, receipt, transactions, intent: null, payees: [], skippedPayees: [],
        entries: [], expectedEntries: [], replay: false, needsLedger: false,
        projectionInvalid: false, receiptOnly: false, skip: true,
      });
      continue;
    }
    if (pending === "invalid" || !taskIsPending(task as any)) return "invalid_task_state";
    if (task.sentBackAt != null) return "operation_conflict";
    const resolved = resolvePayees(task, pending, roster);
    if (resolved === "invalid") return "invalid_task_state";
    const entries = freshEntries(task, pending, resolved.payees, weekStart);
    prepared.push({
      id, lookup, task, receipt, transactions, intent: pending, payees: resolved.payees,
      skippedPayees: resolved.skipped,
      entries, expectedEntries: entries, replay: false, needsLedger: true,
      projectionInvalid: false, receiptOnly: false, skip: false,
    });
  }
  return { tasks: prepared, week, fingerprint, receipts: receiptState.receipts, search };
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

interface ApprovalIntent {
  actorId: string;
  action: ApproveAction;
  taskIds: number[];
  fingerprint: string;
}

function preparedIntent(prepared: PreparedCommand): ApprovalIntent | undefined {
  if (!prepared.actorId || !prepared.action || !prepared.taskIds || !prepared.fingerprint) return undefined;
  return {
    actorId: prepared.actorId,
    action: prepared.action,
    taskIds: [...prepared.taskIds].sort((left, right) => left - right),
    fingerprint: prepared.fingerprint,
  };
}

function withRepairMarker(
  data: SnapshotData,
  operationId: string,
  taskIds: number[],
  intent?: ApprovalIntent,
): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  const next = current.filter((marker) => marker.operationId !== operationId);
  next.push({
    operationId,
    taskIds: [...new Set(taskIds)].sort((left, right) => left - right),
    ...(intent ? {
      action: intent.action,
      actorId: intent.actorId,
      fingerprint: intent.fingerprint,
    } : {}),
    createdAt: new Date().toISOString(),
  });
  return { ...data, pendingProjectionRepairs: next };
}

interface SnapshotPatch {
  id: number;
  task: SnapshotTask | null;
  values: Record<string, unknown>;
  allowInsert: boolean;
  receiptOnly?: boolean;
  shouldApply: (task: SnapshotTask) => boolean;
}

interface SnapshotWriteOutcome {
  ok: boolean;
  cleared: number;
  conflict: boolean;
}

function sameCanonicalWeek(left: WeekData, right: WeekData): boolean {
  const canonicalLeft = { ...left, points: recomputeWeekPoints(left.history) };
  const canonicalRight = { ...right, points: recomputeWeekPoints(right.history) };
  return JSON.stringify(stableValue(canonicalLeft)) === JSON.stringify(stableValue(canonicalRight));
}

function sameSnapshotTaskState(left: SnapshotTask, right: SnapshotTask): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

async function verifyApprovalSnapshot(
  pb: AdminPB,
  command: ApproveCommand,
  fingerprint: string,
  patches: SnapshotPatch[],
  weekData: WeekData | null,
): Promise<boolean> {
  const state = await readSnapshotStateWithRevision(pb);
  const receiptState = receiptMap(state.data, command, fingerprint);
  if (receiptState.conflict) return false;
  const receipts = getSnapshotOperationReceipts(state.data, command.operationId);
  if (weekData) {
    if (state.data.taskWeekStart !== weekData.weekStart) return false;
    const snapshotWeek = normalizeWeekData(state.data.weekData);
    if (!snapshotWeek || !sameCanonicalWeek(snapshotWeek, weekData)) return false;
  }
  for (const patch of patches) {
    const receipt = receipts.find(
      (candidate) => candidate.taskId === patch.id && candidate.fingerprint === fingerprint,
    );
    if (!receipt) return false;
    if (patch.receiptOnly || patch.task === null || !patch.shouldApply(patch.task)) continue;
    const current = liveSnapshotTasks(state.data).find((task) => Number(task.id) === patch.id);
    if (!current) return false;
    const expected = { ...patch.task, ...patch.values } as SnapshotTask;
    if (!sameSnapshotTaskState(current, expected)) return false;
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
  if (patches.some((patch) => !patch.receiptOnly && deletedTaskIds.has(patch.id))) return false;
  return verifyApprovalSnapshot(pb, command, fingerprint, patches, weekData);
}

async function writeApprovalSnapshot(
  pb: AdminPB,
  command: ApproveCommand,
  fingerprint: string,
  patches: SnapshotPatch[],
  weekData: WeekData | null,
  intent?: ApprovalIntent,
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
        if (tombstoned.has(patch.id) && !patch.receiptOnly) {
          return { data, result: { ok: false, cleared: 0, conflict: true } };
        }
        if (patch.receiptOnly) {
          cleared += 1;
          continue;
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
        if (patch.task === null && !patch.receiptOnly) continue;
        const existing = getSnapshotOperationReceipts(next, command.operationId).find(
          (receipt) => receipt.taskId === patch.id,
        );
        if (existing) continue;
        next = appendReceipt(next, {
          operationId: command.operationId,
          action: command.action,
          taskId: patch.id,
          fingerprint,
          ...(intent?.actorId ? { actorId: intent.actorId } : {}),
          ...(intent?.taskIds ? { taskIds: intent.taskIds } : {}),
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
  intent?: ApprovalIntent,
): Promise<boolean> {
  try {
    await mutateSnapshotWithMeta((data) => ({
      data: withRepairMarker(
        data,
        operationId,
        intent?.taskIds ?? taskIds,
        intent,
      ),
      result: null,
    }), pb);
    return true;
  } catch {
    return false;
  }
}

function stripCrewCheckins(task: SnapshotTask): { ok: true; value: unknown } | "invalid" {
  const rawCrew = task.crew;
  const crew = recordValue(rawCrew);
  if (rawCrew === undefined || rawCrew === null) return { ok: true, value: null };
  if (!crew || !Array.isArray(crew.members)) return "invalid";
  if (crew.removed !== undefined && (!Array.isArray(crew.removed) || crew.removed.some((name) => typeof name !== "string"))) return "invalid";
  const members = crew.members.map((member) => {
    if (!isRecord(member)) return null;
    return {
      name: member.name,
      emoji: member.emoji,
      joinedAt: member.joinedAt,
    };
  });
  if (members.some((member) => member === null)) return "invalid";
  return {
    ok: true,
    value: {
      members,
      ...(Array.isArray(crew.removed) ? { removed: [...crew.removed] } : {}),
    },
  };
}

function approvalPatch(prepared: PreparedTask, sendBack: boolean): SnapshotPatch | null {
  const task = prepared.task;
  if (sendBack) {
    if (!task) {
      return {
        id: prepared.id,
        task: null,
        values: {},
        allowInsert: false,
        receiptOnly: true,
        shouldApply: () => false,
      };
    }
    const crewResult = stripCrewCheckins(task);
    if (crewResult === "invalid" && !prepared.receipt) return null;
    const crew = crewResult === "invalid" ? task.crew : crewResult.value;
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
  if (!task) {
    return {
      id: prepared.id,
      task: null,
      values: {},
      allowInsert: false,
      receiptOnly: true,
      shouldApply: () => false,
    };
  }
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
    repairRequired: false,
    reason,
  };
}

function repairRequiredFailure(
  operationId: string,
  action: ApproveAction,
  week: WeekData,
): ApprovalServiceResult {
  return {
    ok: false,
    operationId,
    action,
    weekData: week,
    paid: 0,
    cleared: 0,
    skipped: 0,
    reconciled: false,
    repairRequired: true,
    reason: "repair_required",
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
  task?: SnapshotTask | null,
  noCurrentTask = false,
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
    repairRequired: !reconciled,
    ...(projectionFailures.length > 0 ? { projectionFailures } : {}),
    ...(duplicate ? { duplicate: true } : {}),
    ...(task !== undefined ? { task } : {}),
    ...(noCurrentTask ? { noCurrentTask: true } : {}),
  };
}

async function executeSendBack(
  command: ApproveCommand,
  prepared: PreparedCommand,
  preloadedTaskRows?: TaskRowCache,
): Promise<ApprovalServiceResult> {
  const activeItems = prepared.tasks.filter((item) => !item.skip);
  const patches: SnapshotPatch[] = [];
  for (const item of activeItems) {
    const patch = approvalPatch(item, true);
    if (!patch) return failure(command.operationId, command.action, "invalid_task_state", prepared.week);
    patches.push(patch);
  }
  if (activeItems.length === 0) {
    return success(command, prepared.week, 0, 0, 0, true);
  }
  let cleared = 0;
  let projectionFailures: number[] = [];
  let snapshotDurable = true;
  let projectedTask: SnapshotTask | null = null;
  let noCurrentTask = false;
  let outcome = false;
  try {
    outcome = await withAdmin(async (pb) => {
    const snapshot = await writeApprovalSnapshot(pb, command, prepared.fingerprint, patches, null, preparedIntent(prepared));
    if (!snapshot.ok) {
      snapshotDurable = false;
      projectionFailures = activeItems.map((item) => item.id);
      return false;
    }
    cleared = snapshot.cleared;
    const failed: number[] = [];
    for (const item of activeItems) {
      const patch = patches.find((candidate) => candidate.id === item.id);
      const projected = await projectCanonicalTaskToPB(
        pb,
        projectedTaskForPatch(item, patch),
        item.id,
        preloadedTaskRows,
      );
      if (!projected) failed.push(item.id);
    }
    if (failed.length > 0) {
      projectionFailures = failed;
      await addRepairMarker(pb, command.operationId, failed, preparedIntent(prepared));
      return false;
    }
    const current = await readProjectedTask(pb, activeItems[0].id);
    projectedTask = current.task;
    noCurrentTask = current.noCurrentTask;
    return true;
      });
    } catch {
      return failure(command.operationId, command.action, "snapshot_write_failed", prepared.week);
    }
  if (!snapshotDurable) {
    return failure(command.operationId, command.action, "snapshot_write_failed", prepared.week);
  }
  if (!outcome) {
    return success(command, prepared.week, 0, cleared, 0, false, projectionFailures, false, projectedTask, noCurrentTask);
  }
  return success(command, prepared.week, 0, cleared, 0, true, [], false, projectedTask, noCurrentTask);
}

function hasUnreplayedSemanticDuplicate(
  search: OperationLedgerSearch,
  operationId: string,
  entries: LedgerEntryInput[],
): boolean {
  const operationEntries = new Set(
    search.allTransactions
      .filter((transaction) => transaction.meta?.operationId === operationId && transaction.taskId !== undefined)
      .map((transaction) => `${transaction.taskId}:${transaction.member}`),
  );
  return entries.some((entry) =>
    entry.type === "earn" &&
    entry.taskId !== undefined &&
    !operationEntries.has(`${entry.taskId}:${entry.member}`) &&
    hasUnreversedTaskEarn(search.allTransactions, entry.taskId, entry.member),
  );
}

async function readProjectedTask(
  pb: AdminPB,
  taskId: number,
): Promise<{ task: SnapshotTask | null; noCurrentTask: boolean }> {
  const state = await readSnapshotStateWithRevision(pb);
  const task = liveSnapshotTasks(state.data).find((candidate) => Number(candidate.id) === taskId) ?? null;
  return { task, noCurrentTask: task === null };
}

async function executeApproval(
  command: ApproveCommand,
  prepared: PreparedCommand,
  replayOnly = false,
  preloadedTaskRows?: TaskRowCache,
): Promise<ApprovalServiceResult> {
  const active = prepared.tasks.filter((item) => !item.skip);
  if (active.length === 0) {
    return success(command, prepared.week, 0, 0, 0, true);
  }
  const expectedEntries = active.flatMap((item) => item.expectedEntries);
  const replayEntries = replayLedgerEntries(prepared, command.operationId, expectedEntries);
  if (replayEntries.conflict) {
    return failure(command.operationId, command.action, "operation_conflict", prepared.week);
  }
  const entries = replayEntries.entries;
  const beforeIds = new Set(prepared.week.history.map((transaction) => transaction.id));
  let cleared = 0;
  let projectionFailures: number[] = [];
  let projectedTask: SnapshotTask | null = null;
  let noCurrentTask = false;

  const project = async (pb: AdminPB, weekData: WeekData): Promise<boolean> => {
    if (!operationEntriesComplete(prepared, command.operationId, expectedEntries, weekData)) {
      projectionFailures = active.map((item) => item.id);
      await addRepairMarker(pb, command.operationId, projectionFailures, preparedIntent(prepared));
      return false;
    }
    const patches = active
      .map((item) => approvalPatch(item, false))
      .filter((patch): patch is SnapshotPatch => patch !== null);
    const snapshot = await writeApprovalSnapshot(pb, command, prepared.fingerprint, patches, weekData, preparedIntent(prepared));
    if (!snapshot.ok) {
      projectionFailures = active.map((item) => item.id);
      await addRepairMarker(pb, command.operationId, projectionFailures, preparedIntent(prepared));
      return false;
    }
    cleared += snapshot.cleared;
    const failed: number[] = [];
    for (const item of active) {
      const patch = patches.find((candidate) => candidate.id === item.id);
      const target = projectedTaskForPatch(item, patch);
      const projected = await projectCanonicalTaskToPB(pb, target, item.id, preloadedTaskRows);
      if (!projected) failed.push(item.id);
    }
    if (failed.length > 0) {
      projectionFailures = failed;
      await addRepairMarker(pb, command.operationId, failed, preparedIntent(prepared));
      return false;
    }
    const invalid = active.filter((item) => item.projectionInvalid).map((item) => item.id);
    if (invalid.length > 0) {
      projectionFailures = invalid;
      await addRepairMarker(pb, command.operationId, invalid, preparedIntent(prepared));
      return false;
    }
    return true;
  };

  let result: Awaited<ReturnType<typeof applyWeekLedgerOperationLocked>> | null = null;
  if (!replayOnly && entries.length > 0) {
    if (hasUnreplayedSemanticDuplicate(prepared.search, command.operationId, expectedEntries)) {
      return failure(command.operationId, command.action, "semantic_duplicate", prepared.week);
    }
    result = await applyWeekLedgerOperationLocked({
      weekStart: prepared.week.weekStart,
      operation: {
        operationId: command.operationId,
        source: "task-approval",
        fingerprint: prepared.fingerprint,
        actorId: prepared.actorId,
        action: prepared.action,
        taskIds: prepared.taskIds,
        entries,
      },
      project: async ({ pb, weekData, semanticDuplicate }) => {
        if (semanticDuplicate) return true;
        return project(pb, weekData);
      },
    });
    if (!result.ok) {
      const failedResult = result;
      const reason: ApprovalFailureReason = failedResult.code === "operation_conflict"
        ? "operation_conflict"
        : failedResult.code === "invalid_ledger_operation"
          ? "invalid_task_state"
          : "ledger_unavailable";
      return failure(command.operationId, command.action, reason, failedResult.weekData);
    }
    if (result.semanticDuplicate) {
      return failure(command.operationId, command.action, "semantic_duplicate", result.weekData);
    }
  }

  if (replayOnly || entries.length === 0) {
    try {
      await withAdmin((pb) => project(pb, prepared.week));
    } catch {
      projectionFailures = active.map((item) => item.id);
    }
    try {
      const current = await withAdmin((pb) => readProjectedTask(pb, active[0].id));
      projectedTask = current.task;
      noCurrentTask = current.noCurrentTask;
    } catch {
      noCurrentTask = active[0].task === null;
    }
  } else {
    try {
      const current = await withAdmin((pb) => readProjectedTask(pb, active[0].id));
      projectedTask = current.task;
      noCurrentTask = current.noCurrentTask;
    } catch {
      noCurrentTask = active[0].task === null;
    }
  }

  const paid = replayOnly ? 0 : result?.weekData.history.filter(
    (transaction) => transaction.meta?.operationId === command.operationId && !beforeIds.has(transaction.id),
  ).length ?? 0;
  // Award-list members dropped between close and approval (removed from the
  // crew, or gone from the live roster) — honest copy for the approve result.
  const skipped = active.reduce((total, item) => total + item.skippedPayees.length, 0);
  return success(
    command,
    result?.weekData ?? prepared.week,
    paid,
    cleared,
    skipped,
    (result?.reconciled ?? true) && projectionFailures.length === 0,
    projectionFailures,
    result?.duplicate ?? false,
    projectedTask,
    noCurrentTask,
  );
}

function withTaskLocks<T>(ids: number[], index: number, fn: () => Promise<T>): Promise<T> {
  if (index >= ids.length) return fn();
  return withTaskCommandLock(ids[index], () => withTaskLocks(ids, index + 1, fn));
}

async function executeApprovalCommandUnlocked(
  command: ApproveCommand,
  actor: ApprovalActor,
  authorityWeekStart: string,
  replayOnly = false,
  preloadedTaskRows?: TaskRowCache,
): Promise<ApprovalServiceResult> {
  const parsed = command;
  const weekStart = authorityWeekStart;
  const live = await loadLiveParent(actor);
  if (typeof live === "string") return failure(command.operationId, parsed.action, live, emptyWeekData(weekStart));
  const fingerprint = approvalCommandFingerprint(parsed, live.parent.id);
  let prepared: PreparedCommand | ApprovalFailureReason;
  try {
    prepared = await withAdmin(async (pb) => {
      const search = parsed.action === "send-back"
        ? {
            currentWeek: await readWeek(pb, weekStart),
            currentTransactions: [],
            archiveTransactions: [],
            archiveWeeks: [],
            allTransactions: [],
          }
        : await readOperationLedger(pb, weekStart, parsed.operationId);
      const snapshot = await readSnapshotStateWithRevision(pb);
      return resolveTasks(
        pb,
        approvalTaskIds(parsed),
        parsed,
        search.currentWeek,
        search,
        fingerprint,
        live.roster,
        snapshot.data,
        weekStart,
      );
    });
  } catch {
    return failure(command.operationId, parsed.action, "ledger_unavailable", emptyWeekData(weekStart));
  }
  if (typeof prepared === "string") {
    return failure(command.operationId, parsed.action, prepared, emptyWeekData(weekStart));
  }
  prepared.actorId = live.parent.id;
  prepared.action = parsed.action;
  prepared.taskIds = approvalTaskIds(parsed);
  try {
    if (parsed.action === "send-back") return await executeSendBack(parsed, prepared, preloadedTaskRows);
    return await executeApproval(parsed, prepared, replayOnly, preloadedTaskRows);
  } catch {
    return failure(command.operationId, parsed.action, "ledger_unavailable", prepared.week);
  }
}

export async function executeApprovalCommand(
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
  let authorityWeekStart: string;
  try {
    const rollover = await ensureCurrentTaskWeek();
    const rolloverWeekStart = canonicalWeekStart(rollover.weekStart);
    if (!rollover.reconciled || !rolloverWeekStart) {
      return Promise.resolve(failure(
        command.operationId,
        parsed.action,
        "task_store_unavailable",
        emptyWeekData(rolloverWeekStart ?? localWeekStartISO()),
      ));
    }
    authorityWeekStart = rolloverWeekStart;
  } catch {
    return Promise.resolve(failure(
      command.operationId,
      parsed.action,
      "task_store_unavailable",
      emptyWeekData(localWeekStartISO()),
    ));
  }
  return withWeekLedgerLock(authorityWeekStart, () => withTaskLocks(ids, 0, () =>
    executeApprovalCommandUnlocked(parsed, actor, authorityWeekStart),
  )).catch(() => failure(
    command.operationId,
    parsed.action,
    "task_store_unavailable",
    emptyWeekData(authorityWeekStart),
  ));
}

export interface ApprovalRepairOptions {
  pb?: AdminPB;
  weekStart: string;
  operationId: string;
  taskIds?: number[];
  // A projection-repair marker can name any ledger action (a penalty or a
  // manual adjust projects the WEEK leg, not a task row). Only the three
  // approval actions are replayed as task repairs; the caller must filter the
  // rest before calling.
  action?: LedgerOperationAction;
  actorId?: string;
  fingerprint?: string;
  preloadedTaskRows?: TaskRowCache;
  locked?: boolean;
}

type LockedApprovalRepairOptions = ApprovalRepairOptions & { pb: AdminPB };

async function approvalRepairRoster(pb: AdminPB): Promise<LiveMember[] | null> {
  const rows = await pb.collection("members").getFullList({ requestKey: null });
  return normalizeLiveRoster(rows);
}

function approvalRepairTaskIds(
  requested: unknown,
  receipts: SnapshotOperationReceipt[],
  transactions: Transaction[],
): number[] {
  const values = [
    ...(Array.isArray(requested) ? requested : []),
    ...receipts.map((receipt) => receipt.taskId),
    ...transactions.map((transaction) => transaction.taskId),
  ];
  return [...new Set(values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
  ))].sort((left, right) => left - right);
}

function repairIntentFromEvidence(
  options: ApprovalRepairOptions,
  receipts: SnapshotOperationReceipt[],
  transactions: Transaction[],
  approvedAction?: ApproveAction,
): ApprovalIntent | undefined {
  const optionActor = typeof options.actorId === "string" && options.actorId.trim() ? options.actorId.trim() : undefined;
  const optionAction = approvedAction;
  const optionFingerprint = typeof options.fingerprint === "string" && /^[a-f0-9]{64}$/.test(options.fingerprint)
    ? options.fingerprint
    : undefined;
  const optionTaskIds = Array.isArray(options.taskIds)
    ? [...new Set(options.taskIds.filter((id): id is number =>
      typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    ))].sort((left, right) => left - right)
    : [];
  const evidence = [
    ...receipts.map((receipt) => ({
      actorId: receipt.actorId,
      action: receipt.action === "approve" || receipt.action === "approve-all" || receipt.action === "send-back"
        ? receipt.action
        : undefined,
      fingerprint: typeof receipt.fingerprint === "string" && /^[a-f0-9]{64}$/.test(receipt.fingerprint)
        ? receipt.fingerprint
        : undefined,
      taskIds: Array.isArray(receipt.taskIds) ? [...receipt.taskIds].sort((left, right) => left - right) : undefined,
    })),
    ...transactions.map((transaction) => ({
      actorId: transaction.meta?.actorId,
      action: transaction.meta?.action,
      fingerprint: transaction.meta?.fingerprint,
      taskIds: transaction.meta?.taskIds ? [...transaction.meta.taskIds].sort((left, right) => left - right) : undefined,
    })),
  ].filter((value): value is ApprovalIntent =>
    Boolean(value.actorId && value.action && value.fingerprint && value.taskIds?.length),
  );
  const candidate = optionActor && optionAction && optionFingerprint && optionTaskIds.length
    ? { actorId: optionActor, action: optionAction, fingerprint: optionFingerprint, taskIds: optionTaskIds }
    : evidence[0];
  if (!candidate) return undefined;
  if (evidence.some((value) =>
    value.actorId !== candidate.actorId ||
    value.action !== candidate.action ||
    value.fingerprint !== candidate.fingerprint ||
    JSON.stringify(value.taskIds) !== JSON.stringify(candidate.taskIds)
  )) return undefined;
  if (optionActor && optionActor !== candidate.actorId) return undefined;
  if (optionAction && optionAction !== candidate.action) return undefined;
  if (optionFingerprint && optionFingerprint !== candidate.fingerprint) return undefined;
  if (optionTaskIds.length && JSON.stringify(optionTaskIds) !== JSON.stringify(candidate.taskIds)) return undefined;
  return candidate;
}

export async function repairApprovalOperationLocked(
  options: LockedApprovalRepairOptions,
): Promise<ApprovalServiceResult> {
  const operationId = normalizeOperationId(options?.operationId) ?? "";
  const weekStart = canonicalWeekStart(options?.weekStart) ?? "";
  const requestedAction = options.action;
  const action: ApproveAction = requestedAction !== undefined && APPROVAL_REPAIR_ACTIONS.has(requestedAction)
    ? requestedAction as ApproveAction
    : "approve";
  if (!operationId || !weekStart) {
    return failure(operationId, action, "invalid_task_state", emptyWeekData(localWeekStartISO()));
  }
  if (requestedAction !== undefined && !APPROVAL_REPAIR_ACTIONS.has(requestedAction)) {
    return repairRequiredFailure(operationId, "approve", emptyWeekData(weekStart));
  }

  try {
    const search = await readOperationLedger(options.pb, weekStart, operationId);
    const snapshot = await readSnapshotStateWithRevision(options.pb);
    const receipts = getSnapshotOperationReceipts(snapshot.data, operationId);
    const operationTransactions = search.allTransactions.filter(
      (transaction) => transaction.meta?.operationId === operationId,
    );
    // When the marker named no action, the evidence decides it (a send-back
    // marker often carries none) — only a NAMED action constrains inference.
    const intent = repairIntentFromEvidence(
      options,
      receipts,
      operationTransactions,
      requestedAction === undefined ? undefined : action,
    );
    if (!intent) {
      return repairRequiredFailure(operationId, action, search.currentWeek);
    }
    if (options.taskIds?.length && JSON.stringify([...options.taskIds].sort((left, right) => left - right)) !== JSON.stringify(intent.taskIds)) {
      return failure(operationId, intent.action, "operation_conflict", search.currentWeek);
    }
    if (intent.action === "send-back") {
      if (operationTransactions.length > 0) {
        return failure(operationId, intent.action, "operation_conflict", search.currentWeek);
      }
      const matchingReceipts = receipts.filter((receipt) =>
        receipt.action === intent.action &&
        receipt.fingerprint === intent.fingerprint &&
        receipt.actorId === intent.actorId &&
        JSON.stringify(receipt.taskIds ?? []) === JSON.stringify(intent.taskIds),
      );
      if (matchingReceipts.length === 0) {
        return repairRequiredFailure(operationId, intent.action, search.currentWeek);
      }
    } else {
      if (operationTransactions.length === 0) {
        return repairRequiredFailure(operationId, intent.action, search.currentWeek);
      }
      if (operationTransactions.some((transaction) =>
        transaction.meta?.source !== "task-approval" ||
        transaction.meta?.fingerprint !== intent.fingerprint ||
        transaction.meta?.actorId !== intent.actorId ||
        transaction.meta?.action !== intent.action ||
        JSON.stringify(transaction.meta?.taskIds ?? []) !== JSON.stringify(intent.taskIds) ||
        transaction.type !== "earn" ||
        transaction.taskId === undefined
      )) {
        return failure(operationId, intent.action, "operation_conflict", search.currentWeek);
      }
    }

    const roster = await approvalRepairRoster(options.pb);
    if (!roster) return failure(operationId, intent.action, "member_roster_unavailable", search.currentWeek);
    const actor = roster.find((member) => member.id === intent.actorId && member.role.toLowerCase() === "parent");
    if (!actor) return failure(operationId, intent.action, "operation_conflict", search.currentWeek);
    const command = {
      operationId,
      action: intent.action,
      ...(intent.action === "approve-all" ? { taskIds: intent.taskIds } : { taskId: intent.taskIds[0] }),
    } as ApproveCommand;
    if (approvalCommandFingerprint(command, actor.id) !== intent.fingerprint) {
      return failure(operationId, intent.action, "operation_conflict", search.currentWeek);
    }
    const liveTaskIds = new Set(liveSnapshotTasks(snapshot.data).map((task) => Number(task.id)));
    const tombstoneIds = new Set((snapshot.data.deletedTaskIds ?? []).map((id) => Number(id)));
    if (intent.taskIds.some((taskId) => !liveTaskIds.has(taskId) && !tombstoneIds.has(taskId))) {
      return failure(operationId, intent.action, "snapshot_write_failed", search.currentWeek);
    }

    const prepared = await (async (): Promise<PreparedCommand | ApprovalFailureReason> =>
      resolveTasks(
        options.pb,
        intent.taskIds,
        command,
        search.currentWeek,
        search,
        intent.fingerprint,
        roster,
        snapshot.data,
        weekStart,
      ))().catch(() => "ledger_unavailable" as const);
    if (typeof prepared === "string") {
      return failure(operationId, intent.action, prepared, search.currentWeek);
    }
    prepared.actorId = intent.actorId;
    prepared.action = intent.action;
    prepared.taskIds = intent.taskIds;
    if (intent.action !== "send-back") {
      const expected = prepared.tasks.filter((item) => !item.skip).flatMap((item) => item.expectedEntries);
      const matched = expected.map((entry) => operationTransactions.find((transaction) =>
        transactionMatchesEntry(transaction, entry) &&
        transaction.meta?.operationId === operationId &&
        transaction.meta?.source === "task-approval" &&
        transaction.meta?.fingerprint === intent.fingerprint &&
        transaction.meta?.actorId === intent.actorId &&
        transaction.meta?.action === intent.action &&
        JSON.stringify(transaction.meta?.taskIds ?? []) === JSON.stringify(intent.taskIds)
      ));
      if (matched.some((transaction) => !transaction) || matched.length !== expected.length) {
        return repairRequiredFailure(operationId, intent.action, search.currentWeek);
      }
    }
    return executeApprovalCommandUnlocked(
      command,
      { memberId: actor.id, name: actor.name, role: actor.role },
      weekStart,
      true,
      options.preloadedTaskRows,
    );
  } catch {
    return failure(operationId, action, "task_store_unavailable", emptyWeekData(localWeekStartISO()));
  }
}

export async function repairApprovalOperation(
  options: ApprovalRepairOptions,
): Promise<ApprovalServiceResult> {
  if (options.locked === true) {
    if (!options.pb) {
      return failure(normalizeOperationId(options.operationId) ?? "", "approve", "task_store_unavailable", emptyWeekData(canonicalWeekStart(options.weekStart) ?? localWeekStartISO()));
    }
    return repairApprovalOperationLocked({ ...options, pb: options.pb });
  }
  const operationId = normalizeOperationId(options?.operationId) ?? "";
  const weekStart = canonicalWeekStart(options?.weekStart) ?? "";
  const requestedAction = options.action;
  const action: ApproveAction = requestedAction !== undefined && APPROVAL_REPAIR_ACTIONS.has(requestedAction)
    ? requestedAction as ApproveAction
    : "approve";
  if (!operationId || !weekStart) {
    return failure(operationId, action, "invalid_task_state", emptyWeekData(localWeekStartISO()));
  }
  if (requestedAction !== undefined && !APPROVAL_REPAIR_ACTIONS.has(requestedAction)) {
    return repairRequiredFailure(operationId, "approve", emptyWeekData(weekStart));
  }
  try {
    const taskIds = await withAdmin(async (pb) => {
      const search = await readOperationLedger(pb, weekStart, operationId);
      const snapshot = await readSnapshotStateWithRevision(pb);
      return approvalRepairTaskIds(
        options.taskIds,
        getSnapshotOperationReceipts(snapshot.data, operationId),
        search.allTransactions.filter((transaction) => transaction.meta?.operationId === operationId),
      );
    });
    return withWeekLedgerLock(weekStart, () => withTaskLocks(taskIds, 0, () =>
      withAdmin((pb) => repairApprovalOperationLocked({
        pb,
        weekStart,
        operationId,
        taskIds: options.taskIds,
        action: options.action,
        actorId: options.actorId,
        fingerprint: options.fingerprint,
      })),
    ));
  } catch {
    return failure(operationId, "approve", "task_store_unavailable", emptyWeekData(weekStart));
  }
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
