// @vitest-environment jsdom
// Pointed regression suite for the week-integrity audit (B1–B8).
//
// Every test here pins ONE verified bug from the audit, plus the contracts the
// fixes must not break (rollover idempotency, weekend freezing, the double
// regeneration gate, the `taskResetMatches` clone contract, zero-point weeks,
// and the Hall of Fame 12-distinct-week trim).
//
// The PocketBase fake is deliberately STRICT: `create`/`update` drop any key
// the collection's `pb-seed.ts` schema does not declare. A permissive fake
// (the sibling rollover harness keeps every key) is exactly why B6 — a
// `lastActive` that `week_payload()` writes to `week_archive` but the seed
// never creates — was invisible to 5846 green tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotTask } from "@/lib/snapshot-tasks";
import { COLLECTIONS } from "@/lib/pb-seed";

process.env.TZ = "America/Detroit";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));
const snapshotStore = vi.hoisted(() => ({
  data: null as any,
  revision: "1",
  rowId: "snapshot-1" as string | null,
}));
const lockLog = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

// Keep the REAL keyed mutex (the B3 lock-order pin needs real mutual
// exclusion) but record every key so the order itself is assertable.
vi.mock("@/lib/week-ledger-lock", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/week-ledger-lock")>();
  return {
    ...real,
    withWeekLedgerLock: (week: string, fn: () => Promise<unknown>) => {
      lockLog.keys.push(week);
      return real.withWeekLedgerLock(week, fn);
    },
  };
});

vi.mock("@/lib/snapshot-tasks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/snapshot-tasks")>();
  return {
    ...real,
    readSnapshotWithRevision: async () => ({
      rowId: snapshotStore.rowId,
      data: snapshotStore.data,
      revision: { revision: snapshotStore.revision, updatedAt: "2026-10-05T12:00:00.000Z" },
    }),
    mutateSnapshotWithMeta: async (fn: (data: any) => { data: any; result: any }, _pb?: unknown) => {
      const out = fn(snapshotStore.data);
      snapshotStore.data = out.data;
      snapshotStore.revision = String(Number(snapshotStore.revision) + 1);
      return {
        data: out.data,
        revision: { revision: snapshotStore.revision, updatedAt: "2026-10-05T12:00:00.000Z" },
        result: out.result,
      };
    },
  };
});

