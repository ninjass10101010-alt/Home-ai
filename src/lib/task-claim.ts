import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import { withTaskCommandLock } from "@/lib/task-command-lock";
import { getLiveMembers, type LiveMember } from "@/lib/live-member";
import { localTodayISO, localWeekStartISO } from "@/lib/local-date";
import { applyWeekLedgerOperationLocked, normalizeWeekStart } from "@/lib/ledger-operations";
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
  describeSnapshotWriteError,
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
import { slimTaskEmoji } from "@/lib/task-emoji";
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
  /**
   * SERVER-QUEUE ONLY — the instant a deferred `claim`/`complete` was captured
   * (the queue row's `created`). The service re-checks `sentBackAt` against it
   * on its FRESH read, under the task-command lock, so an undo that commits
   * after the drain's cheap pre-check cannot be paid by the replay. The wire
   * parser never admits this key; only `decodeInternalCommand` attaches it.
   */
  supersedeIfSentBackAfter?: string;
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
  // The legacy assigneeEmoji key is validated and then DROPPED (the actor's
  // emoji is re-resolved from the live roster), so this bound is body hygiene
  // for a field that never reaches storage. The storage ceiling + fallback
  // (TASK_SNAPSHOT_EMOJI_MAX -> 👤) is applied where claim actually persists
  // emoji: the claim/complete builds, crew-join, and canonicalCrew — all via
  // slimTaskEmoji. The live client still sends its stored (sometimes photo-
  // sized) assigneeEmoji on the legacy key, so it must stay admitted.
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

/**
 * Option B: chat never moves points. ONE predicate for the whole seam, so the
 * queue-vs-pay decision has a single source of truth — it used to be written out
 * inline once per branch, which is how the comment and the code drifted apart.
 *
 * A completion QUEUES for approval when EITHER
 *
 *   1. it did not come from the Tasks screen: `authentication` is `"internal"`
 *      (the assistant, MUSE, or any server-side caller), or
 *   2. the PIN-verified member is a child, whose points a grown-up approves.
 *
 * Clause 1 is what closes the roster-promotion race, and it is keyed off
 * `authentication` alone because that value is fixed by the CALLER at the
 * boundary: a member promoted child -> parent between two roster reads cannot
 * flip it. Clause 2 is a property of WHO was verified, read once from the live
 * roster — the same `role` every surrounding ownership rule uses. It can only
 * make a queue MORE likely (never pay a child directly), so the two clauses
 * cannot disagree about a grown-up. A parent PIN on the Tasks screen is the only
 * caller that pays on the spot.
 */
function queuesForApproval(actor: ClaimActor): boolean {
  return actor.authentication === "internal" ||
    actor.role.trim().toLowerCase() === "child";
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
    // A fresh tap starts a new occurrence's award; a stale paid amount must
    // never describe it.
    awardedPoints: null,
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
    // The award described a completion that no longer stands.
    awardedPoints: null,
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
      week = undefined;
    }
  }
  if (shouldInspectLedger && week === undefined) {
    // The ledger leg could not be read. Reporting `reconciled: true` here would
    // confirm a command whose points were never checked, and a duplicate
    // confirmation makes the outbox DELETE the entry — so the command is refused
    // with the retryable `ledger_unavailable` instead.
    return {
      reconciled: false,
      revision: lookup.revision,
      task: lookup.task,
      reason: "ledger_unavailable",
    };
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
  let week: WeekData | null | undefined;
  if (ledgerAction) {
    try {
      week = await withAdmin((pb) => readWeek(pb, authorityWeekStart));
    } catch {
      week = undefined;
    }
    if (week === undefined) {
      // "Could not read" must never be answered as a duplicate: the receipt says
      // this command was already handled, but the ledger leg was never checked,
      // and a duplicate acknowledgement makes the outbox delete the entry. The
      // client retries instead.
      return failure(command.operationId, "ledger_unavailable", command.action);
    }
  }
  const transactions = ledgerReplayTransactions(week ?? null, command.operationId);
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
  } catch (error) {
    console.warn(`[task-claim] snapshot write failed: ${describeSnapshotWriteError(error)}`);
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
      // The roster photo (a 100KB+ data URL) must never ride a snapshot row:
      // slimTaskEmoji falls back to 👤 above TASK_SNAPSHOT_EMOJI_MAX, and
      // rendering is roster-first so the real photo still shows.
      emoji: slimTaskEmoji(typeof member.emoji === "string" ? member.emoji : live.emoji ?? ""),
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

/**
 * The week row could not be read — a thrown read, or two `week_data` rows for
 * one week.
 *
 * This is deliberately its own failure and never collapses into "no week
 * exists". The old bare `.find()` picked whichever duplicate sorted first (a
 * stale copy missing the earn reported `nothing_to_undo`, which the outbox
 * consumes as a confirmed duplicate and deletes), and a THROWN read was caught
 * and coerced to `null` — indistinguishable from "no week exists", so a re-sent
 * claim/complete/undo during a PocketBase blip was answered **200 duplicate**
 * for a command whose ledger leg was never checked. Callers keep `undefined`
 * for "could not read" and refuse with a retryable reason instead.
 */
class WeekLedgerReadError extends Error {
  constructor(weekStart: string) {
    super(`week_ledger_unreadable:${weekStart}`);
    this.name = "WeekLedgerReadError";
  }
}

/** Read the single `week_data` row for a week, the way the seam reads it. */
async function readWeek(pb: AdminPB, weekStart: string): Promise<WeekData | null> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const matching = (Array.isArray(rows) ? rows : []).filter(
    (candidate: any) => normalizeWeekStart(candidate?.weekStart) === weekStart,
  );
  // Ambiguity is REFUSED, exactly as `ledger-operations` refuses it: the write
  // path must never be talking about a different row than the read path.
  if (matching.length > 1) throw new WeekLedgerReadError(weekStart);
  const row = matching[0];
  if (!row) return null;
  return normalizeWeekData(row);
}

