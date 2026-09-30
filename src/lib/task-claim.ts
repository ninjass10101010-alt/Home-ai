import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { getLiveMembers, type LiveMember } from "@/lib/live-member";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import { applyWeekLedgerOperationLocked } from "@/lib/ledger-operations";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import {
  crewAllCheckedIn,
  isCrewTask,
  normalizeCrew,
  normalizeCrewRemoved,
  normalizeSpeedBonus,
  PIN_FREE_MAX_AGE,
} from "@/lib/task-utils";
import {
  findCanonicalTask,
  getSnapshotOperationReceipts,
  mutateSnapshotWithMeta,
  normalizeWeekData,
  persistSnapshotWeek,
  projectCanonicalTaskToPB,
  readSnapshotStateWithRevision,
  type AdminPB,
  type CanonicalTaskLookup,
  type SnapshotData,
  type SnapshotOperationReceipt,
  type SnapshotRevision,
  type SnapshotTask,
} from "@/lib/snapshot-tasks";
import {
  isRecord,
  normalizeOperationId,
} from "@/lib/task-operation-contract";
import {
  registerInternalTaskCommandHandler,
  type InternalTaskCommand,
  type InternalTaskCommandContext,
  type InternalTaskCommandResult,
} from "@/lib/task-commands";
import { buildCrewClosePending, crewCloseAwardList } from "@/lib/task-crew-close";
import type { CrewMember, LedgerOperationSource, Task, Transaction, WeekData } from "@/types/tasks";

export type ClaimAction =
  | "claim"
  | "complete"
  | "undo"
  | "crew-join"
  | "crew-checkin"
  | "crew-remove"
  | "crew-close";

export interface ClaimCommand {
  operationId: string;
  action: ClaimAction;
  taskId: number;
  memberName?: string;
  pin?: string;
  targetName?: string;
}

export type ClaimAuthentication = "pin" | "session" | "internal";

export interface ClaimActor {
  memberId: string;
  name: string;
  role: string;
  authentication?: ClaimAuthentication;
  requestedName?: string;
}

export interface ClaimSuccessResponse {
  success: true;
  operationId: string;
  action: ClaimAction;
  task?: SnapshotTask;
  weekData?: WeekData;
  pending?: boolean;
  claimedBy?: string;
  alreadyJoined?: boolean;
  reopened?: boolean;
  revision: SnapshotRevision;
  reconciled: boolean;
  duplicate?: boolean;
}

export type ClaimFailureReason =
  | "invalid_body"
  | "invalid_action"
  | "invalid_task_id"
  | "forbidden_claim_payload"
  | "unauthorized"
  | "pin_required"
  | "session_required"
  | "unknown_actor"
  | "member_roster_unavailable"
  | "not_allowed"
  | "adult_only"
  | "unknown_task"
  | "ambiguous_task"
  | "unknown_task_owner"
  | "not_task_owner"
  | "not_universal"
  | "not_late_yet"
  | "crew_task"
  | "not_assigned"
  | "not_crew_task"
  | "already_completed"
  | "already_claimed"
  | "already_undone"
  | "nothing_to_undo"
  | "crew_full"
  | "not_in_crew"
  | "unknown_crew_member"
  | "member_checked_in"
  | "removed_crew_member"
  | "crew_close_not_allowed"
  | "no_checkins"
  | "target_required"
  | "invalid_crew_member"
  | "invalid_task_state"
  | "operation_conflict"
  | "insufficient_balance"
  | "ledger_unavailable"
  | "snapshot_write_failed"
  | "task_store_unavailable";

export interface ClaimServiceResult {
  ok: boolean;
  operationId: string;
  action?: ClaimAction;
  task?: Task;
  weekData?: WeekData;
  pending?: boolean;
  claimedBy?: string;
  alreadyJoined?: boolean;
  reopened?: boolean;
  revision?: SnapshotRevision;
  reconciled: boolean;
  duplicate?: boolean;
  reason?: ClaimFailureReason;
}

export type ClaimParseResult =
  | ClaimCommand
  | { error: Extract<ClaimFailureReason, "invalid_body" | "invalid_action" | "invalid_task_id" | "forbidden_claim_payload"> };

const CLAIM_ACTIONS = new Set<ClaimAction>([
  "claim",
  "complete",
  "undo",
  "crew-join",
  "crew-checkin",
  "crew-remove",
  "crew-close",
]);

const COMMON_KEYS = new Set(["action", "operationId", "taskId", "memberName", "pin"]);
const LEGACY_KEYS = new Set([
  "claimantName",
  "claimantPin",
  "assigneeEmoji",
]);

type ClaimParseError = {
  error: Extract<ClaimFailureReason, "invalid_body" | "invalid_action" | "invalid_task_id" | "forbidden_claim_payload">;
};

function parseError(reason: ClaimParseError["error"]): ClaimParseError {
  return { error: reason };
}

function optionalTrimmedText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || undefined;
}

export function parseClaimCommand(value: unknown): ClaimParseResult {
  if (!isRecord(value)) return parseError("invalid_body");
  const keys = Object.keys(value);
  if (keys.some((key) => ["actor", "role", "user", "memberId", "amount", "weekData", "history", "pendingApproval", "completed", "completedAt", "title", "points", "crew"].includes(key))) {
    return parseError("forbidden_claim_payload");
  }
  if (keys.some((key) => !COMMON_KEYS.has(key) && !LEGACY_KEYS.has(key) && key !== "targetName")) {
    return parseError("forbidden_claim_payload");
  }
  const actionValue = value.action === undefined ? "claim" : value.action;
  if (typeof actionValue !== "string" || !CLAIM_ACTIONS.has(actionValue as ClaimAction)) {
    return parseError("invalid_action");
  }
  const action = actionValue as ClaimAction;
  const operationId = normalizeOperationId(value.operationId);
  if (!operationId || operationId.length > 200) return parseError("invalid_body");
  if (
    typeof value.taskId !== "number" ||
    !Number.isSafeInteger(value.taskId) ||
    value.taskId <= 0
  ) {
    return parseError("invalid_task_id");
  }
  if (
    value.assigneeEmoji !== undefined &&
    (typeof value.assigneeEmoji !== "string" || value.assigneeEmoji.length > 400_000)
  ) return parseError("invalid_body");
  const canonicalName = optionalTrimmedText(value.memberName);
  const legacyName = optionalTrimmedText(value.claimantName);
  const canonicalPin = optionalTrimmedText(value.pin);
  const legacyPin = optionalTrimmedText(value.claimantPin);
  if (
    canonicalName === null ||
    legacyName === null ||
    canonicalPin === null ||
    legacyPin === null ||
    (canonicalName !== undefined && legacyName !== undefined && canonicalName !== legacyName) ||
    (canonicalPin !== undefined && legacyPin !== undefined && canonicalPin !== legacyPin)
  ) {
    return parseError("invalid_body");
  }
  const memberName = canonicalName ?? legacyName;
  const pin = canonicalPin ?? legacyPin;
  const targetName = optionalTrimmedText(value.targetName);
  if (targetName === null) return parseError("invalid_body");
  if (action === "crew-remove" && !targetName) return parseError("invalid_body");
  if (action !== "crew-remove" && targetName !== undefined) return parseError("forbidden_claim_payload");
  return {
    operationId,
    action,
    taskId: value.taskId,
    ...(memberName ? { memberName } : {}),
    ...(pin ? { pin } : {}),
    ...(targetName ? { targetName } : {}),
  };
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

function claimCommandFingerprint(command: ClaimCommand, actor: ClaimActor): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue({
      operationId: command.operationId,
      action: command.action,
      taskId: command.taskId,
      targetName: command.targetName ?? null,
      actorId: actor.memberId,
    })))
    .digest("hex");
}

