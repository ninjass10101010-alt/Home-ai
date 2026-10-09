/**
 * Undo / replay integrity at the task-claim seam.
 *
 * B1  `undo` read ONE week (the authority week), so a Sunday-paid earn — which
 *     lives in the PREVIOUS week's `week_data` row, later upserted into
 *     `week_archive` — was invisible and the reversal was impossible. The
 *     refusal (`nothing_to_undo`) is classified as a DUPLICATE by the browser
 *     outbox, so the client showed an undo toast and DELETED the entry.
 * B2  `undo` keyed the reversal on `actor.name`, so a paid CREW completion
 *     (credited to N members, owned by a non-member `"Crew"`) had no reversal
 *     path at all: every identity a caller can present is either not the earn's
 *     member, or a child whose own PIN is refused, or a parent PIN that finds no
 *     earn.
 * B3  The week-ledger mutex had no timeout, so one hung PocketBase round-trip
 *     wedged EVERY points writer for that week for the life of the process.
 * B4  Replay detection was scoped to the ONE `week_data` row being written, so
 *     an `operationId` already applied in an ARCHIVED week was invisible and the
 *     operation was applied a SECOND time (duplicate points).
 * B5  `readWeek` resolved duplicate `week_data` rows with a bare `.find()` and
 *     coerced a THROWN read to `null` — indistinguishable from "no week
 *     exists", which the outbox consumes as a verified duplicate (HTTP 200).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/types/tasks";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  getLiveMembers: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMembers: mocks.getLiveMembers,
}));

import { executeClaimCommand, type ClaimActor } from "@/lib/task-claim";
import { applyWeekLedgerOperation } from "@/lib/ledger-operations";
import { KEYED_LOCK_SECTION_TIMEOUT_MS, withKeyedLock } from "@/lib/keyed-lock";
import {
  __resetWeekLedgerLockForTests,
  withWeekLedgerLock,
} from "@/lib/week-ledger-lock";
import { localWeekStartISO } from "@/lib/local-date";
import { shiftWeek } from "@/lib/meals-week-utils";

const SNAP = "consuela_data_snapshots";
const WEEK_DATA = "week_data";
const WEEK_ARCHIVE = "week_archive";

const roster = [
  { id: "parent-alex", name: "Alex", role: "parent", emoji: "🦊", age: 40 },
  { id: "parent-rebecca", name: "Rebecca Garcia", role: "parent", emoji: "🐱", age: 40 },
  { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 },
  { id: "child-bailey", name: "Bailey Garcia", role: "child", emoji: "👧", age: 12 },
  { id: "pet-rex", name: "Rex", role: "pet", emoji: "🐶", age: 3 },
];

const AUTHORITY_WEEK = localWeekStartISO();
const PREVIOUS_WEEK = shiftWeek(AUTHORITY_WEEK, -1);

function emptyWeek(weekStart: string): Record<string, unknown> {
  return { weekStart, points: {}, streak: {}, lastActive: {}, history: [] };
}

function weekRow(
  weekStart: string,
  history: Transaction[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `w-${weekStart}`,
    weekStart,
    points: JSON.stringify({}),
    streak: JSON.stringify({}),
    lastActive: JSON.stringify({}),
    history: JSON.stringify(history),
    ...overrides,
  };
}

function earn(
  id: number,
  member: string,
  amount: number,
  taskId: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    timestamp: "2026-09-20T18:00:00.000Z",
    member,
    type: "earn",
    amount,
    description: `Crew: Dishes (+${amount}pts)`,
    taskId,
    ...overrides,
  };
}

interface HarnessOptions {
  tasks?: Record<string, unknown>[];
  /** A complete snapshot blob, for seeding a receipt written by an earlier run. */
  snapshotData?: Record<string, unknown>;
  weekRows?: Record<string, unknown>[];
  archiveRows?: Record<string, unknown>[];
  taskRows?: Record<string, unknown>[];
  weekDataReadThrows?: boolean;
}

