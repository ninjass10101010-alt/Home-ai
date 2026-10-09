import { withAdmin } from "@/lib/pb-auth";
import type { AdminPB } from "@/lib/snapshot-tasks";
import { executeInternalTaskCommand, type InternalTaskCommandResult } from "@/lib/task-commands";
import { ensureTaskClaimHandlersRegistered } from "@/lib/task-claim";
import { ensureTaskManageHandlersRegistered } from "@/lib/task-manage";
import { ensureTaskApprovalHandlersRegistered } from "@/lib/task-approval";
import { executeLedgerCommand } from "@/lib/task-ledger-command";
import { applyWeekLedgerOperation, type LedgerProjection } from "@/lib/ledger-operations";
import {
  findCanonicalTask,
  mutateSnapshotWithMeta,
  persistSnapshotWeek,
  type SnapshotData,
} from "@/lib/snapshot-tasks";
import { applyTaskConfigCommand, parseStoredTaskConfigCommand } from "@/lib/task-config-apply";
import { isRecord } from "@/lib/task-operation-contract";
import {
  DUPLICATE_REASONS,
  PERMANENT_REASONS,
  RETRYABLE_REASONS,
  type TaskOperationRoute,
  type TaskOutboxDisplayTarget,
} from "@/lib/task-operation-payload";
import type { LedgerOperationInput } from "@/types/tasks";

/**
 * The server-side task command queue — the PocketBase replacement for the
 * browser localStorage outbox.
 *
 * When a command route's service call fails with a TRANSIENT reason (the task
 * store is unreachable mid-write, the snapshot leg failed), the intake route
 * writes the verified command here and answers `202 { queued: true }`. The
 * family's tap is then durable across devices, reloads and reboots, and the
 * drain below replays it through the SAME service seams the original intake
 * used — never a drifting copy — with receipts and operation-id fingerprints
 * already guaranteeing a replay can never double-apply.
 *
 * The raw PIN is NEVER stored: intake verifies the credential and records the
 * verified ACTOR identity (memberId/name/role + how they proved themselves),
 * which is exactly the authorization the original command already received.
 */

export const TASK_COMMAND_QUEUE_COLLECTION = "task_command_queue";

export const TASK_QUEUE_MAX_ATTEMPTS = 8;
export const TASK_QUEUE_BASE_BACKOFF_MS = 2_000;
export const TASK_QUEUE_MAX_BACKOFF_MS = 5 * 60_000;
/** A parked pending row older than this goes terminal `failed` — the banner
 * can never outlive a day, and the family is told to tap the chore again. */
export const TASK_QUEUE_EXPIRY_MS = 24 * 60 * 60_000;
/** Terminal rows stay readable (cross-device banners + retry affordances). */
export const TASK_QUEUE_FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Resolved/cancelled markers stay visible so every device can release its
 * optimistic marks; past this the row is deleted. */
export const TASK_QUEUE_TERMINAL_RETENTION_MS = 60 * 60_000;
/** One drain pass replays at most this many due rows — bounded work per sync. */
export const TASK_QUEUE_DRAIN_BATCH = 10;

export type TaskQueueRowStatus = "pending" | "failed" | "resolved" | "cancelled";

export interface TaskQueueActor {
  memberId: string;
  name: string;
  role: string;
  authentication: "pin" | "session";
}

export interface TaskQueueEnqueueInput {
  operationId: string;
  route: TaskOperationRoute;
  action: string;
  payload: Record<string, unknown>;
  actor: TaskQueueActor;
  displayTarget?: TaskOutboxDisplayTarget;
}

export interface TaskQueueStateRow {
  operationId: string;
  route: TaskOperationRoute;
  action: string;
  status: TaskQueueRowStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorReason: string | null;
  lastErrorMessage: string | null;
  displayTarget: TaskOutboxDisplayTarget | null;
  /** The ack body captured at drain time (resolved rows) or the refusal body
   * (failed rows) — bounded by terminal retention. */
  result: Record<string, unknown> | null;
  actorMemberId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DrainTaskCommandQueueSummary {
  acknowledged: number;
  retryable: number;
  permanent: number;
}

function taskQueueBackoffMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(TASK_QUEUE_BASE_BACKOFF_MS * 2 ** (attempt - 1), TASK_QUEUE_MAX_BACKOFF_MS);
}