import { ensureCurrentTaskWeek, resetRecurringTasksForWeek } from "@/lib/task-week-rollover";
import { ensureCurrentTaskDay, regenerateRecurringOnTasks } from "@/lib/task-day-sweep";
import { ensureArchivedWeeksEnshrined } from "@/lib/hall-of-fame-backfill";
import { buildAllTimeTotals } from "@/lib/all-time-totals";
import { withWeekLedgerLock, __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";
import { DEFAULT_WEEKLY_PRIZES, archiveWeekWinner, loadHallOfFame, saveHallOfFame } from "@/lib/task-utils";

type Row = Record<string, any>;

const OLDEST = "2026-09-07";
const PRIOR = "2026-09-21";
const PREV = "2026-09-28";
const CURRENT = "2026-10-05";

/** Monday 09:00 America/Detroit. */
const mondayMorning = (week: string): Date => {
  const monday = new Date(`${week}T13:00:00.000Z`);
  if (Number.isNaN(monday.getTime())) throw new Error(`bad week ${week}`);
  return monday;
};

// ─── PocketBase fake ────────────────────────────────────────────────────────

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

function createHarness(seed: Record<string, Row[]> = {}, options: { dropUpdates?: Record<string, number> } = {}) {
  const dropUpdates = { ...(options.dropUpdates ?? {}) };
  const state: Record<string, Row[]> = {
    week_data: [],
    week_archive: [],
    hall_of_fame: [],
    members: [{ id: "member-1", name: "Alex", emoji: "🦊", role: "parent" }],
    weekly_prizes: [{ id: "prize-1", rank: 1, emoji: "🥇", text: DEFAULT_WEEKLY_PRIZES[0].text }],
    ...seed,
  };
  const calls: Record<string, Row[]> = {};
  const call = (name: string): Row[] => (calls[name] ||= []);
  const deletes: Record<string, string[]> = {};
  const record = (name: string) => (deletes[name] ||= []);
  let sequence = 0;
  const collections: Record<string, any> = {};
  const events: string[] = [];

  for (const name of Object.keys(state)) {
    collections[name] = {
      getFullList: async () => {
        events.push(`read:${name}`);
        return structuredClone(state[name]);
      },
      getOne: async (id: string) => {
        const row = state[name].find((candidate) => candidate.id === id);
        return row ? structuredClone(row) : null;
      },
      create: async (payload: Row) => {
        const row: Row = { id: `${name}-${++sequence}`, ...declared(name, payload) };
        state[name].push(row);
        call(name).push(structuredClone(row));
        events.push(`create:${name}:${row.weekStart ?? ""}`);
        return structuredClone(row);
      },
      update: async (id: string, payload: Row) => {
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index < 0) throw new Error(`missing ${name} row ${id}`);
        const row = { ...state[name][index], ...declared(name, payload) };
        if ((dropUpdates[name] ?? 0) > 0) {
          // PocketBase accepted the call but the row never changed.
          dropUpdates[name] -= 1;
          return structuredClone(state[name][index]);
        }
        state[name][index] = row;
        call(name).push(structuredClone(row));
        events.push(`update:${name}:${row.weekStart ?? ""}`);
        return structuredClone(row);
      },
      delete: async (id: string) => {
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index >= 0) state[name].splice(index, 1);
        record(name).push(id);
        events.push(`delete:${name}:${id}`);
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

  return {
    pb,
    state,
    calls,
    deletes,
    events,
    weekData(weekStart: string): Row[] {
      return state.week_data.filter((row) => row.weekStart === weekStart);
    },
    archiveIds(weekStart: string): number[] {
      return state.week_archive
        .filter((row) => row.weekStart === weekStart)
        .flatMap((row) => (row.history ?? []).map((tx: Row) => tx.id));
    },
    snapshotData(): Row {
      return snapshotStore.data ?? {};
    },
    snapshotTasks(): SnapshotTask[] {
      const data = snapshotStore.data ?? {};
      const dead = new Set((data.deletedTaskIds ?? []).map(Number));
      return ((data.tasks ?? []) as SnapshotTask[]).filter((task) => !dead.has(Number(task.id)));
    },
  };
}

function earn(id: number, member: string, amount: number, taskId: number, timestamp: string, description = "Completed: Dishes"): Row {
  return { id, timestamp, member, type: "earn", amount, description, taskId };
}

function weekRow(weekStart: string, history: Row[], over: Partial<Row> = {}): Row {
  return {
    id: `wd-${weekStart}`,
    weekStart,
    points: {},
    streak: {},
    lastActive: {},
    history,
    ...over,
  };
}

function seedSnapshot(taskWeekStart: string, tasks: SnapshotTask[] = [], over: Row = {}) {
  snapshotStore.data = {
    revision: snapshotStore.revision,
    taskWeekStart,
    weekData: { weekStart: taskWeekStart, points: {}, streak: {}, lastActive: {}, history: [] },
    tasks,
    deletedTaskIds: [],
    ...over,
  };
  snapshotStore.rowId = "snapshot-1";
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.withAdmin.mockReset();
  __resetWeekLedgerLockForTests();
  lockLog.keys.length = 0;
  snapshotStore.data = null;
  snapshotStore.revision = "1";
  snapshotStore.rowId = "snapshot-1";
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ─── B1 — the day sweep culled before it closed deadline crews ──────────────

function crewTask(over: Row = {}): SnapshotTask {
  return {
    id: 11,
    title: "Garage reset",
    assignee: "Crew",
    assigneeEmoji: "🤝",
    due: "2026-10-01",
    points: 15,
    recurring: null,
    category: "chores",
    priority: "medium",
    completed: false,
    crewSize: 2,
    crewCloseMode: "deadline",
    crew: {
      members: [
        { name: "Alex", emoji: "🦊", joinedAt: "2026-10-01T12:00:00.000Z", checkedInAt: "2026-10-03T15:00:00.000Z" },
        { name: "Bailey", emoji: "👧", joinedAt: "2026-10-01T12:00:00.000Z", checkedInAt: "2026-10-03T15:00:00.000Z" },
      ],
      removed: [],
    },
    ...over,
  } as unknown as SnapshotTask;
}

describe("B1 — the day sweep closes deadline crews BEFORE the expiry cull", () => {
  it("pays a deadline crew that checked in after its expiry instead of tombstoning it", async () => {
    const harness = createHarness();
    seedSnapshot(PREV, [crewTask({ expiresAfterDays: 1 }) as SnapshotTask]);
    await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    const result = await ensureCurrentTaskDay({ now: mondayMorning(CURRENT) });

    expect(result.swept).toBe(true);
    expect(result.closedTaskIds).toEqual([11]);
    expect(result.reconciled).toBe(true);
    const stored = harness.snapshotTasks().find((task) => Number(task.id) === 11) as Row;
    expect(stored.completed).toBe(true);
    expect(stored.pendingApproval).toMatchObject({ byName: "Crew", crew: ["Alex", "Bailey"] });
    expect(harness.snapshotData().deletedTaskIds).not.toContain(11);
  });

  it("still culls a genuinely expired non-crew task (the stage order swap is not a cull amnesty)", async () => {
    const harness = createHarness();
    seedSnapshot(PREV, [
      {
        id: 21,
        title: "Take out recycling",
        assignee: "Alex",
        assigneeEmoji: "🦊",
        due: "2026-09-28",
        points: 3,
        recurring: null,
        category: "chores",
        priority: "medium",
        completed: false,
        expiresAfterDays: 2,
      } as unknown as SnapshotTask,
    ]);
    await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    const result = await ensureCurrentTaskDay({ now: mondayMorning(CURRENT) });

    expect(result.closedTaskIds).toEqual([]);
    expect(result.reconciled).toBe(true);
    expect(harness.snapshotData().deletedTaskIds).toContain(21);
    expect(harness.snapshotTasks().some((task) => Number(task.id) === 21)).toBe(false);
  });
});

// ─── B2 — the rollover archived at most one prior week ──────────────────────

describe("B2 — every week_data row older than the current week is archived", () => {
  it("archives BOTH skipped older weeks and all-time then counts both", async () => {
    const harness = createHarness({
      week_data: [
        weekRow(OLDEST, [earn(1, "Alex", 10, 1, "2026-09-08T10:00:00.000Z")]),
        weekRow(PRIOR, [earn(2, "Alex", 50, 2, "2026-09-22T10:00:00.000Z")]),
      ],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.reconciled).toBe(true);
    expect(result.archived).toBe(true);
    expect(result.previousWeekStart).toBe(PRIOR);
    expect(harness.state.week_archive.map((row) => row.weekStart).sort()).toEqual([OLDEST, PRIOR]);
    expect(harness.weekData(CURRENT)).toHaveLength(1);

    const payload = buildAllTimeTotals(
      { weekStart: CURRENT, points: {}, streak: {}, lastActive: {}, history: [] } as any,
      harness.state.week_archive.map((row) => ({
        weekStart: row.weekStart,
        archivedAt: row.archivedAt,
        history: row.history,
        points: row.points,
      })),
      ["Alex"],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals.Alex).toEqual({ points: 60, completions: 2 });
  });

  it("reports an honest unknown while any older week is still un-archived", () => {
    const payload = buildAllTimeTotals(
      { weekStart: CURRENT, points: {}, streak: {}, lastActive: {}, history: [] } as any,
      [{ weekStart: PRIOR, history: [earn(2, "Alex", 50, 2, "2026-09-22T10:00:00.000Z")] }],
      ["Alex"],
      [OLDEST],
    );
    expect(payload.historyComplete).toBe(false);
    expect(payload.totals.Alex).toEqual({ points: null, completions: null });
  });

  it("stays complete when every older week is archived (no false unknown)", () => {
    const payload = buildAllTimeTotals(
      { weekStart: CURRENT, points: {}, streak: {}, lastActive: {}, history: [] } as any,
      [{ weekStart: PRIOR, history: [earn(2, "Alex", 50, 2, "2026-09-22T10:00:00.000Z")] }],
      ["Alex"],
      [],
    );
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals.Alex).toEqual({ points: 50, completions: 1 });
  });
});

// ─── B3 — the archive repair path destroyed archive-only transactions ──────

describe("B3 — the archive repair keeps every transaction on either side", () => {
  it("keeps an archive transaction that exists only in week_archive", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
      week_archive: [
        {
          id: "archive-1",
          weekStart: PREV,
          points: { Alex: 12 },
          streak: {},
          lastActive: {},
          archivedAt: "2026-10-05T13:00:00.000Z",
          history: [
            earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z"),
            earn(105, "Alex", 7, 77, "2026-09-28T23:59:59.900Z"),
          ],
        },
      ],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.reconciled).toBe(true);
    const archived = harness.state.week_archive.filter((row) => row.weekStart === PREV);
    expect(archived).toHaveLength(1);
    expect(harness.archiveIds(PREV).sort()).toEqual([101, 105]);
    expect(archived[0].points).toEqual({ Alex: 12 });
    expect(harness.deletes.week_archive ?? []).toHaveLength(0);
  });

  it("does not double-count a duplicate earn of the same task when the two sides disagree", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
      week_archive: [
        {
          id: "archive-1",
          weekStart: PREV,
          points: { Alex: 7 },
          streak: {},
          lastActive: {},
          archivedAt: "2026-10-05T13:00:00.000Z",
          history: [earn(901, "Alex", 7, 1, "2026-09-28T20:00:00.000Z", "Stale")],
        },
      ],
    });
    seedSnapshot(PREV);

    await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    const archived = harness.state.week_archive.filter((row) => row.weekStart === PREV);
    expect(harness.archiveIds(PREV)).toEqual([101]);
    expect(archived[0].points).toEqual({ Alex: 5 });
  });

  it("archives a claim that lands at Sun 23:59:59.9 while the rollover runs at Mon 00:00:01", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
    });
    seedSnapshot(PREV);
    const late = earn(105, "Alex", 7, 77, "2026-10-04T23:59:59.900Z");

    // A late claim holds the OLDER week's ledger lock (that is the week it
    // writes) and commits its append well after the rollover has started.
    const lateClaim = withWeekLedgerLock(PREV, async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const row = harness.weekData(PREV)[0];
      row.history = [...row.history, late];
      row.points = { Alex: 12 };
    });
    const rollover = ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });
    await Promise.all([lateClaim, rollover]);

    // The rollover must have waited for the claim and archived BOTH.
    expect(harness.archiveIds(PREV).sort()).toEqual([101, 105]);
    const archived = harness.state.week_archive.filter((row) => row.weekStart === PREV);
    expect(archived[0].points).toEqual({ Alex: 12 });
  });

  it("takes every week ledger lock oldest-first, current week last (the lock order)", async () => {
    const harness = createHarness({
      week_data: [
        weekRow(OLDEST, [earn(1, "Alex", 10, 1, "2026-09-08T10:00:00.000Z")]),
        weekRow(PRIOR, [earn(2, "Alex", 50, 2, "2026-09-22T10:00:00.000Z")]),
        weekRow(PREV, [earn(3, "Alex", 5, 3, "2026-09-28T20:00:00.000Z")]),
      ],
    });
    seedSnapshot(PREV);

    await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(lockLog.keys).toEqual([OLDEST, PRIOR, PREV, CURRENT]);
  });
});

