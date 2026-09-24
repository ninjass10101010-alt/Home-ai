import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const parentTestCredential = "parent-test-credential";
const childTestCredential = "child-test-credential";
const routeModulePath = "@/app/api/tasks/config/route";
const configModulePath = "@/lib/task-config";
const liveMemberModulePath = "@/lib/live-member";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  verifySession: vi.fn(),
  lockOrder: [] as string[],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
}));

vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "consuela_session",
  verifySession: mocks.verifySession,
}));

vi.mock("@/lib/keyed-lock", () => ({
  withKeyedLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    mocks.lockOrder.push(`acquire:${key}`);
    try {
      return await fn();
    } finally {
      mocks.lockOrder.push(`release:${key}`);
    }
  },
  __resetKeyedLockForTests: vi.fn(),
}));

type StoredSnapshot = Record<string, any>;

type Harness = {
  pb: any;
  writes: {
    snapshot: any[];
    tasks: any[];
    week_data: any[];
    rewards: { create: any[]; update: any[]; delete: any[] };
    penalties: { create: any[]; update: any[]; delete: any[] };
    weekly_prizes: { create: any[]; update: any[]; delete: any[] };
  };
  attempts: Record<"rewards" | "penalties" | "weekly_prizes", Record<"create" | "update" | "delete", number>>;
  snapshot: () => StoredSnapshot;
  api: {
    memberGetOne: ReturnType<typeof vi.fn>;
    memberGetFirstListItem: ReturnType<typeof vi.fn>;
  };
};

const defaultSnapshot = (): StoredSnapshot => ({
  revision: "4",
  tasks: [{ id: 1, title: "Keep this task", completed: false }],
  weekData: {
    weekStart: "2026-09-21",
    points: { Alex: 5 },
    streak: {},
    lastActive: {},
    history: [
      {
        id: 1,
        timestamp: "2026-09-21T10:00:00.000Z",
        member: "Alex",
        type: "earn",
        amount: 5,
        description: "Done",
      },
    ],
  },
  rewards: [],
  rewardsUpdatedAt: "2026-09-24T09:00:00.000Z",
  penalties: [],
  penaltiesUpdatedAt: "2026-09-24T09:00:00.000Z",
  weeklyPrizes: [],
  weeklyPrizesStamp: "2026-09-24T09:00:00.000Z",
  operationReceipts: {
    "op-task": [
      {
        operationId: "op-task",
        action: "approve",
        taskId: 1,
        createdAt: "2026-09-21T10:00:00.000Z",
      },
    ],
  },
  configOperationReceipts: {},
});

function makeHarness(options?: {
  snapshot?: StoredSnapshot;
  rewards?: any[];
  penalties?: any[];
  weeklyPrizes?: any[];
  member?: Record<string, unknown> | null;
  memberError?: any;
  failConfigOperation?: "create" | "update" | "delete";
  failConfigRowId?: string;
}): Harness {
  let snapshot = structuredClone(options?.snapshot ?? defaultSnapshot());
  const rows: Record<string, any[]> = {
    rewards: structuredClone(options?.rewards ?? []),
    penalties: structuredClone(options?.penalties ?? []),
    weekly_prizes: structuredClone(options?.weeklyPrizes ?? []),
  };
  const writes: Harness["writes"] = {
    snapshot: [],
    tasks: [],
    week_data: [],
    rewards: { create: [], update: [], delete: [] },
    penalties: { create: [], update: [], delete: [] },
    weekly_prizes: { create: [], update: [], delete: [] },
  };
  const attempts: Harness["attempts"] = {
    rewards: { create: 0, update: 0, delete: 0 },
    penalties: { create: 0, update: 0, delete: 0 },
    weekly_prizes: { create: 0, update: 0, delete: 0 },
  };
  let configFailurePending = Boolean(options?.failConfigOperation);
  const shouldFail = (
    name: string,
    operation: "create" | "update" | "delete",
    id?: string,
  ) => {
    if (name !== "rewards" && name !== "penalties" && name !== "weekly_prizes") return false;
    attempts[name][operation] += 1;
    if (
      configFailurePending &&
      options?.failConfigOperation === operation &&
      (!options.failConfigRowId || options.failConfigRowId === id)
    ) {
      configFailurePending = false;
      return true;
    }
    return false;
  };
  let sequence = 0;
  const memberGetOne = vi.fn(async (id: string, requestOptions?: { requestKey?: string | null }) => {
    void requestOptions;
    if (id !== "parent-live") return null;
    if (options?.memberError) throw options.memberError;
    if (options?.member === null) {
      const error = new Error("missing") as Error & { status: number };
      error.status = 404;
      throw error;
    }
    return options?.member ?? { id: "parent-live", name: "Live Parent", role: "parent" };
  });
  const memberGetFirstListItem = vi.fn(async () => null);

  const pb = {
    collection: vi.fn((name: string) => ({
      getFullList: vi.fn(async () => {
        if (name === "consuela_data_snapshots") {
          return [{ id: "snapshot-1", data: structuredClone(snapshot), updated_at: "2026-09-24T09:00:00.000Z" }];
        }
        if (name === "members") {
          if (options?.memberError) throw options.memberError;
          return options?.member === null || options?.member === undefined
            ? [{ id: "parent-live", name: "Live Parent", role: "parent" }]
            : [options.member];
        }
        return structuredClone(rows[name] ?? []);
      }),
      getOne: memberGetOne,
      getFirstListItem: memberGetFirstListItem,
      update: vi.fn(async (id: string, payload: Record<string, any>) => {
        if (name === "consuela_data_snapshots") {
          writes.snapshot.push({ id, payload: structuredClone(payload) });
          snapshot = structuredClone(payload.data);
          return { id, ...payload };
        }
        if (name === "tasks" || name === "week_data") {
          writes[name].push({ id, payload: structuredClone(payload) });
          return { id, ...payload };
        }
        if (shouldFail(name, "update", id)) throw new Error(`fail:${name}:update:${id}`);
        writes[name as "rewards" | "penalties" | "weekly_prizes"].update.push({ id, payload: structuredClone(payload) });
        const row = rows[name]?.find((candidate) => candidate.id === id);
        if (row) Object.assign(row, payload);
        return { id, ...payload };
      }),
      create: vi.fn(async (payload: Record<string, any>) => {
        if (name === "consuela_data_snapshots") {
          writes.snapshot.push({ id: null, payload: structuredClone(payload) });
          snapshot = structuredClone(payload.data);
          return { id: "snapshot-new", ...payload };
        }
        if (name === "tasks" || name === "week_data") {
          writes[name].push({ id: null, payload: structuredClone(payload) });
          return { id: `${name}-new`, ...payload };
        }
        if (shouldFail(name, "create", String(payload.name))) throw new Error(`fail:${name}:create`);
        const id = `${name}-${++sequence}`;
        writes[name as "rewards" | "penalties" | "weekly_prizes"].create.push({ id, payload: structuredClone(payload) });
        rows[name] = [...(rows[name] ?? []), { id, ...payload }];
        return { id, ...payload };
      }),
      delete: vi.fn(async (id: string) => {
        if (name === "tasks" || name === "week_data") {
          writes[name].push({ id, payload: null });
          return true;
        }
        if (shouldFail(name, "delete", id)) throw new Error(`fail:${name}:delete:${id}`);
        writes[name as "rewards" | "penalties" | "weekly_prizes"].delete.push({ id });
        rows[name] = (rows[name] ?? []).filter((row) => row.id !== id);
        return true;
      }),
    })),
  };

  return {
    pb,
    writes,
    attempts,
    snapshot: () => structuredClone(snapshot),
    api: { memberGetOne, memberGetFirstListItem },
  };
}