interface WeekHistory {
  weekStart: string;
  history: Transaction[];
}

/** `week_archive` rows, or none when this client cannot name the collection. */
async function readArchiveRows(pb: AdminPB): Promise<Record<string, unknown>[]> {
  let handle: unknown;
  try {
    handle = pb.collection("week_archive");
  } catch {
    return [];
  }
  if (!handle || typeof (handle as { getFullList?: unknown }).getFullList !== "function") return [];
  const rows = await (handle as { getFullList: (options?: unknown) => Promise<unknown> })
    .getFullList({ requestKey: null });
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

/**
 * Every week the family has ledger history in — `week_data` first (it stays
 * authoritative), then `week_archive` (the rollover's mirror, which is the ONLY
 * copy once a row is gone from `week_data`).
 *
 * A paid undo needs this because the earn it reverses is not necessarily in the
 * authority week: a chore done on Sunday is paid into the PREVIOUS week's row,
 * and on Monday the new week's row may not even exist yet.
 */
async function readLedgerWeeks(pb: AdminPB, authorityWeekStart: string): Promise<WeekHistory[]> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const parsed: WeekHistory[] = [];
  const seenWeeks = new Set<string>();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    const weekStart = normalizeWeekStart((candidate as { weekStart?: unknown })?.weekStart);
    if (!weekStart) continue;
    if (seenWeeks.has(weekStart)) {
      if (weekStart === authorityWeekStart) throw new WeekLedgerReadError(weekStart);
      continue;
    }
    seenWeeks.add(weekStart);
    const week = normalizeWeekData(candidate);
    // A week whose stored history no longer parses is evidence for nobody in
    // either direction (every balance computation runs the same parser), so it
    // is skipped rather than allowed to freeze the undo.
    if (week) parsed.push({ weekStart, history: week.history });
  }
  for (const row of await readArchiveRows(pb)) {
    const week = normalizeWeekData(row);
    if (week) parsed.push({ weekStart: week.weekStart, history: week.history });
  }
  // `week_archive` mirrors `week_data`, so the same transaction arrives twice.
  // The first occurrence wins, which keeps the reversal pointed at the row the
  // seam will actually write.
  const seenIds = new Set<number>();
  return parsed.map((week) => {
    const history = week.history.filter((transaction) => {
      if (seenIds.has(transaction.id)) return false;
      seenIds.add(transaction.id);
      return true;
    });
    return { weekStart: week.weekStart, history };
  });
}

interface EarnCandidate {
  earn: Transaction;
  weekStart: string;
  reversed: boolean;
}

