// Pointed regression suite for the rename/reconcile resilience wave.
//
//   B1 — the ledger is keyed on the member's DISPLAY NAME, so a mid-week
//        rename orphans the balance and blinds the negative-balance gate.
//        A rename must carry its history across `week_data`, `week_archive`
//        and the snapshot's `weekData`, all-or-nothing per week.
//   B2 — ONE malformed canonical `crew` value failed EVERY reconcile for the
//        whole family forever, with no quarantine path. It must now quarantine
//        that single task and let the pass complete `ok`.
//   B3 — `mergeCanonicalTransactions` SILENTLY dropped a duplicate `earn`.
//        The drop must be REPORTED, and wave 1's `mergedArchiveWeek()`
//        lossless union must keep working.
//
// The PocketBase fake is deliberately STRICT (a write drops any key the
// collection's `pb-seed.ts` schema does not declare) — the same trap that hid
// B6 of the previous wave in `task-week-integrity-fixes.test.ts`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTIONS } from "@/lib/pb-seed";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  authorizeAdminRequest: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  findLiveMemberById: vi.fn(),
  findLiveMemberByExactName: vi.fn(),
  listLiveMembersSanitized: vi.fn(),
  listMembersSanitized: vi.fn(),
  createMemberRecord: vi.fn(),
  isMemberPinAvailable: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminRequest: mocks.authorizeAdminRequest,
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

vi.mock("@/lib/server-auth", () => ({
  findLiveMemberById: mocks.findLiveMemberById,
  findLiveMemberByExactName: mocks.findLiveMemberByExactName,
  listLiveMembersSanitized: mocks.listLiveMembersSanitized,
  listMembersSanitized: mocks.listMembersSanitized,
  createMemberRecord: mocks.createMemberRecord,
  isMemberPinAvailable: mocks.isMemberPinAvailable,
  withMemberAdminOperation: (fn: () => Promise<unknown>) => fn(),
  sanitizeMember: (member: any) => {
    const { pin, ...rest } = member;
    return rest;
  },
}));

// The real keyed mutex — the rename must hold it, and the test resets it
// between cases.
vi.mock("@/lib/week-ledger-lock", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/week-ledger-lock")>();
  return {
    ...real,
    withWeekLedgerLock: (week: string, fn: () => Promise<unknown>) => {
      lockedWeeks.push(week);
      return real.withWeekLedgerLock(week, fn);
    },
  };
});

// Keep the REAL snapshot module (its week/lock helpers are the contract under
// test) and only record which week rows the rename touches.
const lockedWeeks = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

import { NextRequest } from "next/server";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";
import { PATCH } from "@/app/api/members/admin/route";
import { reconcileTaskProjection, reconcileTaskProjectionLocked } from "@/lib/task-projection-reconciler";
import {
  computeMemberBalances,
  mergeCanonicalTransactions,
  mergeCanonicalTransactionsWithReport,
  migrateWeekDataMemberName,
  recomputeWeekPoints,
} from "@/lib/task-ledger";
import type { Transaction, WeekData } from "@/types/tasks";

type Row = Record<string, any>;

const WEEK = "2026-09-21";
const PRIOR_WEEK = "2026-09-14";
const OLD_NAME = "Jon Oldname";
const NEW_NAME = "Jon Newname";
const OTHER_NAME = "Sibling";
const MEMBER_ID = "pb-jon";

// ─── strict PocketBase fake ────────────────────────────────────────────────

const SCHEMAS = new Map<string, Set<string>>(
  COLLECTIONS.map((collection: any) => [
    collection.name,
    new Set<string>(collection.schema.map((field: any) => field.name)),
  ]),
);

/** PocketBase drops a write whose key the collection does not declare. */
function declared(name: string, payload: Row): Row {
  const schema = SCHEMAS.get(name);
  if (!schema) return structuredClone(payload);
  const kept: Row = {};
  for (const [key, value] of Object.entries(payload)) {
    if (schema.has(key)) kept[key] = value;
  }
  return kept;
}

