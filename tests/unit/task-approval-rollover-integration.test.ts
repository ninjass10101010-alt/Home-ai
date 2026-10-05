import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.TZ = "America/Detroit";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

// Only the PIN verifier is stubbed. `requireLiveSession` must stay REAL: the
// sync GET authorizes itself with it before any of its write legs, and this
// suite's whole point is that the REAL rollover and reconciler run behind it —
// so the gate is driven against the harness's live member row rather than
// replaced. Spreading the original module is the same idiom
// `task-route-auth-and-honesty.test.ts` uses for its other seams.
vi.mock("@/lib/server-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyPinFromPB: mocks.verifyPinFromPB,
}));

import { GET } from "@/app/api/tasks/sync/route";
import { POST } from "@/app/api/tasks/approve/route";
import { approvalCommandFingerprint } from "@/lib/task-approval";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";
import { __resetWeekLedgerLockForTests } from "@/lib/week-ledger-lock";
import { SESSION_COOKIE, signSession } from "@/lib/session";

type Row = Record<string, any>;

const PRIOR = "2026-09-21";
const CURRENT = "2026-09-28";
const NOW = new Date("2026-09-28T12:00:00-04:00");
const OPERATION_ID = "op-real-rollover-replay";

// The sync GET takes the request and authorizes itself with `requireLiveSession`
// as its first statement, so it needs a genuinely signed session cookie — the
// same HMAC shape `tasks-sync-legs.test.ts` builds. The signed role has to
// match the harness's LIVE `parent-rebecca` row, because the real gate
// re-reads it and refuses 403 on drift.
const LIVE_MEMBER = { id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" };

function createHarness() {
  const state: Record<string, Row[]> = {
    week_data: [],
    week_archive: [],
    consuela_data_snapshots: [],
    hall_of_fame: [],
    members: [
      { id: "parent-rebecca", name: "Rebecca (Mom)", role: "parent", emoji: "👩" },
      { id: "child-caspian", name: "Caspian Garcia", role: "child", emoji: "🧒" },
    ],
    weekly_prizes: [{ id: "prize-1", rank: 1, text: "Pick the movie" }],
    tasks: [],
  };
  const events: string[] = [];
  let sequence = 0;
  const collections: Record<string, any> = {};

  for (const name of Object.keys(state)) {
    collections[name] = {
      getFullList: vi.fn(async () => structuredClone(state[name])),
      getOne: vi.fn(async (id: string) => {
        const row = state[name].find((candidate) => candidate.id === id);
        return row ? structuredClone(row) : null;
      }),
      create: vi.fn(async (payload: Row) => {
        events.push(`${name}:create`);
        const row = { id: `${name}-${++sequence}`, ...structuredClone(payload) };
        state[name].push(row);
        return structuredClone(row);
      }),
      update: vi.fn(async (id: string, payload: Row) => {
        events.push(`${name}:update`);
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index < 0) throw new Error(`missing ${name} row`);
        state[name][index] = { ...state[name][index], ...structuredClone(payload) };
        return structuredClone(state[name][index]);
      }),
      delete: vi.fn(async (id: string) => {
        events.push(`${name}:delete`);
        const index = state[name].findIndex((candidate) => candidate.id === id);
        if (index >= 0) state[name].splice(index, 1);
        return { id };
      }),
    };
  }

  return {
    state,
    events,
    pb: {
      collection: vi.fn((name: string) => {
        const collection = collections[name];
        if (!collection) throw new Error(`unexpected collection ${name}`);
        return collection;
      }),
    },
  };
}

function seedPriorApproval(harness: ReturnType<typeof createHarness>, fingerprint: string) {
  const transaction = {
    id: 7001,
    timestamp: "2026-09-27T18:00:00.000Z",
    member: "Caspian Garcia",
    type: "earn",
    amount: 8,
    description: "Approved: Dishes (+8pts)",
    taskId: 101,
    meta: {
      operationId: OPERATION_ID,
      source: "task-approval",
      fingerprint,
    },
  };
  const priorWeek = {
    weekStart: PRIOR,
    points: { "Caspian Garcia": 8 },
    streak: {},
    lastActive: {},
    history: [transaction],
  };
  const task = {
    id: 101,
    title: "Dishes",
    assignee: "Caspian Garcia",
    assigneeEmoji: "🧒",
    assigned: "Caspian Garcia",
    due: PRIOR,
    points: 8,
    recurring: null,
    category: "kitchen",
    priority: "medium",
    universal: false,
    stealable: false,
    completed: true,
    completedBy: "Caspian Garcia",
    completedAt: "2026-09-27T17:00:00.000Z",
    completedInWeek: PRIOR,
    pendingApproval: {
      byName: "Caspian Garcia",
      at: "2026-09-27T17:00:00.000Z",
      points: 8,
    },
    sentBackAt: null,
    crewSize: null,
    crew: null,
  };
  harness.state.week_data.push({ id: "week-prior", ...structuredClone(priorWeek) });
  harness.state.consuela_data_snapshots.push({
    id: "snapshot-1",
    key: "tasks-snapshot",
    data: {
      revision: "1",
      taskWeekStart: PRIOR,
      weekData: structuredClone(priorWeek),
      tasks: [structuredClone(task)],
      deletedTaskIds: [],
    },
    updated_at: "2026-09-27T18:30:00.000Z",
  });
}