function failure(
  operationId: string,
  reason: ClaimFailureReason,
  action?: ClaimAction,
  claimedBy?: string,
): ClaimServiceResult {
  return {
    ok: false,
    operationId,
    ...(action ? { action } : {}),
    ...(claimedBy ? { claimedBy } : {}),
    reason,
    reconciled: false,
  };
}

function humanMembers(members: LiveMember[]): LiveMember[] {
  return members.filter((member) => member.role.trim().toLowerCase() !== "pet");
}

function humanNameCandidates(members: LiveMember[], value: unknown): LiveMember[] {
  if (typeof value !== "string") return [];
  const query = value.trim().toLocaleLowerCase();
  if (!query) return [];
  const humans = humanMembers(members);
  const exact = humans.filter((member) => member.name.trim().toLocaleLowerCase() === query);
  if (exact.length > 0) return exact;
  const firstName = query.split(/\s+/)[0];
  return humans.filter(
    (member) => member.name.trim().toLocaleLowerCase().split(/\s+/)[0] === firstName,
  );
}

function resolveHumanMember(members: LiveMember[], value: unknown): LiveMember | null {
  const matches = humanNameCandidates(members, value);
  return matches.length === 1 ? matches[0] : null;
}

function resolveActor(members: LiveMember[], actor: ClaimActor): LiveMember | null {
  const id = typeof actor.memberId === "string" ? actor.memberId.trim() : "";
  if (!id) return null;
  const byId = members.find((member) => member.id === id);
  if (!byId || byId.role.trim().toLowerCase() === "pet") return null;
  const byName = resolveHumanMember(members, actor.name);
  if (!byName || byName.id !== byId.id) return null;
  if (actor.requestedName !== undefined) {
    const requested = resolveHumanMember(members, actor.requestedName);
    if (!requested || requested.id !== byId.id) return null;
  }
  return byId;
}

function isUnderTenChild(member: { role: string; age?: number }): boolean {
  const age = Number(member.age);
  return member.role.trim().toLowerCase() === "child" &&
    Number.isFinite(age) &&
    age > 0 &&
    age < PIN_FREE_MAX_AGE;
}

/**
 * A session-only undo is ONE thing and one thing only: a kid taking back their
 * own PENDING tap, which never moved any points. A PAID undo reverses real
 * ledger entries, so it is a different command with real consequences and it
 * must never be reachable without the member PIN — not for a parent, and not
 * for a child of any age. The check is explicit here (rather than being left to
 * a later ownership comparison) so the client is told the truth: a PIN is
 * required, not "you do not own this".
 */
function sessionUndoAllows(actor: ClaimActor, task: SnapshotTask): boolean {
  if (actor.authentication !== "session") return true;
  if (actor.role.trim().toLowerCase() !== "child") return false;
  return pendingApproval(task) !== null;
}

function sessionPolicyAllows(actor: ClaimActor, task: SnapshotTask, action: ClaimAction): boolean {
  if (actor.authentication !== "session") return true;
  if (action === "undo") return sessionUndoAllows(actor, task);
  if (!isUnderTenChild(actor)) return false;
  if (action === "crew-join" || action === "crew-checkin") return true;
  return action === "complete" && task.universal === false && !isCrewTask(task as unknown as Task);
}

function doneThisWeek(task: SnapshotTask, weekStart: string): boolean {
  return task.completed === true ||
    (task.status === "done" && (
      task.completedInWeek === undefined ||
      task.completedInWeek === null ||
      task.completedInWeek === "" ||
      task.completedInWeek === weekStart
    ));
}

function validTaskPoints(task: SnapshotTask): number | null {
  return typeof task.points === "number" &&
    Number.isSafeInteger(task.points) &&
    task.points >= 0
    ? task.points
    : null;
}

function claimGate(task: SnapshotTask): "open" | "late" | "not_late_yet" | "not_universal" {
  if (task.universal !== false) return "open";
  const late = task.stealable === true &&
    typeof task.due === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(task.due) &&
    task.due < localTodayISO();
  return late ? "late" : task.stealable === true ? "not_late_yet" : "not_universal";
}