function queueIsoNow(): string {
  return new Date().toISOString();
}

function rowCreatedAtMs(row: Record<string, any>): number {
  const raw = row?.created ?? row?.createdAt;
  const epoch = typeof raw === "string" ? Date.parse(raw) : Number(raw);
  return Number.isFinite(epoch) ? epoch : 0;
}

function normalizeDisplayTarget(value: unknown): TaskOutboxDisplayTarget | null {
  if (!isRecord(value)) return null;
  const kind = String(value.kind ?? "");
  const known = ["task", "claim", "approval", "crew", "undo", "config"];
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : undefined;
  const taskId = typeof value.taskId === "number" && Number.isFinite(value.taskId) ? value.taskId : undefined;
  return {
    ...(taskId !== undefined ? { taskId } : {}),
    ...(title ? { title } : {}),
    kind: known.includes(kind) ? (kind as TaskOutboxDisplayTarget["kind"]) : "task",
  };
}

function toStateRow(row: any): TaskQueueStateRow {
  return {
    operationId: String(row.operationId ?? ""),
    route: String(row.route ?? "") as TaskOperationRoute,
    action: String(row.action ?? ""),
    status: (["pending", "failed", "resolved", "cancelled"].includes(String(row.status))
      ? String(row.status)
      : "pending") as TaskQueueRowStatus,
    attemptCount: Number(row.attemptCount ?? 0) || 0,
    nextAttemptAt: typeof row.nextAttemptAt === "string" ? row.nextAttemptAt : null,
    lastErrorReason: typeof row.lastErrorReason === "string" ? row.lastErrorReason : null,
    lastErrorMessage: typeof row.lastErrorMessage === "string" ? row.lastErrorMessage : null,
    displayTarget: normalizeDisplayTarget(row.displayTarget),
    result: isRecord(row.result) ? (row.result as Record<string, unknown>) : null,
    actorMemberId: String(row.actorMemberId ?? ""),
    createdAt: typeof row.created === "string" ? row.created : queueIsoNow(),
    updatedAt: typeof row.updated === "string" ? row.updated : queueIsoNow(),
  };
}

async function readQueueRows(pb: AdminPB, filter: string): Promise<Record<string, any>[]> {
  const rows = await pb
    .collection(TASK_COMMAND_QUEUE_COLLECTION)
    .getFullList({ requestKey: null, filter, sort: "created" });
  return Array.isArray(rows) ? (rows as Record<string, any>[]) : [];
}

/**
 * Write the verified command as a pending queue row. IDEMPOTENT on the
 * operation id: a re-queue of a known id is a retry of the SAME command, so
 * the existing row is returned untouched (its attempt budget preserved, never
 * reset — the same contract the client outbox held).
 */
export async function enqueueTaskCommandRow(input: TaskQueueEnqueueInput): Promise<boolean> {
  if (!input.operationId.trim() || !input.route || !input.action) return false;
  return withAdmin(async (pb) => {
    const existing = await pb
      .collection(TASK_COMMAND_QUEUE_COLLECTION)
      .getFullList({
        requestKey: null,
        filter: `operationId = "${input.operationId.replace(/"/g, '\\"')}"`,
      });
    if (Array.isArray(existing) && existing.length > 0) return true;
    await pb.collection(TASK_COMMAND_QUEUE_COLLECTION).create(
      {
        operationId: input.operationId,
        route: input.route,
        action: input.action,
        payload: input.payload,
        actorMemberId: input.actor.memberId,
        actorName: input.actor.name,
        actorRole: input.actor.role,
        actorAuthentication: input.actor.authentication,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: new Date(Date.now() + taskQueueBackoffMs(1)).toISOString(),
        displayTarget: input.displayTarget ?? { kind: "task" },
      },
      { requestKey: null },
    );
    return true;
  });
}

/**
 * Housekeeping, run at the head of every drain: park-to-fail the rows past the
 * 24h expiry, and delete terminal rows past their retention windows. Deleting a
 * row a device has not yet read is safe — the row's local twin releases on the
 * next queue poll through the missing-row fallback, and every applied or
 * refused command has already been readable for a full sync window.
 */