// ─── B4 — editing a prize rewrote every historical podium ───────────────────

describe("B4 — prize text is frozen at the moment a week is archived", () => {
  function seedHall() {
    return createHarness({
      week_archive: [
        {
          id: "archive-old",
          weekStart: OLDEST,
          points: { Alex: 13 },
          streak: {},
          lastActive: {},
          history: [earn(1, "Alex", 13, 1, "2026-09-08T10:00:00.000Z")],
        },
        {
          id: "archive-latest",
          weekStart: PRIOR,
          points: { Alex: 5 },
          streak: {},
          lastActive: {},
          history: [earn(2, "Alex", 5, 2, "2026-09-22T10:00:00.000Z")],
        },
      ],
      hall_of_fame: [
        { id: "hall-old", member: "Alex", emoji: "🦊", weekStart: OLDEST, points: 13, rank: 1, prize: "Frozen prize", celebrated: true },
        { id: "hall-latest", member: "Alex", emoji: "🦊", weekStart: PRIOR, points: 5, rank: 1, prize: "Frozen prize", celebrated: true },
      ],
      weekly_prizes: [{ id: "prize-1", rank: 1, emoji: "🥇", text: "Picks Friday's family movie" }],
    });
  }

  it("a parent editing weekly_prizes leaves every historical hall row untouched", async () => {
    const harness = seedHall();
    harness.state.weekly_prizes = [{ id: "prize-1", rank: 1, emoji: "🥇", text: "Uncle Dave takes the trash" }];

    await ensureArchivedWeeksEnshrined(harness.pb as any);

    const historical = harness.state.hall_of_fame.find((row) => row.weekStart === OLDEST);
    expect(historical).toMatchObject({ id: "hall-old", prize: "Frozen prize", celebrated: true });
    expect(harness.calls.hall_of_fame ?? []).not.toContainEqual(
      expect.objectContaining({ weekStart: OLDEST, prize: "Uncle Dave takes the trash" }),
    );
    // The newest archived week still self-heals to the live catalog.
    expect(harness.state.hall_of_fame.find((row) => row.weekStart === PRIOR)).toMatchObject({
      prize: "Uncle Dave takes the trash",
    });
  });

  it("deleting every weekly_prizes row does not rewrite history to the hardcoded defaults", async () => {
    const harness = seedHall();
    harness.state.weekly_prizes = [];

    await ensureArchivedWeeksEnshrined(harness.pb as any);

    expect(harness.state.hall_of_fame.find((row) => row.weekStart === OLDEST)).toMatchObject({
      prize: "Frozen prize",
    });
  });

  it("still repairs a stale historical podium without blanking its frozen prize", async () => {
    const harness = seedHall();
    harness.state.hall_of_fame = [
      { id: "hall-old", member: "Alex", emoji: "stale", weekStart: OLDEST, points: 999, rank: 3, prize: "Frozen prize", celebrated: true },
    ];
    harness.state.weekly_prizes = [{ id: "prize-1", rank: 1, emoji: "🥇", text: "Uncle Dave takes the trash" }];

    await ensureArchivedWeeksEnshrined(harness.pb as any);

    expect(harness.state.hall_of_fame.find((row) => row.weekStart === OLDEST)).toMatchObject({
      points: 13,
      rank: 1,
      emoji: "🦊",
      prize: "Frozen prize",
      celebrated: true,
    });
  });
});

