import {
  isRecord,
  normalizeOperationId,
  normalizeTimestamp,
} from "@/lib/task-operation-contract";
import type { LedgerOperationMeta, LedgerOperationSource, Transaction } from "@/types/tasks";

export const LEDGER_TRANSACTION_TYPES = [
  "earn",
  "redeem",
  "penalty",
  "adjust",
] as const satisfies readonly Transaction["type"][];

export const LEDGER_OPERATION_SOURCES = [
  "assigned-complete",
  "open-claim",
  "late-snatch",
  "task-approval",
  "reward-redeem",
  "planner-adjust",
  "task-undo",
  "legacy-migration",
] as const satisfies readonly LedgerOperationSource[];

const transactionTypes = new Set<Transaction["type"]>(LEDGER_TRANSACTION_TYPES);

const ledgerOperationSources = new Set<LedgerOperationSource>(LEDGER_OPERATION_SOURCES);

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function canonicalLedgerMeta(value: unknown): LedgerOperationMeta | null {
  if (!isRecord(value)) return null;
  const operationId = normalizeOperationId(value.operationId);
  const source = value.source;
  const fingerprint = value.fingerprint;
  const actorId = value.actorId;
  const action = value.action;
  const taskIds = value.taskIds;
  if (!operationId || typeof source !== "string" || !ledgerOperationSources.has(source as LedgerOperationSource)) {
    return null;
  }
  if (fingerprint !== undefined && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) {
    return null;
  }
  if (actorId !== undefined && (typeof actorId !== "string" || !actorId.trim())) return null;
  if (action !== undefined && action !== "approve" && action !== "approve-all" && action !== "send-back") return null;
  if (taskIds !== undefined) {
    if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((id) => !positiveSafeInteger(id))) return null;
    if (new Set(taskIds).size !== taskIds.length) return null;
  }
  return {
    operationId,
    source: source as LedgerOperationSource,
    ...(typeof fingerprint === "string" ? { fingerprint } : {}),
    ...(typeof actorId === "string" ? { actorId: actorId.trim() } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(taskIds !== undefined ? { taskIds: [...taskIds].sort((left, right) => left - right) } : {}),
  };
}

export function parseCanonicalTransactions(value: unknown): Transaction[] | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;

  const transactions: Transaction[] = [];
  for (const candidate of parsed) {
    if (!isRecord(candidate)) return null;
    if (!positiveSafeInteger(candidate.id)) return null;
    const timestamp = normalizeTimestamp(candidate.timestamp);
    const member = typeof candidate.member === "string" ? candidate.member.trim() : "";
    const type = candidate.type;
    const amount = candidate.amount;
    const description =
      typeof candidate.description === "string" ? candidate.description.trim() : "";
    if (
      !timestamp ||
      !member ||
      typeof type !== "string" ||
      !transactionTypes.has(type as Transaction["type"]) ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      !description
    ) {
      return null;
    }
    if (candidate.taskId !== undefined && !positiveSafeInteger(candidate.taskId)) return null;
    if (
      candidate.appliedBy !== undefined &&
      (typeof candidate.appliedBy !== "string" || !candidate.appliedBy.trim())
    ) {
      return null;
    }
    const meta = candidate.meta === undefined ? undefined : canonicalLedgerMeta(candidate.meta);
    if (candidate.meta !== undefined && !meta) return null;

    transactions.push({
      id: candidate.id,
      timestamp,
      member,
      type: type as Transaction["type"],
      amount,
      description,
      ...(candidate.taskId === undefined ? {} : { taskId: candidate.taskId }),
      ...(candidate.appliedBy === undefined
        ? {}
        : { appliedBy: (candidate.appliedBy as string).trim() }),
      ...(meta ? { meta } : {}),
    });
  }

  return transactions;
}

export function mergeCanonicalTransactions(histories: Transaction[][]): Transaction[] {
  const candidates = histories
    .flat()
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.id - right.id,
    );
  const byId = new Map<number, Transaction>();
  const history: Transaction[] = [];
  for (const transaction of candidates) {
    const existing = byId.get(transaction.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(transaction)) {
        throw new TypeError("conflicting_transaction_id");
      }
      continue;
    }
    if (
      transaction.type === "earn" &&
      transaction.taskId !== undefined &&
      hasUnreversedTaskEarn(history, transaction.taskId, transaction.member)
    ) {
      continue;
    }
    byId.set(transaction.id, transaction);
    history.push(transaction);
  }
  return history;
}

export function recomputeWeekPoints(history: Transaction[]): Record<string, number> {
  const canonicalHistory = parseCanonicalTransactions(history);
  if (!canonicalHistory) throw new TypeError("invalid_transaction_history");
  const points: Record<string, number> = {};

  for (const transaction of canonicalHistory) {
    const current = points[transaction.member] ?? 0;
    const next = current + transaction.amount;
    points[transaction.member] = next < 0 ? 0 : next;
  }

  return points;
}

export function hasUnreversedTaskEarn(
  history: Transaction[],
  taskId: number,
  member: string,
): boolean {
  const canonicalHistory = parseCanonicalTransactions(history);
  if (!canonicalHistory) throw new TypeError("invalid_transaction_history");
  const earns = canonicalHistory.filter(
    (transaction) =>
      transaction.type === "earn" &&
      Number(transaction.taskId) === Number(taskId) &&
      transaction.member === member,
  );
  const latestEarn = earns.reduce<Transaction | null>((latest, transaction) => {
    if (!latest) return transaction;
    return Date.parse(transaction.timestamp) >= Date.parse(latest.timestamp)
      ? transaction
      : latest;
  }, null);
  if (!latestEarn) return false;

  return !canonicalHistory.some(
    (transaction) =>
      transaction.type === "adjust" &&
      transaction.amount <= 0 &&
      Number(transaction.taskId) === Number(taskId) &&
      transaction.member === member &&
      Date.parse(transaction.timestamp) >= Date.parse(latestEarn.timestamp),
  );
}
