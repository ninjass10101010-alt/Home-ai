// Pure parsing + summarization for Alex's ledger payload, served by the
// finance-dashboard container at GET /api/data/dashboard and proxied
// same-origin through the Consuela dashboard. No React, no fetch — the
// widget imports these helpers so the math stays unit-testable.

export interface LedgerAccount {
  name: string;
  institution?: string;
  type?: string; // "Checking" | "Savings" | "Loan" | ...
  balance: number;
  delta?: number;
}

export interface LedgerBalanceSnapshot {
  name: string;
  category?: string; // "Loan" | "Checking" | ...
  balance: number;
  lastUpdated?: string; // "M/D/YYYY" or "YYYY-MM-DD"
}

export interface LedgerMonth {
  period?: { monthLabel?: string; yearLabel?: string };
  ledger?: { totalBudgeted?: number; totalSpent?: number };
  accounts?: LedgerAccount[];
  balanceSnapshots?: LedgerBalanceSnapshot[];
}

export interface LedgerDashboardPayload {
  yearData?: Record<string, LedgerMonth>;
  selectedMonthKey?: string;
}

export interface LedgerSummary {
  monthKey: string;
  monthLabel: string;
  cash: number;
  debt: number;
  spent: number;
  budgeted: number;
  updatedLabel: string | null;
}

/** Latest month = max "YYYY-MM" key (string sort is chronological for this shape). */
export function latestMonthKey(payload: LedgerDashboardPayload): string | null {
  const keys = Object.keys(payload?.yearData ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k));
  if (keys.length === 0) return null;
  return keys.sort()[keys.length - 1];
}

function parseSnapshotDate(s?: string): number | null {
  if (!s) return null;
  const trimmed = s.trim();
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  return null;
}

/** Most recent snapshot freshness label, tolerating both date formats. */
export function latestUpdatedLabel(snapshots: LedgerBalanceSnapshot[]): string | null {
  let best: { t: number; label: string } | null = null;
  for (const s of snapshots) {
    const t = parseSnapshotDate(s.lastUpdated);
    if (t !== null && (best === null || t > best.t)) best = { t, label: s.lastUpdated!.trim() };
  }
  return best?.label ?? null;
}

export function summarizeLedger(payload: LedgerDashboardPayload): LedgerSummary | null {
  const monthKey = latestMonthKey(payload);
  if (!monthKey) return null;
  const month = payload.yearData?.[monthKey] ?? {};
  const accounts = month.accounts ?? [];
  const snapshots = month.balanceSnapshots ?? [];

  const cash = accounts
    .filter((a) => a.type === "Checking" || a.type === "Savings")
    .reduce((sum, a) => sum + (a.balance || 0), 0);

  // Debt: prefer balance snapshots (superset — cards + loans); fall back to
  // Loan-typed accounts when no snapshots exist for the month.
  const debt = snapshots.some((s) => s.category === "Loan")
    ? snapshots
        .filter((s) => s.category === "Loan")
        .reduce((sum, s) => sum + (s.balance || 0), 0)
    : accounts
        .filter((a) => a.type === "Loan")
        .reduce((sum, a) => sum + (a.balance || 0), 0);

  const monthLabel =
    month.period?.monthLabel && month.period?.yearLabel
      ? `${month.period.monthLabel} ${month.period.yearLabel}`
      : monthKey;

  return {
    monthKey,
    monthLabel,
    cash,
    debt,
    spent: month.ledger?.totalSpent ?? 0,
    budgeted: month.ledger?.totalBudgeted ?? 0,
    updatedLabel: latestUpdatedLabel(snapshots),
  };
}

export function formatUSD(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