function completedFields(now: string, weekStart: string, actor: ClaimActor) {
  return {
    completed: true,
    status: "done",
    completedBy: actor.name,
    completedAt: now,
    completedInWeek: weekStart,
    sentBackAt: null,
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
  const operationReceipts: Record<string, SnapshotOperationReceipt[]> = Object.create(null);
  if (isRecord(data.operationReceipts)) {
    for (const [key, value] of Object.entries(data.operationReceipts)) {
      operationReceipts[key] = Array.isArray(value) ? value as SnapshotOperationReceipt[] : [];
    }
  }
  operationReceipts[receipt.operationId] = existing;
  return { ...data, operationReceipts };
}

function receiptState(
  lookup: CanonicalTaskLookup,
  command: ClaimCommand,
  actor: ClaimActor,
  fingerprint: string,
): { conflict: boolean; receipt: SnapshotOperationReceipt | null } {
  const receipts = getSnapshotOperationReceipts(lookup.data, command.operationId);
  if (!receipts.length) return { conflict: false, receipt: null };
  const matching = receipts.filter(
    (receipt) =>
      receipt.action === command.action &&
      receipt.taskId === command.taskId &&
      receipt.fingerprint === fingerprint,
  );
  const conflict = matching.length !== 1 || receipts.some(
    (receipt) =>
      receipt.action !== command.action ||
      receipt.taskId !== command.taskId ||
      receipt.fingerprint !== fingerprint,
  );
  return { conflict, receipt: conflict ? null : matching[0] };
}

function successMetadata(
  action: ClaimAction,
  actor: ClaimActor,
  task: SnapshotTask | null,
): Pick<ClaimServiceResult, "pending" | "claimedBy" | "alreadyJoined" | "reopened"> {
  if (!task) return {};
  if (task.pendingApproval) {
    return {
      pending: true,
      claimedBy: task.pendingApproval.byName,
    };
  }
  if (action === "crew-join" || action === "crew-checkin") {
    const members = normalizeCrew(task.crew);
    return {
      alreadyJoined: members.some((member) => member.name === actor.name),
      reopened: task.completed === false && Boolean(task.sentBackAt),
    };
  }
  if (action === "undo") {
    return {
      reopened: task.completed === false,
      claimedBy: typeof task.completedBy === "string" && task.completedBy ? task.completedBy : actor.name,
    };
  }
  return {
    claimedBy: typeof task.completedBy === "string" && task.completedBy
      ? task.completedBy
      : actor.name,
  };
}

function success(
  command: ClaimCommand,
  actor: ClaimActor,
  task: SnapshotTask | null,
  revision: SnapshotRevision,
  reconciled: boolean,
  weekData?: WeekData,
  duplicate = false,
): ClaimServiceResult {
  return {
    ok: true,
    operationId: command.operationId,
    action: command.action,
    ...(task ? { task: task as unknown as Task } : {}),
    ...(weekData ? { weekData } : {}),
    revision,
    reconciled,
    ...(duplicate ? { duplicate: true } : {}),
    ...successMetadata(command.action, actor, task),
  };
}

function snapshotHasLedgerOperation(data: SnapshotData, operationId: string): boolean {
  const week = normalizeWeekData(data.weekData);
  return Boolean(
    week?.history.some((transaction) => transaction.meta?.operationId === operationId),
  );
}

function ledgerRepairEntries(transactions: Transaction[]) {
  return transactions.map((transaction) => ({
    type: transaction.type,
    member: transaction.member,
    amount: transaction.amount,
    description: transaction.description,
    ...(transaction.taskId === undefined ? {} : { taskId: transaction.taskId }),
    ...(transaction.appliedBy === undefined ? {} : { appliedBy: transaction.appliedBy }),
  }));
}

function ledgerReplayTransactions(
  week: WeekData | null,
  operationId: string,
): Transaction[] {
  return week?.history.filter(
    (transaction) => transaction.meta?.operationId === operationId,
  ) ?? [];
}

function reopenTask(task: SnapshotTask, now: string): SnapshotTask {
  const crew = isCrewTask(task as unknown as Task) && task.crew
    ? {
        members: task.crew.members.map((member: {
          name: string;
          emoji: string;
          joinedAt: string;
          checkedInAt?: string;
        }) => ({
          name: member.name,
          emoji: member.emoji,
          joinedAt: member.joinedAt,
        })),
        ...(Array.isArray(task.crew.removed) && task.crew.removed.length > 0
          ? { removed: [...task.crew.removed] }
          : {}),
      }
    : task.crew;
  return {
    ...task,
    completed: false,
    status: "pending",
    completedBy: null,
    completedAt: null,
    completedInWeek: null,
    pendingApproval: null,
    sentBackAt: now,
    ...(crew !== undefined ? { crew } : {}),
  };
}

function replayBuild(
  command: ClaimCommand,
  actor: ClaimActor & { emoji?: string },
  task: SnapshotTask,
  now: string,
  weekStart: string,
): SnapshotTask {
  if (command.action === "claim") {
    return {
      ...task,
      ...completedFields(now, weekStart, actor),
      pendingApproval: null,
    };
  }
  if (command.action === "complete") {
    return {
      ...task,
      ...completedFields(now, weekStart, actor),
      pendingApproval: null,
    };
  }
  return reopenTask(task, now);
}

async function readCurrentCanonicalTask(taskId: number): Promise<CanonicalTaskLookup> {
  return withAdmin((pb) => findCanonicalTask(pb, taskId));
}

function isHistoricalLedgerOperation(
  command: ClaimCommand,
  actor: ClaimActor,
  week: WeekData,
  operationTransactions: Transaction[],
): boolean {
  if (operationTransactions.length === 0) return true;
  const relevant = week.history.filter(
    (transaction) =>
      transaction.taskId === command.taskId &&
      transaction.member === actor.name &&
      (transaction.type === "earn" || transaction.type === "adjust"),
  );
  let latest: Transaction | null = null;
  for (const transaction of relevant) {
    if (!latest || Date.parse(transaction.timestamp) >= Date.parse(latest.timestamp)) {
      latest = transaction;
    }
  }
  if (!latest) return true;
  if (command.action === "claim" || command.action === "complete") {
    return latest.type !== "earn" || latest.meta?.operationId !== command.operationId;
  }
  if (command.action === "undo") {
    return latest.type !== "adjust" || latest.meta?.operationId !== command.operationId;
  }
  return false;
}

async function repairReceiptProjection(
  command: ClaimCommand,
  actor: ClaimActor,
  lookup: CanonicalTaskLookup,
  authorityWeekStart: string,
  weekOverride?: WeekData | null,
  receiptPresent = true,
): Promise<{ reconciled: boolean; revision: SnapshotRevision; weekData?: WeekData; task: SnapshotTask | null; reason?: ClaimFailureReason }> {
  const actorRole = actor.role.trim().toLowerCase();
  const shouldInspectLedger = actorRole === "parent" &&
    (command.action === "claim" || command.action === "complete" || command.action === "undo");
  const weekStart = authorityWeekStart;
  let week = weekOverride;
  if (shouldInspectLedger && week === undefined) {
    try {
      week = await withAdmin((pb) => readWeek(pb, weekStart));
    } catch {
      week = null;
    }
  }
  const transactions = ledgerReplayTransactions(week ?? null, command.operationId);
  let repairedTask: SnapshotTask | null = lookup.task;
  if (transactions.length === 0) {
    const reconciled = await withAdmin((pb) =>
      projectCanonicalTaskToPB(pb, lookup.task, command.taskId)
    );
    return {
      reconciled,
      revision: lookup.revision,
      task: lookup.task,
      ...(week ? { weekData: week } : {}),
    };
  }
  const source = transactions[0].meta?.source as LedgerOperationSource | undefined;
  const expectedFingerprint = claimCommandFingerprint(command, actor);
  const storedFingerprints = transactions
    .map((transaction) => transaction.meta?.fingerprint)
    .filter((value): value is string => typeof value === "string");
  if (
    !source ||
    transactions.some((transaction) => transaction.meta?.source !== source) ||
    storedFingerprints.some((fingerprint) => fingerprint !== expectedFingerprint)
  ) {
    return {
      reconciled: false,
      revision: lookup.revision,
      task: lookup.task,
      ...(week ? { weekData: week } : {}),
      reason: "operation_conflict",
    };
  }
  const historical = !receiptPresent && week
    ? isHistoricalLedgerOperation(command, actor, week, transactions)
    : false;
  let revision = lookup.revision;
  const result = await applyWeekLedgerOperationLocked({
    weekStart,
    operation: {
      operationId: command.operationId,
      source,
      fingerprint: storedFingerprints[0] ?? expectedFingerprint,
      entries: ledgerRepairEntries(transactions),
    },
    project: async ({ pb, weekData }) => {
      const current = await readSnapshotStateWithRevision(pb);
      const currentTask = liveSnapshotTasksForData(current.data, command.taskId);
      const tombstoned = (current.data.deletedTaskIds ?? []).some(
        (candidate) => Number(candidate) === command.taskId,
      );
      let projectedTask = currentTask;
      repairedTask = currentTask;
      if (!receiptPresent && !historical && currentTask) {
        const outcome = await writeCanonicalTask(
          pb,
          { ...lookup, task: currentTask, revision: current.revision, data: current.data },
          command,
          actor,
          expectedFingerprint,
          currentTask,
          (task) => replayBuild(command, actor, task, new Date().toISOString(), weekStart),
        );
        if (!outcome.ok) return false;
        projectedTask = outcome.task;
        repairedTask = outcome.task;
        revision = outcome.revision;
      }
      if (!snapshotHasLedgerOperation(current.data, command.operationId)) {
        const persisted = await persistSnapshotWeek(pb, weekData);
        if (!persisted.ok) return false;
        revision = persisted.revision;
      } else {
        revision = current.revision;
      }
      if (!projectedTask && !tombstoned) return false;
      return projectCanonicalTaskToPB(pb, projectedTask, command.taskId);
    },
  });
  if (!result.ok) {
    return {
      reconciled: false,
      revision,
      task: repairedTask,
      ...(week ? { weekData: week } : {}),
      ...(result.code === "operation_conflict" ? { reason: "operation_conflict" as const } : {}),
    };
  }
  return {
    reconciled: result.reconciled,
    revision,
    weekData: result.weekData,
    task: repairedTask,
  };
}

async function replayReceipt(
  command: ClaimCommand,
  actor: ClaimActor,
  lookup: CanonicalTaskLookup,
  authorityWeekStart: string,
): Promise<ClaimServiceResult | null> {
  const fingerprint = claimCommandFingerprint(command, actor);
  let currentLookup: CanonicalTaskLookup;
  try {
    currentLookup = await readCurrentCanonicalTask(command.taskId);
  } catch {
    return failure(command.operationId, "task_store_unavailable", command.action);
  }
  const receipt = receiptState(currentLookup, command, actor, fingerprint);
  if (receipt.conflict) return failure(command.operationId, "operation_conflict", command.action);
  const actorRole = actor.role.trim().toLowerCase();
  const ledgerAction = actorRole === "parent" &&
    (command.action === "claim" || command.action === "complete" || command.action === "undo");
  let week: WeekData | null = null;
  if (ledgerAction) {
    try {
      week = await withAdmin((pb) => readWeek(pb, authorityWeekStart));
    } catch {
      week = null;
    }
  }
  const transactions = ledgerReplayTransactions(week, command.operationId);
  if (!receipt.receipt && transactions.length === 0) return null;
  if (!currentLookup.task && !currentLookup.tombstoned) {
    return failure(command.operationId, "snapshot_write_failed", command.action);
  }
  const repair = await repairReceiptProjection(
    command,
    actor,
    currentLookup,
    authorityWeekStart,
    week,
    Boolean(receipt.receipt),
  );
  if (repair.reason) return failure(command.operationId, repair.reason, command.action);
  return success(
    command,
    actor,
    repair.task,
    repair.revision,
    repair.reconciled,
    repair.weekData,
    true,
  );
}

interface CanonicalWriteOutcome {
  ok: boolean;
  task: SnapshotTask | null;
  revision: SnapshotRevision;
  duplicate: boolean;
  reason?: ClaimFailureReason;
}

async function writeCanonicalTask(
  pb: AdminPB,
  lookup: CanonicalTaskLookup,
  command: ClaimCommand,
  actor: ClaimActor,
  fingerprint: string,
  fallbackTask: SnapshotTask | null,
  build: (current: SnapshotTask) => SnapshotTask | null,
): Promise<CanonicalWriteOutcome> {
  try {
    let duplicate = false;
    const mutation = await mutateSnapshotWithMeta<{
      task: SnapshotTask | null;
      duplicate: boolean;
      error?: ClaimFailureReason;
    }>((data) => {
      const receipts = getSnapshotOperationReceipts(data, command.operationId);
      if (receipts.length > 0) {
        const matching = receipts.filter(
          (receipt) =>
            receipt.action === command.action &&
            receipt.taskId === command.taskId &&
            receipt.fingerprint === fingerprint,
        );
        if (
          matching.length !== 1 ||
          receipts.some(
            (receipt) =>
              receipt.action !== command.action ||
              receipt.taskId !== command.taskId ||
              receipt.fingerprint !== fingerprint,
          )
        ) {
          return { data, result: { task: null, duplicate: false, error: "operation_conflict" } };
        }
        duplicate = true;
        const task = liveSnapshotTasksForData(data, command.taskId);
        return { data, result: { task, duplicate: true } };
      }
      if ((data.deletedTaskIds ?? []).some((candidate) => Number(candidate) === command.taskId)) {
        return { data, result: { task: null, duplicate: false, error: "unknown_task" } };
      }
      const current = liveSnapshotTasksForData(data, command.taskId) ?? fallbackTask;
      if (!current) return { data, result: { task: null, duplicate: false, error: "unknown_task" } };
      const next = build({ ...current });
      if (!next) return { data, result: { task: current, duplicate: false } };
      const tasks = [
        ...(data.tasks ?? []).filter((task) => Number(task.id) !== command.taskId),
        next,
      ];
      const receipt: SnapshotOperationReceipt = {
        operationId: command.operationId,
        action: command.action,
        taskId: command.taskId,
        fingerprint,
        createdAt: new Date().toISOString(),
      };
      return {
        data: appendReceipt({ ...data, tasks }, receipt),
        result: { task: next, duplicate: false },
      };
    }, pb);
    if (mutation.result.error) {
      return {
        ok: false,
        task: mutation.result.task,
        revision: mutation.revision,
        duplicate: mutation.result.duplicate,
        reason: mutation.result.error,
      };
    }
    const verified = await readSnapshotStateWithRevision(pb);
    const verifiedReceipt = getSnapshotOperationReceipts(verified.data, command.operationId)
      .some((receipt) =>
        receipt.action === command.action &&
        receipt.taskId === command.taskId &&
        receipt.fingerprint === fingerprint
      );
    const verifiedTask = liveSnapshotTasksForData(verified.data, command.taskId);
    if (!verifiedReceipt || (!verifiedTask && !(verified.data.deletedTaskIds ?? []).some((candidate) => Number(candidate) === command.taskId))) {
      return {
        ok: false,
        task: mutation.result.task,
        revision: verified.revision,
        duplicate: mutation.result.duplicate,
        reason: "snapshot_write_failed",
      };
    }
    return {
      ok: true,
      task: verifiedTask ?? mutation.result.task,
      revision: verified.revision,
      duplicate: mutation.result.duplicate || duplicate,
    };
  } catch {
    return {
      ok: false,
      task: null,
      revision: lookup.revision,
      duplicate: false,
      reason: "snapshot_write_failed",
    };
  }
}

function liveSnapshotTasksForData(data: SnapshotData, taskId: number): SnapshotTask | null {
  const tasks = Array.isArray(data.tasks) ? data.tasks as SnapshotTask[] : [];
  const tombstoned = new Set((data.deletedTaskIds ?? []).map(Number));
  const matches = tasks.filter((task) => Number(task.id) === taskId && !tombstoned.has(taskId));
  return matches.length === 1 ? matches[0] : null;
}

async function finishNonLedgerWrite(
  pb: AdminPB,
  command: ClaimCommand,
  actor: ClaimActor,
  outcome: CanonicalWriteOutcome,
): Promise<ClaimServiceResult> {
  if (!outcome.ok) return failure(command.operationId, outcome.reason ?? "snapshot_write_failed", command.action);
  const reconciled = outcome.task
    ? await projectCanonicalTaskToPB(pb, outcome.task, command.taskId)
    : await projectCanonicalTaskToPB(pb, null, command.taskId);
  return success(
    command,
    actor,
    outcome.task,
    outcome.revision,
    reconciled,
    undefined,
    outcome.duplicate,
  );
}

function canonicalCrew(
  task: SnapshotTask,
  members: LiveMember[],
): { members: CrewMember[]; removed: string[] } | null {
  const normalized = normalizeCrew(task.crew);
  const seen = new Set<string>();
  const output: CrewMember[] = [];
  for (const member of normalized) {
    const live = resolveHumanMember(members, member.name);
    if (!live || seen.has(live.id)) return null;
    seen.add(live.id);
    output.push({
      ...member,
      name: live.name,
      emoji: typeof member.emoji === "string" ? member.emoji : live.emoji ?? "",
    });
  }
  return { members: output, removed: normalizeCrewRemoved(task.crew) };
}

function crewWithRemoved(
  members: CrewMember[],
  removed: string[],
): { members: CrewMember[]; removed?: string[] } {
  return removed.length > 0
    ? { members, removed: [...new Set(removed)] }
    : { members };
}

function removedContains(
  member: LiveMember,
  removed: string[],
  roster: LiveMember[],
): boolean | "ambiguous" {
  for (const name of removed) {
    const matches = humanNameCandidates(roster, name);
    if (matches.length > 1) return "ambiguous";
    if (matches.length === 1 && matches[0].id === member.id) return true;
  }
  return false;
}

function pendingApproval(task: SnapshotTask): {
  byName: string;
  at: string;
  points: number;
  crew?: string[];
} | null {
  const value = task.pendingApproval;
  if (!isRecord(value) || typeof value.byName !== "string" || !value.byName.trim()) return null;
  const points = typeof value.points === "number" &&
    Number.isSafeInteger(value.points) &&
    value.points >= 0
    ? value.points
    : Number(task.points) || 0;
  const crew = Array.isArray(value.crew)
    ? value.crew.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    : undefined;
  return {
    byName: value.byName.trim(),
    at: typeof value.at === "string" ? value.at : new Date().toISOString(),
    points,
    ...(crew && crew.length > 0 ? { crew } : {}),
  };
}

async function readWeek(pb: AdminPB, weekStart: string): Promise<WeekData | null> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const row = (Array.isArray(rows) ? rows : []).find(
    (candidate: any) => candidate?.weekStart === weekStart,
  );
  if (!row) return null;
  return normalizeWeekData(row);
}

