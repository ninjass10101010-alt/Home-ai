import { withAdmin } from "@/lib/pb-auth";
import { normalizeWeekData, type AdminPB } from "@/lib/snapshot-tasks";
import {
  hasUnreversedTaskEarn,
  LEDGER_OPERATION_SOURCES,
  LEDGER_TRANSACTION_TYPES,
  parseCanonicalTransactions,
  recomputeWeekPoints,
} from "@/lib/task-ledger";
import {
  isRecord,
  normalizeOperationId,
  normalizeTimestamp,
} from "@/lib/task-operation-contract";
import { withWeekLedgerLock } from "@/lib/week-ledger-lock";
import type {
  LedgerOperationInput,
  LedgerOperationSource,
  Transaction,
  WeekData,
} from "@/types/tasks";

export type LedgerOperationErrorCode =
  | "invalid_ledger_operation"
  | "insufficient_balance"
  | "ledger_write_conflict";

export type LedgerOperationResult =
  | {
      ok: true;
      applied: boolean;
      duplicate: boolean;
      semanticDuplicate: boolean;
      reconciled: boolean;
      weekData: WeekData;
      operationId: string;
      projectionError?: string;
    }
  | {
      ok: false;
      code: LedgerOperationErrorCode;
      applied: false;
      duplicate: false;
      semanticDuplicate: false;
      reconciled: false;
      weekData: WeekData;
      operationId: string;
    };

export interface LedgerProjectionContext {
  pb: AdminPB;
  weekData: WeekData;
  operationId: string;
  applied: boolean;
  duplicate: boolean;
  semanticDuplicate: boolean;
}

export type LedgerProjection = (
  context: LedgerProjectionContext,
) => Promise<boolean | void>;

export interface ApplyWeekLedgerOperationArgs {
  weekStart: string;
  operation: LedgerOperationInput;
  project?: LedgerProjection;
  now?: Date;
}

interface NormalizedLedgerEntry {
  type: Transaction["type"];
  member: string;
  amount: number;
  description: string;
  taskId?: number;
  appliedBy?: string;
}

interface NormalizedLedgerOperation {
  operationId: string;
  source: LedgerOperationSource;
  entries: NormalizedLedgerEntry[];
}

const transactionTypes = new Set<Transaction["type"]>(LEDGER_TRANSACTION_TYPES);

const operationSources = new Set<LedgerOperationSource>(LEDGER_OPERATION_SOURCES);

const projectionFailure = "projection_failed";
let transactionSequence = 0;

class LedgerOperationAbort extends Error {
  readonly code: LedgerOperationErrorCode;
  readonly weekData: WeekData;

  constructor(code: LedgerOperationErrorCode, weekData: WeekData) {
    super(code);
    this.name = "LedgerOperationAbort";
    this.code = code;
    this.weekData = weekData;
  }
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

function resultOperationId(operation: unknown): string {
  if (!isRecord(operation) || typeof operation.operationId !== "string") return "";
  return normalizeOperationId(operation.operationId) ?? "";
}

function normalizeWeekStart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const weekStart = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === weekStart
    ? weekStart
    : null;
}

function validNow(value: unknown): Date | null {
  const candidate = value === undefined ? new Date() : value;
  if (!(candidate instanceof Date)) return null;
  const time = candidate.getTime();
  if (!Number.isSafeInteger(time) || time <= 0) return null;
  return new Date(time);
}