function createHarness(
  seed: Record<string, Row[]> = {},
  options: {
    /** PB accepted the call but the row never changed, N times per collection. */
    dropUpdates?: Record<string, number>;
    /** PB REJECTED the call, N times per collection. */
    rejectUpdates?: Record<string, number>;
    /** Run `fn` right before the Nth update of a collection lands. */
    onUpdate?: (name: string, rowId: string, payload: Row) => void;
  } = {},
) {
  const dropUpdates = { ...(options.dropUpdates ?? {}) };
  const rejectUpdates = { ...(options.rejectUpdates ?? {}) };
  const state: Record<string, Row[]> = {
    week_data: [],
    week_archive: [],
    consuela_data_snapshots: [],
    tasks: [],
    members: [],
    hall_of_fame: [],
    weekly_prizes: [],
    ...seed,
  };
  let sequence = 0;
  const collections: Record<string, any> = {};

  for (const name of Object.keys(state)) {
    collections[name] = {
      getFullList: async () => structuredClone(state[name]),
      getOne: async (id: string) => {
        const row = state[name].find((candidate) => candidate.id === id);
        return row ? structuredClone(row) : null;
      },
      create: async (payload: Row) => {
        const row: Row = { id: `${name}-${++sequence}`, ...declared(name, payload) };
        state[name].push(row);
        return structuredClone(row);
      },
      update: async (id: string, payload: Row) => {
        if ((rejectUpdates[name] ?? 0) > 0) {
          rejectUpdates[name] -= 1;
          throw new Error(`injected ${name} update rejection`);
        }
        options.onUpdate?.(name, id, payload);
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index < 0) throw new Error(`missing ${name} row ${id}`);
        if ((dropUpdates[name] ?? 0) > 0) {
          dropUpdates[name] -= 1;
          return structuredClone(state[name][index]);
        }
        const row = { ...state[name][index], ...declared(name, payload) };
        state[name][index] = row;
        return structuredClone(row);
      },
      delete: async (id: string) => {
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index >= 0) state[name].splice(index, 1);
        return { id };
      },
    };
  }

  const pb = {
    collection: (name: string) => {
      if (!collections[name]) throw new Error(`unexpected collection ${name}`);
      return collections[name];
    },
  };

  mocks.withAdmin.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn(pb));

  // The rollover's revision IS the snapshot's revision: a repair that writes the
  // snapshot bumps it, and a stale expectation is `rollover:changed`, not a
  // bug in the code under test.
  mocks.ensureCurrentTaskWeek.mockImplementation(async () => ({
    ...ROLLOVER_OK,
    revision: {
      revision: String(state.consuela_data_snapshots[0]?.data?.revision ?? "1"),
      updatedAt: "2026-10-05T12:00:00.000Z",
    },
  }));

  return {
    pb,
    state,
    weekRows(weekStart = WEEK): Row[] {
      return state.week_data.filter((row) => row.weekStart === weekStart);
    },
    archiveRows(weekStart?: string): Row[] {
      return weekStart
        ? state.week_archive.filter((row) => row.weekStart === weekStart)
        : state.week_archive;
    },
    snapshotData(): Row {
      return (state.consuela_data_snapshots[0]?.data ?? {}) as Row;
    },
    member(id: string): Row | undefined {
      return state.members.find((row) => row.id === id);
    },
    taskRow(taskId: number): Row | undefined {
      return state.tasks.find((row) => Number(row.taskId) === taskId);
    },
  };
}

// ─── fixtures ──────────────────────────────────────────────────────────────

function earn(id: number, member: string, amount: number, over: Row = {}): Transaction & Row {
  return {
    id,
    timestamp: `${WEEK}T12:00:0${id % 10}.000Z`,
    member,
    type: "earn",
    amount,
    description: `Completed: Chore ${id}`,
    taskId: id,
    ...over,
  };
}

function weekRow(id: string, weekStart: string, history: Row[], over: Row = {}): Row {
  return {
    id,
    weekStart,
    points: {},
    streak: {},
    lastActive: {},
    history,
    ...over,
  };
}

function snapshotRow(data: Row): Row {
  return { id: "snapshot-1", key: "tasks-snapshot", data, updated_at: "2026-10-05T12:00:00.000Z" };
}

function snapshotData(over: Row = {}): Row {
  return {
    revision: "1",
    taskWeekStart: WEEK,
    tasks: [],
    deletedTaskIds: [],
    pendingProjectionRepairs: [],
    weekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
    ...over,
  };
}

function chore(id: number, over: Row = {}): Row {
  return {
    id,
    title: `Chore ${id}`,
    assignee: OTHER_NAME,
    assigneeEmoji: "👦",
    assigned: OTHER_NAME,
    due: WEEK,
    points: 5,
    recurring: null,
    category: "chores",
    priority: "medium",
    universal: false,
    stealable: false,
    completed: false,
    completedBy: null,
    completedAt: null,
    completedInWeek: null,
    pendingApproval: null,
    sentBackAt: null,
    status: "pending",
    crewSize: null,
    crew: null,
    speedBonus: null,
    crewCloseMode: null,
    expiresAfterDays: null,
    ...over,
  };
}

