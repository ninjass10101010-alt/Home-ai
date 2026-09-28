import { hasUnreversedTaskEarn } from "@/lib/task-ledger";
import type { Transaction, WeekData } from "@/types/tasks";

export interface LegacyLedgerQuarantineReport {
  version: 1;
  generatedAt: string;
  localWeekStart: string;
  canonicalWeekStart: string;
  exactMatches: Transaction[];
  semanticMatches: Transaction[];
  quarantined: Transaction[];
}

export type QuarantineMode = "dry-run" | "export";

export interface QuarantineRequest {
  mode: QuarantineMode;
  localWeekData: WeekData;
}

export interface QuarantineResponse {
  ok: true;
  mode: QuarantineMode;
  report: LegacyLedgerQuarantineReport;
  path?: string;
}

function sameTaskId(left: Transaction, right: Transaction): boolean {
  if (left.taskId === undefined && right.taskId === undefined) return true;
  if (left.taskId === undefined || right.taskId === undefined) return false;
  return Number(left.taskId) === Number(right.taskId);
}

function sameIdentity(local: Transaction, canonical: Transaction): boolean {
  return (
    local.member === canonical.member &&
    local.type === canonical.type &&
    local.amount === canonical.amount &&
    sameTaskId(local, canonical)
  );
}

function latestEarn(
  canonical: Transaction[],
  taskId: number,
  member: string,
  spent: Set<number>,
): Transaction | null {
  let latest: Transaction | null = null;
  for (const transaction of canonical) {
    if (transaction.type !== "earn") continue;
    if (Number(transaction.taskId) !== taskId) continue;
    if (transaction.member !== member) continue;
    if (spent.has(transaction.id)) continue;
    if (
      !latest ||
      transaction.timestamp > latest.timestamp ||
      (transaction.timestamp === latest.timestamp && transaction.id > latest.id)
    ) {
      latest = transaction;
    }
  }
  return latest;
}

export function matchLegacyLedgerTransactions(
  local: WeekData,
  canonical: WeekData,
): LegacyLedgerQuarantineReport {
  const canonicalById = new Map<number, Transaction>();
  for (const transaction of canonical.history) canonicalById.set(transaction.id, transaction);

  const spent = new Set<number>();
  const exactMatches: Transaction[] = [];
  const semanticMatches: Transaction[] = [];
  const quarantined: Transaction[] = [];

  for (const transaction of local.history) {
    const candidate = canonicalById.get(transaction.id);
    if (candidate && !spent.has(candidate.id) && sameIdentity(transaction, candidate)) {
      spent.add(candidate.id);
      exactMatches.push(transaction);
      continue;
    }

    if (transaction.type === "earn" && transaction.taskId !== undefined) {
      const serverEarn = latestEarn(
        canonical.history,
        Number(transaction.taskId),
        transaction.member,
        spent,
      );
      if (
        serverEarn &&
        serverEarn.amount === transaction.amount &&
        hasUnreversedTaskEarn(canonical.history, Number(transaction.taskId), transaction.member)
      ) {
        spent.add(serverEarn.id);
        semanticMatches.push(transaction);
        continue;
      }
    }

    quarantined.push(transaction);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    localWeekStart: local.weekStart,
    canonicalWeekStart: canonical.weekStart,
    exactMatches,
    semanticMatches,
    quarantined,
  };
}

export function serializeQuarantineReport(report: LegacyLedgerQuarantineReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