// ─── B5 — duplicate archives with a tied archivedAt decided by return order ─

describe("B5 — a tied archivedAt with divergent histories is unknowable, not a coin flip", () => {
  const currentWeek = {
    weekStart: PRIOR,
    points: {},
    streak: {},
    lastActive: {},
    history: [earn(1, "Alex", 50, 1, "2026-09-21T10:00:00.000Z")],
  } as any;

  const rowA = {
    weekStart: OLDEST,
    archivedAt: "2026-09-28T13:00:00.000Z",
    history: [earn(2, "Alex", 50, 2, "2026-09-08T10:00:00.000Z")],
  };
  const rowB = {
    weekStart: OLDEST,
    archivedAt: "2026-09-28T13:00:00.000Z",
    history: [
      earn(3, "Alex", 30, 3, "2026-09-08T11:00:00.000Z"),
      earn(4, "Bailey", 99, 4, "2026-09-08T12:00:00.000Z"),
    ],
  };

  it("reports an honest unknown for conflicting duplicates in either return order", () => {
    for (const rows of [[rowA, rowB], [rowB, rowA]]) {
      const payload = buildAllTimeTotals(currentWeek, rows as any, ["Alex", "Bailey"]);
      expect(payload.historyComplete).toBe(false);
      expect(payload.totals.Alex).toEqual({ points: null, completions: null });
      expect(payload.totals.Bailey).toEqual({ points: null, completions: null });
    }
  });

  it("still collapses two IDENTICAL duplicate archives silently", () => {
    const payload = buildAllTimeTotals(currentWeek, [rowA, structuredClone(rowA)] as any, ["Alex", "Bailey"]);
    expect(payload.historyComplete).toBe(true);
    expect(payload.totals.Alex).toEqual({ points: 100, completions: 2 });
  });
});

