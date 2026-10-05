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
  /**
   * B5: two `week_archive` rows for one week whose `archivedAt` TIES and whose
   * canonical histories DIFFER. PocketBase's return order is unspecified, so a
   * strict `>` comparison let the incumbent win and the family total depended
   * on a coin flip — a child's real 99 points could read as 0. Not
   * decidable, so it is reported as unknown rather than guessed.
   */
  conflicted: boolean;
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

/** Two archives are "the same archive" when their CANONICAL histories match.
 *  `points` is deliberately not compared: the recomputed history is the single
 *  authority everywhere else in the ledger, so a stale points map is not a
 *  second opinion. Unreadable histories on both sides collapse (the week is
 *  already reported unknown by the parse check below). */
function sameArchiveContent(left: ArchiveWeekRow, right: ArchiveWeekRow): boolean {
  return (
    JSON.stringify(parseCanonicalTransactions(left.history)) ===
    JSON.stringify(parseCanonicalTransactions(right.history))
  );
}

type ArchiveChoice = { row: ArchiveWeekRow; conflicted: boolean };

function latestArchiveRow(chosen: Map<string, ArchiveChoice>, row: ArchiveWeekRow): void {
  const weekStart = readWeekStart(row.weekStart);
  const existing = chosen.get(weekStart);
  if (!existing) {
    chosen.set(weekStart, { row, conflicted: false });
    return;
  }
  const incoming = readArchivedAt(row.archivedAt);
  const incumbent = readArchivedAt(existing.row.archivedAt);
  if (incoming > incumbent) {
    chosen.set(weekStart, { row, conflicted: false });
    return;
  }
  if (incoming < incumbent) return;
  // A tie is a same-second retry (the archive writer stamps `now.toISOString()`),
  // which is exactly how duplicate rows arise. Identical duplicates still
  // collapse silently; divergent ones must not be resolved by return order.
  if (!sameArchiveContent(existing.row, row)) {
    chosen.set(weekStart, { row: existing.row, conflicted: true });
  }
}

function includedWeeks(
  currentWeek: WeekData | null,
  archiveRows: readonly ArchiveWeekRow[],
): IncludedWeek[] {
  const currentWeekStart = currentWeek ? readWeekStart(currentWeek.weekStart) : "";
  const chosen = new Map<string, ArchiveChoice>();
  for (const row of archiveRows) {
    if (row) latestArchiveRow(chosen, row);
  }
  const weeks: IncludedWeek[] = [];
  if (currentWeek) {
    weeks.push({
      identified: currentWeekStart.length > 0,
      history: (currentWeek as { history: unknown }).history,
      points: (currentWeek as { points: unknown }).points,
      conflicted: false,
    });
  }
  for (const weekStart of [...chosen.keys()].sort()) {
    if (currentWeekStart && weekStart === currentWeekStart) continue;
    const choice = chosen.get(weekStart) as ArchiveChoice;
    weeks.push({
      identified: weekStart.length > 0,
      history: choice.row.history,
      points: choice.row.points,
      conflicted: choice.conflicted,
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
  /**
   * B2: `week_data` rows older than the current week that have NO
   * `week_archive` row. `/api/tasks/all-time` narrows `week_data` to the single
   * current week before calling this, so an orphaned older row — a week the
   * rollover skipped — used to be dropped in silence while the payload
   * actively asserted `historyComplete: true`. Its points are genuinely
   * unknown, so the caller passes the week starts and the payload reports the
   * honest unavailable state instead of a confident wrong number.
   */
  unarchivedWeekStarts: readonly string[] = [],
): AllTimeTotalsPayload {
  const weeks = includedWeeks(currentWeek, archiveRows);
  const members = new Set<string>();
  // Names a STORED points map mentions. They are evidence of nothing on their
  // own — the points map is never authority here — so they are collected
  // separately and can only ever carry the honest unknown below.
  const storedNames = new Set<string>();
  const byId = new Map<number, Transaction>();
  // An IDENTIFIED unarchived older week makes the total unknowable; an
  // unidentifiable entry is ignored (there is nothing to point at).
  let historyComplete = !unarchivedWeekStarts.some((weekStart) => readWeekStart(weekStart).length > 0);

  for (const week of weeks) {
    for (const name of storedMemberNames(week.points)) storedNames.add(name);
    if (!week.identified || week.conflicted) {
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

  // A stored name that no roster and no transaction corroborates is a LEGACY
  // key (a rename migration moves ledger keys, but an old row can survive) or a
  // person who does not exist at all. Either way their balance is UNKNOWN: the
  // project rule is that an unknown is null, never 0 — a confident `{points: 0}`
  // would invent a family member who has never existed. So the member set for
  // definite values is the roster plus real transactions only, and a stored-only
  // name is reported as unknown (kept in the payload so the shape never
  // changes, never counted as a zero).
  const storedOnly = new Set([...storedNames].filter((name) => !members.has(name)));
  const reported = new Set([...members, ...storedOnly]);

  const totals: Record<string, AllTimeMemberTotal> = {};
  for (const name of [...reported].sort()) {
    if (!historyComplete || storedOnly.has(name)) {
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
