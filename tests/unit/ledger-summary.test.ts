import { describe, it, expect } from "vitest";
import {
  formatUSD,
  latestMonthKey,
  summarizeLedger,
  type LedgerDashboardPayload,
} from "@/lib/finance/ledger-summary";

// Mirrors the live payload shape (verified on the NAS 2026-09-02):
// accounts[] carry type Checking|Savings|Loan; balanceSnapshots[] carry
// category Loan|Checking with mixed lastUpdated formats.
const PAYLOAD: LedgerDashboardPayload = {
  yearData: {
    "2026-08": {
      period: { monthLabel: "August", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 6400.0 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3000 },
      ],
      balanceSnapshots: [
        { name: "Older", category: "Loan", balance: 100, lastUpdated: "2026-08-01" },
      ],
    },
    "2026-09": {
      period: { monthLabel: "September", yearLabel: "2026" },
      ledger: { totalBudgeted: 7712.84, totalSpent: 1234.56 },
      accounts: [
        { name: "LMCU Checking", type: "Checking", balance: 3816.18 },
        { name: "Huntington", type: "Checking", balance: 526.36 },
        { name: "LMCU Shares", type: "Savings", balance: 5248.57 },
        { name: "Tesla Loan", type: "Loan", balance: 44595.24 },
      ],
      balanceSnapshots: [
        { name: "Discover", category: "Loan", balance: 3488.63, lastUpdated: "2026-08-11" },
        { name: "Mortgage", category: "Loan", balance: 370194.62, lastUpdated: "8/31/2026" },
        { name: "LMCU Checking", category: "Checking", balance: 3816.18, lastUpdated: "8/31/2026" },
      ],
    },
  },
  selectedMonthKey: "2026-09",
};

describe("latestMonthKey", () => {
  it("picks the lexicographically largest YYYY-MM key", () => {
    expect(latestMonthKey(PAYLOAD)).toBe("2026-09");
  });
  it("returns null for an empty/missing yearData", () => {
    expect(latestMonthKey({})).toBeNull();
    expect(latestMonthKey({ yearData: {} })).toBeNull();
  });
});

describe("summarizeLedger", () => {
  it("computes cash/debt/spend for the latest month", () => {
    const s = summarizeLedger(PAYLOAD)!;
    expect(s.monthKey).toBe("2026-09");
    expect(s.monthLabel).toBe("September 2026");
    expect(s.cash).toBeCloseTo(9591.11);
    expect(s.debt).toBeCloseTo(373683.25); // Loan snapshots only (superset of accounts)
    expect(s.spent).toBe(1234.56);
    expect(s.budgeted).toBe(7712.84);
    expect(s.updatedLabel).toBe("8/31/2026"); // latest across both date formats
  });

  it("falls back to Loan-typed accounts when there are no Loan snapshots", () => {
    const p: LedgerDashboardPayload = {
      yearData: {
        "2026-09": {
          accounts: [
            { name: "Tesla Loan", type: "Loan", balance: 44595.24 },
            { name: "Checking", type: "Checking", balance: 10 },
          ],
        },
      },
    };
    expect(summarizeLedger(p)!.debt).toBe(44595.24);
    expect(summarizeLedger(p)!.updatedLabel).toBeNull();
  });

  it("returns null when there is no month data", () => {
    expect(summarizeLedger({ yearData: {} })).toBeNull();
  });

  it("tolerates a sparse month (missing ledger/accounts blocks)", () => {
    const s = summarizeLedger({ yearData: { "2026-01": {} } });
    expect(s).not.toBeNull();
    expect(s!.cash).toBe(0);
    expect(s!.debt).toBe(0);
    expect(s!.monthLabel).toBe("2026-01"); // key fallback when period labels missing
  });
});

describe("formatUSD", () => {
  it("formats whole dollars with commas, no decimals", () => {
    expect(formatUSD(9591.11)).toBe("$9,591");
    expect(formatUSD(0)).toBe("$0");
    expect(formatUSD(373683.25)).toBe("$373,683");
  });
});