function makePb(options: HarnessOptions = {}) {
  const weekRows: Record<string, any>[] = structuredClone(options.weekRows ?? []);
  const archiveRows: Record<string, any>[] = structuredClone(options.archiveRows ?? []);
  const taskRows: Record<string, any>[] = structuredClone(options.taskRows ?? []);
  const weekWrites: { weekStart: string; payload: Record<string, any> }[] = [];
  let archiveReads = 0;
  let snapshotRow: Record<string, any> = {
    id: "snap-1",
    key: "tasks-snapshot",
    data: JSON.stringify(options.snapshotData ?? {
      tasks: structuredClone(options.tasks ?? []),
      deletedTaskIds: [],
      weekData: emptyWeek(AUTHORITY_WEEK),
    }),
  };

  const collection = (name: string) => {
    if (name === SNAP) {
      return {
        getFullList: async () => [structuredClone(snapshotRow)],
        update: async (_id: string, payload: Record<string, unknown>) => {
          snapshotRow = { ...snapshotRow, ...structuredClone(payload) };
          return snapshotRow;
        },
        create: async (payload: Record<string, unknown>) => {
          snapshotRow = { ...snapshotRow, ...structuredClone(payload) };
          return snapshotRow;
        },
      };
    }
    if (name === WEEK_DATA) {
      return {
        getFullList: async () => {
          if (options.weekDataReadThrows) throw new Error("week_data_read_failed");
          return structuredClone(weekRows);
        },
        getOne: async (id: string) => {
          const row = weekRows.find((candidate) => String(candidate.id) === String(id));
          return row ? structuredClone(row) : null;
        },
        update: async (id: string, payload: Record<string, unknown>) => {
          const index = weekRows.findIndex((candidate) => String(candidate.id) === String(id));
          const next = { ...(weekRows[index] ?? { id }), ...structuredClone(payload) };
          weekRows[index] = next;
          weekWrites.push({ weekStart: String(next.weekStart), payload: structuredClone(payload) });
          return structuredClone(next);
        },
        create: async (payload: Record<string, unknown>) => {
          const next: Record<string, unknown> = {
            id: `w-created-${weekRows.length + 1}`,
            ...structuredClone(payload),
          };
          weekRows.push(next);
          weekWrites.push({ weekStart: String(next.weekStart), payload: structuredClone(payload) });
          return structuredClone(next);
        },
      };
    }
    if (name === WEEK_ARCHIVE) {
      return {
        getFullList: async () => {
          archiveReads += 1;
          return structuredClone(archiveRows);
        },
      };
    }
    return {
      getFullList: async () => structuredClone(taskRows),
      update: async (id: string, payload: Record<string, unknown>) => {
        const index = taskRows.findIndex((row) => String(row.id) === String(id));
        if (index >= 0) taskRows[index] = { ...taskRows[index], ...structuredClone(payload) };
        return taskRows[index] ?? { id };
      },
      create: async (payload: Record<string, unknown>) => {
        const created = { id: `task-row-${taskRows.length + 1}`, ...structuredClone(payload) };
        taskRows.push(created);
        return created;
      },
      delete: async (id: string) => {
        const index = taskRows.findIndex((row) => String(row.id) === String(id));
        if (index >= 0) taskRows.splice(index, 1);
        return true;
      },
    };
  };

  const pb = { collection };

  return {
    pb,
    weekWrites,
    weekRows: () => structuredClone(weekRows),
    archiveReads: () => archiveReads,
    snapshotData: () =>
      typeof snapshotRow.data === "string" ? JSON.parse(snapshotRow.data) : structuredClone(snapshotRow.data),
    addDuplicateWeekRow: (weekStart: string, history: Transaction[] = []) => {
      weekRows.push(weekRow(weekStart, history, { id: `w-dup-${weekRows.length + 1}` }));
    },
  };
}

function actor(
  id: string,
  authentication: ClaimActor["authentication"] = "pin",
): ClaimActor {
  const member = roster.find((candidate) => candidate.id === id);
  if (!member) throw new Error(`unknown fixture member ${id}`);
  return { memberId: member.id, name: member.name, role: member.role, authentication };
}

let operationSequence = 0;

function command(
  action: "claim" | "complete" | "undo",
  taskId: number,
  operationId?: string,
) {
  return {
    operationId: operationId ?? `op-undo-integrity-${++operationSequence}`,
    action,
    taskId,
  };
}

function wire(fixture: ReturnType<typeof makePb>): void {
  mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn(fixture.pb));
}

