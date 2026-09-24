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
      points: { Alex: 8 },
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

function weekRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    weekStart: WEEK,
    points: "{}",
    streak: "{}",
    lastActive: "{}",
    history: "[]",
    ...overrides,
  };
}

function duplicateInitialPb() {
  const existing = transaction(1, {
    taskId: 101,
    meta: { operationId: "op-duplicate-initial", source: "task-approval" },
  });
  const stored = weekRow("week-1", {
    points: JSON.stringify({ Alex: 8 }),
    history: JSON.stringify([existing]),
  });
  const rows = [stored, { ...structuredClone(stored), id: "week-2" }];
  return {
    pb: {
      collection: vi.fn(() => ({
        getFullList: vi.fn(async () => structuredClone(rows)),
        update: vi.fn(),
        create: vi.fn(),
      })),
    } as any,
  };
}

function duplicateVerificationPb() {
  let row = weekRow("week-1");
  let written = false;
  return {
    pb: {
      collection: vi.fn(() => ({
        getFullList: vi.fn(async () =>
          written
            ? [structuredClone(row), { ...structuredClone(row), id: "week-2" }]
            : [structuredClone(row)],
        ),
        getOne: vi.fn(async () => structuredClone(row)),
        update: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
          row = { ...row, ...structuredClone(payload) };
          written = true;
          return structuredClone(row);
        }),
        create: vi.fn(),
      })),
    } as any,
  };
}

function createRowPb(options: { fail?: boolean } = {}) {
  let row: Record<string, unknown> | null = null;
  const collection = {
    getFullList: vi.fn(async () => (row ? [structuredClone(row)] : [])),
    getOne: vi.fn(async () => (row ? structuredClone(row) : null)),
    update: vi.fn(),
    create: vi.fn(async (payload: Record<string, unknown>) => {
      if (options.fail) throw new Error("create failed");
      row = { id: "created-week", ...structuredClone(payload) };
      return structuredClone(row);
    }),
  };
  return {
    pb: {
      collection: vi.fn(() => collection),
    } as any,
    collection,
  };
}

