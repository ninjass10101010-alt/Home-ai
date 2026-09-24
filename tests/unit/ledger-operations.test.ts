import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction, WeekData } from "@/types/tasks";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { applyWeekLedgerOperation, type LedgerOperationResult } from "@/lib/ledger-operations";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";

const WEEK = "2026-09-21";

function transaction(
  id: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    timestamp: "2026-09-21T10:00:00.000Z",
    member: "Alex",
    type: "earn",
    amount: 8,
    description: "Approved",
    ...overrides,
  };
}

function makePb(options: {
  history?: Transaction[];
  points?: Record<string, number>;
  dropWrite?: boolean;
  writeError?: Error;
} = {}) {
  let row: Record<string, unknown> = {
    id: "week-1",
    weekStart: WEEK,
    points: JSON.stringify(options.points ?? {}),
    streak: "{}",
    lastActive: "{}",
    history: JSON.stringify(options.history ?? []),
  };
  let writeCount = 0;
  const collection = {
    getFullList: vi.fn(async () => [structuredClone(row)]),
    getOne: vi.fn(async (id: string) => (id === row.id ? structuredClone(row) : null)),
    update: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
      writeCount += 1;
      if (options.writeError) throw options.writeError;
      if (!options.dropWrite) row = { ...row, ...structuredClone(payload) };
      return structuredClone(row);
    }),
    create: vi.fn(async (payload: Record<string, unknown>) => {
      writeCount += 1;
      if (options.writeError) throw options.writeError;
      row = { id: "week-created", ...structuredClone(payload) };
      return structuredClone(row);
    }),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name !== "week_data") throw new Error(`unexpected collection ${name}`);
      return collection;
    }),
  };
  return {
    pb: pb as any,
    collection,
    get history() {
      return row.history;
    },
    get points() {
      return row.points;
    },
    get writeCount() {
      return writeCount;
    },
  };
}

function expectSuccess(result: LedgerOperationResult): Extract<LedgerOperationResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result;
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  __resetWeekLedgerLockForTests();
});

