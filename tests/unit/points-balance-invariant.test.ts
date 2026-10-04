// Points ledger: the balance invariant had TWO implementations with opposite
// negative-value policies, and the gate was evaluated at WEEK scope instead of
// MEMBER scope. Together these meant one member's legacy negative silently read
// as "0 points" on screen while refusing every member's next operation, with no
// self-heal. These tests pin every reproduction.
//
// RED on the pre-fix source; GREEN after the invariant is single-sourced.

import { describe, expect, it } from "vitest";
import {
  computeMemberBalances,
  memberWouldGoNegative,
  recomputeWeekPoints,
} from "@/lib/task-ledger";
import type { Transaction } from "@/types/tasks";

let seq = 0;
function tx(member: string, type: Transaction["type"], amount: number): Transaction {
  seq += 1;
  return {
    id: seq,
    member,
    type,
    amount,
    timestamp: `2026-10-04T12:00:00.000Z`.replace("04T", String(4 + (seq % 6)).padStart(2, "0") + "T"),
    description: "test",
  } as Transaction;
}

describe("computeMemberBalances — the single balance invariant", () => {
  it("sums a member's transactions into their true running balance", () => {
    const balances = computeMemberBalances([tx("Aurora", "earn", 10), tx("Baylor", "earn", 5)]);
    expect(balances).toEqual({ Aurora: 10, Baylor: 5 });
  });

  it("preserves a negative balance instead of erasing it", () => {
    // The defect: Aurora earns 10 then is reversed by 25. The truth is -15.
    const balances = computeMemberBalances([tx("Aurora", "earn", 10), tx("Aurora", "adjust", -25)]);
    expect(balances.Aurora).toBe(-15);
  });

  it("is order-independent: the same net total gives the same balance either way", () => {
    const forward = computeMemberBalances([tx("Aurora", "adjust", -5), tx("Aurora", "earn", 10)]);
    const reverse = computeMemberBalances([tx("Aurora", "earn", 10), tx("Aurora", "adjust", -5)]);
    expect(forward.Aurora).toBe(5);
    expect(reverse.Aurora).toBe(forward.Aurora);
  });

  it("rejects a history that is not canonical rather than guessing", () => {
    expect(() => computeMemberBalances(null as never)).toThrow(TypeError);
    expect(() => computeMemberBalances("not json" as never)).toThrow(TypeError);
  });
});

describe("recomputeWeekPoints — the kids-facing floor of zero, kept deliberately", () => {
  it("clamps a negative balance to 0 for display", () => {
    const points = recomputeWeekPoints([tx("Aurora", "earn", 10), tx("Aurora", "adjust", -25)]);
    expect(points.Aurora).toBe(0);
  });

  it("floors at zero AS EACH TRANSACTION REPLAYS, so later credits build on 0", () => {
    // The product semantic (task-ledger-contract): a child can never owe points.
    // An adjustment larger than the balance floors at 0; the next earn builds on
    // 0, not on the true negative. This is deliberate, NOT an order bug.
    const history = [
      tx("Alex", "earn", 5),
      tx("Alex", "redeem", -2),
      tx("Alex", "penalty", -1),
      tx("Alex", "adjust", 4),
      tx("Alex", "adjust", -10), // 6 -> floors to 0
      tx("Alex", "earn", 1), // 0 -> 1
    ];
    expect(recomputeWeekPoints(history)).toEqual({ Alex: 1 });
  });

  it("agrees with the summed invariant on any history the write gate permitted", () => {
    // The gate rejects an operation whose summed balance would go below zero, so
    // a stored history never dips negative and the two cannot disagree. This is
    // the invariant that makes the divergence above safe.
    const legal = [tx("Aurora", "earn", 10), tx("Aurora", "redeem", -4), tx("Baylor", "earn", 6)];
    expect(recomputeWeekPoints(legal)).toEqual(computeMemberBalances(legal));
  });

  it("does not invent a balance for a member with no transactions", () => {
    expect(recomputeWeekPoints([tx("Aurora", "earn", 10)])).toEqual({ Aurora: 10 });
  });
});

describe("memberWouldGoNegative — scoped to the acting member", () => {
  const history = [tx("Aurora", "earn", 10), tx("Aurora", "adjust", -25), tx("Baylor", "earn", 5)];

  it("reports the member who is actually short", () => {
    expect(memberWouldGoNegative(history, "Aurora")).toBe(true);
  });

  it("does NOT implicate a different member who is in credit", () => {
    // The defect: Baylor has +5 and never went negative, but the week-scoped
    // gate refused Baylor's operations because of Aurora's deficit.
    expect(memberWouldGoNegative(history, "Baylor")).toBe(false);
  });

  it("reports false for an unknown member rather than throwing", () => {
    expect(memberWouldGoNegative(history, "Nobody")).toBe(false);
  });

  it("is false for a clean week", () => {
    expect(memberWouldGoNegative([tx("Aurora", "earn", 10)], "Aurora")).toBe(false);
  });
});