function configRequest(body: unknown, role: "parent" | "child" = "parent"): NextRequest {
  const credential = role === "parent" ? parentTestCredential : childTestCredential;
  return new NextRequest("http://localhost/api/tasks/config", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `consuela_session=${credential}`,
    },
    body: JSON.stringify(body),
  });
}

async function postConfig(body: unknown, role: "parent" | "child" = "parent") {
  const { POST } = await import(/* @vite-ignore */ routeModulePath);
  return POST(configRequest(body, role));
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyLiveParentSession.mockReset();
  mocks.verifySession.mockReset();
  mocks.lockOrder.length = 0;
  mocks.verifyLiveParentSession.mockImplementation(async (request: NextRequest) => {
    const credential = request.cookies.get("consuela_session")?.value;
    if (credential === childTestCredential) {
      return { ok: false, status: 403, reason: "adult_only" };
    }
    return {
      ok: true,
      member: { id: "parent-live", name: "Live Parent", role: "parent" },
    };
  });
});

describe("POST /api/tasks/config", () => {
  it("rejects child config writes", async () => {
    const response = await postConfig({
      operationId: "op-config-rewards-1",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    }, "child");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "adult_only" });
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });

  it("persists a newer reward list without touching task state", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-rewards-2",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      operationId: "op-config-rewards-2",
      kind: "rewards",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
      updatedAt: "2026-09-24T10:00:00.000Z",
      applied: true,
      revision: { revision: "5" },
    });
    expect(harness.writes.tasks).toHaveLength(0);
    expect(harness.writes.week_data).toHaveLength(0);
    expect(harness.writes.rewards.create).toEqual([
      { id: "rewards-1", payload: { name: "Movie", emoji: "🎬", cost: 50 } },
    ]);
    expect(harness.snapshot()).toMatchObject({
      tasks: defaultSnapshot().tasks,
      weekData: defaultSnapshot().weekData,
      rewards: [{ name: "Movie", emoji: "🎬", cost: 50 }],
      rewardsUpdatedAt: "2026-09-24T10:00:00.000Z",
    });
  });

  it("preserves task and week snapshot legs byte-for-byte", async () => {
    const snapshot = defaultSnapshot();
    snapshot.tasks = [{ id: 9, title: "Untouched", completed: true, completedAt: "2026-09-24T08:00:00.000Z" }];
    snapshot.weekData.points = { Alex: 999 };
    snapshot.operationReceipts = {
      "  op-task-existing  ": [{
        operationId: "  op-task-existing  ",
        action: "approve",
        taskId: 9,
        createdAt: " 2026-09-24T08:00:00.000Z ",
      }],
    };
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-preserve-state",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    });

    expect(response.status).toBe(200);
    expect(harness.snapshot().tasks).toEqual(snapshot.tasks);
    expect(harness.snapshot().weekData).toEqual(snapshot.weekData);
    expect(harness.snapshot().operationReceipts).toEqual(snapshot.operationReceipts);
  });

  it("does not resurrect a deleted reward with an older stamp", async () => {
    const harness = makeHarness({
      rewards: [{ id: "stale-reward", name: "Stale", emoji: "🍿", cost: 10 }],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-rewards-3",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-23T10:00:00.000Z",
      items: [{ name: "Old Movie", emoji: "🎬", cost: 50 }],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.updatedAt).toBe("2026-09-24T09:00:00.000Z");
    expect(body.applied).toBe(false);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
    expect(harness.writes.snapshot).toHaveLength(0);
  });

  it.each([
    ["task row", { task: { id: 1, title: "No" } }],
    ["week data", { weekData: { points: { Alex: 999 } } }],
    ["completion", { items: [{ name: "Movie", emoji: "🎬", cost: 50, completed: true }] }],
    ["approval", { items: [{ name: "Movie", emoji: "🎬", cost: 50, pendingApproval: {} }] }],
    ["history", { item: { name: "Movie", emoji: "🎬", cost: 50, history: [] } }],
  ])("rejects %s as forbidden_config_field", async (_label, forbidden) => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-forbidden",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
      ...forbidden,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "forbidden_config_field" });
    expect(harness.writes.snapshot).toHaveLength(0);
  });

  it("rejects case-insensitive incoming natural-key collisions before any mutation", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-incoming-collision",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [
        { name: "Movie", emoji: "🎬", cost: 25 },
        { name: "movie", emoji: "🍿", cost: 50 },
      ],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "config_natural_key_conflict",
      kind: "rewards",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
  });

  it("rejects replacement lists over the item limit with a stable 422", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const items = Array.from({ length: 101 }, (_, index) => ({
      name: `Reward ${index}`,
      emoji: "🎁",
      cost: index + 1,
    }));

    const response = await postConfig({
      operationId: "op-config-list-limit",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      error: "invalid_resulting_config",
      kind: "rewards",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
  });

  it("rejects an upsert whose resulting list has a natural-key collision", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = [
      { id: 1, name: "A", emoji: "🅰️", cost: 1 },
      { id: 2, name: "B", emoji: "🅱️", cost: 2 },
    ];
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-result-collision",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 1, name: "B", emoji: "🅱️", cost: 20 },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      error: "invalid_resulting_config",
      kind: "rewards",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.update).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it("reconciles replacement PB rows by stable name and deletes stale rows", async () => {
    const harness = makeHarness({
      rewards: [
        { id: "old-id", name: "Old", emoji: "🗑️", cost: 1 },
        { id: "movie-id", name: "Movie", emoji: "🎬", cost: 25 },
        { id: "duplicate-movie", name: "Movie", emoji: "🎬", cost: 25 },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-rewards-reconcile",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🍿", cost: 50, category: "fun" }],
    });

    expect(response.status).toBe(200);
    expect(harness.writes.rewards.update).toEqual([
      { id: "duplicate-movie", payload: { name: "Movie", emoji: "🍿", cost: 50 } },
    ]);
    expect(harness.writes.rewards.delete.map((entry) => entry.id).sort()).toEqual([
      "movie-id",
      "old-id",
    ]);
    expect(harness.writes.rewards.create).toHaveLength(0);
  });

  it("sanitizes current legacy items before writing an upsert result", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = [
      { id: 1, name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 },
      { id: 2, name: "Keep", emoji: "🎮", cost: 10 },
    ];
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-sanitize-current",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 3, name: "New", emoji: "🎬", cost: 50 },
    });

    expect(response.status).toBe(200);
    expect(harness.snapshot().rewards.map((item: any) => item.emoji)).toEqual(["👤", "🎮", "🎬"]);
    expect(JSON.stringify(harness.snapshot())).not.toContain("base64");
  });

  it("rejects case-insensitive current natural-key collisions before any mutation", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = [
      { id: 1, name: "Movie", emoji: "🎬", cost: 25 },
      { id: 2, name: "movie", emoji: "🍿", cost: 50 },
    ];
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-current-collision",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 3, name: "New", emoji: "🎁", cost: 5 },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      error: "invalid_current_config",
      kind: "rewards",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.update).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it.each([
    ["non-array", "broken"],
    ["duplicate", [
      { id: 1, name: "Movie", emoji: "🎬", cost: 25 },
      { id: 2, name: "movie", emoji: "🍿", cost: 50 },
    ]],
  ])("replace recovers %s current config from the incoming list", async (_shape, stored) => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = stored;
    const harness = makeHarness({ snapshot, rewards: [{ id: "stale", name: "Stale", emoji: "🗑️", cost: 1 }] });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: `op-config-replace-recovery-${_shape}`,
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Recovered", emoji: "🍿", cost: 15 }],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([
      { name: "Recovered", emoji: "🍿", cost: 15 },
    ]);
    expect(harness.snapshot().rewards).toEqual([
      { name: "Recovered", emoji: "🍿", cost: 15 },
    ]);
    expect(harness.writes.rewards.delete).toEqual([{ id: "stale" }]);
    expect(harness.writes.rewards.create).toHaveLength(1);
  });

  it("returns stable invalid_current_config for delete against a non-array current list", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = "broken";
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-delete-broken",
      kind: "rewards",
      action: "delete",
      updatedAt: "2026-09-24T10:00:00.000Z",
      itemId: 1,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      success: false,
      error: "invalid_current_config",
      kind: "rewards",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it("retains the lowest PB id for duplicate natural keys regardless of row order", async () => {
    const harness = makeHarness({
      rewards: [
        { id: "z-movie", name: "MOVIE", emoji: "🍿", cost: 50 },
        { id: "a-movie", name: "Movie", emoji: "🎬", cost: 25 },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-pb-deterministic",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 25 }],
    });

    expect(response.status).toBe(200);
    expect(harness.writes.rewards.update).toEqual([]);
    expect(harness.writes.rewards.delete).toEqual([{ id: "z-movie" }]);
    expect(harness.writes.rewards.create).toEqual([]);
  });

  it("upserts by stable name, deletes by client id, and compacts weekly ranks", async () => {
    const harness = makeHarness({
      snapshot: {
        ...defaultSnapshot(),
        rewards: [{ id: 7, name: "Old Movie", emoji: "🎬", cost: 25 }],
        weeklyPrizes: [
          { id: "p1", rank: 1, emoji: "🥇", text: "One" },
          { id: "p2", rank: 2, emoji: "🥈", text: "Two" },
        ],
      },
      rewards: [{ id: "reward-row", name: "Old Movie", emoji: "🎬", cost: 25 }],
      weeklyPrizes: [
        { id: "pb-p1", rank: 1, emoji: "🥇", text: "One" },
        { id: "pb-p2", rank: 2, emoji: "🥈", text: "Two" },
      ],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const upsert = await postConfig({
      operationId: "op-config-reward-rename",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 7, name: "New Movie", emoji: "🍿", cost: 50 },
    });
    expect(upsert.status).toBe(200);
    expect((await upsert.json()).items).toEqual([
      { id: 7, name: "New Movie", emoji: "🍿", cost: 50 },
    ]);
    expect(harness.writes.rewards.delete.map((entry) => entry.id)).toEqual(["reward-row"]);
    expect(harness.writes.rewards.create[0].payload).toEqual({ name: "New Movie", emoji: "🍿", cost: 50 });

    mocks.lockOrder.length = 0;
    const deletion = await postConfig({
      operationId: "op-config-prize-delete",
      kind: "weekly-prizes",
      action: "delete",
      updatedAt: "2026-09-24T11:00:00.000Z",
      itemId: "p1",
    });
    expect(deletion.status).toBe(200);
    expect((await deletion.json()).items).toEqual([
      { id: "p2", rank: 1, emoji: "🥈", text: "Two" },
    ]);
    expect(harness.writes.weekly_prizes.update).toContainEqual({
      id: "pb-p1",
      payload: { rank: 1, emoji: "🥈", text: "Two" },
    });
    expect(harness.writes.weekly_prizes.delete).toContainEqual({ id: "pb-p2" });
  });

  it("stores a deterministic command fingerprint independent of object key order", async () => {
    const config = await import(/* @vite-ignore */ configModulePath);
    const fingerprint = (config as any).taskConfigCommandFingerprint;
    expect(typeof fingerprint).toBe("function");
    if (typeof fingerprint !== "function") return;
    const left = {
      operationId: "op-fingerprint",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ id: 1, name: "Movie", emoji: "🎬", cost: 50, category: "fun" }],
    };
    const right = {
      items: [{ category: "fun", cost: 50, emoji: "🎬", name: "Movie", id: 1 }],
      updatedAt: "2026-09-24T10:00:00.000Z",
      action: "replace",
      kind: "rewards",
      operationId: "op-fingerprint",
    };
    expect(fingerprint(left)).toBe(fingerprint(right));
    expect(fingerprint(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores a separate normalized receipt with its command fingerprint", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "  op-config-receipt  ",
      kind: "penalties" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T12:00:00+02:00",
      items: [{ name: "Messy room", emoji: "⚠️", points: 5 }],
    };

    const response = await postConfig(command);
    const config = await import(/* @vite-ignore */ configModulePath);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.operationId).toBe("op-config-receipt");
    expect(body.updatedAt).toBe("2026-09-24T10:00:00.000Z");
    expect(harness.snapshot().configOperationReceipts).toEqual({
      "op-config-receipt": {
        kind: "penalties",
        action: "replace",
        updatedAt: "2026-09-24T10:00:00.000Z",
        fingerprint: (config as any).taskConfigCommandFingerprint({
          operationId: "op-config-receipt",
          kind: "penalties",
          action: "replace",
          updatedAt: "2026-09-24T10:00:00.000Z",
          items: command.items,
        }),
      },
    });
    expect(harness.snapshot().operationReceipts).toEqual(defaultSnapshot().operationReceipts);
  });

  it("rejects replay through a fingerprintless legacy receipt", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = [{ id: 1, name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 }];
    snapshot.configOperationReceipts = {
      "op-config-legacy-replay": {
        kind: "rewards",
        action: "upsert",
        updatedAt: "2026-09-24T10:00:00.000Z",
      },
    };
    const harness = makeHarness({ snapshot });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-legacy-replay",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 1, name: "Legacy", emoji: "🎬", cost: 25 },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "operation_conflict",
      operationId: "op-config-legacy-replay",
    });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.update).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it("persists sanitized replay config without replay PB writes", async () => {
    const command = {
      operationId: "op-config-sanitize-replay",
      kind: "rewards" as const,
      action: "upsert" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 1, name: "Legacy", emoji: "🎬", cost: 25 },
    };
    const config = await import(/* @vite-ignore */ configModulePath);
    const snapshot = defaultSnapshot();
    snapshot.rewards = [{ id: 1, name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 }];
    snapshot.configOperationReceipts = {
      [command.operationId]: {
        kind: command.kind,
        action: command.action,
        updatedAt: command.updatedAt,
        fingerprint: config.taskConfigCommandFingerprint(command),
      },
    };
    const harness = makeHarness({
      snapshot,
      rewards: [{ id: "movie-row", name: "Legacy", emoji: "👤", cost: 25 }],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig(command);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ applied: false, revision: { revision: "5" } });
    expect(body.items[0].emoji).toBe("👤");
    expect(harness.snapshot().rewards[0].emoji).toBe("👤");
    expect(harness.writes.snapshot).toHaveLength(1);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.update).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it("persists sanitized stale config without PB writes", async () => {
    const snapshot = defaultSnapshot();
    snapshot.rewards = [{ id: 1, name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 }];
    snapshot.rewardsUpdatedAt = "2026-09-24T11:00:00.000Z";
    const harness = makeHarness({
      snapshot,
      rewards: [{ id: "movie-row", name: "Legacy", emoji: "👤", cost: 25 }],
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-sanitize-stale",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      applied: false,
      updatedAt: "2026-09-24T11:00:00.000Z",
      revision: { revision: "6" },
    });
    expect(body.items[0].emoji).toBe("👤");
    expect(harness.snapshot().rewards[0].emoji).toBe("👤");
    expect(harness.snapshot().configOperationReceipts["op-config-sanitize-stale"]).toBeUndefined();
    expect(harness.writes.snapshot).toHaveLength(2);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.writes.rewards.update).toHaveLength(0);
    expect(harness.writes.rewards.delete).toHaveLength(0);
  });

  it("persists a stale repair marker until PB reconciliation succeeds", async () => {
    const command = {
      operationId: "op-config-stale-repair",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    };
    const config = await import(/* @vite-ignore */ configModulePath);
    const snapshot = defaultSnapshot();
    snapshot.rewards = [{ id: 1, name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 }];
    snapshot.rewardsUpdatedAt = "2026-09-24T11:00:00.000Z";
    const harness = makeHarness({
      snapshot,
      rewards: [{ id: "movie-row", name: "Legacy", emoji: "data:image/webp;base64,private", cost: 25 }],
      failConfigOperation: "update",
      failConfigRowId: "movie-row",
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const failed = await postConfig(command);
    const marked = harness.snapshot().configOperationReceipts[command.operationId];
    expect(failed.status).toBe(502);
    expect(marked).toEqual({
      kind: "rewards",
      action: "replace",
      updatedAt: command.updatedAt,
      fingerprint: config.taskConfigCommandFingerprint(command),
      reconcileRequired: true,
    });

    const repaired = await postConfig(command);

    expect(repaired.status).toBe(200);
    expect(harness.attempts.rewards.update).toBe(2);
    expect(harness.writes.rewards.update).toHaveLength(1);
    expect(harness.writes.rewards.create).toHaveLength(0);
    expect(harness.snapshot().configOperationReceipts[command.operationId]).toBeUndefined();
  });

  it("replays an operation without another snapshot or PB write", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-replay",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    };

    const first = await postConfig(command);
    const writesAfterFirst = {
      snapshot: harness.writes.snapshot.length,
      create: harness.writes.rewards.create.length,
      update: harness.writes.rewards.update.length,
    };
    const second = await postConfig(command);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).applied).toBe(false);
    expect(harness.writes.snapshot).toHaveLength(writesAfterFirst.snapshot);
    expect(harness.writes.rewards.create).toHaveLength(writesAfterFirst.create);
    expect(harness.writes.rewards.update).toHaveLength(writesAfterFirst.update);
  });

  it.each([
    ["kind", {
      operationId: "op-config-conflict",
      kind: "penalties",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Mess", emoji: "⚠️", points: 5 }],
    }],
    ["action", {
      operationId: "op-config-conflict",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      item: { id: 1, name: "Movie", emoji: "🎬", cost: 50 },
    }],
    ["timestamp", {
      operationId: "op-config-conflict",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:01.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    }],
    ["payload", {
      operationId: "op-config-conflict",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 75 }],
    }],
  ])("returns a stable conflict when an operationId is reused with a different %s", async (_field, mismatch) => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const original = {
      operationId: "op-config-conflict",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    };
    expect((await postConfig(original)).status).toBe(200);
    const writes = {
      snapshot: harness.writes.snapshot.length,
      create: harness.writes.rewards.create.length,
      update: harness.writes.rewards.update.length,
    };

    const first = await postConfig(mismatch);
    const second = await postConfig(mismatch);

    expect(first.status).toBe(409);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      success: false,
      error: "operation_conflict",
      operationId: "op-config-conflict",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual(firstBody);
    expect(harness.writes.snapshot).toHaveLength(writes.snapshot);
    expect(harness.writes.rewards.create).toHaveLength(writes.create);
    expect(harness.writes.rewards.update).toHaveLength(writes.update);
  });

  it("bounds config receipts by exported count and age while retaining newest operations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
    try {
      const config = await import(/* @vite-ignore */ configModulePath);
      expect(config.TASK_CONFIG_RECEIPT_MAX_COUNT).toBe(256);
      expect(config.TASK_CONFIG_RECEIPT_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
      const now = Date.now();
      const receipts: Record<string, any> = {};
      for (let index = 0; index < config.TASK_CONFIG_RECEIPT_MAX_COUNT + 14; index += 1) {
        receipts[`recent-${index}`] = {
          kind: "rewards",
          action: "replace",
          updatedAt: new Date(now - (config.TASK_CONFIG_RECEIPT_MAX_COUNT + 13 - index) * 1000).toISOString(),
          fingerprint: "a".repeat(64),
        };
      }
      receipts["too-old"] = {
        kind: "rewards",
        action: "replace",
        updatedAt: new Date(now - config.TASK_CONFIG_RECEIPT_MAX_AGE_MS - 1).toISOString(),
        fingerprint: "b".repeat(64),
      };
      const snapshot = defaultSnapshot();
      snapshot.configOperationReceipts = receipts;
      const harness = makeHarness({ snapshot });
      mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

      const response = await postConfig({
        operationId: "newest-config",
        kind: "rewards",
        action: "replace",
        updatedAt: "2026-09-24T10:00:00.000Z",
        items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
      });

      expect(response.status).toBe(200);
      const stored = harness.snapshot().configOperationReceipts;
      expect(Object.keys(stored)).toHaveLength(config.TASK_CONFIG_RECEIPT_MAX_COUNT);
      expect(stored["newest-config"]).toBeTruthy();
      expect(stored[`recent-${config.TASK_CONFIG_RECEIPT_MAX_COUNT + 13}`]).toBeTruthy();
      expect(stored["recent-13"]).toBeUndefined();
      expect(stored["too-old"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("repairs a failed PB create with the same operation", async () => {
    const harness = makeHarness({ failConfigOperation: "create" });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-create-repair",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    };

    const failed = await postConfig(command);
    const repaired = await postConfig(command);

    expect(failed.status).toBe(502);
    expect(repaired.status).toBe(200);
    expect(harness.attempts.rewards.create).toBe(2);
    expect(harness.writes.rewards.create).toHaveLength(1);
    expect(harness.writes.snapshot).toHaveLength(1);
    expect(harness.writes.tasks).toHaveLength(0);
    expect(harness.writes.week_data).toHaveLength(0);
  });

  it("repairs a failed PB update with the same operation", async () => {
    const harness = makeHarness({
      rewards: [{ id: "movie-row", name: "Movie", emoji: "🎬", cost: 25 }],
      failConfigOperation: "update",
      failConfigRowId: "movie-row",
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-update-repair",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "🍿", cost: 50 }],
    };

    const failed = await postConfig(command);
    const repaired = await postConfig(command);

    expect(failed.status).toBe(502);
    expect(repaired.status).toBe(200);
    expect(harness.attempts.rewards.update).toBe(2);
    expect(harness.writes.rewards.update).toHaveLength(1);
    expect(harness.writes.snapshot).toHaveLength(1);
  });

  it("repairs a failed PB delete with the same operation", async () => {
    const harness = makeHarness({
      rewards: [{ id: "stale-row", name: "Stale", emoji: "🗑️", cost: 5 }],
      failConfigOperation: "delete",
      failConfigRowId: "stale-row",
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-delete-repair",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    };

    const failed = await postConfig(command);
    const repaired = await postConfig(command);

    expect(failed.status).toBe(502);
    expect(repaired.status).toBe(200);
    expect(harness.attempts.rewards.delete).toBe(2);
    expect(harness.writes.rewards.delete).toHaveLength(1);
    expect(harness.writes.snapshot).toHaveLength(1);
  });

  it("resumes a mid-sequence PB create failure on the same operation", async () => {
    const harness = makeHarness({ failConfigOperation: "create", failConfigRowId: "B" });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-mid-create",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [
        { name: "A", emoji: "🅰️", cost: 1 },
        { name: "B", emoji: "🅱️", cost: 2 },
        { name: "C", emoji: "🇨", cost: 3 },
      ],
    };

    expect((await postConfig(command)).status).toBe(502);
    expect(harness.writes.rewards.create.map((entry) => entry.payload.name)).toEqual(["A"]);
    expect((await postConfig(command)).status).toBe(200);
    expect(harness.writes.rewards.create.map((entry) => entry.payload.name)).toEqual(["A", "B", "C"]);
    expect(harness.attempts.rewards.create).toBe(4);
    expect(harness.writes.snapshot).toHaveLength(1);
  });

  it("resumes a mid-sequence PB update failure on the same operation", async () => {
    const harness = makeHarness({
      rewards: [
        { id: "row-a", name: "A", emoji: "🅰️", cost: 1 },
        { id: "row-b", name: "B", emoji: "🅱️", cost: 2 },
        { id: "row-c", name: "C", emoji: "🇨", cost: 3 },
      ],
      failConfigOperation: "update",
      failConfigRowId: "row-b",
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-mid-update",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [
        { name: "A", emoji: "🍎", cost: 10 },
        { name: "B", emoji: "🍌", cost: 20 },
        { name: "C", emoji: "🍇", cost: 30 },
      ],
    };

    expect((await postConfig(command)).status).toBe(502);
    expect(harness.writes.rewards.update.map((entry) => entry.id)).toEqual(["row-a"]);
    expect((await postConfig(command)).status).toBe(200);
    expect(harness.writes.rewards.update.map((entry) => entry.id)).toEqual(["row-a", "row-b", "row-c"]);
    expect(harness.attempts.rewards.update).toBe(4);
    expect(harness.writes.snapshot).toHaveLength(1);
  });

  it("resumes a mid-sequence PB delete failure on the same operation", async () => {
    const harness = makeHarness({
      rewards: [
        { id: "row-a", name: "A", emoji: "🅰️", cost: 1 },
        { id: "row-b", name: "B", emoji: "🅱️", cost: 2 },
        { id: "row-c", name: "C", emoji: "🇨", cost: 3 },
      ],
      failConfigOperation: "delete",
      failConfigRowId: "row-b",
    });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = {
      operationId: "op-config-mid-delete",
      kind: "rewards" as const,
      action: "replace" as const,
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    };

    expect((await postConfig(command)).status).toBe(502);
    expect(harness.writes.rewards.delete.map((entry) => entry.id)).toEqual(["row-a"]);
    expect((await postConfig(command)).status).toBe(200);
    expect(harness.writes.rewards.delete.map((entry) => entry.id)).toEqual(["row-a", "row-b", "row-c"]);
    expect(harness.attempts.rewards.delete).toBe(4);
    expect(harness.writes.snapshot).toHaveLength(1);
  });

  it("sanitizes config emoji before snapshot and PB writes", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-emoji",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ name: "Movie", emoji: "data:image/webp;base64,private", cost: 50 }],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).items[0].emoji).toBe("👤");
    expect(harness.snapshot().rewards[0].emoji).toBe("👤");
    expect(harness.writes.rewards.create[0].payload.emoji).toBe("👤");
    expect(JSON.stringify(harness.writes)).not.toContain("base64");
  });

  it("locks config before snapshot and never acquires a week lock", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    await postConfig({
      operationId: "op-config-lock",
      kind: "rewards",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    });

    expect(mocks.lockOrder).toEqual([
      "acquire:task-config:rewards",
      "acquire:snapshot:tasks-snapshot",
      "release:snapshot:tasks-snapshot",
      "release:task-config:rewards",
    ]);
    expect(mocks.lockOrder.some((entry) => entry.includes("week-ledger"))).toBe(false);
  });

  it("accepts the exact future-skew boundary and rejects one millisecond beyond it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
    try {
      const config = await import(/* @vite-ignore */ configModulePath);
      expect(config.TASK_CONFIG_MAX_FUTURE_SKEW_MS).toBe(5 * 60 * 1000);
      const base = {
        operationId: "op-config-skew",
        kind: "rewards",
        action: "replace",
        items: [],
      };
      expect(config.parseTaskConfigCommand({
        ...base,
        updatedAt: "2026-09-24T10:05:00.000Z",
      }, (emoji: string) => emoji)).toMatchObject({ updatedAt: "2026-09-24T10:05:00.000Z" });
      expect(config.parseTaskConfigCommand({
        ...base,
        updatedAt: "2026-09-24T10:05:00.001Z",
      }, (emoji: string) => emoji)).toEqual({ error: "invalid_config_command" });

      const exact = makeHarness();
      mocks.withAdmin.mockImplementation((fn: any) => fn(exact.pb));
      const accepted = await postConfig({ ...base, updatedAt: "2026-09-24T10:05:00.000Z" });
      expect(accepted.status).toBe(200);

      const beyond = makeHarness();
      mocks.withAdmin.mockImplementation((fn: any) => fn(beyond.pb));
      const rejected = await postConfig({ ...base, updatedAt: "2026-09-24T10:05:00.001Z" });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: "invalid_config_command" });
      expect(beyond.writes.snapshot).toHaveLength(0);
      expect(beyond.writes.rewards.create).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a year-9999 stamp before any mutation", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "op-config-year-9999",
      kind: "rewards",
      action: "replace",
      updatedAt: "9999-12-31T23:59:59.999Z",
      items: [{ name: "Movie", emoji: "🎬", cost: 50 }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_config_command" });
    expect(harness.writes.snapshot).toHaveLength(0);
    expect(harness.writes.rewards.create).toHaveLength(0);
  });

  it("normalizes the command and rejects action-shape errors", async () => {
    const config = await import(/* @vite-ignore */ configModulePath);
    const parsed = config.parseTaskConfigCommand({
      operationId: " op-normalized ",
      kind: "weekly-prizes",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ rank: 2, emoji: "🥈", text: "Two" }],
    }, (emoji: string) => emoji);
    expect(parsed).toEqual({
      operationId: "op-normalized",
      kind: "weekly-prizes",
      action: "replace",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [{ id: "prize-2", rank: 2, emoji: "🥈", text: "Two" }],
    });
    expect(config.parseTaskConfigCommand({
      operationId: "op-invalid",
      kind: "rewards",
      action: "upsert",
      updatedAt: "2026-09-24T10:00:00.000Z",
      items: [],
    }, (emoji: string) => emoji)).toEqual({ error: "invalid_config_command" });
  });
});

