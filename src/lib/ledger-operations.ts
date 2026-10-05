import { createHash } from "node:crypto";
import { withAdmin } from "@/lib/pb-auth";
import { normalizeWeekData, type AdminPB } from "@/lib/snapshot-tasks";
import {
  hasUnreversedTaskEarn,
  LEDGER_OPERATION_SOURCES,
  LEDGER_TRANSACTION_TYPES,
  computeMemberBalances,
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
  LedgerOperationAction,
  LedgerOperationInput,
  LedgerOperationSource,
  Transaction,
  WeekData,
} from "@/types/tasks";

export type LedgerOperationErrorCode =
  | "invalid_ledger_operation"
  | "insufficient_balance"
  | "operation_conflict"
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
  fingerprint: string;
  actorId?: string;
  action?: LedgerOperationAction;
  taskIds?: number[];
  entries: NormalizedLedgerEntry[];
}

const transactionTypes = new Set<Transaction["type"]>(LEDGER_TRANSACTION_TYPES);

const operationSources = new Set<LedgerOperationSource>(LEDGER_OPERATION_SOURCES);

const operationActions = new Set<LedgerOperationAction>([
  "approve",
  "approve-all",
  "send-back",
  "penalty",
  "adjust",
]);

function operationFingerprint(
  source: LedgerOperationSource,
  entries: NormalizedLedgerEntry[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      source,
      entries: entries.map((entry) => ({
        type: entry.type,
        member: entry.member,
        amount: entry.amount,
        description: entry.description,
        ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
        ...(entry.appliedBy === undefined ? {} : { appliedBy: entry.appliedBy }),
      })),
    }))
    .digest("hex");
}

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

/**
 * The ONE week-key rule. Exported so a reader that resolves a week row outside
 * this seam (`task-claim`'s `readWeek`) matches rows exactly the way the write
 * path does — a `weekStart` with stray whitespace must not be invisible to one
 * and visible to the other.
 */
export function normalizeWeekStart(value: unknown): string | null {
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

  const suppliedFingerprint = value.fingerprint;
  if (
    suppliedFingerprint !== undefined &&
    (typeof suppliedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(suppliedFingerprint))
  ) return null;
  const actorId = value.actorId;
  if (actorId !== undefined && (typeof actorId !== "string" || !actorId.trim())) return null;
  const action = value.action;
  if (action !== undefined && !operationActions.has(action as LedgerOperationAction)) return null;
  const taskIds = value.taskIds;
  if (taskIds !== undefined) {
    if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((id) =>
      typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0,
    )) return null;
    if (new Set(taskIds).size !== taskIds.length) return null;
  }
  const fingerprint = typeof suppliedFingerprint === "string"
    ? suppliedFingerprint
    : operationFingerprint(source as LedgerOperationSource, entries);
  return {
    operationId,
    source: source as LedgerOperationSource,
    fingerprint,
    ...(typeof actorId === "string" ? { actorId: actorId.trim() } : {}),
    ...(action !== undefined ? { action: action as LedgerOperationAction } : {}),
    ...(taskIds !== undefined ? { taskIds: [...taskIds].sort((left, right) => left - right) } : {}),
    entries,
  };
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

/**
 * True when ANY of the members an operation touches would end up below zero.
 *
 * Replaces a week-scoped `hasNegativeOutcome(history)` that (a) implicated every
 * member because it walked the whole week's history, and (b) reported
 * `insufficient_balance` for a merely FRACTIONAL running balance, since it
 * conflated precision with insolvency. Amounts are integer-guarded on every
 * write path (`signedAmount` requires `Number.isSafeInteger`) and the canonical
 * parser rejects a non-finite amount, so a fractional balance is not a reason
 * to refuse anything.
 */
function anyAffectedMemberGoNegative(
  history: Transaction[],
  members: ReadonlySet<string>,
): boolean {
  if (members.size === 0) return false;
  const balances = computeMemberBalances(history);
  for (const member of members) {
    const balance = balances[member];
    if (balance !== undefined && balance < 0) return true;
  }
  return false;
}

/** The members whose balance an operation can change. */
function affectedMembers(entries: readonly NormalizedLedgerEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.member));
}