function run(
  cmd: ReturnType<typeof command>,
  actorValue: ClaimActor,
  fixture: ReturnType<typeof makePb>,
) {
  wire(fixture);
  return executeClaimCommand(cmd, actorValue);
}

const soloTask = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  title: "Dishes",
  points: 7,
  universal: false,
  assignee: "Alex",
  completed: true,
  status: "done",
  completedBy: "Alex",
  completedInWeek: AUTHORITY_WEEK,
  pendingApproval: null,
  ...overrides,
});

const crewTask = (overrides: Record<string, unknown> = {}) => ({
  id: 60,
  title: "Dishes",
  points: 5,
  universal: false,
  assignee: "Open",
  crewSize: 2,
  crew: {
    members: [
      { name: "Caspian Garcia", emoji: "🧒", joinedAt: "2026-09-20T17:00:00.000Z", checkedInAt: "2026-09-20T17:30:00.000Z" },
      { name: "Bailey Garcia", emoji: "👧", joinedAt: "2026-09-20T17:00:00.000Z", checkedInAt: "2026-09-20T17:31:00.000Z" },
    ],
  },
  completed: true,
  status: "done",
  // A crew close is owned by a name that is NOT on the live roster.
  completedBy: "Crew",
  completedInWeek: AUTHORITY_WEEK,
  pendingApproval: null,
  ...overrides,
});

beforeEach(() => {
  __resetWeekLedgerLockForTests();
  mocks.withAdmin.mockReset();
  mocks.getLiveMembers.mockReset().mockResolvedValue(roster);
});

afterEach(() => {
  __resetWeekLedgerLockForTests();
  vi.useRealTimers();
});