// ─── B6 — week_payload() writes lastActive, the seed never created it ───────

describe("B6 — the week_archive schema declares every field week_payload() writes", () => {
  it("declares lastActive on week_archive", () => {
    const collection = COLLECTIONS.find((entry: any) => entry.name === "week_archive") as any;
    const fields = Object.fromEntries(collection.schema.map((field: any) => [field.name, field]));
    expect(fields.lastActive).toMatchObject({ name: "lastActive", type: "json" });
  });

  it("a populated lastActive survives the archive write (strict PocketBase, not a permissive fake)", async () => {
    const harness = createHarness({
      week_data: [
        weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")], {
          lastActive: { Alex: "2026-09-28T20:00:00.000Z" },
        }),
      ],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.reconciled).toBe(true);
    expect(harness.state.week_archive[0].lastActive).toEqual({ Alex: "2026-09-28T20:00:00.000Z" });
  });
});

// ─── B7 — one bad prior-week transaction bricked every point-earning route ──

describe("B7 — an unreadable prior week fails soft and never throws", () => {
  it("returns an honest failure category, keeps the current week usable, and does not throw", async () => {
    const harness = createHarness({
      week_data: [
        weekRow(PREV, [
          earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z"),
          { ...earn(102, "Alex", 5, 2, "2026-09-28T21:00:00.000Z"), description: "   " },
        ]),
      ],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.reconciled).toBe(false);
    expect((result as any).failed).toContain("week_archive:invalid");
    expect(result.weekStart).toBe(CURRENT);
    expect(result.currentWeekData.weekStart).toBe(CURRENT);
    expect(harness.weekData(CURRENT)).toHaveLength(1);
    expect(harness.snapshotData()).toMatchObject({ taskWeekStart: CURRENT });
    // The category is the contract; the diagnostics appended after it
    // (weekStart/rows/error, ad8bf8a) must not be able to break the pin.
    expect(
      warnSpy.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .some((message: string) => message.includes("[task-week-rollover] week_archive:invalid")),
    ).toBe(true);
  });

  it("the day sweep still runs on the same day (the board is not bricked)", async () => {
    const harness = createHarness({
      week_data: [
        weekRow(PREV, [{ ...earn(102, "Alex", 5, 2, "2026-09-28T21:00:00.000Z"), amount: "five" }]),
      ],
    });
    seedSnapshot(PREV, [crewTask({ expiresAfterDays: 1 }) as SnapshotTask]);

    await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });
    const sweep = await ensureCurrentTaskDay({ now: mondayMorning(CURRENT) });

    expect(sweep.swept).toBe(true);
    expect(sweep.reconciled).toBe(true);
    expect(sweep.closedTaskIds).toEqual([11]);
    expect(harness.snapshotTasks()[0]).toMatchObject({ completed: true });
  });

  it("a corrupt week_archive row also fails soft, and is never deleted or overwritten", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
      week_archive: [
        {
          id: "archive-broken",
          weekStart: PREV,
          points: { Alex: 5 },
          streak: {},
          lastActive: {},
          archivedAt: "2026-10-05T13:00:00.000Z",
          history: [{ ...earn(901, "Alex", 5, 1, "2026-09-28T20:00:00.000Z"), meta: { bogus: true } }],
        },
      ],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.reconciled).toBe(false);
    expect(result.failed).toContain("week_archive:invalid");
    expect(harness.state.week_archive).toHaveLength(1);
    expect(harness.calls.week_archive).toBeUndefined();
    expect(harness.deletes.week_archive ?? []).toHaveLength(0);
    expect(harness.weekData(CURRENT)).toHaveLength(1);
  });

  it("a store that will not hold a write still surfaces the failure (never a silent pass)", async () => {
    const harness = createHarness(
      {
        week_data: [
          weekRow(PREV, [
            earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z"),
            earn(102, "Alex", 6, 2, "2026-09-28T21:00:00.000Z"),
          ]),
          { id: "prior-dup", ...weekRow(PREV, [earn(103, "Alex", 7, 3, "2026-09-28T22:00:00.000Z")]) },
        ],
      },
      { dropUpdates: { week_data: 1 } },
    );
    seedSnapshot(PREV);

    // Unreadable DATA fails soft (B7); a write that does not persist is a
    // store outage and must still be loud — and must never delete an
    // unverified duplicate.
    await expect(ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) })).rejects.toThrow();
    expect(harness.weekData(PREV)).toHaveLength(2);
    expect(harness.deletes.week_data ?? []).toHaveLength(0);
  });
});