function sameOperationEntry(
  transaction: Transaction,
  entry: NormalizedLedgerEntry,
  operationId: string,
  source: LedgerOperationSource,
  fingerprint: string,
): boolean {
  return (
    transaction.meta?.operationId === operationId &&
    transaction.meta?.source === source &&
    (transaction.meta?.fingerprint === undefined ||
      transaction.meta?.fingerprint === fingerprint) &&
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
    left.meta?.source === right.meta?.source &&
    left.meta?.fingerprint === right.meta?.fingerprint &&
    left.meta?.actorId === right.meta?.actorId &&
    left.meta?.action === right.meta?.action &&
    JSON.stringify(left.meta?.taskIds ?? []) === JSON.stringify(right.meta?.taskIds ?? [])
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
): { missing: NormalizedLedgerEntry[]; duplicate: boolean; conflict: boolean } | null {
  const existing = history.filter(
    (transaction) => transaction.meta?.operationId === operation.operationId,
  );
  const fingerprinted = existing.filter((transaction) => transaction.meta?.fingerprint);
  if (fingerprinted.some((transaction) => transaction.meta?.fingerprint !== operation.fingerprint)) {
    return { missing: [], duplicate: false, conflict: true };
  }
  const unmatched = [...existing];
  const missing: NormalizedLedgerEntry[] = [];

  for (const entry of operation.entries) {
    const index = unmatched.findIndex((transaction) =>
      sameOperationEntry(
        transaction,
        entry,
        operation.operationId,
        operation.source,
        operation.fingerprint,
      ),
    );
    if (index === -1) {
      missing.push(entry);
      continue;
    }
    unmatched.splice(index, 1);
  }

  if (unmatched.length > 0) return { missing: [], duplicate: existing.length > 0, conflict: true };
  return { missing, duplicate: existing.length > 0, conflict: false };
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
      fingerprint: operation.fingerprint,
      ...(operation.actorId ? { actorId: operation.actorId } : {}),
      ...(operation.action ? { action: operation.action } : {}),
      ...(operation.taskIds ? { taskIds: operation.taskIds } : {}),
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
  rows: Record<string, any>[];
}> {
  const rows = await pb.collection("week_data").getFullList({ requestKey: null });
  const list = Array.isArray(rows) ? rows : [];
  const matchingRows = list.filter(
    (candidate: any) => normalizeWeekStart(candidate?.weekStart) === weekStart,
  );
  if (matchingRows.length > 1) {
    throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
  }
  const row = matchingRows[0] as Record<string, any> | undefined;
  if (!row) return { row: null, weekData: emptyWeekData(weekStart), pointsNeedRepair: false, rows: list };
  const canonical = canonicalWeek(row, weekStart);
  if (!canonical) throw new LedgerOperationAbort("invalid_ledger_operation", emptyWeekData(weekStart));
  return { row, weekData: canonical.weekData, pointsNeedRepair: canonical.pointsNeedRepair, rows: list };
}

/**
 * `week_archive` as a handle, or `null` when this PB cannot name the collection.
 *
 * Only a non-PocketBase client throws synchronously from `collection(name)` (or
 * hands back an object with no `getFullList`); the real admin client always
 * returns a RecordService and surfaces a missing/unreachable collection as a
 * REJECTED read, which is a real outage and is handled as one.
 */
function archiveCollection(pb: AdminPB): { getFullList: (options?: unknown) => Promise<unknown> } | null {
  let handle: unknown;
  try {
    handle = pb.collection("week_archive");
  } catch {
    return null;
  }
  if (!handle || typeof (handle as { getFullList?: unknown }).getFullList !== "function") return null;
  return handle as { getFullList: (options?: unknown) => Promise<unknown> };
}

/**
 * Every transaction stored in a week OTHER than the one this operation writes.
 *
 * Replay detection used to look at the ONE `week_data` row it was about to
 * write. Past weeks are never deleted and the rollover upserts them into
 * `week_archive` as well, so an operation already applied in an older week was
 * invisible to the check and a re-sent browser outbox entry paid a SECOND time.
 *
 * `week_archive` is only READ once `week_data` itself holds a second week,
 * because the rollover upserts rather than moves: a row that exists in the
 * archive also exists in `week_data`, so a single-row `week_data` means this
 * database has never had another week and has nothing archived to find. That
 * keeps the common write path free of an extra round-trip and keeps a
 * single-collection PocketBase client (a test double, or a trimmed deployment)
 * from being asked for a collection it cannot name.
 *
 * A REJECTED archive read FAILS CLOSED. "I could not look" and "there is
 * nothing there" must not both collapse into "apply it again".
 */
async function readOtherWeekTransactions(
  pb: AdminPB,
  weekStart: string,
  dataRows: readonly Record<string, any>[],
): Promise<Transaction[]> {
  const byId = new Map<number, Transaction>();
  const add = (transaction: Transaction): void => {
    if (!byId.has(transaction.id)) byId.set(transaction.id, transaction);
  };
  const collect = (row: unknown): void => {
    const week = normalizeWeekData(row);
    // A week whose stored history no longer parses is not replay evidence in
    // either direction: every balance computation runs the same canonical
    // parser, so such a row counts for nobody. Skipping it keeps one corrupt
    // old week from freezing the current one.
    if (!week) return;
    for (const transaction of week.history) add(transaction);
  };
  let otherWeeks = 0;
  for (const row of dataRows) {
    if (normalizeWeekStart((row as { weekStart?: unknown })?.weekStart) === weekStart) continue;
    otherWeeks += 1;
    collect(row);
  }
  if (otherWeeks > 0) {
    const archive = archiveCollection(pb);
    if (archive) {
      let rows: unknown;
      try {
        rows = await archive.getFullList({ requestKey: null });
      } catch {
        throw new LedgerOperationAbort("ledger_write_conflict", emptyWeekData(weekStart));
      }
      for (const row of Array.isArray(rows) ? rows : []) collect(row);
    }
  }
  return [...byId.values()];
}

interface OutsideWeekReplay {
  /** This operationId is already applied in another week. */
  applied: boolean;
  /** Another operation already paid one of this operation's (task, member) pairs. */
  semanticDuplicate: boolean;
  /** One operationId, two meanings — refused exactly like the same-week case. */
  conflict: boolean;
}

/**
 * @param otherWeeks transactions from every week OTHER than the one being
 *   written — the only rows that can prove this operation was already applied
 *   somewhere else.
 * @param combined   the same rows plus the target week's own history, so a
 *   reversal written TODAY still cancels an earn from last week.
 */
function outsideWeekReplay(
  otherWeeks: readonly Transaction[],
  combined: readonly Transaction[],
  operation: NormalizedLedgerOperation,
): OutsideWeekReplay {
  const applied = otherWeeks.filter(
    (transaction) => transaction.meta?.operationId === operation.operationId,
  );
  if (applied.length > 0) {
    const fingerprinted = applied.filter((transaction) => transaction.meta?.fingerprint);
    if (fingerprinted.some((transaction) => transaction.meta?.fingerprint !== operation.fingerprint)) {
      return { applied: false, semanticDuplicate: false, conflict: true };
    }
    return { applied: true, semanticDuplicate: false, conflict: false };
  }
  // An earn the CURRENT week already holds is not this check's business: the
  // same-week replay path detects it and still repairs a stale points map, which
  // is the behaviour it is there for. This asks a narrower question — is a
  // standing payment for this (task, member) already sitting in ANOTHER week?
  const paidElsewhere = new Set(
    otherWeeks
      .filter((transaction) => transaction.type === "earn" && transaction.taskId !== undefined)
      .map((transaction) => `${transaction.taskId}:${transaction.member}`),
  );
  const semanticDuplicate = operation.entries.some(
    (entry) =>
      entry.type === "earn" &&
      entry.taskId !== undefined &&
      paidElsewhere.has(`${entry.taskId}:${entry.member}`) &&
      hasUnreversedTaskEarn([...combined], entry.taskId, entry.member),
  );
  return { applied: false, semanticDuplicate, conflict: false };
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
  const weekStart = typeof input.weekStart === "string" ? input.weekStart.trim() : "";
  return withWeekLedgerLock(weekStart, () => applyWeekLedgerOperationLocked(args));
}

export async function applyWeekLedgerOperationLocked(
  args: ApplyWeekLedgerOperationArgs,
): Promise<LedgerOperationResult> {
  const input: Record<string, unknown> = isRecord(args) ? args : {};
  const weekStart = normalizeWeekStart(input.weekStart) ?? "";
  const operation = input.operation;
  const operationId = resultOperationId(operation);
  const fallback = emptyWeekData(weekStart);
  const projectInput = input.project;
  const project = typeof projectInput === "function" ? (projectInput as LedgerProjection) : null;
  const now = validNow(input.now);
  const timestamp = now ? normalizeTimestamp(now.toISOString()) : null;

  /**
   * The one place a projection runs, so the duplicate paths and the write path
   * report `reconciled`/`projectionError` identically. A duplicate still
   * projects: that is how a snapshot receipt lost while the ledger leg landed
   * gets repaired.
   */
  const runProjection = async (
    pb: AdminPB,
    outcome: {
      weekData: WeekData;
      operationId: string;
      applied: boolean;
      duplicate: boolean;
      semanticDuplicate: boolean;
    },
  ): Promise<LedgerOperationResult> => {
    let reconciled = true;
    let projectionError: string | undefined;
    if (project) {
      try {
        const projected = await project({
          pb,
          weekData: outcome.weekData,
          operationId: outcome.operationId,
          applied: outcome.applied,
          duplicate: outcome.duplicate,
          semanticDuplicate: outcome.semanticDuplicate,
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
      applied: outcome.applied,
      duplicate: outcome.duplicate,
      semanticDuplicate: outcome.semanticDuplicate,
      reconciled,
      weekData: outcome.weekData,
      operationId: outcome.operationId,
      ...(projectionError === undefined ? {} : { projectionError }),
    };
  };

  if (
    !weekStart ||
    !now ||
    !timestamp ||
    (projectInput !== undefined && project === null)
  ) {
    return failure("invalid_ledger_operation", fallback, operationId);
  }

  try {
    return await withAdmin(async (pb): Promise<LedgerOperationResult> => {
        const read = await readWeekRow(pb, weekStart);
        const current = read.weekData;
        const normalizedOperation = normalizeOperation(operation);
        if (!normalizedOperation) {
          return failure("invalid_ledger_operation", current, operationId);
        }
        const replay = findMissingEntries(current.history, normalizedOperation);
        if (!replay) {
          return failure("invalid_ledger_operation", current, normalizedOperation.operationId);
        }
        if (replay.conflict) {
          return failure("operation_conflict", current, normalizedOperation.operationId);
        }

        // Replay scope is EVERY week, not this one row. An operation already
        // applied in an older week — which the browser outbox re-POSTs for up to
        // 7 days, and which the rollover keeps in `week_data` AND
        // `week_archive` — is reported as a duplicate instead of applied a
        // second time. Nothing below the write is weakened: this returns before
        // any write happens.
        const otherWeeks = await readOtherWeekTransactions(pb, weekStart, read.rows);
        const outside = outsideWeekReplay(
          otherWeeks,
          [...otherWeeks, ...current.history],
          normalizedOperation,
        );
        if (outside.conflict) {
          return failure("operation_conflict", current, normalizedOperation.operationId);
        }
        if (outside.applied || outside.semanticDuplicate) {
          return runProjection(pb, {
            weekData: current,
            operationId: normalizedOperation.operationId,
            applied: false,
            duplicate: true,
            semanticDuplicate: outside.semanticDuplicate,
          });
        }
        // NOTE: there is deliberately no pre-check on the CURRENT history here.
        // The old week-scoped `hasNegativeOutcome(current.history)` refused every
        // operation — for every member — whenever any member's stored balance was
        // already negative, which froze the whole family's ledger for the week
        // while the screen showed the short member a confident "0 points". It
        // also blocked the very operation that would REPAIR a deficit. The only
        // meaningful rule is the post-merge one below: after this operation, no
        // member it actually touches may be below zero.

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
        if (replay.missing.length > 0 && anyAffectedMemberGoNegative(mergedHistory, affectedMembers(replay.missing))) {
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
            (newTransactions.length > 0 &&
              anyAffectedMemberGoNegative(verified.history, affectedMembers(replay.missing)))
          ) {
            throw new LedgerOperationAbort("ledger_write_conflict", current);
          }
          weekData = verified;
        }

        return runProjection(pb, {
          weekData,
          operationId: normalizedOperation.operationId,
          applied: newTransactions.length > 0,
          duplicate: replay.duplicate,
          semanticDuplicate,
        });
    });
  } catch (error) {
    if (error instanceof LedgerOperationAbort) {
      return failure(error.code, error.weekData, operationId);
    }
    return failure("ledger_write_conflict", fallback, operationId);
  }
}