function latestEarn(
  history: Transaction[],
  taskId: number,
  member: string,
): Transaction | null {
  const earns = history.filter(
    (transaction) =>
      transaction.type === "earn" &&
      transaction.taskId === taskId &&
      transaction.member === member,
  );
  if (!earns.length) return null;
  return earns.reduce((latest, transaction) =>
    Date.parse(transaction.timestamp) >= Date.parse(latest.timestamp) ? transaction : latest
  );
}

function earnReversed(history: Transaction[], earn: Transaction): boolean {
  return history.some(
    (transaction) =>
      transaction.type === "adjust" &&
      transaction.amount <= 0 &&
      transaction.taskId === earn.taskId &&
      transaction.member === earn.member &&
      Date.parse(transaction.timestamp) >= Date.parse(earn.timestamp),
  );
}

interface LedgerMutationContext {
  authorityWeekStart: string;
  lookup: CanonicalTaskLookup;
  actor: ClaimActor & LiveMember;
  task: SnapshotTask;
  fingerprint: string;
  build: (current: SnapshotTask) => SnapshotTask;
  source: "assigned-complete" | "open-claim" | "late-snatch" | "task-undo";
  entries: {
    type: "earn" | "adjust";
    member: string;
    amount: number;
    description: string;
    taskId: number;
  }[];
}