describe("B1 — a paid undo reaches the week that HOLDS the earn", () => {
  it("reverses an earn in the PREVIOUS week and writes the reversal into that week, not the authority week", async () => {
    const paid = earn(11, "Alex", 7, 42, {
      timestamp: `${PREVIOUS_WEEK}T18:00:00.000Z`,
      meta: { operationId: "op-original-sunday", source: "task-approval" },
    });
    const fixture = makePb({
      tasks: [soloTask({ completedInWeek: PREVIOUS_WEEK })],
      // Sunday's row survives the rollover in week_data AND is upserted into
      // week_archive, so the earn is legible in both.
      weekRows: [
        weekRow(PREVIOUS_WEEK, [paid]),
        weekRow(AUTHORITY_WEEK, []),
      ],
      archiveRows: [weekRow(PREVIOUS_WEEK, [paid])],
    });

    const result = await run(command("undo", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    // The reversal lands in the week that holds the earn.
    expect(fixture.weekWrites).toHaveLength(1);
    expect(fixture.weekWrites[0].weekStart).toBe(PREVIOUS_WEEK);
    const history: Transaction[] = fixture.weekWrites[0].payload.history;
    const reversal = history.find((transaction) => transaction.type === "adjust")!;
    expect(reversal).toBeDefined();
    // Exactly the earn's amount, on the earn's own member.
    expect(reversal.amount).toBe(-7);
    expect(reversal.member).toBe("Alex");
    expect(reversal.taskId).toBe(42);
    // Every ledger write carries the command's operationId.
    expect(reversal.meta?.operationId).toBe(result.operationId);
    // The authority week is untouched.
    const authorityWrites = fixture.weekWrites.filter((write) => write.weekStart === AUTHORITY_WEEK);
    expect(authorityWrites).toHaveLength(0);
    // The task is reopened.
    expect(result.task?.completed).toBe(false);
  });

  it("still blocks a SECOND reversal of the same earn", async () => {
    const paid = earn(11, "Alex", 7, 42, {
      timestamp: `${PREVIOUS_WEEK}T18:00:00.000Z`,
      meta: { operationId: "op-original-sunday", source: "task-approval" },
    });
    const reversed: Transaction = {
      id: 12,
      timestamp: `${PREVIOUS_WEEK}T19:00:00.000Z`,
      member: "Alex",
      type: "adjust",
      amount: -7,
      description: "Undo: Dishes (-7pts)",
      taskId: 42,
    };
    const fixture = makePb({
      tasks: [soloTask({ completedInWeek: PREVIOUS_WEEK })],
      weekRows: [weekRow(PREVIOUS_WEEK, [paid, reversed]), weekRow(AUTHORITY_WEEK, [])],
      archiveRows: [weekRow(PREVIOUS_WEEK, [paid, reversed])],
    });

    const result = await run(command("undo", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_undone");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

describe("B2 — a paid crew close is reversible by an authorised actor", () => {
  it("reverses EXACTLY the crew's earn rows, each at its own amount, for a parent PIN", async () => {
    const history = [
      earn(21, "Caspian Garcia", 4, 60, { timestamp: `${AUTHORITY_WEEK}T17:30:00.000Z` }),
      earn(22, "Bailey Garcia", 6, 60, { timestamp: `${AUTHORITY_WEEK}T17:31:00.000Z` }),
    ];
    const fixture = makePb({
      tasks: [crewTask()],
      weekRows: [weekRow(AUTHORITY_WEEK, history)],
    });

    const result = await run(command("undo", 60), actor("parent-alex"), fixture);

    expect(result.ok).toBe(true);
    expect(fixture.weekWrites).toHaveLength(1);
    const written = fixture.weekWrites[0].payload.history as Transaction[];
    const reversals = written.filter((transaction) => transaction.type === "adjust");
    expect(reversals).toHaveLength(2);
    expect(
      reversals
        .map((transaction) => [transaction.member, transaction.amount])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    ).toEqual([
      ["Bailey Garcia", -6],
      ["Caspian Garcia", -4],
    ]);
    for (const reversal of reversals) {
      expect(reversal.taskId).toBe(60);
      expect(reversal.meta?.operationId).toBe(result.operationId);
    }
    // No earn is invented and none is left standing.
    expect(written.filter((transaction) => transaction.type === "earn")).toHaveLength(2);
    expect(result.task?.completed).toBe(false);
  });

  it("lets a member reverse their OWN paid share and only that share", async () => {
    const history = [
      earn(21, "Caspian Garcia", 4, 60, { timestamp: `${AUTHORITY_WEEK}T17:30:00.000Z` }),
      earn(22, "Bailey Garcia", 6, 60, { timestamp: `${AUTHORITY_WEEK}T17:31:00.000Z` }),
    ];
    const fixture = makePb({
      tasks: [crewTask()],
      weekRows: [weekRow(AUTHORITY_WEEK, history)],
    });

    const result = await run(command("undo", 60), actor("child-caspian"), fixture);

    expect(result.ok).toBe(true);
    const written = fixture.weekWrites[0].payload.history as Transaction[];
    const reversals = written.filter((transaction) => transaction.type === "adjust");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].member).toBe("Caspian Garcia");
    expect(reversals[0].amount).toBe(-4);
  });

  it("refuses a member reversing a SIBLING's solo payment (no writes, no acknowledgement)", async () => {
    const fixture = makePb({
      tasks: [soloTask({ assignee: "Bailey Garcia", completedBy: "Bailey Garcia" })],
      weekRows: [weekRow(AUTHORITY_WEEK, [earn(31, "Bailey Garcia", 7, 42)])],
    });

    const result = await run(command("undo", 42), actor("child-caspian"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_task_owner");
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("lets a member reverse their OWN solo payment (their own PIN, nobody else's)", async () => {
    const fixture = makePb({
      tasks: [soloTask({ assignee: "Caspian Garcia", completedBy: "Caspian Garcia" })],
      weekRows: [weekRow(AUTHORITY_WEEK, [earn(32, "Caspian Garcia", 7, 42)])],
    });

    const result = await run(command("undo", 42), actor("child-caspian"), fixture);

    expect(result.ok).toBe(true);
    const written = fixture.weekWrites[0].payload.history as Transaction[];
    const reversal = written.find((transaction) => transaction.type === "adjust")!;
    expect(reversal.member).toBe("Caspian Garcia");
    expect(reversal.amount).toBe(-7);
  });

  it("still refuses a SESSION-only paid undo — the reversal always needs the member PIN", async () => {
    const fixture = makePb({
      tasks: [soloTask()],
      weekRows: [weekRow(AUTHORITY_WEEK, [earn(41, "Alex", 7, 42)])],
    });

    const result = await run(command("undo", 42), actor("parent-alex", "session"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pin_required");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

describe("B3 — the week-ledger mutex is bounded", () => {
  it("releases the chain when a section never settles, so the next caller for the same key runs", async () => {
    vi.useFakeTimers();
    let started = false;
    const hung = withWeekLedgerLock(AUTHORITY_WEEK, () => {
      started = true;
      return new Promise<never>(() => {});
    });
    // Let the section actually start before advancing the clock.
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBe(true);

    const next = withWeekLedgerLock(AUTHORITY_WEEK, async () => "second-ran");

    await vi.advanceTimersByTimeAsync(KEYED_LOCK_SECTION_TIMEOUT_MS + 1);

    await expect(hung).rejects.toThrow(/keyed_lock_timeout/);
    await expect(next).resolves.toBe("second-ran");
  });

  it("accepts a per-call override so a caller that legitimately needs longer can ask for it", async () => {
    vi.useFakeTimers();
    const slow = withKeyedLock(
      "week-ledger:override",
      async () => {
        await vi.advanceTimersByTimeAsync(2 * KEYED_LOCK_SECTION_TIMEOUT_MS);
        return "slow-ok";
      },
      { timeoutMs: 5 * KEYED_LOCK_SECTION_TIMEOUT_MS },
    );

    await expect(slow).resolves.toBe("slow-ok");
  });

  it("still serialises same-key sections FIFO and does not poison the chain on failure", async () => {
    const order: string[] = [];
    const failing = withKeyedLock("week-ledger:serial", async () => {
      order.push("first");
      throw new Error("boom");
    });
    const second = withKeyedLock("week-ledger:serial", async () => {
      order.push("second");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(order).toEqual(["first", "second"]);
  });
});

describe("B4 — replay detection sees the archive", () => {
  const ARCHIVED_OPERATION = "op-sunday-approval";

  /**
   * The real post-rollover shape: the finished week survives in `week_data` AND
   * is upserted into `week_archive`.
   */
  function archiveFixture(history: Transaction[]) {
    return makePb({
      tasks: [],
      weekRows: [weekRow(AUTHORITY_WEEK, []), weekRow(PREVIOUS_WEEK, history)],
      archiveRows: [weekRow(PREVIOUS_WEEK, history)],
    });
  }

  it("reports an operationId already applied in an ARCHIVED week as duplicate and writes nothing", async () => {
    const archived = earn(51, "Alex", 7, 42, {
      timestamp: `${PREVIOUS_WEEK}T18:00:00.000Z`,
      meta: { operationId: ARCHIVED_OPERATION, source: "task-approval" },
    });
    const fixture = archiveFixture([archived]);
    wire(fixture);

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: ARCHIVED_OPERATION,
        source: "task-approval",
        entries: [
          { type: "earn", member: "Alex", amount: 7, description: "Approved: Dishes (+7pts)", taskId: 42 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(true);
    expect(result.applied).toBe(false);
    // Duplicate points would mean a second earn for the same (task, member).
    expect(fixture.weekWrites).toHaveLength(0);
    // The archive really is consulted, not just the older week_data row.
    expect(fixture.archiveReads()).toBe(1);
  });

  it("does not spend a round-trip on week_archive when week_data holds no other week", async () => {
    const fixture = makePb({
      tasks: [],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
      archiveRows: [weekRow(PREVIOUS_WEEK, [])],
    });
    wire(fixture);

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: "op-single-week",
        source: "task-approval",
        entries: [
          { type: "earn", member: "Alex", amount: 7, description: "Approved: Dishes (+7pts)", taskId: 42 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    // The rollover upserts rather than moves, so a database that has never had a
    // second week has nothing archived to find.
    expect(fixture.archiveReads()).toBe(0);
  });

  it("refuses a different operationId that would re-pay an already-earned (task, member) in an archived week", async () => {
    const archived = earn(51, "Alex", 7, 42, {
      timestamp: `${PREVIOUS_WEEK}T18:00:00.000Z`,
      meta: { operationId: "op-earlier", source: "task-approval" },
    });
    const fixture = archiveFixture([archived]);
    wire(fixture);

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: "op-monday-resend",
        source: "task-approval",
        entries: [
          { type: "earn", member: "Alex", amount: 7, description: "Approved: Dishes (+7pts)", taskId: 42 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticDuplicate).toBe(true);
    expect(result.applied).toBe(false);
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still applies a genuinely new operation into the authority week", async () => {
    const fixture = archiveFixture([]);
    wire(fixture);

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: "op-brand-new",
        source: "task-approval",
        entries: [
          { type: "earn", member: "Bailey Garcia", amount: 3, description: "Approved: Rake (+3pts)", taskId: 43 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(fixture.weekWrites).toHaveLength(1);
    expect(fixture.weekWrites[0].weekStart).toBe(AUTHORITY_WEEK);
    const written = fixture.weekWrites[0].payload.history as Transaction[];
    expect(written.some((transaction) => transaction.member === "Bailey Garcia" && transaction.amount === 3)).toBe(true);
  });

  it("still allows a re-earn after a CROSS-WEEK reversal — the earlier week's payment was cancelled", async () => {
    // The B4 check sees an earn for (task, member) in another week. It must still
    // be satisfied when that payment has been reversed — including by an `adjust`
    // written into a DIFFERENT week, which is exactly what a cross-week undo does.
    const archived = earn(52, "Alex", 7, 42, {
      timestamp: `${PREVIOUS_WEEK}T18:00:00.000Z`,
      meta: { operationId: "op-earlier", source: "task-approval" },
    });
    const reversal: Transaction = {
      id: 53,
      timestamp: `${AUTHORITY_WEEK}T08:00:00.000Z`,
      member: "Alex",
      type: "adjust",
      amount: -7,
      description: "Undo: Dishes (-7pts)",
      taskId: 42,
      meta: { operationId: "op-undo", source: "task-undo" },
    };
    const fixture = makePb({
      tasks: [],
      weekRows: [weekRow(AUTHORITY_WEEK, [reversal]), weekRow(PREVIOUS_WEEK, [archived])],
      archiveRows: [weekRow(PREVIOUS_WEEK, [archived])],
    });
    wire(fixture);

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: "op-re-earn",
        source: "assigned-complete",
        entries: [
          { type: "earn", member: "Alex", amount: 7, description: "Completed: Dishes (+7pts)", taskId: 42 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticDuplicate).toBe(false);
    expect(result.applied).toBe(true);
    expect(fixture.weekWrites).toHaveLength(1);
  });

  it("fails closed when the archive cannot be read — 'I could not look' must not mean 'apply it again'", async () => {
    const fixture = makePb({
      tasks: [],
      weekRows: [weekRow(AUTHORITY_WEEK, []), weekRow(PREVIOUS_WEEK, [])],
    });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) =>
      fn({
        collection: (name: string) => {
          if (name === WEEK_ARCHIVE) {
            return { getFullList: async () => { throw new Error("week_archive_read_failed"); } };
          }
          return (fixture.pb as { collection: (name: string) => unknown }).collection(name);
        },
      }),
    );

    const result = await applyWeekLedgerOperation({
      weekStart: AUTHORITY_WEEK,
      operation: {
        operationId: "op-outage",
        source: "task-approval",
        entries: [
          { type: "earn", member: "Alex", amount: 7, description: "Approved: Dishes (+7pts)", taskId: 42 },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ledger_write_conflict");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

describe("B5 — week reads normalise the key, refuse ambiguity, and never lie about an outage", () => {
  it("refuses two week_data rows for one week instead of silently picking one", async () => {
    const fixture = makePb({
      tasks: [soloTask()],
      weekRows: [weekRow(AUTHORITY_WEEK, [earn(61, "Alex", 7, 42)])],
    });
    // A stale duplicate that is MISSING the earn — exactly the case where the
    // old bare `.find()` answered `nothing_to_undo`, which the outbox consumes
    // as a verified duplicate and deletes the entry.
    fixture.addDuplicateWeekRow(AUTHORITY_WEEK);

    const result = await run(command("undo", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe("nothing_to_undo");
    expect(result.reason).toBe("ledger_unavailable");
    expect(result.reconciled).toBe(false);
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("finds a week_data row whose weekStart carries stray whitespace (the seam already accepted it)", async () => {
    const fixture = makePb({
      tasks: [soloTask()],
      weekRows: [weekRow(` ${AUTHORITY_WEEK} `, [earn(62, "Alex", 7, 42)])],
    });

    const result = await run(command("undo", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(true);
    expect(fixture.weekWrites[0].weekStart).toBe(AUTHORITY_WEEK);
  });

  it("answers nothing_to_undo honestly when the week is unambiguous and simply unpaid", async () => {
    const fixture = makePb({
      tasks: [soloTask()],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });

    const result = await run(command("undo", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("nothing_to_undo");
  });

  it("never acknowledges a replay as a duplicate when the week_data read throws", async () => {
    const paid = makePb({
      tasks: [soloTask({ completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });
    const first = await run(command("complete", 42, "op-read-failure-replay"), actor("parent-alex"), paid);
    expect(first.ok).toBe(true);

    // A re-send of the SAME command against a PocketBase that cannot answer the
    // week_data read. The snapshot receipt is there, so the naive path reads the
    // failed read as "no ledger leg" and confirms the command as a duplicate.
    const outage = makePb({
      snapshotData: paid.snapshotData(),
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
      weekDataReadThrows: true,
    });
    const replay = await run(
      command("complete", 42, "op-read-failure-replay"),
      actor("parent-alex"),
      outage,
    );

    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("ledger_unavailable");
    expect(replay.duplicate).not.toBe(true);
    expect(replay.reconciled).toBe(false);
  });
});

describe("regression — the refusals and the queue rule the fixes must not weaken", () => {
  it("still refuses `complete` on a crew task", async () => {
    const fixture = makePb({ tasks: [crewTask({ completed: false, status: "pending" })], weekRows: [weekRow(AUTHORITY_WEEK, [])] });

    const result = await run(command("complete", 60), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("crew_task");
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still refuses `complete` on a task that is not assigned", async () => {
    const fixture = makePb({
      tasks: [soloTask({ universal: true, assignee: "Open", completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });

    const result = await run(command("complete", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_assigned");
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still refuses `complete` when the caller is not the assignee", async () => {
    const fixture = makePb({
      tasks: [soloTask({ assignee: "Bailey Garcia", completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });

    const result = await run(command("complete", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_task_owner");
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still refuses a pet", async () => {
    const fixture = makePb({ tasks: [soloTask()], weekRows: [weekRow(AUTHORITY_WEEK, [])] });

    const result = await run(command("undo", 42), actor("pet-rex"), fixture);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_allowed");
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still queues a child completion rather than paying it", async () => {
    const childOwned = soloTask({
      assignee: "Caspian Garcia",
      completed: false,
      status: "pending",
      completedBy: null,
      completedAt: null,
      completedInWeek: null,
      points: 5,
    });
    const fixture = makePb({ tasks: [childOwned], weekRows: [weekRow(AUTHORITY_WEEK, [])] });

    const result = await run(command("complete", 42), actor("child-caspian"), fixture);

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toMatchObject({ byName: "Caspian Garcia", points: 5 });
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still queues an INTERNAL (chat) completion for a grown-up rather than paying it", async () => {
    const fixture = makePb({
      tasks: [soloTask({ completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });

    const result = await run(command("complete", 42), actor("parent-alex", "internal"), fixture);

    expect(result.ok).toBe(true);
    expect(result.task?.pendingApproval).toMatchObject({ byName: "Alex", points: 7 });
    expect(fixture.weekWrites).toHaveLength(0);
  });

  it("still pays a parent PIN completion on the spot", async () => {
    const fixture = makePb({
      tasks: [soloTask({ completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });

    const result = await run(command("complete", 42), actor("parent-alex"), fixture);

    expect(result.ok).toBe(true);
    expect(fixture.weekWrites).toHaveLength(1);
    expect(fixture.weekWrites[0].weekStart).toBe(AUTHORITY_WEEK);
    expect(result.task?.pendingApproval).toBeNull();
  });
});

// Named "task-page wave B3", NOT "B6": this suite's own B1–B5 describes
// (:298, :366, :463, :514, :713, documented at :4-21) are a FINISHED historical
// series, and a wave-prefixed name is what keeps the two apart.
describe("task-page wave B3 — a pre-contract week is evidence for nobody, in EITHER direction", () => {
  const legacyRow = (weekStart: string) => weekRow(weekStart, [], {
    history: JSON.stringify([{
      id: 3, timestamp: `${weekStart}T12:00:00.000Z`, member: "Bailey Garcia",
      type: "earn", amount: 5, description: "Approved: Dishes (+5pts)", taskId: 42,
      meta: { source: "task-complete" },
    }]),
  });
  const unpaid = (name: string) => soloTask({
    assignee: name, completed: false, status: "pending", completedBy: null,
    completedAt: null, completedInWeek: null,
  });

  it("still pays into the authority week when an OLDER week's history will not parse", async () => {
    const fixture = makePb({
      tasks: [unpaid("Rebecca Garcia")],
      weekRows: [legacyRow(PREVIOUS_WEEK), weekRow(AUTHORITY_WEEK, [])],
      archiveRows: [],
    });

    const result = await run(command("complete", 42), actor("parent-rebecca"), fixture);

    expect(result.ok).toBe(true);
    expect(fixture.weekWrites).toHaveLength(1);
    expect(fixture.weekWrites[0].weekStart).toBe(AUTHORITY_WEEK);
    expect(fixture.weekWrites[0].payload.history).toContainEqual(
      expect.objectContaining({ type: "earn", member: "Rebecca Garcia", amount: 7, taskId: 42 }),
    );
    expect(fixture.archiveReads()).toBeGreaterThan(0);
  });

  it("answers invalid_task_state — never a duplicate — when the AUTHORITY week itself will not parse", async () => {
    const fixture = makePb({
      tasks: [unpaid("Rebecca Garcia")],
      weekRows: [legacyRow(AUTHORITY_WEEK), weekRow(PREVIOUS_WEEK, [])],
      archiveRows: [],
    });

    const result = await run(command("complete", 42), actor("parent-rebecca"), fixture);

    // `invalid_ledger_operation` → `invalid_task_state` (task-claim.ts:1249-1251).
    // Anything the outbox classifies as a DUPLICATE deletes the entry and leaves
    // the points wrong (task-claim.ts:1020-1031), so the reason is the contract.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_task_state");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});

// Named "task-page wave B2", NOT "B6": this suite's own B1–B5 describes (:298,
// :366, :463, :514, :713) are a FINISHED historical series, and a wave-prefixed
// name is what keeps the two apart.
describe("task-page wave B2 — claim owns the current-week row without the rollover (the D3 contract)", () => {
  it("creates the current week_data row when none exists, and does not call the rollover", async () => {
    const fixture = makePb({
      tasks: [soloTask({ completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [],
      archiveRows: [],
    });
    const result = await run(command("complete", 42, "op-d3-create"), actor("parent-alex"), fixture);
    expect(result.ok).toBe(true);
    // The stamp and the ledger week are the SAME key, always.
    expect(fixture.weekWrites.map((w) => w.weekStart)).toEqual([AUTHORITY_WEEK]);
  });

  it("serialises against the rollover on the SAME week-ledger lock (no duplicate row)", async () => {
    // Hold AUTHORITY_WEEK's ledger lock (as the rollover does), start a claim,
    // and assert the claim does not reach PocketBase until the lock is
    // released — the property that makes "claim creates the row, rollover
    // reconciles it" safe instead of a duplicate-row race.
    const fixture = makePb({
      tasks: [soloTask({ completed: false, status: "pending", completedBy: null, completedAt: null, completedInWeek: null })],
      weekRows: [],
      archiveRows: [],
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rollover = withWeekLedgerLock(AUTHORITY_WEEK, async () => {
      await held;
    });

    const claim = run(command("complete", 42, "op-d3-lock"), actor("parent-alex"), fixture);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fixture.weekWrites).toHaveLength(0);

    release();
    const result = await claim;
    await rollover;

    expect(result.ok).toBe(true);
    expect(fixture.weekWrites.map((w) => w.weekStart)).toEqual([AUTHORITY_WEEK]);
  });

  it("refuses a second command on an unstamped done row with already_completed (A5)", async () => {
    // The client double-tap guard is stamp-only (`completedInWeek ===
    // localWeekStartISO()`), so on an unstamped done row it queues a second
    // command; the server refuses honestly via `doneThisWeek`
    // (task-claim.ts:377-385) — no double-pay, no second write.
    const fixture = makePb({
      tasks: [soloTask({ completed: false, status: "done", completedBy: "Alex", completedAt: null, completedInWeek: null })],
      weekRows: [weekRow(AUTHORITY_WEEK, [])],
    });
    const result = await run(command("complete", 42, "op-a5-refuse"), actor("parent-alex"), fixture);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_completed");
    expect(fixture.weekWrites).toHaveLength(0);
  });
});