function normalizeOperation(value: unknown): NormalizedLedgerOperation | null {
  if (!isRecord(value)) return null;
  const operationId = normalizeOperationId(value.operationId);
  const source = value.source;
  if (
    !operationId ||
    typeof source !== "string" ||
    !operationSources.has(source as LedgerOperationSource) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  ) {
    return null;
  }

  const entries: NormalizedLedgerEntry[] = [];
  for (const candidate of value.entries) {
    if (!isRecord(candidate)) return null;
    const type = candidate.type;
    const member = typeof candidate.member === "string" ? candidate.member.trim() : "";
    const description =
      typeof candidate.description === "string" ? candidate.description.trim() : "";
    const amount = candidate.amount;
    if (
      typeof type !== "string" ||
      !transactionTypes.has(type as Transaction["type"]) ||
      !member ||
      !description ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount)
    ) {
      return null;
    }

    let taskId: number | undefined;
    if (candidate.taskId !== undefined) {
      if (
        typeof candidate.taskId !== "number" ||
        !Number.isSafeInteger(candidate.taskId) ||
        candidate.taskId <= 0
      ) {
        return null;
      }
      taskId = candidate.taskId;
    }

    let appliedBy: string | undefined;
    if (candidate.appliedBy !== undefined) {
      if (typeof candidate.appliedBy !== "string" || !candidate.appliedBy.trim()) return null;
      appliedBy = candidate.appliedBy.trim();
    }

    entries.push({
      type: type as Transaction["type"],
      member,
      amount,
      description,
      ...(taskId === undefined ? {} : { taskId }),
      ...(appliedBy === undefined ? {} : { appliedBy }),
    });
  }

  return { operationId, source: source as LedgerOperationSource, entries };
}

interface CanonicalWeek {
  weekData: WeekData;
  pointsNeedRepair: boolean;
}