export async function sweepTaskCommandQueueRows(pb: AdminPB): Promise<void> {
  const now = Date.now();
  const rows = await readQueueRows(pb, "");
  for (const row of rows) {
    const status = String(row.status ?? "");
    const ageMs = now - rowCreatedAtMs(row);
    if (status === "pending" && ageMs >= TASK_QUEUE_EXPIRY_MS) {
      await pb.collection(TASK_COMMAND_QUEUE_COLLECTION).update(
        String(row.id),
        {
          status: "failed",
          lastErrorReason: "queue_expired",
          lastErrorMessage: "The family server could not take this chore for over a day — tap the chore again.",
          nextAttemptAt: null,
        },
        { requestKey: null },
      );
      continue;
    }
    if (status === "failed" && ageMs >= TASK_QUEUE_FAILED_RETENTION_MS) {
      await pb.collection(TASK_COMMAND_QUEUE_COLLECTION).delete(String(row.id), { requestKey: null });
      continue;
    }
    if (
      (status === "resolved" || status === "cancelled") &&
      ageMs >= TASK_QUEUE_TERMINAL_RETENTION_MS
    ) {
      await pb.collection(TASK_COMMAND_QUEUE_COLLECTION).delete(String(row.id), { requestKey: null });
    }
  }
}

type ReplayOutcome =
  | { kind: "resolved"; ack: Record<string, unknown> }
  | { kind: "retry"; reason: string; message: string }
  | { kind: "failed"; reason: string; message: string }
  | { kind: "duplicate"; ack: Record<string, unknown> };

function withRepairMarker(
  data: SnapshotData,
  operationId: string,
  actorId: string,
): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  return {
    ...data,
    pendingProjectionRepairs: [
      ...current.filter((marker) => marker.operationId !== operationId),
      { operationId, taskIds: [], actorId, createdAt: new Date().toISOString() },
    ],
  };
}

function redeemProjection(operationId: string, actorId: string): LedgerProjection {
  return async ({ pb, weekData }) => {
    const projected = await persistSnapshotWeek(pb, weekData);
    if (projected.ok) return true;
    try {
      await mutateSnapshotWithMeta(
        (data) => ({ data: withRepairMarker(data, operationId, actorId), result: null }),
        pb,
      );
    } catch {
      // Best effort: the marker is a hint, the reconciler still sees the gap.
    }
    return false;
  };
}

function internalResultToOutcome(
  result: InternalTaskCommandResult,
): ReplayOutcome {
  // D4: an ok result that did NOT reconcile may have paid while the kitchen
  // display never received it. Storing it `resolved` would let every device
  // bank it as done; it stays RETRYABLE and repairable instead.
  if (result.ok && result.reconciled === false) {
    return {
      kind: "retry",
      reason: "projection_pending",
      message: "The change has not reached every device yet. Consuela is still retrying.",
    };
  }
  if (result.ok) {
    return {
      kind: "resolved",
      ack: {
        operationId: result.operationId,
        ...(result.task !== undefined ? { task: result.task } : {}),
        ...(result.weekData !== undefined ? { weekData: result.weekData } : {}),
        ...(result.revision !== undefined ? { revision: result.revision } : {}),
        ...(result.paid !== undefined ? { paid: result.paid } : {}),
        ...(result.cleared !== undefined ? { cleared: result.cleared } : {}),
        ...(Array.isArray(result.clearedTasks) ? { clearedTasks: result.clearedTasks } : {}),
        ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
        ...(result.duplicate ? { duplicate: true } : {}),
        reconciled: result.reconciled,
      },
    };
  }
  const reason = String(result.reason ?? "task_store_unavailable");
  const message = "The family server could not apply this change just yet.";
  if (DUPLICATE_REASONS.has(reason)) {
    return { kind: "duplicate", ack: { operationId: result.operationId, duplicate: true, reason } };
  }
  if (RETRYABLE_REASONS.has(reason)) {
    return { kind: "retry", reason, message };
  }
  return { kind: "failed", reason, message };
}