describe("ledger operation review regressions", () => {
  it("rejects duplicate week rows on the initial canonical read", async () => {
    const harness = duplicateInitialPb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-duplicate-initial",
        source: "task-approval",
        entries: [{ type: "earn", member: "Alex", amount: 8, description: "Approved", taskId: 101 }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "ledger_write_conflict" });
  });

  it("rejects duplicate week rows on post-write verification", async () => {
    const harness = duplicateVerificationPb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-duplicate-verification",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "ledger_write_conflict" });
  });

  it.each([
    ["read", new Date(0)],
    ["negative", new Date(-1)],
    ["invalid", "not-a-date" as unknown as Date],
  ])("rejects %s dates before writing", async (_label, now) => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: `op-invalid-now-${_label}`,
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
      now,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_ledger_operation",
      operationId: `op-invalid-now-${_label}`,
    });
    expect(harness.writeCount).toBe(0);
  });

  it("returns a safe empty identity for an unsafe operation ID", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "__proto__",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_ledger_operation", operationId: "" });
    expect(JSON.stringify(result)).not.toContain("__proto__");
    expect(harness.writeCount).toBe(0);
  });

  it("repairs stale points for an exact replay without adding history", async () => {
    const existing = transaction(1, {
      taskId: 101,
      meta: { operationId: "op-stale-exact", source: "task-approval" },
    });
    const harness = makePb({ history: [existing], points: { Alex: 999 } });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-stale-exact",
          source: "task-approval",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Approved", taskId: 101 }],
        },
      }),
    );

    expect(result.applied).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.weekData.history).toHaveLength(1);
    expect(result.weekData.points).toEqual({ Alex: 8 });
    expect(harness.writeCount).toBe(1);
  });

  it("repairs stale points for a semantic replay without adding history", async () => {
    const harness = makePb({
      history: [transaction(1, { taskId: 101 })],
      points: { Alex: 999 },
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-stale-semantic",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(result.applied).toBe(false);
    expect(result.semanticDuplicate).toBe(true);
    expect(result.weekData.history).toHaveLength(1);
    expect(result.weekData.points).toEqual({ Alex: 8 });
    expect(harness.writeCount).toBe(1);
  });

  it("repairs stale points when partial replay is completed by a semantic duplicate", async () => {
    const harness = makePb({
      history: [
        transaction(1, {
          taskId: 101,
          meta: { operationId: "op-stale-partial", source: "task-approval" },
        }),
        transaction(2, { taskId: 202, member: "Bailey" }),
      ],
      points: { Alex: 999, Bailey: 999 },
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-stale-partial",
          source: "task-approval",
          entries: [
            { type: "earn", member: "Alex", amount: 8, description: "Approved", taskId: 101 },
            { type: "earn", member: "Bailey", amount: 8, description: "Approved", taskId: 202 },
          ],
        },
      }),
    );

    expect(result.applied).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.semanticDuplicate).toBe(true);
    expect(result.weekData.history).toHaveLength(2);
    expect(result.weekData.points).toEqual({ Alex: 8, Bailey: 8 });
    expect(harness.writeCount).toBe(1);
  });

  it("creates and verifies a new canonical week row", async () => {
    const harness = createRowPb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-create-row",
          source: "planner-adjust",
          entries: [{ type: "adjust", member: "Alex", amount: 3, description: "Bonus" }],
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.weekData.points).toEqual({ Alex: 3 });
    expect(harness.collection.create).toHaveBeenCalledOnce();
  });

  it("maps PB read, update, and create errors to a stable conflict", async () => {
    const readHarness = {
      pb: {
        collection: vi.fn(() => ({
          getFullList: vi.fn(async () => {
            throw new Error("read private material");
          }),
        })),
      } as any,
    };
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(readHarness.pb));
    const readResult = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-read-error",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });
    expect(readResult).toMatchObject({ ok: false, code: "ledger_write_conflict" });
    expect(JSON.stringify(readResult)).not.toContain("read private material");

    const updateHarness = makePb({ writeError: new Error("update private material") });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(updateHarness.pb));
    const updateResult = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-update-error",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });
    expect(updateResult).toMatchObject({ ok: false, code: "ledger_write_conflict" });
    expect(JSON.stringify(updateResult)).not.toContain("update private material");

    const createHarness = createRowPb({ fail: true });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(createHarness.pb));
    const createResult = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-create-error",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });
    expect(createResult).toMatchObject({ ok: false, code: "ledger_write_conflict" });
    expect(JSON.stringify(createResult)).not.toContain("create failed");
  });

  it("rejects same-operation entries with a different identity", async () => {
    const harness = makePb({
      history: [
        transaction(1, {
          taskId: 101,
          meta: { operationId: "op-same-id", source: "task-approval" },
        }),
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-same-id",
        source: "task-approval",
        entries: [{ type: "earn", member: "Bailey", amount: 8, description: "Approved", taskId: 101 }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_ledger_operation" });
    expect(harness.writeCount).toBe(0);
  });

  it("matches reordered entries from the same operation without writing", async () => {
    const harness = makePb({
      history: [
        transaction(1, {
          member: "Alex",
          taskId: 101,
          meta: { operationId: "op-reordered", source: "task-approval" },
        }),
        transaction(2, {
          member: "Bailey",
          taskId: 101,
          meta: { operationId: "op-reordered", source: "task-approval" },
        }),
      ],
      points: { Alex: 8, Bailey: 8 },
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-reordered",
          source: "task-approval",
          entries: [
            { type: "earn", member: "Bailey", amount: 8, description: "Approved", taskId: 101 },
            { type: "earn", member: "Alex", amount: 8, description: "Approved", taskId: 101 },
          ],
        },
      }),
    );

    expect(result.duplicate).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.weekData.history).toHaveLength(2);
    expect(harness.writeCount).toBe(0);
  });

  it("returns an unreconciled success when projection returns false", async () => {
    const harness = makePb();
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-projection-false",
          source: "planner-adjust",
          entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
        },
        project: async () => false,
      }),
    );

    expect(result.reconciled).toBe(false);
    expect(result.projectionError).toBe("projection_failed");
  });

  it("does not treat reversals for another task or member as a reversal", async () => {
    const harness = makePb({
      history: [
        transaction(1, { taskId: 101, member: "Alex" }),
        transaction(2, { taskId: 102, member: "Alex" }),
        transaction(3, {
          taskId: 102,
          member: "Alex",
          type: "adjust",
          amount: -8,
          description: "Other task reversal",
          timestamp: "2026-09-21T11:00:00.000Z",
        }),
        transaction(4, { taskId: 101, member: "Bailey" }),
        transaction(5, {
          taskId: 101,
          member: "Bailey",
          type: "adjust",
          amount: -8,
          description: "Other member reversal",
          timestamp: "2026-09-21T12:00:00.000Z",
        }),
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-wrong-reversal",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(result.semanticDuplicate).toBe(true);
    expect(result.applied).toBe(false);
  });

  it("allows re-earn after a later matching task and member reversal", async () => {
    const harness = makePb({
      history: [
        transaction(1, { taskId: 101, member: "Alex" }),
        transaction(2, { taskId: 102, member: "Alex" }),
        transaction(3, {
          taskId: 102,
          member: "Alex",
          type: "adjust",
          amount: -8,
          description: "Other task reversal",
          timestamp: "2026-09-21T11:00:00.000Z",
        }),
        transaction(4, { taskId: 101, member: "Bailey" }),
        transaction(5, {
          taskId: 101,
          member: "Bailey",
          type: "adjust",
          amount: -8,
          description: "Other member reversal",
          timestamp: "2026-09-21T12:00:00.000Z",
        }),
        transaction(6, {
          taskId: 101,
          member: "Alex",
          type: "adjust",
          amount: -8,
          description: "Matching reversal",
          timestamp: "2026-09-21T13:00:00.000Z",
        }),
      ],
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-matching-reversal",
          source: "assigned-complete",
          entries: [{ type: "earn", member: "Alex", amount: 8, description: "Completed", taskId: 101 }],
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.semanticDuplicate).toBe(false);
    expect(result.weekData.history).toHaveLength(7);
  });

  it("keeps generated IDs positive, safe, and collision-free", async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const nowMs = now.getTime();
    const existingIds = Array.from({ length: 2000 }, (_, index) => transaction(nowMs + index));
    const harness = makePb({ history: existingIds });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = expectSuccess(
      await applyWeekLedgerOperation({
        weekStart: WEEK,
        operation: {
          operationId: "op-id-collision",
          source: "planner-adjust",
          entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
        },
        now,
      }),
    );

    const newId = result.weekData.history.at(-1)?.id;
    expect(newId).toBeGreaterThan(0);
    expect(Number.isSafeInteger(newId)).toBe(true);
    expect(existingIds.some((entry) => entry.id === newId)).toBe(false);
  });

  it("rejects malformed transaction data returned by verification", async () => {
    let row = weekRow("week-1");
    const harness = {
      pb: {
        collection: vi.fn(() => ({
          getFullList: vi.fn(async () => [structuredClone(row)]),
          getOne: vi.fn(async () => structuredClone(row)),
          update: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
            const history = (payload.history as unknown[]).map((entry) => ({ ...(entry as object), id: 0 }));
            row = { ...row, ...payload, history: JSON.stringify(history) };
            return structuredClone(row);
          }),
          create: vi.fn(),
        })),
      } as any,
    };
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const result = await applyWeekLedgerOperation({
      weekStart: WEEK,
      operation: {
        operationId: "op-malformed-verification",
        source: "planner-adjust",
        entries: [{ type: "adjust", member: "Alex", amount: 1, description: "Bonus" }],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "ledger_write_conflict" });
  });
});