function samePoints(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function canonicalWeek(
  value: unknown,
  weekStart: string,
): CanonicalWeek | null {
  const parsed = normalizeWeekData(value);
  if (!parsed || parsed.weekStart !== weekStart) return null;
  const history = parseCanonicalTransactions(parsed.history);
  if (!history) return null;
  if (history.some((transaction) => !Number.isSafeInteger(transaction.amount))) return null;
  const ids = new Set<number>();
  for (const transaction of history) {
    if (ids.has(transaction.id)) return null;
    ids.add(transaction.id);
  }
  const points = recomputeWeekPoints(history);
  return {
    weekData: {
      ...parsed,
      history,
      points,
    },
    pointsNeedRepair: !samePoints(parsed.points, points),
  };
}

function hasNegativeOutcome(history: Transaction[]): boolean {
  const balances: Record<string, number> = {};
  for (const transaction of history) {
    const next = (balances[transaction.member] ?? 0) + transaction.amount;
    if (next < 0) return true;
    if (!Number.isSafeInteger(next)) return true;
    balances[transaction.member] = next;
  }
  return false;
}

function sameOperationEntry(
  transaction: Transaction,
  entry: NormalizedLedgerEntry,
  operationId: string,
  source: LedgerOperationSource,
): boolean {
  return (
    transaction.meta?.operationId === operationId &&
    transaction.meta?.source === source &&
    transaction.member === entry.member &&
    transaction.type === entry.type &&
    transaction.amount === entry.amount &&
    transaction.taskId === entry.taskId
  );
}

function sameTransaction(left: Transaction, right: Transaction): boolean {
  return (
    left.id === right.id &&
    left.timestamp === right.timestamp &&
    left.member === right.member &&
    left.type === right.type &&
    left.amount === right.amount &&
    left.description === right.description &&
    left.taskId === right.taskId &&
    left.appliedBy === right.appliedBy &&
    left.meta?.operationId === right.meta?.operationId &&
    left.meta?.source === right.meta?.source
  );
}

function containsTransactions(
  verified: Transaction[],
  expected: Transaction[],
): boolean {
  const remaining = [...verified];
  for (const transaction of expected) {
    const index = remaining.findIndex((candidate) => sameTransaction(candidate, transaction));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function findMissingEntries(
  history: Transaction[],
  operation: NormalizedLedgerOperation,
): { missing: NormalizedLedgerEntry[]; duplicate: boolean } | null {
  const existing = history.filter(
    (transaction) => transaction.meta?.operationId === operation.operationId,
  );
  const unmatched = [...existing];
  const missing: NormalizedLedgerEntry[] = [];

  for (const entry of operation.entries) {
    const index = unmatched.findIndex((transaction) =>
      sameOperationEntry(transaction, entry, operation.operationId, operation.source),
    );
    if (index === -1) {
      missing.push(entry);
      continue;
    }
    unmatched.splice(index, 1);
  }

  if (unmatched.length > 0) return null;
  return { missing, duplicate: existing.length > 0 };
}

function nextTransactionId(history: Transaction[], nowMs: number): number | null {
  let candidate = nowMs + transactionSequence;
  transactionSequence += 1;
  const used = new Set(history.map((transaction) => transaction.id));
  while (
    candidate <= 0 ||
    !Number.isSafeInteger(candidate) ||
    used.has(candidate)
  ) {
    if (!Number.isSafeInteger(candidate) || candidate >= Number.MAX_SAFE_INTEGER) return null;
    candidate += 1;
  }
  return candidate;
}

function createTransaction(
  entry: NormalizedLedgerEntry,
  operation: NormalizedLedgerOperation,
  history: Transaction[],
  timestamp: string,
  nowMs: number,
): Transaction | null {
  const id = nextTransactionId(history, nowMs);
  if (id === null) return null;
  return {
    id,
    timestamp,
    member: entry.member,
    type: entry.type,
    amount: entry.amount,
    description: entry.description,
    ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
    ...(entry.appliedBy === undefined ? {} : { appliedBy: entry.appliedBy }),
    meta: {
      operationId: operation.operationId,
      source: operation.source,
    },
  };
}

async function readWeekRow(
  pb: AdminPB,
  weekStart: string,
): Promise<{
  row: Record<string, any> | null;
  weekData: WeekData;
  pointsNeedRepair: boolean;
}> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const matchingRows = (Array.isArray(rows) ? rows : []).filter(
    (candidate: any) => normalizeWeekStart(candidate?.weekStart) === weekStart,
  );
  if (matchingRows.length > 1) {
    throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
  }
  const row = matchingRows[0] as Record<string, any> | undefined;
  if (!row) return { row: null, weekData: emptyWeekData(weekStart), pointsNeedRepair: false };
  const canonical = canonicalWeek(row, weekStart);
  if (!canonical) throw new LedgerOperationAbort("invalid_ledger_operation", emptyWeekData(weekStart));
  return { row, weekData: canonical.weekData, pointsNeedRepair: canonical.pointsNeedRepair };
}

async function readWrittenWeek(
  pb: AdminPB,
  weekStart: string,
  rowId: unknown,
): Promise<CanonicalWeek | null> {
  const collection = pb.collection("week_data");
  let directRow: unknown = null;
  if (rowId !== null && rowId !== undefined && typeof collection.getOne === "function") {
    directRow = await collection.getOne(String(rowId), { requestKey: null });
  }
  const rows = await collection.getFullList({ requestKey: null });
  const matchingRows = (Array.isArray(rows) ? rows : []).filter(
    (candidate: any) => normalizeWeekStart(candidate?.weekStart) === weekStart,
  );
  if (matchingRows.length > 1) {
    throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
  }
  const listedRow = matchingRows[0] as Record<string, any> | undefined;
  if (listedRow && rowId !== null && rowId !== undefined && String(listedRow.id) !== String(rowId)) {
    throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
  }
  const row = listedRow ?? directRow;
  if (!row) return null;
  const canonical = canonicalWeek(row, weekStart);
  if (!canonical) throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
  return canonical;
}

function failure(
  code: LedgerOperationErrorCode,
  weekData: WeekData,
  operationId: string,
): LedgerOperationResult {
  return {
    ok: false,
    code,
    applied: false,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: false,
    weekData,
    operationId,
  };
}

export async function applyWeekLedgerOperation(
  args: ApplyWeekLedgerOperationArgs,
): Promise<LedgerOperationResult> {
  const input: Record<string, unknown> = isRecord(args) ? args : {};
  const weekStart = normalizeWeekStart(input.weekStart) ?? "";
  const operation = input.operation;
  const operationId = resultOperationId(operation);
  const fallback = emptyWeekData(weekStart);
  const project = input.project;
  const now = validNow(input.now);
  const timestamp = now ? normalizeTimestamp(now.toISOString()) : null;

  if (
    !weekStart ||
    !now ||
    !timestamp ||
    (project !== undefined && typeof project !== "function")
  ) {
    return failure("invalid_ledger_operation", fallback, operationId);
  }

  try {
    return await withWeekLedgerLock(weekStart, async () =>
      withAdmin(async (pb): Promise<LedgerOperationResult> => {
        const read = await readWeekRow(pb, weekStart);
        const current = read.weekData;
        const normalizedOperation = normalizeOperation(operation);
        if (!normalizedOperation) {
          return failure("invalid_ledger_operation", current, operationId);
        }
        if (hasNegativeOutcome(current.history)) {
          return failure("insufficient_balance", current, normalizedOperation.operationId);
        }

        const replay = findMissingEntries(current.history, normalizedOperation);
        if (!replay) {
          return failure("invalid_ledger_operation", current, normalizedOperation.operationId);
        }

        const nowMs = now.getTime();
        const workingHistory = [...current.history];
        const newTransactions: Transaction[] = [];
        let semanticDuplicate = false;

        for (const entry of replay.missing) {
          if (
            entry.type === "earn" &&
            entry.taskId !== undefined &&
            hasUnreversedTaskEarn(workingHistory, entry.taskId, entry.member)
          ) {
            semanticDuplicate = true;
            continue;
          }
          const transaction = createTransaction(
            entry,
            normalizedOperation,
            workingHistory,
            timestamp,
            nowMs,
          );
          if (!transaction) {
            return failure("ledger_write_conflict", current, normalizedOperation.operationId);
          }
          newTransactions.push(transaction);
          workingHistory.push(transaction);
        }

        const mergedHistory = [...current.history, ...newTransactions];
        if (hasNegativeOutcome(mergedHistory)) {
          return failure("insufficient_balance", current, normalizedOperation.operationId);
        }
        const points = recomputeWeekPoints(mergedHistory);
        let weekData: WeekData = {
          ...current,
          points,
          history: mergedHistory,
        };

        if (newTransactions.length > 0 || read.pointsNeedRepair) {
          const collection = pb.collection("week_data");
          const payload = {
            weekStart,
            points,
            streak: current.streak,
            lastActive: current.lastActive,
            history: mergedHistory,
          };
          let rowId: unknown = read.row?.id ?? null;
          if (read.row) {
            await collection.update(read.row.id, payload, { requestKey: null });
          } else {
            const created = await collection.create(payload, { requestKey: null });
            rowId = (created as any)?.id ?? null;
          }

          const verifiedRead = await readWrittenWeek(pb, weekStart, rowId);
          if (!verifiedRead) {
            throw new LedgerOperationAbort("ledger_write_conflict", current);
          }
          const verified = verifiedRead.weekData;
          if (
            !containsTransactions(verified.history, mergedHistory) ||
            !samePoints(verified.points, points) ||
            verifiedRead.pointsNeedRepair ||
            hasNegativeOutcome(verified.history)
          ) {
            throw new LedgerOperationAbort("ledger_write_conflict", current);
          }
          weekData = verified;
        }

        let reconciled = true;
        let projectionError: string | undefined;
        if (project) {
          try {
            const projected = await project({
              pb,
              weekData,
              operationId: normalizedOperation.operationId,
              applied: newTransactions.length > 0,
              duplicate: replay.duplicate,
              semanticDuplicate,
            });
            if (projected === false) {
              reconciled = false;
              projectionError = projectionFailure;
            }
          } catch {
            reconciled = false;
            projectionError = projectionFailure;
          }
        }

        return {
          ok: true,
          applied: newTransactions.length > 0,
          duplicate: replay.duplicate,
          semanticDuplicate,
          reconciled,
          weekData,
          operationId: normalizedOperation.operationId,
          ...(projectionError === undefined ? {} : { projectionError }),
        };
      }),
    );
  } catch (error) {
    if (error instanceof LedgerOperationAbort) {
      return failure(error.code, error.weekData, operationId);
    }
    return failure("ledger_write_conflict", fallback, operationId);
  }
}