describe("verifyLiveParentSession", () => {
  it("uses the live PB role even when the signed role is stale", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "parent-live", name: "Signed", role: "child" });
    const harness = makeHarness({ member: { id: "parent-live", name: "Live", role: "parent" } });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const liveMember = await vi.importActual<typeof import("@/lib/live-member")>(liveMemberModulePath);

    const result = await liveMember.verifyLiveParentSession(
      configRequest({}, "parent"),
    );

    expect(result).toEqual({
      ok: true,
      member: { id: "parent-live", name: "Live", role: "parent" },
    });
    expect(harness.api.memberGetOne).toHaveBeenCalledWith("parent-live", { requestKey: null });
    expect(harness.api.memberGetFirstListItem).not.toHaveBeenCalled();
  });

  it("fails closed when the signed member is missing from PB", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "parent-live", name: "Signed", role: "parent" });
    const harness = makeHarness({ member: null });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const liveMember = await vi.importActual<typeof import("@/lib/live-member")>(liveMemberModulePath);

    const result = await liveMember.verifyLiveParentSession(
      configRequest({}, "parent"),
    );

    expect(result).toEqual({ ok: false, status: 401, reason: "member_missing" });
    expect(harness.api.memberGetOne).toHaveBeenCalledWith("parent-live", { requestKey: null });
    expect(harness.api.memberGetFirstListItem).not.toHaveBeenCalled();
  });

  it("returns 503 when live PB verification is unavailable", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "parent-live", name: "Signed", role: "parent" });
    const harness = makeHarness({ memberError: new Error("private database failure") });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const liveMember = await vi.importActual<typeof import("@/lib/live-member")>(liveMemberModulePath);

    const result = await liveMember.verifyLiveParentSession(
      configRequest({}, "parent"),
    );

    expect(result).toEqual({ ok: false, status: 503, reason: "member_lookup_failed" });
    expect(harness.api.memberGetOne).toHaveBeenCalledWith("parent-live", { requestKey: null });
    expect(harness.api.memberGetFirstListItem).not.toHaveBeenCalled();
  });

  it("rejects a signed parent after live PB demotion", async () => {
    mocks.verifySession.mockResolvedValue({ memberId: "parent-live", name: "Signed", role: "parent" });
    const harness = makeHarness({ member: { id: "parent-live", name: "Live", role: "child" } });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const liveMember = await vi.importActual<typeof import("@/lib/live-member")>(liveMemberModulePath);

    const result = await liveMember.verifyLiveParentSession(
      configRequest({}, "parent"),
    );

    expect(result).toEqual({ ok: false, status: 403, reason: "adult_only" });
    expect(harness.api.memberGetOne).toHaveBeenCalledWith("parent-live", { requestKey: null });
  });
});

