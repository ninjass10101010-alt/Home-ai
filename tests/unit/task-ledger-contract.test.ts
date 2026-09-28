import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types/tasks";
import {
  hasUnreversedTaskEarn,
  parseCanonicalTransactions,
  recomputeWeekPoints,
} from "@/lib/task-ledger";

const transaction = (
  id: number,
  member: string,
  type: Transaction["type"],
  amount: number,
  timestamp: string,
  taskId?: number,
): Transaction => ({
  id,
  timestamp,
  member,
  type,
  amount,
  description: `${type}:${id}`,
  ...(taskId === undefined ? {} : { taskId }),
});

describe("task ledger contract", () => {
  it("recomputes balances from history", () => {
    const history: Transaction[] = [
      { id: 1, timestamp: "2026-09-21T10:00:00.000Z", member: "Alex", type: "earn", amount: 5, description: "earn" },
      { id: 2, timestamp: "2026-09-21T11:00:00.000Z", member: "Alex", type: "redeem", amount: -2, description: "redeem" },
    ];
    expect(recomputeWeekPoints(history)).toEqual({ Alex: 3 });
  });

  it("replays every ledger type without allowing a negative balance", () => {
    const history: Transaction[] = [
      transaction(1, "Alex", "earn", 5, "2026-09-21T10:00:00.000Z"),
      transaction(2, "Alex", "redeem", -2, "2026-09-21T11:00:00.000Z"),
      transaction(3, "Alex", "penalty", -1, "2026-09-21T12:00:00.000Z"),
      transaction(4, "Alex", "adjust", 4, "2026-09-21T13:00:00.000Z"),
      transaction(5, "Alex", "adjust", -10, "2026-09-21T14:00:00.000Z"),
      transaction(6, "Alex", "earn", 1, "2026-09-21T15:00:00.000Z"),
      transaction(7, "Jordan", "penalty", -3, "2026-09-21T16:00:00.000Z"),
    ];
    expect(recomputeWeekPoints(history)).toEqual({ Alex: 1, Jordan: 0 });
  });

  it("detects an unreversed task earn for the exact member", () => {
    const history: Transaction[] = [
      transaction(1, "Alex", "earn", 5, "2026-09-21T10:00:00.000Z", 42),
      transaction(2, "Jordan", "adjust", -5, "2026-09-21T11:00:00.000Z", 42),
    ];
    expect(hasUnreversedTaskEarn(history, 42, "Alex")).toBe(true);
    expect(hasUnreversedTaskEarn(history, 42, "Jordan")).toBe(false);
  });

  it("reverses only the latest task earn at or after its timestamp", () => {
    const history: Transaction[] = [
      transaction(1, "Alex", "earn", 5, "2026-09-21T10:00:00.000Z", 42),
      transaction(2, "Alex", "adjust", -5, "2026-09-21T11:00:00.000Z", 42),
      transaction(3, "Alex", "earn", 7, "2026-09-21T12:00:00.000Z", 42),
    ];
    expect(hasUnreversedTaskEarn(history, 42, "Alex")).toBe(true);

    history.push(transaction(4, "Alex", "adjust", -7, "2026-09-21T13:00:00.000Z", 42));
    expect(hasUnreversedTaskEarn(history, 42, "Alex")).toBe(false);
  });

  it("rejects every malformed canonical transaction instead of filtering it", () => {
    const valid = transaction(1, "Alex", "earn", 5, "2026-09-21T10:00:00.000Z", 42);
    const malformed = [
      { ...valid, id: "1" },
      { ...valid, id: 0 },
      { ...valid, id: 1.5 },
      { ...valid, timestamp: "" },
      { ...valid, timestamp: "not-a-timestamp" },
      { ...valid, timestamp: "1" },
      { ...valid, timestamp: "2026-02-30T10:00:00.000Z" },
      { ...valid, timestamp: "2026-09-21" },
      { ...valid, member: " " },
      { ...valid, amount: "5" },
      { ...valid, type: "legacy" },
      { ...valid, taskId: 0 },
      { ...valid, taskId: 1.5 },
      { ...valid, description: "" },
    ];

    for (const candidate of malformed) {
      expect(parseCanonicalTransactions([candidate])).toBeNull();
      expect(() => recomputeWeekPoints([candidate] as unknown as Transaction[])).toThrow();
    }
  });

  it("rejects malformed history before the semantic earn gate", () => {
    const malformed = [
      transaction(1, "Alex", "earn", Number.NaN, "2026-09-21T10:00:00.000Z", 42),
    ];

    expect(() => hasUnreversedTaskEarn(malformed, 42, "Alex")).toThrow();
  });

  it("canonicalizes offset timestamps before comparing earn reversals", () => {
    const history: Transaction[] = [
      transaction(1, "Alex", "earn", 5, "2026-09-21T12:00:00+02:00", 42),
      transaction(2, "Alex", "adjust", -5, "2026-09-21T05:00:00-05:00", 42),
    ];

    expect(parseCanonicalTransactions(history)).toEqual([
      {
        ...history[0],
        timestamp: "2026-09-21T10:00:00.000Z",
      },
      {
        ...history[1],
        timestamp: "2026-09-21T10:00:00.000Z",
      },
    ]);
    expect(hasUnreversedTaskEarn(history, 42, "Alex")).toBe(false);
  });

  it("normalizes canonical transaction operation metadata", () => {
    const parsed = parseCanonicalTransactions([
      {
        ...transaction(1, " Alex ", "earn", 5, "2026-09-21T10:00:00.000Z", 42),
        meta: { operationId: "  op-ledger-1  ", source: "assigned-complete", fingerprint: "c".repeat(64) },
      },
    ]);

    expect(parsed).toEqual([
      {
        id: 1,
        timestamp: "2026-09-21T10:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 5,
        description: "earn:1",
        taskId: 42,
        meta: { operationId: "op-ledger-1", source: "assigned-complete", fingerprint: "c".repeat(64) },
      },
    ]);
  });
});