/** The member names a stored week row currently attributes history to. */
function historyMembers(row: Row): string[] {
  return ((row.history ?? []) as Row[]).map((tx) => String(tx.member));
}

function roster(name: string, role: "parent" | "child" = "child"): Row {
  return { id: `pb-${name.toLowerCase().replace(/\s+/g, "-")}`, name, role, emoji: "🧒" };
}

function patchRequest(body: Row): NextRequest {
  return new NextRequest("http://localhost/api/members/admin", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROLLOVER_OK = {
  weekStart: WEEK,
  previousWeekStart: null,
  archived: false,
  tasksReset: false,
  hallOfFameRecorded: false,
  currentWeekData: { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] },
  revision: { revision: "1", updatedAt: "2026-10-05T12:00:00.000Z" },
  reconciled: true,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  __resetKeyedLockForTests();
  __resetWeekLedgerLockForTests();
  lockedWeeks.length = 0;
  mocks.authorizeAdminRequest.mockResolvedValue({ ok: true });
  mocks.isMemberPinAvailable.mockResolvedValue(true);
  mocks.ensureCurrentTaskWeek.mockResolvedValue(ROLLOVER_OK);
});

// ─── B1 — a rename must carry its ledger history ───────────────────────────

describe("B1: renaming a member migrates their ledger keys", () => {
  const currentHistory = [
    earn(101, OLD_NAME, 25),
    earn(102, OTHER_NAME, 10),
    { id: 103, timestamp: `${WEEK}T13:00:00.000Z`, member: OLD_NAME, type: "adjust", amount: -5, description: "Penalty" },
  ];
  const priorHistory = [earn(201, OLD_NAME, 30)];

  function seedLedger() {
    return {
      members: [
        { id: MEMBER_ID, name: OLD_NAME, role: "child", emoji: "🧒" },
        { id: "pb-sibling", name: OTHER_NAME, role: "child", emoji: "👧" },
      ],
      week_data: [
        weekRow("wd-current", WEEK, currentHistory, {
          points: { [OLD_NAME]: 20, [OTHER_NAME]: 10 },
          streak: { [OLD_NAME]: 3, [OTHER_NAME]: 1 },
          lastActive: { [OLD_NAME]: `${WEEK}T13:00:00.000Z` },
        }),
        weekRow("wd-prior", PRIOR_WEEK, priorHistory, {
          points: { [OLD_NAME]: 30 },
          streak: { [OLD_NAME]: 2 },
          lastActive: { [OLD_NAME]: `${PRIOR_WEEK}T13:00:00.000Z` },
        }),
      ],
      week_archive: [
        weekRow("wa-prior", PRIOR_WEEK, priorHistory, {
          archivedAt: `${WEEK}T00:00:00.000Z`,
          points: { [OLD_NAME]: 30 },
          streak: { [OLD_NAME]: 2 },
          lastActive: { [OLD_NAME]: `${PRIOR_WEEK}T13:00:00.000Z` },
        }),
      ],
      consuela_data_snapshots: [
        snapshotRow(snapshotData({
          weekData: {
            weekStart: WEEK,
            points: { [OLD_NAME]: 20, [OTHER_NAME]: 10 },
            streak: { [OLD_NAME]: 3 },
            lastActive: { [OLD_NAME]: `${WEEK}T13:00:00.000Z` },
            history: currentHistory,
          },
        })),
      ],
    };
  }

  function renameRequest() {
    return patchRequest({ id: MEMBER_ID, patch: { name: NEW_NAME } });
  }

  it("moves balance, streak, lastActive and history to the new name in every store", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ member: { name: NEW_NAME } });
    expect(harness.member(MEMBER_ID)?.name).toBe(NEW_NAME);

    for (const row of [...harness.weekRows(), ...harness.archiveRows()]) {
      expect(Object.keys(row.points)).not.toContain(OLD_NAME);
      expect(row.history.every((tx: Row) => tx.member !== OLD_NAME)).toBe(true);
      expect(row.history.map((tx: Row) => tx.member)).toContain(NEW_NAME);
      expect(row.streak).not.toHaveProperty(OLD_NAME);
      expect(row.lastActive).not.toHaveProperty(OLD_NAME);
      expect(row.streak).toHaveProperty(NEW_NAME);
      expect(row.lastActive).toHaveProperty(NEW_NAME);
    }

    const snapshotWeek = harness.snapshotData().weekData as Row;
    expect(Object.keys(snapshotWeek.points)).not.toContain(OLD_NAME);
    expect(snapshotWeek.history.every((tx: Row) => tx.member !== OLD_NAME)).toBe(true);
    expect(snapshotWeek.points).toEqual({ [NEW_NAME]: 20, [OTHER_NAME]: 10 });
  });

  it("leaves the member's displayed total unchanged by the rename", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const before = recomputeWeekPoints(harness.weekRows()[0].history as any)[OLD_NAME];
    const res = await PATCH(renameRequest());

    expect(res.status).toBe(200);
    const after = recomputeWeekPoints(harness.weekRows()[0].history as any)[NEW_NAME];
    expect(before).toBe(20);
    expect(after).toBe(20);
    // The negative-balance gate reads the recomputed map, so the renamed
    // member's balance is still visible to it (an orphaned key reads `undefined`).
    expect(computeMemberBalances(harness.weekRows()[0].history as any)).toHaveProperty(NEW_NAME, 20);
    expect(computeMemberBalances(harness.weekRows()[0].history as any)).not.toHaveProperty(OLD_NAME);
  });

  it("migrates under the week-ledger lock, once per week, and never derives a new week key", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(200);
    // The stored rows are the only week-key authority: the current week and the
    // prior week, each held while it is migrated.
    expect([...new Set(lockedWeeks)].sort()).toEqual([PRIOR_WEEK, WEEK]);
    expect(harness.weekRows(WEEK)).toHaveLength(1);
    expect(harness.weekRows(PRIOR_WEEK)).toHaveLength(1);
    expect(harness.archiveRows().map((row) => row.weekStart)).toEqual([PRIOR_WEEK]);
  });

  it("is all-or-nothing per week: a mid-migration rejection leaves NO partially-migrated week", async () => {
    // Two rows for the current week: the first update lands, the second is
    // rejected, so the rollback must put BOTH rows back under the old name.
    const harness = createHarness({
      ...seedLedger(),
      week_data: [
        weekRow("wd-current", WEEK, currentHistory, { points: { [OLD_NAME]: 20 }, streak: { [OLD_NAME]: 3 } }),
        weekRow("wd-current-dup", WEEK, currentHistory, { points: { [OLD_NAME]: 20 }, streak: { [OLD_NAME]: 3 } }),
        weekRow("wd-prior", PRIOR_WEEK, priorHistory, { points: { [OLD_NAME]: 30 } }),
      ],
    }, { rejectUpdates: { week_data: 1 } });
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "ledger_rename_failed" });
    // No half-migrated week: every current-week row is back to the old name.
    for (const row of harness.weekRows(WEEK)) {
      expect(row.points).toEqual({ [OLD_NAME]: 20 });
      expect(historyMembers(row)).not.toContain(NEW_NAME);
      expect(historyMembers(row)).toContain(OLD_NAME);
      expect(historyMembers(row)).toContain(OTHER_NAME);
    }
    // The roster was never rewritten, so the member still resolves by old name.
    expect(harness.member(MEMBER_ID)?.name).toBe(OLD_NAME);
  });

  it("rolls the whole rename back when PocketBase silently drops the write", async () => {
    const harness = createHarness(seedLedger(), { dropUpdates: { week_data: 1 } });
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "ledger_rename_failed" });
    for (const row of [...harness.weekRows(), ...harness.archiveRows()]) {
      expect(historyMembers(row)).not.toContain(NEW_NAME);
      expect(historyMembers(row)).toContain(OLD_NAME);
    }
    expect(harness.member(MEMBER_ID)?.name).toBe(OLD_NAME);
  });

  it("refuses a rename onto a name that already has ledger history and touches nothing", async () => {
    const harness = createHarness({
      ...seedLedger(),
      week_data: [
        weekRow("wd-current", WEEK, [...currentHistory, earn(104, NEW_NAME, 40)], {
          points: { [OLD_NAME]: 20, [NEW_NAME]: 40 },
          streak: {},
        }),
        weekRow("wd-prior", PRIOR_WEEK, priorHistory, { points: { [OLD_NAME]: 30 } }),
      ],
      // The roster has no such member — only the ledger remembers the name.
      members: [
        { id: MEMBER_ID, name: OLD_NAME, role: "child", emoji: "🧒" },
        { id: "pb-sibling", name: OTHER_NAME, role: "child", emoji: "👧" },
      ],
    });
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ledger_name_conflict" });
    // Both balances are untouched.
    expect(harness.weekRows(WEEK)[0].points).toEqual({ [OLD_NAME]: 20, [NEW_NAME]: 40 });
    expect(harness.weekRows(WEEK)[0].history.filter((tx: Row) => tx.member === NEW_NAME)).toHaveLength(1);
    expect(harness.weekRows(PRIOR_WEEK)[0].points).toEqual({ [OLD_NAME]: 30 });
    expect(harness.member(MEMBER_ID)?.name).toBe(OLD_NAME);
    expect(harness.snapshotData().weekData).toMatchObject({ points: { [OLD_NAME]: 20, [OTHER_NAME]: 10 } });
  });

  it("writes nothing for a no-op rename", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const before = {
      week: JSON.stringify(harness.weekRows()),
      archive: JSON.stringify(harness.archiveRows()),
      snapshot: JSON.stringify(harness.snapshotData()),
    };
    const res = await PATCH(patchRequest({ id: MEMBER_ID, patch: { name: `  ${OLD_NAME}  ` } }));

    expect(res.status).toBe(200);
    expect(JSON.stringify(harness.weekRows())).toBe(before.week);
    expect(JSON.stringify(harness.archiveRows())).toBe(before.archive);
    expect(JSON.stringify(harness.snapshotData())).toBe(before.snapshot);
    expect(lockedWeeks).toEqual([]);
  });

  it("does not migrate a member that is only getting an emoji", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(patchRequest({ id: MEMBER_ID, patch: { emoji: "🦊" } }));

    expect(res.status).toBe(200);
    expect(harness.member(MEMBER_ID)?.emoji).toBe("🦊");
    expect(historyMembers(harness.weekRows()[0])).toContain(OLD_NAME);
    expect(historyMembers(harness.weekRows()[0])).not.toContain(NEW_NAME);
    expect(lockedWeeks).toEqual([]);
  });

  it("keeps the parent-only authorization gate in front of the rename", async () => {
    mocks.authorizeAdminRequest.mockResolvedValue({ ok: false, status: 403, error: "adult_only" });
    const harness = createHarness(seedLedger());

    const res = await PATCH(renameRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "adult_only" });
    expect(harness.member(MEMBER_ID)?.name).toBe(OLD_NAME);
    expect(mocks.findLiveMemberById).not.toHaveBeenCalled();
  });

  it("still rejects a roster duplicate before any ledger write", async () => {
    const harness = createHarness(seedLedger());
    mocks.findLiveMemberById.mockResolvedValue({ id: MEMBER_ID, name: OLD_NAME, role: "child" });

    const res = await PATCH(patchRequest({ id: MEMBER_ID, patch: { name: "SIBLING" } }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate" });
    expect(harness.member(MEMBER_ID)?.name).toBe(OLD_NAME);
    expect(lockedWeeks).toEqual([]);
  });
});