// ─── B8 — two identically-titled recurring chores collapsed into one ───────

describe("B8 — a recurring lineage is one chore, not a title coincidence", () => {
  it("regenerates BOTH same-titled daily chores with their own points", () => {
    const base = {
      title: "Dishes",
      assignee: "Alex",
      assigneeEmoji: "🦊",
      due: "2026-10-02",
      recurring: "daily",
      category: "chores",
      priority: "medium",
      completed: false,
    };
    const result = regenerateRecurringOnTasks(
      [
        { ...base, id: 11, points: 5 },
        { ...base, id: 12, points: 10, category: "kitchen" },
      ] as any,
      "2026-10-03",
      PREV,
      "2026-10-03T13:00:00.000Z",
      (() => {
        let next = 900;
        return (existing: ReadonlySet<number>) => {
          while (existing.has(next)) next += 1;
          return next++;
        };
      })(),
    );

    expect(result.deletedIds.sort()).toEqual([11, 12]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => Number(task.points)).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(result.tasks.every((task) => task.due === "2026-10-03")).toBe(true);
  });

  it("clones BOTH same-titled weekly chores across the weekly rollover", () => {
    const weekly = (id: number, points: number, category: string) => ({
      id,
      title: "Dishes",
      assignee: "Alex",
      assigneeEmoji: "🦊",
      due: "2026-09-29",
      points,
      recurring: "weekly",
      category,
      priority: "medium",
      completed: false,
    });
    const result = resetRecurringTasksForWeek(
      [weekly(11, 5, "chores"), weekly(12, 10, "kitchen")] as any,
      CURRENT,
      (() => {
        let next = 900;
        return () => next++;
      })(),
    );

    expect(result.deletedTaskIds.sort()).toEqual([11, 12]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => Number(task.points)).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(result.tasks.map((task) => task.category).sort()).toEqual(["chores", "kitchen"]);
  });
});

