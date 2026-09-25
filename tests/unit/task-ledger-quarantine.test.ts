import { describe, expect, it } from "vitest";
import {
  matchLegacyLedgerTransactions,
  serializeQuarantineReport,
  type QuarantineRequest,
  type QuarantineResponse,
} from "@/lib/task-ledger-quarantine";
import type { Transaction, WeekData } from "@/types/tasks";

const WEEK = "2026-09-21";

function transaction(
  id: number,
  type: Transaction["type"],
  member: string,
  amount: number,
  taskId?: number,
): Transaction {
  return {
    id,
    timestamp: `2026-09-2${(id % 8) + 1}T10:00:00.000Z`,
    member,
    type,
    amount,
    description: type === "earn" ? "Completed: Dishes" : "Adjustment",
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function weekWithHistory(history: Transaction[]): WeekData {
  return {
    weekStart: WEEK,
    points: {},
    streak: {},
    lastActive: {},
    history,
  };
}

describe("matchLegacyLedgerTransactions", () => {
  it("matches an exact transaction only when payload identity agrees", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42)]),
    );
    expect(report.exactMatches.map((tx) => tx.id)).toEqual([7]);
    expect(report.quarantined).toEqual([]);
  });

  it("quarantines a shared id whose member, type, amount, or taskId disagrees", () => {
    const disagreeing: Transaction[] = [
      transaction(7, "earn", "Sam", 5, 42),
      transaction(7, "penalty", "Alex", 5, 42),
      transaction(7, "earn", "Alex", 9, 42),
      transaction(7, "earn", "Alex", 5, 43),
    ];
    for (const canonicalTx of disagreeing) {
      const report = matchLegacyLedgerTransactions(
        weekWithHistory([transaction(7, "earn", "Alex", 5, 42)]),
        weekWithHistory([canonicalTx]),
      );
      expect(report.exactMatches).toEqual([]);
      expect(report.semanticMatches).toEqual([]);
      expect(report.quarantined.map((tx) => tx.id)).toEqual([7]);
    }
  });

  it("matches a remaining task earn only against an unreversed task/member earn", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([
        transaction(9, "earn", "Alex", 5, 42),
        transaction(10, "adjust", "Alex", -5, 42),
      ]),
    );
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([8]);
  });

  it("matches a remaining task earn against an unreversed server earn", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(9, "earn", "Alex", 5, 42)]),
    );
    expect(report.exactMatches).toEqual([]);
    expect(report.semanticMatches.map((tx) => tx.id)).toEqual([8]);
    expect(report.quarantined).toEqual([]);
  });

  it("keeps an earn unreversed when the adjustment lands before the earn", () => {
    const before = { ...transaction(10, "adjust", "Alex", -5, 42), timestamp: "2026-09-21T09:00:00.000Z" };
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([before, transaction(9, "earn", "Alex", 5, 42)]),
    );
    expect(report.semanticMatches.map((tx) => tx.id)).toEqual([8]);
    expect(report.quarantined).toEqual([]);
  });

  it("quarantines a local task earn when the server earn belongs to another member", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(9, "earn", "Sam", 5, 42)]),
    );
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([8]);
  });

  it("quarantines a local task earn when the server earn is for another task", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(9, "earn", "Alex", 5, 43)]),
    );
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([8]);
  });

  it("quarantines a local task earn when the server amount disagrees", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(9, "earn", "Alex", 7, 42)]),
    );
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([8]);
  });

  it("spends one server earn at most once across local leftovers", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(8, "earn", "Alex", 5, 42), transaction(11, "earn", "Alex", 5, 42)]),
      weekWithHistory([transaction(9, "earn", "Alex", 5, 42)]),
    );
    expect(report.semanticMatches.map((tx) => tx.id)).toEqual([8]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([11]);
  });

  it("quarantines a local non-earn or taskless transaction even when an id matches", () => {
    const localRedeem = { ...transaction(7, "redeem", "Alex", -20) };
    const localAdjust = transaction(8, "adjust", "Alex", 3);
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([localRedeem, localAdjust]),
      weekWithHistory([]),
    );
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([7, 8]);
  });

  it("never re-issues a matched transaction in the quarantine list", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([
        transaction(7, "earn", "Alex", 5, 42),
        transaction(8, "earn", "Alex", 5, 42),
        transaction(9, "earn", "Alex", 5, 43),
      ]),
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42), transaction(10, "earn", "Alex", 5, 42)]),
    );
    expect(report.exactMatches.map((tx) => tx.id)).toEqual([7]);
    expect(report.semanticMatches.map((tx) => tx.id)).toEqual([8]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([9]);
  });

  it("quarantines every local transaction when the canonical week is empty", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42), transaction(8, "adjust", "Alex", -2)]),
      weekWithHistory([]),
    );
    expect(report.exactMatches).toEqual([]);
    expect(report.semanticMatches).toEqual([]);
    expect(report.quarantined.map((tx) => tx.id)).toEqual([7, 8]);
  });

  it("reports both week starts, a version, and a generated timestamp", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([]),
      { ...weekWithHistory([]), weekStart: "2026-09-28" },
    );
    expect(report.version).toBe(1);
    expect(report.localWeekStart).toBe(WEEK);
    expect(report.canonicalWeekStart).toBe("2026-09-28");
    expect(Number.isFinite(Date.parse(report.generatedAt))).toBe(true);
  });
});

describe("serializeQuarantineReport", () => {
  it("round-trips the report as JSON", () => {
    const report = matchLegacyLedgerTransactions(
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42), transaction(8, "earn", "Alex", 5, 43)]),
      weekWithHistory([transaction(7, "earn", "Alex", 5, 42)]),
    );
    const parsed = JSON.parse(serializeQuarantineReport(report));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(report)));
    expect(parsed.quarantined.map((tx: Transaction) => tx.id)).toEqual([8]);
  });

  it("keeps the interface vocabulary stable for the route contract", () => {
    const mode: QuarantineRequest["mode"] = "export";
    const response: QuarantineResponse = {
      ok: true,
      mode,
      report: matchLegacyLedgerTransactions(weekWithHistory([]), weekWithHistory([])),
    };
    expect(response.ok).toBe(true);
    expect(response.path).toBeUndefined();
    expect(serializeQuarantineReport(response.report)).toContain('"quarantined"');
  });
});