describe("B1: migrateWeekDataMemberName (pure ledger-key migration)", () => {
  const week: WeekData = {
    weekStart: WEEK,
    points: { [OLD_NAME]: 20, [OTHER_NAME]: 10 },
    streak: { [OLD_NAME]: 3 },
    lastActive: { [OLD_NAME]: `${WEEK}T12:00:00.000Z` },
    history: [earn(101, OLD_NAME, 25), earn(102, OTHER_NAME, 10)],
  };

  it("rewrites history keys and recomputes points from history, never from the stored map", () => {
    const stale = { ...week, points: { [OLD_NAME]: 999 } };

    const outcome = migrateWeekDataMemberName(stale, OLD_NAME, NEW_NAME);

    expect(outcome).toMatchObject({ status: "migrated" });
    const migrated = (outcome as { week: WeekData }).week;
    expect(migrated.points).toEqual({ [NEW_NAME]: 25, [OTHER_NAME]: 10 });
    expect(migrated.history.map((tx) => tx.member)).toEqual([NEW_NAME, OTHER_NAME]);
    expect(migrated.streak).toEqual({ [NEW_NAME]: 3 });
    expect(migrated.lastActive).toEqual({ [NEW_NAME]: `${WEEK}T12:00:00.000Z` });
  });

  it("reports a target name that already holds history as a conflict", () => {
    const occupied: WeekData = {
      ...week,
      history: [...week.history, earn(104, NEW_NAME, 40)],
      points: { [OLD_NAME]: 20, [NEW_NAME]: 40 },
    };

    expect(migrateWeekDataMemberName(occupied, OLD_NAME, NEW_NAME)).toMatchObject({ status: "conflict" });
  });

  it("reports a week with nothing under the old name as unchanged", () => {
    expect(migrateWeekDataMemberName(week, "Nobody", NEW_NAME)).toMatchObject({ status: "unchanged" });
  });

  it("treats a bare zero points key as no history and still migrates cleanly", () => {
    const phantom: WeekData = { ...week, points: { [OLD_NAME]: 20, [NEW_NAME]: 0 } };

    const outcome = migrateWeekDataMemberName(phantom, OLD_NAME, NEW_NAME);

    expect(outcome).toMatchObject({ status: "migrated" });
    expect((outcome as { week: WeekData }).week.points).toEqual({ [NEW_NAME]: 25, [OTHER_NAME]: 10 });
  });
});