/**
 * The drain's CHEAP pre-check for queued `claim` / `complete` intents — a
 * fast refusal that never enters the service. It is defense-in-depth only:
 * the authoritative check runs inside `executeClaimCommand`, on the fresh
 * read and under the task-command lock, against the `supersedeIfSentBackAfter`
 * instant this drain passes into the command (the two reads can disagree —
 * an undo can commit in between — and only the locked check is atomic).
 *
 * A queued command is a deferred intent, not a promise; it may only apply
 * while the row still carries the state it was written against. `sentBackAt`
 * is the durable retraction stamp, and the queue row's `created` is when the
 * intent was captured — a retraction at or after that instant means the
 * intent is gone. Refusing with `already_undone` (an existing duplicate
 * reason) is a terminal ack: the family sees the tap was taken back, and
 * nothing is paid.
 *
 * `snapshot_write_failed` needs no supersede guard of its own: the canonical
 * write records its operation receipt BEFORE it verifies, so a re-run with the
 * same operationId is a duplicate read, not a re-apply.
 */
function claimSupersededBySendBack(
  task: Record<string, any> | null,
  queueRow: Record<string, any>,
  operationId: string,
): ReplayOutcome | null {
  const sentBackAtMs = Date.parse(String(task?.sentBackAt ?? ""));
  if (!Number.isFinite(sentBackAtMs)) return null;
  const queueCreatedMs = rowCreatedAtMs(queueRow);
  if (sentBackAtMs < queueCreatedMs) return null;
  return {
    kind: "duplicate",
    ack: { operationId, duplicate: true, reason: "already_undone" },
  };
}

/**
 * Replay ONE stored row through the same service seam its intake route used.
 * The stored actor identity is the authorization the route verified at intake
 * — no raw PIN exists anywhere in the row.
 */