async function applyLedgerMutation(
  command: ClaimCommand,
  context: LedgerMutationContext,
): Promise<ClaimServiceResult> {
  const weekStart = context.authorityWeekStart;
  let revision = context.lookup.revision;
  let task: SnapshotTask | null = null;
  const result = await applyWeekLedgerOperationLocked({
    weekStart,
    operation: {
      operationId: command.operationId,
      source: context.source,
      fingerprint: context.fingerprint,
      entries: context.entries,
    },
    project: async ({ pb, weekData, semanticDuplicate }) => {
      if (semanticDuplicate) return true;
      const outcome = await writeCanonicalTask(
        pb,
        context.lookup,
        command,
        context.actor,
        context.fingerprint,
        context.lookup.source === "pb" ? context.task : null,
        context.build,
      );
      revision = outcome.revision;
      task = outcome.task;
      if (!outcome.ok) return false;
      const weekProjection = await persistSnapshotWeek(pb, weekData);
      if (!weekProjection.ok) return false;
      revision = weekProjection.revision;
      return projectCanonicalTaskToPB(pb, outcome.task, command.taskId);
    },
  });
  if (!result.ok) {
    if (result.code === "insufficient_balance") {
      return failure(command.operationId, "insufficient_balance", command.action);
    }
    if (result.code === "operation_conflict") {
      return failure(command.operationId, "operation_conflict", command.action);
    }
    if (result.code === "invalid_ledger_operation") {
      return failure(command.operationId, "invalid_task_state", command.action);
    }
    return failure(command.operationId, "ledger_unavailable", command.action);
  }
  if (result.semanticDuplicate) {
    let winner: Transaction | null = null;
    for (const transaction of result.weekData.history) {
      if (
        transaction.type === "earn" &&
        transaction.taskId === command.taskId &&
        (!winner || Date.parse(transaction.timestamp) >= Date.parse(winner.timestamp))
      ) {
        winner = transaction;
      }
    }
    const winnerMember = context.task.completedBy || winner?.member;
    return failure(
      command.operationId,
      "already_claimed",
      command.action,
      winnerMember,
    );
  }
  return success(
    command,
    context.actor,
    task ?? context.task,
    revision,
    result.reconciled,
    result.weekData,
    result.duplicate,
  );
}