// ─── B2 — one malformed crew must not brick the family's board ─────────────

function reconcileHarness(options: {
  snapshot: Row;
  taskRows?: Row[];
  weekRows?: Row[];
  archiveRows?: Row[];
} ) {
  return createHarness({
    week_data: options.weekRows ?? [weekRow("wd-current", WEEK, [])],
    week_archive: options.archiveRows ?? [],
    consuela_data_snapshots: [snapshotRow(options.snapshot)],
    tasks: options.taskRows ?? [],
    members: [roster(OTHER_NAME), roster("Parent Test", "parent")],
  });
}

describe("B2: a malformed crew is quarantined instead of failing the whole pass", () => {
  // PB coerces a json field to text on some paths, so `crew` reaches the
  // canonical snapshot as a string that is NOT valid JSON.
  const MALFORMED = "{not json at all";

  it("still reconciles every other task and returns ok, reporting the malformed one as a warning", async () => {
    const good = chore(5);
    const broken = chore(6, { crewSize: 2, crew: MALFORMED });
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [good, broken] }),
      taskRows: [
        { ...chore(5), id: "pb-5", taskId: 5, title: "stale" },
        { ...chore(6), id: "pb-6", taskId: 6, crew: MALFORMED },
      ],
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.failed).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("task:6:crew_quarantined");
    // The healthy task still projected, and the quarantined one's PB row was
    // rewritten to match the repaired canonical crew.
    expect(harness.taskRow(5)?.title).toBe("Chore 5");
    expect(result.repaired).toEqual(expect.arrayContaining([
      "task:5:projection",
      "task:6:crew_quarantined",
      "task:6:crew",
    ]));
  });

  it("actually nulls the malformed crew in the snapshot, so the next pass is clean", async () => {
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [chore(5), chore(6, { crewSize: 2, crew: MALFORMED })] }),
      taskRows: [{ ...chore(5), id: "pb-5", taskId: 5 }, { ...chore(6), id: "pb-6", taskId: 6, crew: MALFORMED }],
    });

    const first = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(first.ok).toBe(true);
    expect((harness.snapshotData().tasks as Row[]).find((row) => row.id === 6)?.crew).toBeNull();
    expect(harness.taskRow(6)?.crew).toBeNull();

    const second = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(second.ok).toBe(true);
    expect(second.warnings).not.toContain("task:6:crew_quarantined");
    expect(second.repaired).toEqual([]);
  });

  it("quarantines a malformed crew that is an object with no members array", async () => {
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [chore(5), chore(7, { crew: { members: "everyone" } })] }),
      taskRows: [{ ...chore(5), id: "pb-5", taskId: 5 }, { ...chore(7), id: "pb-7", taskId: 7 }],
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("task:7:crew_quarantined");
    expect((harness.snapshotData().tasks as Row[]).find((row) => row.id === 7)?.crew).toBeNull();
  });

  it("quarantines inside a scoped, operation-keyed pass too", async () => {
    const operationId = "op-quarantine-scope";
    const harness = reconcileHarness({
      snapshot: snapshotData({
        tasks: [chore(6, { crew: MALFORMED })],
        operationReceipts: { [operationId]: [{ operationId, action: "penalty", taskId: 6, createdAt: `${WEEK}T10:00:00.000Z` }] },
        pendingProjectionRepairs: [{ operationId, taskIds: [6], action: "penalty", createdAt: `${WEEK}T10:01:00.000Z` }],
      }),
      taskRows: [{ ...chore(6), id: "pb-6", taskId: 6, crew: MALFORMED }],
    });

    const result = await reconcileTaskProjectionLocked(harness.pb as any, {
      weekStart: WEEK,
      operationId,
      taskIds: [6],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("task:6:crew_quarantined");
    expect((harness.snapshotData().tasks as Row[])[0].crew).toBeNull();
    // The marker is consumed only because the projection is now provable.
    expect(harness.snapshotData().pendingProjectionRepairs).toEqual([]);
  });

  it("does NOT quarantine a tombstoned task — a deleted task has no crew to repair", async () => {
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [chore(5)], deletedTaskIds: [8] }),
      taskRows: [{ ...chore(5), id: "pb-5", taskId: 5 }],
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("B2 regression: the reconciler's own guarantees survive the quarantine", () => {
  /**
   * A non-approval marker (a `penalty` receipt exists, so `approvalMarker` is
   * false) puts a task id in scope through the projection path — the only way
   * an id with no live row and no PB row is ever examined at all.
   */
  function staleMarkerSnapshot(taskId: number, operationId: string): Row {
    return snapshotData({
      operationReceipts: {
        [operationId]: [{ operationId, action: "penalty", taskId, createdAt: `${WEEK}T10:00:00.000Z` }],
      },
      pendingProjectionRepairs: [
        { operationId, taskIds: [taskId], action: "penalty", createdAt: `${WEEK}T10:01:00.000Z` },
      ],
    });
  }

  it("still requires a tombstone for an id with no live row and zero PB rows", async () => {
    const operationId = "op-stale-task";
    const tombstoned = reconcileHarness({
      snapshot: { ...staleMarkerSnapshot(9, operationId), deletedTaskIds: [9] },
      taskRows: [],
    });

    const proven = await reconcileTaskProjection({ pb: tombstoned.pb as any, weekStart: WEEK });

    expect(proven.ok).toBe(true);
    expect(proven.failed).toEqual([]);
    expect(proven.repaired).toEqual(expect.arrayContaining(["projection:marker"]));
    expect(tombstoned.snapshotData().pendingProjectionRepairs).toEqual([]);

    const orphan = reconcileHarness({
      snapshot: staleMarkerSnapshot(9, operationId),
      taskRows: [],
    });

    const unproven = await reconcileTaskProjection({ pb: orphan.pb as any, weekStart: WEEK });

    // Without the tombstone the id is in no store at all, so the pass cannot
    // prove the deletion: it refuses (the id set no longer matches the one it
    // discovered) and the marker is NEVER consumed. A PB row is never invented
    // for it either, so a delete is not resurrected.
    expect(unproven.ok).toBe(false);
    expect(unproven.reconciled).toBe(false);
    expect(unproven.failed.length).toBeGreaterThan(0);
    expect(orphan.snapshotData().pendingProjectionRepairs).toHaveLength(1);
    expect(orphan.state.tasks).toHaveLength(0);
  });

  it("still aborts on ambiguous duplicate live task ids so a delete is never resurrected", async () => {
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [chore(5, { title: "First" }), chore(5, { title: "Second" })] }),
      taskRows: [{ ...chore(5), id: "pb-5", taskId: 5 }],
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.ok).toBe(false);
    expect(result.failed).toContain("task:5:ambiguous");
    expect(harness.state.tasks).toHaveLength(1);
    expect(harness.taskRow(5)?.title).toBe("Chore 5");
  });

  it("still detects a concurrent writer through the finalStateChanged guard", async () => {
    const harness = reconcileHarness({
      snapshot: snapshotData({ tasks: [chore(5)] }),
      taskRows: [{ ...chore(5), id: "pb-5", taskId: 5 }],
    });
    let weekReads = 0;
    const original = harness.pb.collection;
    harness.pb.collection = ((name: string) => {
      const collection = original(name);
      if (name !== "week_data") return collection;
      return {
        ...collection,
        getFullList: async () => {
          const rows = await collection.getFullList();
          weekReads += 1;
          if (weekReads === 2) rows[0].streak = { [OTHER_NAME]: 99 };
          return rows;
        },
      };
    }) as any;

    const result = await reconcileTaskProjectionLocked(harness.pb as any, { weekStart: WEEK, taskIds: [5] });

    expect(result.ok).toBe(false);
    expect(result.failed).toContain("tasks:changed");
  });
});