async function replayQueueRow(row: Record<string, any>, pb: AdminPB): Promise<ReplayOutcome> {
  const route = String(row.route ?? "");
  const action = String(row.action ?? "");
  const payload = isRecord(row.payload) ? (row.payload as Record<string, unknown>) : {};
  const actor = {
    memberId: String(row.actorMemberId ?? ""),
    name: String(row.actorName ?? ""),
    role: String(row.actorRole ?? ""),
    authentication: (String(row.actorAuthentication ?? "session") === "pin" ? "pin" : "session") as
      | "pin"
      | "session",
  };
  const operationId = String(row.operationId ?? "");

  try {
    if (route === "/api/tasks/claim") {
      ensureTaskClaimHandlersRegistered();
      const guardedPayload = { ...payload };
      // Only the two actions that re-apply a completion carry the hazard; the
      // retraction itself (`undo`) and the crew/config legs must replay.
      if (action === "claim" || action === "complete") {
        const taskId = Number(payload.taskId);
        if (Number.isSafeInteger(taskId) && taskId > 0) {
          // Cheap pre-check (defense-in-depth): refuse before entering the
          // service when the CURRENT read already shows the retraction.
          let superseded: ReplayOutcome | null = null;
          try {
            const lookup = await findCanonicalTask(pb, taskId);
            superseded = claimSupersededBySendBack(lookup.task, row, operationId);
          } catch {
            // An unreadable store is not a retraction: let the service answer
            // with its own retryable failure instead of refusing the claim.
            superseded = null;
          }
          if (superseded) return superseded;
          // The ATOMIC re-check rides the command itself: the service compares
          // `sentBackAt` against this capture instant on its FRESH read, under
          // the task-command lock — so an undo that commits after the read
          // above can no longer be paid by this replay.
          const queueCreatedMs = rowCreatedAtMs(row);
          if (queueCreatedMs > 0) {
            guardedPayload.supersedeIfSentBackAfter = new Date(queueCreatedMs).toISOString();
          }
        }
      }
      return internalResultToOutcome(
        await executeInternalTaskCommand(
          { operationId, kind: action as never, actor, payload: guardedPayload },
          { source: "server" },
        ),
      );
    }
    if (route === "/api/tasks/manage") {
      ensureTaskManageHandlersRegistered();
      return internalResultToOutcome(
        await executeInternalTaskCommand(
          { operationId, kind: action as never, actor, payload },
          { source: "server" },
        ),
      );
    }
    if (route === "/api/tasks/approve") {
      ensureTaskApprovalHandlersRegistered();
      return internalResultToOutcome(
        await executeInternalTaskCommand(
          { operationId, kind: action as never, actor, payload },
          { source: "server" },
        ),
      );
    }
    if (route === "/api/tasks/ledger") {
      const result = await executeLedgerCommand({
        operationId,
        action: action as "penalty" | "adjust",
        memberName: String(payload.memberName ?? actor.name),
        ...(payload.targetMemberName !== undefined
          ? { targetMemberName: String(payload.targetMemberName) }
          : {}),
        ...(payload.itemId !== undefined ? { itemId: payload.itemId as string | number } : {}),
        ...(payload.amount !== undefined ? { amount: Number(payload.amount) } : {}),
        ...(payload.reason !== undefined ? { reason: String(payload.reason) } : {}),
        memberId: actor.memberId,
        // The PIN was verified at intake; the command replays on the recorded
        // actor identity. `executeLedgerCommand` never re-reads it.
        pin: "",
      });
      if (result.ok && result.reconciled === false) {
        return {
          kind: "retry",
          reason: "projection_pending",
          message: "The change has not reached every device yet. Consuela is still retrying.",
        };
      }
      if (result.ok) {
        return {
          kind: "resolved",
          ack: {
            operationId: result.operationId,
            action: result.action,
            weekData: result.weekData,
            member: result.member,
            points: result.points,
            reconciled: result.reconciled === true,
            ...(result.duplicate ? { duplicate: true } : {}),
          },
        };
      }
      const reason = String(result.reason ?? "ledger_unavailable");
      const message = "The family server could not apply this change just yet.";
      if (RETRYABLE_REASONS.has(reason)) return { kind: "retry", reason, message };
      return { kind: "failed", reason, message };
    }
    if (route === "/api/rewards/redeem") {
      const operation = isRecord(payload.operation) ? (payload.operation as unknown as LedgerOperationInput) : null;
      const weekStart = String(payload.weekStart ?? "");
      const actorId = String(payload.actorId ?? actor.memberId);
      if (!operation || !weekStart) {
        return { kind: "failed", reason: "invalid_body", message: "The stored redemption was unreadable." };
      }
      let result = await applyWeekLedgerOperation({
        weekStart,
        operation,
        project: redeemProjection(operationId, actorId),
      });
      if (!result.ok && result.code === "ledger_write_conflict") {
        result = await applyWeekLedgerOperation({
          weekStart,
          operation,
          project: redeemProjection(operationId, actorId),
        });
      }
      if (result.ok) {
        return {
          kind: "resolved",
          ack: {
            operationId: result.operationId,
            weekData: result.weekData,
            reconciled: result.reconciled === true,
            ...(result.duplicate ? { duplicate: true } : {}),
          },
        };
      }
      const code = String(result.code ?? "ledger_unavailable");
      if (code === "operation_conflict") {
        return { kind: "duplicate", ack: { operationId, duplicate: true, reason: "duplicate" } };
      }
      if (code === "insufficient_balance") {
        return { kind: "failed", reason: "insufficient", message: "Not enough points anymore." };
      }
      return { kind: "retry", reason: "ledger_unavailable", message: "Points could not be updated just now." };
    }
    if (route === "/api/tasks/config") {
      const parsed = parseStoredTaskConfigCommand({ ...payload, operationId, action });
      if ("error" in parsed) {
        return { kind: "failed", reason: parsed.error, message: "The saved change was unreadable." };
      }
      return await withAdmin(async (pb) => {
        const outcome = await applyTaskConfigCommand(pb, parsed.command);
        if ("conflict" in outcome) {
          return { kind: "duplicate", ack: { operationId, duplicate: true, reason: "operation_conflict" } };
        }
        if ("stale" in outcome) {
          // The stale outcome's authoritative catalog is discarded — only the
          // refusal is stored. Catalog adoption at drain time is a tracked
          // follow-up.
          return {
            kind: "failed",
            reason: "stale_config",
            message: "The catalog moved on — the saved change was not applied.",
          };
        }
        return { kind: "resolved", ack: { ...outcome.response } };
      });
    }
    return { kind: "failed", reason: "unsupported_task_command", message: "The saved change is not a known command." };
  } catch {
    return { kind: "retry", reason: "task_store_unavailable", message: "The family server could not be reached." };
  }
}

/**
 * Drain due pending rows: replay each through its seam, apply the attempt
 * ladder, and record the terminal marker (resolved/cancelled) with the ack
 * body so any device can release its optimistic mark.
 */
