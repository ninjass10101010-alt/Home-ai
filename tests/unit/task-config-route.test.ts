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
  snapshot: () => StoredSnapshot;
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
  let sequence = 0;

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
      getFirstListItem: vi.fn(async () => {
        if (name === "members") {
          if (options?.memberError) throw options.memberError;
          if (options?.member === null) {
            const error = new Error("missing") as Error & { status: number };
            error.status = 404;
            throw error;
          }
          return options?.member ?? { id: "parent-live", name: "Live Parent", role: "parent" };
        }
        return null;
      }),
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
        writes[name as "rewards" | "penalties" | "weekly_prizes"].delete.push({ id });
        rows[name] = (rows[name] ?? []).filter((row) => row.id !== id);
        return true;
      }),
    })),
  };

  return { pb, writes, snapshot: () => structuredClone(snapshot) };
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
      { id: "movie-id", payload: { name: "Movie", emoji: "🍿", cost: 50 } },
    ]);
    expect(harness.writes.rewards.delete.map((entry) => entry.id).sort()).toEqual([
      "duplicate-movie",
      "old-id",
    ]);
    expect(harness.writes.rewards.create).toHaveLength(0);
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

  it("stores a separate normalized receipt without task receipt data", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const response = await postConfig({
      operationId: "  op-config-receipt  ",
      kind: "penalties",
      action: "replace",
      updatedAt: "2026-09-24T12:00:00+02:00",
      items: [{ name: "Messy room", emoji: "⚠️", points: 5 }],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.operationId).toBe("op-config-receipt");
    expect(body.updatedAt).toBe("2026-09-24T10:00:00.000Z");
    expect(harness.snapshot().configOperationReceipts).toEqual({
      "op-config-receipt": {
        kind: "penalties",
        action: "replace",
        updatedAt: "2026-09-24T10:00:00.000Z",
      },
    });
    expect(harness.snapshot().operationReceipts).toEqual(defaultSnapshot().operationReceipts);
  });

  it("sanitizes replayed stored config before PB reconciliation", async () => {
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

    expect(response.status).toBe(200);
    expect((await response.json()).items[0].emoji).toBe("👤");
    expect(harness.writes.rewards.create[0].payload.emoji).toBe("👤");
    expect(JSON.stringify(harness.writes)).not.toContain("base64");
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
});