describe("reward action runner", () => {
  it("posts the reward through the config route", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        operationId: "config-rewards-action",
        kind: "rewards",
        items: [{ id: 1, name: "Movie", emoji: "🎬", cost: 50 }],
        updatedAt: "2026-09-24T10:00:00.000Z",
        revision: { revision: "2", updatedAt: "2026-09-24T10:00:00.000Z" },
        applied: true,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { runAction } = await import(/* @vite-ignore */ "@/lib/action-runner");
      const result = await runAction({
        type: "reward",
        title: "Movie",
        detail: "50 pts",
        emoji: "🎬",
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/config",
        expect.objectContaining({ method: "POST" }),
      );
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
        kind: "rewards",
        action: "upsert",
        item: { name: "Movie", emoji: "🎬", cost: 50 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns failure without success after a reward action network rejection", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { runAction } = await import(/* @vite-ignore */ "@/lib/action-runner");
      const result = await runAction({ type: "reward", title: "Movie", detail: "50 pts" });
      expect(result).toEqual({ success: false, message: "network unavailable" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns failure without success after a reward action 502", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "config_store_unreachable" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { runAction } = await import(/* @vite-ignore */ "@/lib/action-runner");
      const result = await runAction({ type: "reward", title: "Movie", detail: "50 pts" });
      expect(result).toEqual({ success: false, message: "Couldn't add reward \"Movie\"" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