export async function drainDueTaskCommandQueue(): Promise<DrainTaskCommandQueueSummary> {
  return withAdmin(async (pb) => {
    try {
      await sweepTaskCommandQueueRows(pb);
    } catch {
      // A failed sweep must not stop the drain — the rows are still due.
    }
    let due: Record<string, any>[];
    try {
      due = await readQueueRows(pb, 'status = "pending"');
    } catch {
      return { acknowledged: 0, retryable: 0, permanent: 0 };
    }
    const now = Date.now();
    const batch = due
      .filter((row) => {
        const next = row.nextAttemptAt ? Date.parse(String(row.nextAttemptAt)) : 0;
        return !Number.isFinite(next) || next <= now;
      })
      .slice(0, TASK_QUEUE_DRAIN_BATCH);

    let acknowledged = 0;
    let retryable = 0;
    let permanent = 0;
    for (const row of batch) {
      const outcome = await replayQueueRow(row, pb);
      const collection = pb.collection(TASK_COMMAND_QUEUE_COLLECTION);
      if (outcome.kind === "resolved" || outcome.kind === "duplicate") {
        try {
          await collection.update(
            String(row.id),
            {
              status: "resolved",
              nextAttemptAt: null,
              result: outcome.ack,
              resolvedAt: queueIsoNow(),
            },
            { requestKey: null },
          );
        } catch {
          continue;
        }
        acknowledged += 1;
        continue;
      }
      if (outcome.kind === "retry") {
        const attemptCount = (Number(row.attemptCount) || 0) + 1;
        if (attemptCount >= TASK_QUEUE_MAX_ATTEMPTS) {
          try {
            await collection.update(
              String(row.id),
              {
                status: "failed",
                attemptCount,
                nextAttemptAt: null,
                lastErrorReason: outcome.reason,
                lastErrorMessage: outcome.message,
              },
              { requestKey: null },
            );
          } catch {
            continue;
          }
          permanent += 1;
          continue;
        }
        try {
          await collection.update(
            String(row.id),
            {
              attemptCount,
              nextAttemptAt: new Date(Date.now() + taskQueueBackoffMs(attemptCount)).toISOString(),
              lastErrorReason: outcome.reason,
              lastErrorMessage: outcome.message,
            },
            { requestKey: null },
          );
        } catch {
          continue;
        }
        retryable += 1;
        continue;
      }
      // Terminal refusal from the replay itself.
      try {
        await collection.update(
          String(row.id),
          {
            status: "failed",
            nextAttemptAt: null,
            lastErrorReason: outcome.reason,
            lastErrorMessage: outcome.message,
          },
          { requestKey: null },
        );
      } catch {
        continue;
      }
      permanent += 1;
    }
    return { acknowledged, retryable, permanent };
  });
}

/** The queue rows a device's banners render from: pending, recent failures,
 * and terminal markers still inside their retention window. */
export async function listTaskCommandQueueState(): Promise<TaskQueueStateRow[]> {
  return withAdmin(async (pb) => {
    const rows = await readQueueRows(pb, "");
    const now = Date.now();
    return rows
      .filter((row) => {
        const status = String(row.status ?? "");
        if (status === "pending" || status === "failed") return true;
        // Terminal markers only within the retention window.
        return now - rowCreatedAtMs(row) < TASK_QUEUE_TERMINAL_RETENTION_MS;
      })
      .map(toStateRow);
  });
}

/**
 * Cancel a pending row. The actor who queued it, or any parent, may cancel;
 * the row becomes a `cancelled` marker (retained like `resolved`) so every
 * device holding a banner entry for it releases it. Cancelling an already
 * terminal row is a no-op success — the family's intent was already served.
 */
export async function cancelTaskCommandQueueRow(
  operationId: string,
  actorMemberId: string,
  isParent: boolean,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; reason: string }> {
  return withAdmin(async (pb) => {
    const rows = await pb
      .collection(TASK_COMMAND_QUEUE_COLLECTION)
      .getFullList({
        requestKey: null,
        filter: `operationId = "${operationId.replace(/"/g, '\\"')}"`,
      });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { ok: false, status: 404, reason: "unknown_operation" };
    if (String(row.actorMemberId ?? "") !== actorMemberId && !isParent) {
      return { ok: false, status: 403, reason: "not_allowed" };
    }
    if (String(row.status ?? "") !== "pending") return { ok: true };
    await pb.collection(TASK_COMMAND_QUEUE_COLLECTION).update(
      String(row.id),
      { status: "cancelled", nextAttemptAt: null, resolvedAt: queueIsoNow() },
      { requestKey: null },
    );
    return { ok: true };
  });
}