// ─── B3 — a dropped duplicate earn must be observable ──────────────────────

describe("B3: mergeCanonicalTransactions reports the duplicate earns it drops", () => {
  it("reports the dropped duplicate earn and keeps the survivor", () => {
    // Two transaction ids paying the SAME (task, member) — the duplicate shape.
    const history = [earn(101, OTHER_NAME, 5), earn(102, OTHER_NAME, 5, { taskId: 101 })];

    const report = mergeCanonicalTransactionsWithReport([history]);

    expect(report.history.map((tx) => tx.id)).toEqual([101]);
    expect(report.droppedDuplicateEarns).toHaveLength(1);
    expect(report.droppedDuplicateEarns[0]).toMatchObject({
      taskId: 101,
      member: OTHER_NAME,
      amount: 5,
      transactionId: 102,
      retainedTransactionId: 101,
    });
  });

  it("keeps mergeCanonicalTransactions byte-identical for the existing callers", () => {
    const history = [earn(101, OTHER_NAME, 5), earn(102, OTHER_NAME, 5, { taskId: 101 })];
    const sameIdTwice = [earn(101, OTHER_NAME, 5), earn(101, OTHER_NAME, 5)];
    const reversalThenEarn = [
      earn(101, OTHER_NAME, 5),
      { id: 103, timestamp: `${WEEK}T14:00:00.000Z`, member: OTHER_NAME, type: "adjust" as const, amount: -5, description: "Undo", taskId: 101 },
      earn(104, OTHER_NAME, 5, { taskId: 101, timestamp: `${WEEK}T15:00:00.000Z` }),
    ];

    expect(mergeCanonicalTransactions([history])).toEqual(mergeCanonicalTransactionsWithReport([history]).history);
    // A repeated transaction ID is an idempotent union, never a "drop".
    expect(mergeCanonicalTransactionsWithReport([sameIdTwice]).droppedDuplicateEarns).toHaveLength(0);
    expect(mergeCanonicalTransactions([sameIdTwice])).toHaveLength(1);
    // A re-earn AFTER the reversal is a standing payment again and is kept.
    expect(mergeCanonicalTransactions([reversalThenEarn]).map((tx) => tx.id)).toEqual([101, 103, 104]);
    expect(mergeCanonicalTransactionsWithReport([reversalThenEarn]).droppedDuplicateEarns).toHaveLength(0);
  });

  it("still throws on two transactions that disagree about the content of one id", () => {
    expect(() => mergeCanonicalTransactions([
      [earn(101, OTHER_NAME, 5)],
      [{ ...earn(101, OTHER_NAME, 5), amount: 9 }],
    ])).toThrow(TypeError);
  });

  it("surfaces the drop as a reconcile warning instead of a silent points change", async () => {
    const first = earn(301, OTHER_NAME, 5);
    const duplicate = earn(301, OTHER_NAME, 5, { id: 302, taskId: 301 });
    const harness = reconcileHarness({
      snapshot: snapshotData(),
      weekRows: [
        weekRow("wd-primary", WEEK, [first], { points: { [OTHER_NAME]: 5 } }),
        weekRow("wd-duplicate", WEEK, [duplicate], { points: { [OTHER_NAME]: 5 } }),
      ],
    });

    const result = await reconcileTaskProjection({ pb: harness.pb as any, weekStart: WEEK });

    expect(result.warnings).toContain("week:dropped_duplicate_earn:301:302");
    // The duplicate is gone from the persisted week AND reported, so the
    // family's real (wrong) balance is distinguishable from a repaired one.
    expect(harness.weekRows()).toHaveLength(1);
    expect((harness.weekRows()[0].history as Row[]).map((tx) => tx.id)).toEqual([301]);
  });
});

