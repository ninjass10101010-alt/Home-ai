import {
  isRecord,
  normalizeOperationId,
  normalizeTimestamp,
} from "@/lib/task-operation-contract";
import type {
  LedgerOperationAction,
  LedgerOperationMeta,
  LedgerOperationSource,
  Transaction,
} from "@/types/tasks";

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
  "task-penalty",
  "manual-adjust",
  "legacy-migration",
] as const satisfies readonly LedgerOperationSource[];

const transactionTypes = new Set<Transaction["type"]>(LEDGER_TRANSACTION_TYPES);

const ledgerOperationActions = new Set<LedgerOperationAction>([
  "approve",
  "approve-all",
  "send-back",
  "penalty",
  "adjust",
]);

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
  if (action !== undefined && !ledgerOperationActions.has(action as LedgerOperationAction)) return null;
  if (taskIds !== undefined) {
    if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((id) => !positiveSafeInteger(id))) return null;
    if (new Set(taskIds).size !== taskIds.length) return null;
  }
  return {
    operationId,
    source: source as LedgerOperationSource,
    ...(typeof fingerprint === "string" ? { fingerprint } : {}),
    ...(typeof actorId === "string" ? { actorId: actorId.trim() } : {}),
    ...(action !== undefined ? { action: action as LedgerOperationAction } : {}),
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

/**
 * The single owner of the balance invariant.
 *
 * This used to be implemented twice with OPPOSITE negative-value policies:
 * `recomputeWeekPoints` clamped every running step to >= 0 (erasing the deficit
 * and making the result order-dependent — `[-5, +10]` displayed 10 while
 * `[+10, -5]` displayed 5, for the same net balance of 5), while the gate in
 * `ledger-operations` refused to clamp and was evaluated over the whole week.
 *
 * The true balance is plain arithmetic: sum the member's transactions. Callers
 * decide what to do about a negative (the display clamps for kids; the gate
 * scopes to the member being acted on).
 */
export function computeMemberBalances(history: Transaction[]): Record<string, number> {
  const canonicalHistory = parseCanonicalTransactions(history);
  if (!canonicalHistory) throw new TypeError("invalid_transaction_history");

  const balances: Record<string, number> = {};
  for (const transaction of canonicalHistory) {
    balances[transaction.member] = (balances[transaction.member] ?? 0) + transaction.amount;
  }
  return balances;
}

/**
 * True only when THIS member's balance is below zero.
 *
 * Scoped to the acting member on purpose. A member's deficit must never block a
 * different member's earn: the week-scoped version of this check meant one
 * legacy negative froze the entire family's ledger for the week, while the
 * screen showed the short member a confident "0 points" because the display
 * clamped the same deficit away.
 */
export function memberWouldGoNegative(history: Transaction[], member: string): boolean {
  const balances = computeMemberBalances(history);
  const balance = balances[member];
  return balance !== undefined && balance < 0;
}

/**
 * The kids-facing balance, and the SECOND of the two things that used to
 * disagree.
 *
 * The floor of zero is applied AS EACH TRANSACTION IS REPLAYED, not once at the
 * end. That is a deliberate product semantic, pinned by `task-ledger-contract`
 * ("replays every ledger type without allowing a negative balance"): a child
 * can never owe points, so a penalty or adjustment larger than the balance
 * simply floors at 0 and later credits build on 0.
 *
 * It is worth being precise about the relationship to `computeMemberBalances`,
 * which sums instead. The two AGREE on every history the write gate has ever
 * permitted — `anyAffectedMemberGoNegative` in `ledger-operations` rejects any
 * operation whose summed balance would go below zero, so a stored history never
 * dips negative in the first place. They diverge only on a legacy or
 * hand-edited row, where the gate no longer holds; there this function keeps
 * the friendly floor of zero rather than showing a child a negative number.
 */
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
