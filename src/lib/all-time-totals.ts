import { parseCanonicalTransactions } from "@/lib/task-ledger";
import type { Transaction, WeekData } from "@/types/tasks";

export type ArchiveWeekRow = {
  weekStart: string;
  archivedAt?: string;
  history?: unknown;
  points?: unknown;
};

export type AllTimeMemberTotal = {
  points: number | null;
  completions: number | null;
};

export type AllTimeTotalsPayload = {
  weekStart: string;
  totals: Record<string, AllTimeMemberTotal>;
  historyComplete: boolean;
  source: "pocketbase";
  fetchedAt: string;
};

type IncludedWeek = {
  identified: boolean;
  history: unknown;
  points: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWeekStart(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readArchivedAt(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storedMemberNames(points: unknown): string[] {
  if (!isRecord(points)) return [];
  return Object.keys(points).filter((name) => name.trim().length > 0);
}

function transactionKey(transaction: Transaction): string {
  return [
    transaction.id,
    transaction.timestamp,
    transaction.member,
    transaction.type,
    transaction.amount,
    transaction.description,
    transaction.taskId ?? "",
    transaction.appliedBy ?? "",
    transaction.meta?.operationId ?? "",
    transaction.meta?.source ?? "",
    transaction.meta?.fingerprint ?? "",
    transaction.meta?.actorId ?? "",
    transaction.meta?.action ?? "",
    (transaction.meta?.taskIds ?? []).join(","),
  ].join("\u0000");
}

function latestArchiveRow(
  chosen: Map<string, ArchiveWeekRow>,
  row: ArchiveWeekRow,
): void {
  const weekStart = readWeekStart(row.weekStart);
  const existing = chosen.get(weekStart);
  if (!existing) {
    chosen.set(weekStart, row);
    return;
  }
  if (readArchivedAt(row.archivedAt) > readArchivedAt(existing.archivedAt)) {
    chosen.set(weekStart, row);
  }
}

function includedWeeks(
  currentWeek: WeekData | null,
  archiveRows: readonly ArchiveWeekRow[],
): IncludedWeek[] {
  const currentWeekStart = currentWeek ? readWeekStart(currentWeek.weekStart) : "";
  const chosen = new Map<string, ArchiveWeekRow>();
  for (const row of archiveRows) {
    if (row) latestArchiveRow(chosen, row);
  }
  const weeks: IncludedWeek[] = [];
  if (currentWeek) {
    weeks.push({
      identified: currentWeekStart.length > 0,
      history: (currentWeek as { history: unknown }).history,
      points: (currentWeek as { points: unknown }).points,
    });
  }
  for (const weekStart of [...chosen.keys()].sort()) {
    if (currentWeekStart && weekStart === currentWeekStart) continue;
    const row = chosen.get(weekStart) as ArchiveWeekRow;
    weeks.push({
      identified: weekStart.length > 0,
      history: row.history,
      points: row.points,
    });
  }
  return weeks;
}

export function familyAllTimePoints(
  totals: readonly (number | null | undefined)[],
): number | null {
  if (totals.length === 0) return null;
  let sum = 0;
  for (const total of totals) {
    if (typeof total !== "number" || !Number.isFinite(total)) return null;
    sum += total;
  }
  return sum;
}

export function buildAllTimeTotals(
  currentWeek: WeekData | null,
  archiveRows: readonly ArchiveWeekRow[],
  rosterNames: readonly string[] = [],
): AllTimeTotalsPayload {
  const weeks = includedWeeks(currentWeek, archiveRows);
  const members = new Set<string>();
  const byId = new Map<number, Transaction>();
  let historyComplete = true;

  for (const week of weeks) {
    for (const name of storedMemberNames(week.points)) members.add(name);
    if (!week.identified) {
      historyComplete = false;
      continue;
    }
    const history = parseCanonicalTransactions(week.history);
    if (!history) {
      historyComplete = false;
      continue;
    }
    for (const transaction of history) {
      members.add(transaction.member);
      const existing = byId.get(transaction.id);
      if (!existing) {
        byId.set(transaction.id, transaction);
        continue;
      }
      if (transactionKey(existing) !== transactionKey(transaction)) {
        historyComplete = false;
      }
    }
  }

  // Every roster member belongs in the payload: a member with no history at all
  // provably earned zero, and omitting them would make the family total
  // unknowable for everyone.
  for (const name of rosterNames) {
    const trimmed = name.trim();
    if (trimmed.length > 0) members.add(trimmed);
  }

  const totals: Record<string, AllTimeMemberTotal> = {};
  for (const name of [...members].sort()) {
    if (!historyComplete) {
      totals[name] = { points: null, completions: null };
      continue;
    }
    let points = 0;
    let completions = 0;
    for (const transaction of byId.values()) {
      if (transaction.member !== name) continue;
      points += transaction.amount;
      if (transaction.type === "earn") completions += 1;
    }
    totals[name] = { points, completions };
  }
  return {
    weekStart: currentWeek ? readWeekStart(currentWeek.weekStart) : "",
    totals,
    historyComplete,
    source: "pocketbase",
    fetchedAt: new Date().toISOString(),
  };
}