describe("B3 regression: wave 1's mergedArchiveWeek union is still lossless", () => {
  it("keeps an archive-only transaction and does not double-count a duplicated archive", async () => {
    const actual = await vi.importActual<typeof import("@/lib/task-week-rollover")>("@/lib/task-week-rollover");
    const priorOnly = {
      id: 401,
      timestamp: `${PRIOR_WEEK}T12:00:00.000Z`,
      member: OLD_NAME,
      type: "earn" as const,
      amount: 12,
      description: "Completed: Archived only",
      taskId: 11,
    };
    const both = {
      id: 402,
      timestamp: `${PRIOR_WEEK}T13:00:00.000Z`,
      member: OLD_NAME,
      type: "earn" as const,
      amount: 8,
      description: "Completed: Both sides",
      taskId: 12,
    };
    const harness = createHarness({
      week_data: [weekRow("wd-prior", PRIOR_WEEK, [priorOnly, both])],
      week_archive: [
        weekRow("wa-prior", PRIOR_WEEK, [both], { archivedAt: `${WEEK}T00:00:00.000Z` }),
      ],
      consuela_data_snapshots: [snapshotRow(snapshotData({ taskWeekStart: WEEK }))],
    });

    const result = await actual.ensureCurrentTaskWeek({ now: new Date(`${WEEK}T06:00:00.000Z`) });

    expect(result.reconciled).toBe(true);
    const archived = harness.archiveRows(PRIOR_WEEK)[0];
    expect((archived.history as Row[]).map((tx) => tx.id).sort((a, b) => a - b)).toEqual([401, 402]);
    expect(archived.points).toEqual({ [OLD_NAME]: 20 });
  });
});