// ─── Regression pins ───────────────────────────────────────────────────────

describe("regression — rollover idempotency", () => {
  it("a second run in the same week archives nothing new, clones nothing new and enshrines nothing new", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
    });
    seedSnapshot(PREV, [
      {
        id: 31,
        title: "Dishes",
        assignee: "Alex",
        assigneeEmoji: "🦊",
        due: "2026-09-29",
        points: 5,
        recurring: "weekly",
        category: "kitchen",
        priority: "medium",
        completed: false,
      } as unknown as SnapshotTask,
    ]);

    const first = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });
    const archiveWrites = (harness.calls.week_archive ?? []).length;
    const hallWrites = (harness.calls.hall_of_fame ?? []).length;
    const snapshotRevision = first.revision.revision;
    const second = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(first.archived).toBe(true);
    expect(second.archived).toBe(false);
    expect(second.tasksReset).toBe(false);
    expect(second.hallOfFameRecorded).toBe(false);
    expect(second.revision.revision).toBe(snapshotRevision);
    expect((harness.calls.week_archive ?? []).length).toBe(archiveWrites);
    expect((harness.calls.hall_of_fame ?? []).length).toBe(hallWrites);
    expect(harness.state.week_archive).toHaveLength(1);
    expect(harness.snapshotTasks().filter((task) => task.title === "Dishes")).toHaveLength(1);
  });

  it("keeps zero-point weeks out of the Hall of Fame", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [])],
    });
    seedSnapshot(PREV);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.archived).toBe(true);
    expect(harness.state.week_archive).toHaveLength(1);
    expect(harness.state.hall_of_fame).toHaveLength(0);
  });
});