function laterThan(left: Transaction, right: Transaction): boolean {
  const leftAt = Date.parse(left.timestamp);
  const rightAt = Date.parse(right.timestamp);
  if (leftAt !== rightAt) return leftAt > rightAt;
  return left.id > right.id;
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

/**
 * The LATEST earn per member for a task, across every week, each flagged with
 * whether that member's payment has already been reversed.
 *
 * Per member, because a crew close pays N members: reversing the crew's
 * payment means reversing EVERY earn row the crew was paid, each at its own
 * amount. Per taskId only, because a crew close is owned by `completedBy:
 * "Crew"` — a name that is not on the live roster, so no caller's own name can
 * ever match it.
 */
function latestTaskEarns(weeks: readonly WeekHistory[], taskId: number): EarnCandidate[] {
  const latest = new Map<string, EarnCandidate>();
  for (const week of weeks) {
    for (const transaction of week.history) {
      if (transaction.type !== "earn" || transaction.taskId !== taskId) continue;
      const existing = latest.get(transaction.member);
      if (existing && !laterThan(transaction, existing.earn)) continue;
      latest.set(transaction.member, {
        earn: transaction,
        weekStart: week.weekStart,
        reversed: earnReversed(week.history, transaction),
      });
    }
  }
  return [...latest.values()];
}

/**
 * Two allowed reversers, and no third: a parent may reverse anybody's payment,
 * a member may reverse only their OWN. The earn's member is resolved against
 * the live roster so a stored first name still matches the right person.
 */
function mayReverseEarn(
  actor: ClaimActor,
  paidMember: string,
  roster: LiveMember[],
): boolean {
  if (actor.role.trim().toLowerCase() === "parent") return true;
  const owner = resolveHumanMember(roster, paidMember);
  if (owner) return owner.id === actor.memberId;
  return paidMember === actor.name;
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
  // The queued replay's supersede guard, re-checked on the FRESH read and
  // INSIDE the task-command lock (this whole function runs under
  // withWeekLedgerLock -> withTaskCommandLock, the same lock the undo's
  // reopenTask write takes). The drain's cheap pre-check can go stale between
  // its read and this one; this check-then-act cannot race a concurrent undo,
  // so a retracted completion is refused before ANY ledger write.
  if (
    command.supersedeIfSentBackAfter &&
    (action === "claim" || action === "complete")
  ) {
    const retractedMs = Date.parse(String((task as Record<string, any>).sentBackAt ?? ""));
    const capturedMs = Date.parse(command.supersedeIfSentBackAfter);
    if (Number.isFinite(retractedMs) && Number.isFinite(capturedMs) && retractedMs >= capturedMs) {
      return failure(command.operationId, "already_undone", action);
    }
  }
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
    // `queuesForApproval` is the ONE rule (see its doc comment); the `claim`
    // branch and the `complete` branch below must not grow a second answer.
    const queueOnly = queuesForApproval(baseActor);
    const build = (current: SnapshotTask): SnapshotTask => ({
      ...current,
      assignee: actor.name,
      assigned: actor.name,
      assigneeEmoji: slimTaskEmoji(actor.emoji) || current.assigneeEmoji || "",
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
    // The same ONE rule as the `claim` branch above.
    const queueOnly = queuesForApproval(baseActor);
    const build = (current: SnapshotTask): SnapshotTask => ({
      ...current,
      assigneeEmoji: slimTaskEmoji(actor.emoji) || current.assigneeEmoji || "",
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

    // Everything above this point was an UNPAID reopen (a queued tap that never
    // moved points). From here the undo is a real ledger reversal, and
    // `sessionPolicyAllows` has already established that a PIN (or an admin
    // caller) is presenting it.
    //
    // The earn is NOT necessarily in the authority week, and it is NOT
    // necessarily the caller's own: a chore paid on Sunday lives in the previous
    // week's row, and a crew close pays N members under an owner name
    // ("Crew") that is not on the roster. So the earn is resolved per member
    // across every week, and each reversal is written into the week that HOLDS
    // that earn.
    let weeks: WeekHistory[];
    try {
      weeks = await withAdmin((pb) => readLedgerWeeks(pb, weekStart));
    } catch {
      // An unreadable / ambiguous ledger is not "nothing to undo": that reason is
      // classified as a DUPLICATE by the outbox, which would delete the entry
      // and leave the points wrong. `ledger_unavailable` is retryable.
      return failure(command.operationId, "ledger_unavailable", action);
    }
    const candidates = latestTaskEarns(weeks, command.taskId);
    if (candidates.length === 0) return failure(command.operationId, "nothing_to_undo", action);
    const unpaid = candidates.filter((candidate) => !candidate.reversed);
    if (unpaid.length === 0) return failure(command.operationId, "already_undone", action);
    const authorised = unpaid.filter((candidate) =>
      mayReverseEarn(actor, candidate.earn.member, roster)
    );
    if (authorised.length === 0) return failure(command.operationId, "not_task_owner", action);
    for (const candidate of authorised) {
      if (!Number.isSafeInteger(candidate.earn.amount) || candidate.earn.amount < 0) {
        return failure(command.operationId, "invalid_task_state", action);
      }
    }

    const title = task.title || "task";
    const byWeek = new Map<string, NonNullable<LedgerMutationContext["entries"]>>();
    for (const candidate of authorised) {
      const amount = candidate.earn.amount;
      const entries = byWeek.get(candidate.weekStart) ?? [];
      entries.push({
        type: "adjust",
        // The EARN's member, never the actor's: a crew reversal pays back every
        // member the crew was paid.
        member: candidate.earn.member,
        amount: amount === 0 ? 0 : -amount,
        description: `Undo: ${title} (${amount === 0 ? "0" : `-${amount}`}pts)`,
        taskId: command.taskId,
      });
      byWeek.set(candidate.weekStart, entries);
    }
    const groups = [...byWeek.entries()].sort((left, right) => left[0].localeCompare(right[0]));
    // The primary group carries the snapshot leg (reopen the task + persist the
    // week): the authority week when it holds any of the earn, else the earliest
    // week that does.
    const primaryIndex = Math.max(
      0,
      groups.findIndex(([groupWeek]) => groupWeek === weekStart),
    );
    const [primaryWeek, primaryEntries] = groups[primaryIndex];

    const result = await applyLedgerMutation(command, {
      authorityWeekStart: primaryWeek,
      lookup,
      actor,
      task,
      fingerprint,
      build: (current) => reopenTask(current, now),
      source: "task-undo",
      entries: primaryEntries,
    });
    if (!result.ok) return result;

    // Any other week holding a paid member's earn gets its own reversal through
    // the SAME seam, under the SAME operationId, so a retry finds them already
    // applied rather than reversing twice. No projection: the task was reopened
    // once, by the primary.
    //
    // The LOCKED seam variant is deliberate: `executeClaimCommand` already holds
    // the authority week's lock and the global order is
    // week-ledger → task-command → snapshot, so taking a second week-ledger lock
    // here would insert an acquisition between task-command and snapshot (and
    // open an A-B-A window at a week boundary). The primary — the common case —
    // is fully serialised, and a lost update on the rare extra week is caught by
    // the seam's own post-write verification, which aborts with a retryable
    // `ledger_unavailable` rather than losing points.
    for (const [groupWeek, entries] of groups) {
      if (groupWeek === primaryWeek) continue;
      const extra = await applyWeekLedgerOperationLocked({
        weekStart: groupWeek,
        operation: {
          operationId: command.operationId,
          source: "task-undo",
          fingerprint,
          entries,
        },
      });
      if (!extra.ok) {
        return failure(
          command.operationId,
          extra.code === "operation_conflict" ? "operation_conflict" : "ledger_unavailable",
          action,
        );
      }
    }

    if (primaryWeek === weekStart) return result;
    // The reversal moved an OLDER week, so the authority week is unchanged. Say
    // so: returning the older weekData here would hand the client a week it is
    // not displaying as if it were this week's totals.
    const authorityWeek = await withAdmin((pb) => readWeek(pb, weekStart)).catch(() => null);
    const response: ClaimServiceResult = { ...result };
    if (authorityWeek) response.weekData = authorityWeek;
    else delete response.weekData;
    return response;
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
        emoji: slimTaskEmoji(actor.emoji) || "",
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
  // `supersedeIfSentBackAfter` is SERVER-QUEUE ONLY: the wire parser
  // (`parseClaimCommand`) never admits it, and only the two actions that
  // re-apply a completion may carry it. Everything else keeps the old keys.
  const guarded = command.kind === "claim" || command.kind === "complete";
  const allowed = command.kind === "crew-remove"
    ? new Set(["taskId", "targetName"])
    : guarded
      ? new Set(["taskId", "supersedeIfSentBackAfter"])
      : new Set(["taskId"]);
  if (Object.keys(command.payload).some((key) => !allowed.has(key))) return null;
  const { supersedeIfSentBackAfter, ...wirePayload } = command.payload;
  const parsed = parseClaimCommand({
    action: command.kind,
    operationId: command.operationId,
    ...wirePayload,
  });
  if ("error" in parsed) return null;
  const capturedAt =
    typeof supersedeIfSentBackAfter === "string" &&
    Number.isFinite(Date.parse(supersedeIfSentBackAfter))
      ? supersedeIfSentBackAfter
      : undefined;
  return capturedAt ? { ...parsed, supersedeIfSentBackAfter: capturedAt } : parsed;
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