describe("applyWeekLedgerOperation", () => {
  it("replays a complete batch by operationId without duplicating entries", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));
    const operation = {
      operationId: "op-approve-101",
      source: "task-approval" as const,
      entries: [
        { type: "earn" as const, member: "Alex", amount: 8, description: "Approved", taskId: 101 },
        { type: "earn" as const, member: "Bailey", amount: 8, description: "Approved", taskId: 101 },
      ],
    };

    const first = expectSuccess(await applyWeekLedgerOperation({ weekStart: WEEK, operation }));
    const second = expectSuccess(await applyWeekLedgerOperation({ weekStart: WEEK, operation }));

    expect(first.applied).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.weekData.history).toHaveLength(2);
    expect(second.applied).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.weekData.history).toHaveLength(2);
    expect(harness.writeCount).toBe(1);
    expect(second.weekData.history.every((entry) => entry.meta?.operationId === "op-approve-101")).toBe(true);
  });

  it("appends only missing entries after a partial batch replay", async () => {
    const harness = makePb({
      history: [
        transaction(1, {
          taskId: 101,
          meta: { operationId: "op-partial-101", source: "task-approval" },
        }),
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-partial-101",
          source: "task-approval",
          entries: [
            { type: "earn", member: "Alex", amount: 8, description: "Approved", taskId: 101 },
            { type: "earn", member: "Bailey", amount: 8, description: "Approved", taskId: 101 },
          ],
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.semanticDuplicate).toBe(false);
    expect(result.weekData.history).toHaveLength(2);
    expect(result.weekData.history[1].meta?.operationId).toBe("op-partial-101");
  });

  it("does not floor a negative balance", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-redeem-1",
        source: "reward-redeem",
        entries: [{ type: "redeem", member: "Alex", amount: -5, description: "Redeemed" }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "insufficient_balance" });
    expect(harness.writeCount).toBe(0);
  });

  it("skips an unreversed task earn for the same member and re-earn after reversal", async () => {
    const firstHarness = makePb({
      history: [transaction(1, { taskId: 101, meta: undefined })],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(firstHarness.pb));

    const semantic = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-semantic-101",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(semantic.applied).toBe(false);
    expect(semantic.duplicate).toBe(false);
    expect(semantic.semanticDuplicate).toBe(true);
    expect(semantic.weekData.history).toHaveLength(1);
    expect(firstHarness.writeCount).toBe(0);

    const reversalHarness = makePb({
      history: [
        transaction(1, { taskId: 101 }),
        transaction(2, {
          taskId: 101,
          type: "adjust",
          amount: -8,
          description: "Undo",
          timestamp: "2026-09-21T11:00:00.000Z",
        }),
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(reversalHarness.pb));

    const reEarned = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-re-earned-101",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(reEarned.applied).toBe(true);
    expect(reEarned.semanticDuplicate).toBe(false);
    expect(reEarned.weekData.history).toHaveLength(3);
    expect(reEarned.weekData.history[2].meta?.operationId).toBe("op-re-earned-101");
  });

  it("does not deduplicate the same task earn across members", async () => {
    const harness = makePb({ history: [transaction(1, { taskId: 101 })] });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-member-101",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Bailey", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.semanticDuplicate).toBe(false);
    expect(result.weekData.history).toHaveLength(2);
  });

  it("rejects non-integer and malformed operation entries without writing", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));
    const invalidOperations = [
      { operationId: "op-float", source: "task-approval" as const, entries: [{ type: "earn" as const, member: "Alex", amount: 8.5, description: "Bad" }] },
      { operationId: "op-string-amount", source: "task-approval" as const, entries: [{ type: "earn" as const, member: "Alex", amount: "8" as unknown as number, description: "Bad" }] },
      { operationId: "op-bad-task", source: "task-approval" as const, entries: [{ type: "earn" as const, member: "Alex", amount: 8, description: "Bad", taskId: 1.5 }] },
      { operationId: "__proto__", source: "task-approval" as const, entries: [{ type: "earn" as const, member: "Alex", amount: 8, description: "Bad" }] },
    ];

    for (const operation of invalidOperations) {
      const result = await applyWeekLedgerOperation({ weekStart: WEEK, operation });
      expect(result).toMatchObject({ ok: false, code: "invalid_ledger_operation" });
    }

    expect(harness.writeCount).toBe(0);
  });

  it("recomputes canonical balances and rejects malformed stored history", async () => {
    const malformed = makePb({
      history: [transaction(1, { amount: Number.NaN })],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(malformed.pb));

    const invalid = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-malformed-history",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_ledger_operation" });
    expect(malformed.writeCount).toBe(0);

    const canonical = makePb({ points: { Alex: 999 } });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(canonical.pb));
    const valid = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-canonical",
          source: "planner-adjust",
          entries: [{ type: "adjust", member: "Alex", amount: 3, description: "Bonus" }],
        },
      }),
    );
    expect(valid.weekData.points).toEqual({ Alex: 3 });
  });

  it("keeps the week lock while the projection callback runs", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));
    let releaseProjection!: () => void;
    let projectionStarted!: () => void;
    const projectionReady = new Promise<void>((resolve) => { projectionStarted = resolve; });
    const projectionRelease = new Promise<void>((resolve) => { releaseProjection = resolve; });
    let secondAdminCall = 0;
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => {
      secondAdminCall += 1;
      return fn(harness.pb);
    });

    const first = applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-lock-1",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "One" }],
      },
      project: async () => {
        projectionStarted();
        await projectionRelease;
      },
    });
    await projectionReady;
    const second = applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-lock-2",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Two" }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondAdminCall).toBe(1);
    releaseProjection();
    await Promise.all([first, second]);
    expect(secondAdminCall).toBe(2);
  });

  it("keeps a successful ledger result when projection fails", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-projection-failure",
          source: "planner-adjust",
          entries: [{ type: "adjust", member: "Alex", amount: 2, description: "Bonus" }],
        },
        project: async () => {
          throw new Error("private projection detail");
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.reconciled).toBe(false);
    expect(result.projectionError).toBe("projection_failed");
    expect(JSON.stringify(result)).not.toContain("private projection detail");
    expect(harness.writeCount).toBe(1);
  });

  it("returns a stable conflict when post-write verification loses the new entries", async () => {
    const harness = makePb({ dropWrite: true });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));
    let projected = false;

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-verify-failure",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 2, description: "Bonus" }],
      },
      project: async () => {
        projected = true;
      },
    });

    expect(result).toMatchObject({ ok: false, code: "ledger_write_conflict" });
    expect(projected).toBe(false);
  });
});