describe("regression — recurrence gates", () => {
  it("freezes weekday recurrences over the weekend", () => {
    const weekday = {
      id: 41,
      title: "Dishes",
      assignee: "Alex",
      assigneeEmoji: "🦊",
      due: "2026-10-02",
      points: 5,
      recurring: "weekdays",
      category: "chores",
      priority: "medium",
      completed: false,
    } as any;
    const frozen = regenerateRecurringOnTasks([weekday], "2026-10-03", PREV, "now", () => 901);
    expect(frozen.deletedIds).toEqual([]);
    expect(frozen.tasks.map((task) => task.id)).toEqual([41]);

    const monday = regenerateRecurringOnTasks([weekday], CURRENT, CURRENT, "now", () => 902);
    expect(monday.deletedIds).toEqual([41]);
    expect(monday.tasks).toHaveLength(1);
    expect(monday.tasks[0]).toMatchObject({ due: CURRENT, completed: false });
  });

  it("never regenerates a lineage twice in one period (a live row due today blocks the spawn)", () => {
    const daily = (id: number, due: string) => ({
      id,
      title: "Dishes",
      assignee: "Alex",
      assigneeEmoji: "🦊",
      due,
      points: 5,
      recurring: "daily",
      category: "chores",
      priority: "medium",
      completed: false,
    }) as any;
    const result = regenerateRecurringOnTasks(
      [daily(41, "2026-10-03"), daily(42, "2026-10-02")],
      "2026-10-03",
      PREV,
      "now",
      () => 903,
    );
    expect(result.deletedIds).toEqual([]);
    expect(result.tasks.map((task) => task.id).sort()).toEqual([41, 42]);
  });
});

describe("regression — the taskResetMatches server-side clone contract", () => {
  it("the weekly clone empties its crew, resets completed*, keeps the field set, and verifies", async () => {
    const harness = createHarness({
      week_data: [weekRow(PREV, [earn(101, "Alex", 5, 1, "2026-09-28T20:00:00.000Z")])],
    });
    seedSnapshot(PREV, [
      {
        id: 51,
        title: "Playroom reset",
        assignee: "Crew",
        assigneeEmoji: "🤝",
        due: "2026-09-29",
        points: 12,
        speedBonus: 4,
        recurring: "weekly",
        category: "chores",
        priority: "high",
        completed: true,
        status: "done",
        completedBy: "Alex",
        completedAt: "2026-09-29T20:00:00.000Z",
        completedInWeek: PREV,
        crewSize: 2,
        crewCloseMode: "deadline",
        expiresAfterDays: null,
        stealable: true,
        crew: {
          members: [
            { name: "Alex", emoji: "🦊", joinedAt: "x", checkedInAt: "y" },
          ],
          removed: [],
        },
      } as unknown as SnapshotTask,
    ]);

    const result = await ensureCurrentTaskWeek({ now: mondayMorning(CURRENT) });

    expect(result.tasksReset).toBe(true);
    // `reconciled` is the server-side `taskResetMatches` verification passing.
    expect(result.reconciled).toBe(true);
    const clone = harness.snapshotTasks().find((task) => task.title === "Playroom reset") as Row;
    expect(clone.id).not.toBe(51);
    expect(clone).toMatchObject({
      title: "Playroom reset",
      assignee: "Crew",
      due: CURRENT,
      points: 12,
      recurring: "weekly",
      category: "chores",
      priority: "high",
      crewSize: 2,
      crewCloseMode: "deadline",
      speedBonus: 0,
      stealable: true,
      crew: { members: [], removed: [] },
      completed: false,
      status: "pending",
    });
    expect(clone.completedBy).toBeUndefined();
    expect(clone.completedAt).toBeUndefined();
    expect(clone.completedInWeek).toBeUndefined();
    expect(clone.pendingApproval).toBeUndefined();
    expect(clone.sentBackAt).toBeUndefined();
    expect(harness.snapshotData().deletedTaskIds).toContain(51);
  });
});

describe("regression — Hall of Fame trim keeps the latest 12 distinct weeks", () => {
  it("drops whole weeks, never a partial podium", () => {
    saveHallOfFame([]);
    for (let index = 0; index < 13; index += 1) {
      const weekStart = new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10);
      archiveWeekWinner(
        [
          { name: "A", emoji: "🦊", points: 100, rank: 1 },
          { name: "B", emoji: "👧", points: 50, rank: 2 },
          { name: "C", emoji: "🧒", points: 25, rank: 3 },
        ],
        weekStart,
        DEFAULT_WEEKLY_PRIZES,
      );
    }
    const hall = loadHallOfFame();
    const weeks = [...new Set(hall.map((entry) => entry.weekStart))];
    expect(weeks).toHaveLength(12);
    expect(hall).toHaveLength(36);
    expect(weeks).toEqual([...weeks].sort());
    expect(hall.some((entry) => entry.weekStart === "2026-01-05")).toBe(false);
  });
});