async function executeClaimCommandUnlocked(
  command: ClaimCommand,
  rawActor: ClaimActor,
  authorityWeekStart: string,
): Promise<ClaimServiceResult> {
  const action = command.action;
  if (!Number.isSafeInteger(command.taskId) || command.taskId <= 0) {
    return failure(command.operationId, "invalid_task_id", action);
  }

  let roster: LiveMember[];
  try {
    roster = await getLiveMembers();
  } catch {
    return failure(command.operationId, "member_roster_unavailable", action);
  }
  if (!Array.isArray(roster)) return failure(command.operationId, "member_roster_unavailable", action);
  const liveActor = resolveActor(roster, rawActor);
  if (!liveActor) {
    const signed = rawActor.role.trim().toLowerCase();
    return failure(command.operationId, signed === "pet" ? "not_allowed" : "unknown_actor", action);
  }
  const actor: ClaimActor & LiveMember = { ...liveActor, memberId: liveActor.id };

  let lookup: CanonicalTaskLookup;
  try {
    lookup = await withAdmin((pb) => findCanonicalTask(pb, command.taskId));
  } catch {
    return failure(command.operationId, "task_store_unavailable", action);
  }
  let replay: ClaimServiceResult | null;
  try {
    replay = await replayReceipt(command, actor, lookup, authorityWeekStart);
  } catch {
    return failure(command.operationId, "task_store_unavailable", action);
  }
  if (replay) return replay;
  try {
    lookup = await readCurrentCanonicalTask(command.taskId);
  } catch {
    return failure(command.operationId, "task_store_unavailable", action);
  }
  if (lookup.ambiguous) return failure(command.operationId, "ambiguous_task", action);
  if (!lookup.task || lookup.tombstoned) return failure(command.operationId, "unknown_task", action);
  const task = lookup.task;
  const baseActor: ClaimActor = { ...actor, authentication: rawActor.authentication ?? "internal" };
  const actorRole = actor.role.trim().toLowerCase();
  if (!sessionPolicyAllows(baseActor, task, action)) {
    return failure(command.operationId, "pin_required", action);
  }

  const weekStart = authorityWeekStart;
  const now = new Date().toISOString();
  const fingerprint = claimCommandFingerprint(command, actor);
  const points = validTaskPoints(task);

  if (action === "claim") {
    if (isCrewTask(task as unknown as Task)) return failure(command.operationId, "crew_task", action);
    const gate = claimGate(task);
    if (gate === "not_late_yet" || gate === "not_universal") {
      return failure(command.operationId, gate, action);
    }
    if (doneThisWeek(task, weekStart)) {
      return failure(
        command.operationId,
        "already_completed",
        action,
        typeof task.completedBy === "string" && task.completedBy ? task.completedBy : undefined,
      );
    }
    if (points === null) return failure(command.operationId, "invalid_task_state", action);
    const speedBonus = gate === "late" ? 0 : normalizeSpeedBonus(task.speedBonus);
    const amount = points + speedBonus;
    const label = gate === "late" ? "Snatched" : speedBonus > 0 ? "Fast grab" : "Completed";
    // Option B, mirrored from the `complete` branch below: chat never moves
    // points. A command authenticated as "internal" (the assistant, or any
    // future server-side caller) QUEUES for approval whether the claimer is a
    // child or a grown-up; only a real session/PIN caller — the Tasks screen —
    // pays on the spot. Keying off `authentication` rather than `role` closes
    // the roster-promotion race by construction, and it is the SEAM that
    // enforces the rule, not the one caller that happens to be typed to
    // "complete" | "undo" today.
    const queueOnly = actorRole === "child" || baseActor.authentication === "internal";
    const build = (current: SnapshotTask): SnapshotTask => ({
      ...current,
      assignee: actor.name,
      assigned: actor.name,
      assigneeEmoji: actor.emoji ?? current.assigneeEmoji ?? "",
      ...completedFields(now, weekStart, baseActor),
      pendingApproval: queueOnly
        ? {
            byName: actor.name,
            at: now,
            points: amount,
          }
        : null,
    });
    if (queueOnly) {
      return withAdmin((pb) => writeCanonicalTask(
        pb,
        lookup,
        command,
        baseActor,
        fingerprint,
        lookup.source === "pb" ? task : null,
        build,
      ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
    }
    return applyLedgerMutation(command, {
      authorityWeekStart: weekStart,
      lookup,
      actor,
      task,
      fingerprint,
      build,
      source: gate === "late" ? "late-snatch" : "open-claim",
      entries: [{
        type: "earn",
        member: actor.name,
        amount,
        description: `${label}: ${task.title || "task"}${amount > 0 ? ` (+${amount}pts)` : ""}`,
        taskId: command.taskId,
      }],
    });
  }

  if (action === "complete") {
    if (isCrewTask(task as unknown as Task)) return failure(command.operationId, "crew_task", action);
    if (task.universal !== false) return failure(command.operationId, "not_assigned", action);
    if (doneThisWeek(task, weekStart)) return failure(command.operationId, "already_completed", action);
    const owner = resolveHumanMember(roster, task.assignee);
    if (!owner) return failure(command.operationId, "unknown_task_owner", action);
    if (owner.id !== actor.id) return failure(command.operationId, "not_task_owner", action);
    if (points === null) return failure(command.operationId, "invalid_task_state", action);
    // Option B: chat never moves points. A command authenticated as "internal"
    // (the assistant) queues for approval whether the owner is a child or a
    // grown-up; only a real session/PIN caller — the Tasks screen — pays now.
    // Keying off `authentication` rather than `role` closes the roster race:
    // a member promoted between two reads cannot flip this branch.
    const queueOnly = actorRole === "child" || baseActor.authentication === "internal";
    const build = (current: SnapshotTask): SnapshotTask => ({
      ...current,
      assigneeEmoji: actor.emoji ?? current.assigneeEmoji ?? "",
      ...completedFields(now, weekStart, baseActor),
      pendingApproval: queueOnly
        ? {
            byName: actor.name,
            at: now,
            points,
          }
        : null,
    });
    if (queueOnly) {
      return withAdmin((pb) => writeCanonicalTask(
        pb,
        lookup,
        command,
        baseActor,
        fingerprint,
        lookup.source === "pb" ? task : null,
        build,
      ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
    }
    return applyLedgerMutation(command, {
      authorityWeekStart: weekStart,
      lookup,
      actor,
      task,
      fingerprint,
      build,
      source: "assigned-complete",
      entries: [{
        type: "earn",
        member: actor.name,
        amount: points,
        description: `Completed: ${task.title || "task"}${points > 0 ? ` (+${points}pts)` : ""}`,
        taskId: command.taskId,
      }],
    });
  }

  if (action === "undo") {
    const approval = pendingApproval(task);
    if (approval) {
      if (actorRole === "child" && baseActor.authentication === "pin") {
        return failure(command.operationId, "session_required", action);
      }
      if (approval.crew && approval.crew.length > 0) {
        if (actorRole !== "parent") {
          return failure(command.operationId, "adult_only", action);
        }
      } else {
        const owner = resolveHumanMember(roster, approval.byName);
        if (!owner) return failure(command.operationId, "unknown_task_owner", action);
        if (actorRole === "child" && owner.id !== actor.id) {
          return failure(command.operationId, "not_task_owner", action);
        }
      }
      const build = (current: SnapshotTask): SnapshotTask => reopenTask(current, now);
      return withAdmin((pb) => writeCanonicalTask(
        pb,
        lookup,
        command,
        baseActor,
        fingerprint,
        lookup.source === "pb" ? task : null,
        build,
      ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
    }

    if (actorRole === "child") return failure(command.operationId, "not_task_owner", action);
    const week = await withAdmin((pb) => readWeek(pb, weekStart));
    if (!week) return failure(command.operationId, "nothing_to_undo", action);
    const earn = latestEarn(week.history, command.taskId, actor.name);
    if (!earn) return failure(command.operationId, "nothing_to_undo", action);
    if (earnReversed(week.history, earn)) {
      return failure(command.operationId, "already_undone", action);
    }
    if (!Number.isSafeInteger(earn.amount) || earn.amount < 0) {
      return failure(command.operationId, "invalid_task_state", action);
    }
    return applyLedgerMutation(command, {
      authorityWeekStart: weekStart,
      lookup,
      actor,
      task,
      fingerprint,
      build: (current) => reopenTask(current, now),
      source: "task-undo",
      entries: [{
        type: "adjust",
        member: actor.name,
        amount: earn.amount === 0 ? 0 : -earn.amount,
        description: `Undo: ${task.title || "task"} (${earn.amount === 0 ? "0" : `-${earn.amount}`}pts)`,
        taskId: command.taskId,
      }],
    });
  }

  if ((action === "crew-remove" || action === "crew-close") && actorRole !== "parent") {
    return failure(command.operationId, "adult_only", action);
  }
  if (!isCrewTask(task as unknown as Task)) return failure(command.operationId, "not_crew_task", action);
  if (doneThisWeek(task, weekStart) || pendingApproval(task)) {
    return failure(command.operationId, "already_completed", action);
  }
  const crew = canonicalCrew(task, roster);
  if (!crew || typeof task.crewSize !== "number" || !Number.isSafeInteger(task.crewSize)) {
    return failure(command.operationId, "invalid_crew_member", action);
  }

  if (action === "crew-join") {
    const removedState = removedContains(actor, crew.removed, roster);
    if (removedState === "ambiguous") return failure(command.operationId, "invalid_crew_member", action);
    if (removedState) {
      return failure(command.operationId, "removed_crew_member", action);
    }
    if (crew.members.some((member) => member.name === actor.name)) {
      return withAdmin((pb) => writeCanonicalTask(
        pb,
        lookup,
        command,
        baseActor,
        fingerprint,
        lookup.source === "pb" ? task : null,
        (current) => current,
      ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
    }
    if (crew.members.length >= task.crewSize) return failure(command.operationId, "crew_full", action);
    const nextCrew = crewWithRemoved([
      ...crew.members,
      {
        name: actor.name,
        emoji: actor.emoji ?? "",
        joinedAt: now,
      },
    ], crew.removed);
    return withAdmin((pb) => writeCanonicalTask(
      pb,
      lookup,
      command,
      baseActor,
      fingerprint,
      lookup.source === "pb" ? task : null,
      (current) => ({ ...current, crew: nextCrew }),
    ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
  }

  if (action === "crew-checkin") {
    const removedState = removedContains(actor, crew.removed, roster);
    if (removedState === "ambiguous") return failure(command.operationId, "invalid_crew_member", action);
    if (removedState) {
      return failure(command.operationId, "removed_crew_member", action);
    }
    const index = crew.members.findIndex((member) => member.name === actor.name);
    if (index === -1) return failure(command.operationId, "not_in_crew", action);
    if (crew.members[index].checkedInAt) {
      return withAdmin((pb) => writeCanonicalTask(
        pb,
        lookup,
        command,
        baseActor,
        fingerprint,
        lookup.source === "pb" ? task : null,
        (current) => current,
      ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
    }
    const nextMembers = crew.members.map((member, memberIndex) =>
      memberIndex === index ? { ...member, checkedInAt: member.checkedInAt || now } : member
    );
    const nextCrew = crewWithRemoved(nextMembers, crew.removed);
    const allChecked = crewAllCheckedIn({ ...task, crew: nextCrew } as Task);
    if (allChecked && points === null) return failure(command.operationId, "invalid_task_state", action);
    return withAdmin((pb) => writeCanonicalTask(
      pb,
      lookup,
      command,
      baseActor,
      fingerprint,
      lookup.source === "pb" ? task : null,
      (current) => ({
        ...current,
        crew: nextCrew,
        ...(allChecked
          ? {
              ...completedFields(now, weekStart, { ...baseActor, name: "Crew" }),
              pendingApproval: {
                byName: "Crew",
                at: now,
                points: points ?? 0,
                crew: nextMembers.map((member) => member.name),
              },
            }
          : {}),
      }),
    ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
  }

  if (action === "crew-close") {
    const decision = crewCloseAwardList(task as unknown as Task);
    if (!decision.ok) {
      return failure(
        command.operationId,
        decision.reason === "strict_mode" ? "crew_close_not_allowed" : decision.reason,
        action,
      );
    }
    return withAdmin((pb) => writeCanonicalTask(
      pb,
      lookup,
      command,
      baseActor,
      fingerprint,
      lookup.source === "pb" ? task : null,
      (current) => ({
        ...current,
        ...completedFields(now, weekStart, { ...baseActor, name: "Crew" }),
        pendingApproval: buildCrewClosePending(current as unknown as Task, decision.awardList, now),
      }),
    ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
  }

  const targetName = command.targetName;
  if (!targetName) return failure(command.operationId, "target_required", action);
  const target = resolveHumanMember(roster, targetName);
  if (!target) return failure(command.operationId, "unknown_crew_member", action);
  const targetIndex = crew.members.findIndex((member) => member.name === target.name);
  if (targetIndex === -1) return failure(command.operationId, "not_in_crew", action);
  if (crew.members[targetIndex].checkedInAt) {
    return failure(command.operationId, "member_checked_in", action);
  }
  const nextMembers = crew.members.filter((_, index) => index !== targetIndex);
  const nextCrew = crewWithRemoved(nextMembers, [...crew.removed, target.name]);
  return withAdmin((pb) => writeCanonicalTask(
    pb,
    lookup,
    command,
    baseActor,
    fingerprint,
    lookup.source === "pb" ? task : null,
    (current) => ({ ...current, crew: nextCrew }),
  ).then((outcome) => finishNonLedgerWrite(pb, command, baseActor, outcome)));
}

export function executeClaimCommand(
  command: ClaimCommand,
  rawActor: ClaimActor,
): Promise<ClaimServiceResult> {
  if (!Number.isSafeInteger(command.taskId) || command.taskId <= 0) {
    return Promise.resolve(failure(command.operationId, "invalid_task_id", command.action));
  }
  const weekStart = localWeekStartISO();
  return withWeekLedgerLock(
    weekStart,
    () => withTaskCommandLock(
      command.taskId,
      () => executeClaimCommandUnlocked(command, rawActor, weekStart),
    ),
  );
}

export function taskClaimInternalPayload(command: ClaimCommand): Record<string, unknown> {
  return command.action === "crew-remove" && command.targetName
    ? { taskId: command.taskId, targetName: command.targetName }
    : { taskId: command.taskId };
}

function decodeInternalCommand(command: InternalTaskCommand): ClaimCommand | null {
  if (!isRecord(command.payload)) return null;
  const allowed = command.kind === "crew-remove"
    ? new Set(["taskId", "targetName"])
    : new Set(["taskId"]);
  if (Object.keys(command.payload).some((key) => !allowed.has(key))) return null;
  const parsed = parseClaimCommand({
    action: command.kind,
    operationId: command.operationId,
    ...command.payload,
  });
  return "error" in parsed ? null : parsed;
}

async function handleCommand(
  command: InternalTaskCommand,
  _context: InternalTaskCommandContext,
): Promise<InternalTaskCommandResult> {
  const parsed = decodeInternalCommand(command);
  if (!parsed) {
    return {
      ok: false,
      operationId: command.operationId,
      reason: "invalid_claim_command",
      reconciled: false,
    };
  }
  const actor: ClaimActor = {
    memberId: command.actor.memberId,
    name: command.actor.name,
    role: command.actor.role,
    authentication: (command.actor as ClaimActor).authentication ?? "internal",
    ...((command.actor as ClaimActor).requestedName
      ? { requestedName: (command.actor as ClaimActor).requestedName }
      : {}),
  };
  return executeClaimCommand(parsed, actor) as Promise<InternalTaskCommandResult>;
}

let handlersRegistered = false;
const cleanups: Array<() => void> = [];

export function ensureTaskClaimHandlersRegistered(): void {
  if (handlersRegistered) return;
  cleanups.push(
    registerInternalTaskCommandHandler("claim", handleCommand),
    registerInternalTaskCommandHandler("complete", handleCommand),
    registerInternalTaskCommandHandler("undo", handleCommand),
    registerInternalTaskCommandHandler("crew-join", handleCommand),
    registerInternalTaskCommandHandler("crew-checkin", handleCommand),
    registerInternalTaskCommandHandler("crew-remove", handleCommand),
    registerInternalTaskCommandHandler("crew-close", handleCommand),
  );
  handlersRegistered = true;
}

export function unregisterTaskClaimHandlersForTests(): void {
  while (cleanups.length) cleanups.pop()?.();
  handlersRegistered = false;
}

ensureTaskClaimHandlersRegistered();