function request() {
  return new NextRequest("http://localhost/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "approve",
      operationId: OPERATION_ID,
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }),
  });
}

async function syncRequest() {
  const token = await signSession({
    memberId: LIVE_MEMBER.id,
    name: LIVE_MEMBER.name,
    role: LIVE_MEMBER.role,
  });
  return new NextRequest("http://localhost/api/tasks/sync", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The sync GET's route-level gate verifies a real HMAC cookie; with no secret
  // every token is refused and the leg is unreachable.
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789");
  __resetKeyedLockForTests();
  __resetWeekLedgerLockForTests();
  mocks.verifyPinFromPB.mockResolvedValue({
    id: "parent-rebecca",
    name: "Rebecca (Mom)",
    role: "parent",
    emoji: "👩",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetKeyedLockForTests();
  __resetWeekLedgerLockForTests();
});

describe("approval with the real task-week rollover", () => {
  it("archives Sunday before replaying Monday without paying the current week twice", async () => {
    const harness = createHarness();
    const fingerprint = approvalCommandFingerprint(
      { operationId: OPERATION_ID, action: "approve", taskId: 101 },
      "parent-rebecca",
    );
    seedPriorApproval(harness, fingerprint);
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      paid: 0,
      cleared: 1,
      weekData: { weekStart: CURRENT, history: [] },
    });
    expect(harness.state.week_archive).toHaveLength(1);
    expect(harness.state.week_archive[0].history).toHaveLength(1);
    expect(harness.state.week_archive[0].history[0].meta.operationId).toBe(OPERATION_ID);
    expect(harness.state.week_data.find((row) => row.weekStart === CURRENT)?.history).toEqual([]);
    expect(harness.state.consuela_data_snapshots[0].data.taskWeekStart).toBe(CURRENT);
    expect(harness.state.consuela_data_snapshots[0].data.tasks[0].pendingApproval).toBeNull();

    const archiveEvent = harness.events.indexOf("week_archive:create");
    const taskProjectionEvent = harness.events.findIndex((event) =>
      event === "tasks:create" || event === "tasks:update",
    );
    expect(archiveEvent).toBeGreaterThanOrEqual(0);
    expect(taskProjectionEvent).toBeGreaterThan(archiveEvent);
  });

  it("serves a reconciled snapshot through GET with the real rollover and reconciler", async () => {
    const harness = createHarness();
    const task = {
      id: 102,
      title: "Laundry",
      assignee: "Caspian Garcia",
      assigneeEmoji: "🧒",
      assigned: "Caspian Garcia",
      due: CURRENT,
      points: 4,
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
      crewSize: null,
      crew: null,
    };
    harness.state.week_data.push({ id: "week-current", weekStart: CURRENT, points: {}, streak: {}, lastActive: {}, history: [] });
    harness.state.tasks.push({ id: "pb-102", taskId: 102, title: "Laundry", completed: true, completedBy: "Caspian Garcia" });
    harness.state.consuela_data_snapshots.push({
      id: "snapshot-current",
      key: "tasks-snapshot",
      data: {
        revision: "1",
        taskWeekStart: CURRENT,
        weekData: { weekStart: CURRENT, points: {}, streak: {}, lastActive: {}, history: [] },
        tasks: [task],
        deletedTaskIds: [],
      },
      updated_at: "2026-09-28T12:00:00.000Z",
    });
    mocks.withAdmin.mockImplementation(async (fn: (pb: unknown) => Promise<unknown>) => fn(harness.pb));

    const response = await GET(await syncRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, reconciled: true, snapshot: { taskWeekStart: CURRENT } });
    expect(harness.state.tasks[0].completed).toBe(false);
  });
});
