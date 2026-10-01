import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({ withAdmin: mocks.withAdmin }));
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

import {
  liveSnapshotTasks,
  findSnapshotTask,
  findCanonicalTask,
  deleteSnapshotTask,
  upsertSnapshotTask,
  readSnapshotWithRevision,
  mutateSnapshotWithMeta,
  persistSnapshotWeek,
  getSnapshotOperationReceipts,
  taskProjectionRecord,
  projectCanonicalTaskToPB,
  createTaskRowCache,
} from "@/lib/snapshot-tasks";

const t = (id: number, title: string, extra: Record<string, any> = {}) => ({ id, title, ...extra });

const makePB = (row?: Record<string, unknown>) => {
  const collection = {
    getFullList: vi.fn().mockResolvedValue(row ? [row] : []),
    update: vi.fn(async (id: string, payload: Record<string, unknown>) => ({ id, ...payload })),
    create: vi.fn(async (payload: Record<string, unknown>) => ({ id: "created", ...payload })),
  };
  const pb = {
    collection: vi.fn(() => collection),
  };
  return { pb: pb as any, collection };
};

beforeEach(() => {
  mocks.withAdmin.mockReset();
  __resetKeyedLockForTests();
});

describe("snapshot-tasks pure helpers", () => {
  it("liveSnapshotTasks hides tombstoned rows", () => {
    const data = { tasks: [t(1, "Dishes"), t(2, "Trash")], deletedTaskIds: [2] };
    expect(liveSnapshotTasks(data as any).map((x) => x.id)).toEqual([1]);
  });

  it("exposes one canonical task projection record with stable defaults", () => {
    expect(taskProjectionRecord(t(1, "Dishes") as any)).toMatchObject({
      taskId: 1,
      title: "Dishes",
      assignee: "All",
      status: "pending",
      completed: false,
      crew: null,
    });
  });

  it("keeps caller-owned preloaded arrays untouched while the cache tracks writes", async () => {
    const stored: Record<string, any>[] = [{ id: "pb-1", taskId: 1, title: "Old title" }];
    const collection = {
      getFullList: vi.fn(async () => stored.map((row) => ({ ...row }))),
      update: vi.fn(async (id: string, payload: Record<string, unknown>) => ({ id, ...payload })),
      create: vi.fn(async (payload: Record<string, unknown>) => ({ id: "created", ...payload })),
      delete: vi.fn(async () => true),
    };
    const pb = { collection: vi.fn(() => collection) } as any;
    const callerRows = [{ id: "pb-1", taskId: 1, title: "Old title" }];
    const cache = createTaskRowCache(callerRows);

    const projected = await projectCanonicalTaskToPB(
      pb,
      t(1, "New title") as any,
      1,
      cache,
    );
    const deleted = await projectCanonicalTaskToPB(pb, null, 1, cache);

    expect(projected).toBe(true);
    expect(deleted).toBe(true);
    expect(callerRows).toEqual([{ id: "pb-1", taskId: 1, title: "Old title" }]);
    expect(cache.rows).toEqual([]);
  });

  it("findSnapshotTask resolves by taskId then exact title", () => {
    const tasks = [t(1, "Dishes"), t(2, "Trash")] as any;
    expect(findSnapshotTask(tasks, { taskId: 2 })?.title).toBe("Trash");
    expect(findSnapshotTask(tasks, { title: "dishes" })?.id).toBe(1);
    expect(findSnapshotTask(tasks, { title: "Nope" })).toBeNull();
  });

  it("deleteSnapshotTask removes the row AND records a tombstone", () => {
    const data = { tasks: [t(1, "Dishes"), t(2, "Trash")], deletedTaskIds: [] };
    const next = deleteSnapshotTask(data as any, 2);
    expect(next.tasks!.map((x) => x.id)).toEqual([1]);
    expect(next.deletedTaskIds).toContain(2);
  });

  it("upsertSnapshotTask replaces a row and clears its tombstone", () => {
    const data = { tasks: [t(1, "Dishes")], deletedTaskIds: [1, 9] };
    const next = upsertSnapshotTask(data as any, t(1, "Dishes v2") as any);
    expect(next.tasks!.find((x) => x.id === 1)!.title).toBe("Dishes v2");
    expect(next.deletedTaskIds).toEqual([9]);
  });
});

describe("snapshot revisions and receipts", () => {
  it("parses a string snapshot and returns its stored revision", async () => {
    const { pb } = makePB({
      id: "snapshot-1",
      data: JSON.stringify({
        revision: "7",
        tasks: [t(1, "Dishes")],
        operationReceipts: JSON.stringify({
          "op-old": {
            operationId: "op-old",
            action: "complete",
            taskId: 1,
            createdAt: "2026-09-21T10:00:00.000Z",
          },
        }),
      }),
      updated_at: "2026-09-21T10:01:00.000Z",
    });
    mocks.withAdmin.mockImplementation(async (fn: (client: unknown) => unknown) => fn(pb));

    const result = await readSnapshotWithRevision();

    expect(result.rowId).toBe("snapshot-1");
    expect(result.data.tasks).toEqual([t(1, "Dishes")]);
    expect(result.data.operationReceipts).toEqual({
      "op-old": [
        {
          operationId: "op-old",
          action: "complete",
          taskId: 1,
          createdAt: "2026-09-21T10:00:00.000Z",
        },
      ],
    });
    expect(result.revision).toEqual({
      revision: "7",
      updatedAt: "2026-09-21T10:01:00.000Z",
    });
  });

  it("uses revision zero when no canonical snapshot exists", async () => {
    const { pb } = makePB();
    mocks.withAdmin.mockImplementation(async (fn: (client: unknown) => unknown) => fn(pb));

    const result = await readSnapshotWithRevision();

    expect(result).toEqual({ data: {}, revision: { revision: "0", updatedAt: "" }, rowId: null });
  });

  it("increments a decimal revision and persists only sanitized receipt fields", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: JSON.stringify({ revision: "8", tasks: [] }),
    });

    const result = await mutateSnapshotWithMeta(
      (data) => ({
        data: {
          ...data,
          operationReceipts: {
            "op-safe": {
              operationId: "op-safe",
              action: "complete",
              taskId: 42,
              createdAt: "2026-09-21T11:00:00.000Z",
              pin: "must-not-persist",
              requestCredentials: "must-not-persist",
            },
          } as any,
        },
        result: "done" as const,
      }),
      pb,
    );

    expect(result.result).toBe("done");
    expect(result.revision.revision).toBe("9");
    expect(collection.update).toHaveBeenCalledOnce();
    const payload = collection.update.mock.calls[0][1] as any;
    expect(payload.data.revision).toBe("9");
    expect(payload.data.operationReceipts).toEqual({
      "op-safe": [
        {
          operationId: "op-safe",
          action: "complete",
          taskId: 42,
          createdAt: "2026-09-21T11:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-persist");
    expect(result.revision.updatedAt).toBe(payload.updated_at);
  });

  it("increments again on the next canonical mutation", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: { revision: "9", tasks: [] },
    });

    const result = await mutateSnapshotWithMeta(
      (data) => ({ data, result: null }),
      pb,
    );

    expect(result.revision.revision).toBe("10");
    expect((collection.update.mock.calls[0][1] as any).data.revision).toBe("10");
  });

  it("returns a revision and recomputes merged points from JSON ledger fields", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: {
        revision: "2",
        tasks: [],
        weekData: JSON.stringify({
          weekStart: "2026-09-21",
          points: JSON.stringify({ Alex: 999 }),
          streak: JSON.stringify({ Alex: 2 }),
          lastActive: JSON.stringify({ Alex: "2026-09-21" }),
          history: JSON.stringify([
            {
              id: 1,
              timestamp: "2026-09-21T10:00:00.000Z",
              member: "Alex",
              type: "earn",
              amount: 5,
              description: "Completed: Dishes",
            },
            {
              id: 2,
              timestamp: "2026-09-21T11:00:00.000Z",
              member: "Alex",
              type: "redeem",
              amount: -2,
              description: "Reward",
            },
          ]),
        }),
      },
    });

    const result = await persistSnapshotWeek(pb, {
      weekStart: "2026-09-21",
      points: {},
      streak: {},
      lastActive: {},
      history: [
        {
          id: 3,
          timestamp: "2026-09-21T12:00:00.000Z",
          member: "Alex",
          type: "adjust",
          amount: 1,
          description: "Bonus",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.revision.revision).toBe("3");
    const payload = collection.update.mock.calls[0][1] as any;
    expect(payload.data.weekData.points).toEqual({ Alex: 4 });
    expect(payload.data.weekData.history).toHaveLength(3);
    expect(payload.data.taskWeekStart).toBe("2026-09-21");
    expect(payload.updated_at).toBe(result.revision.updatedAt);
  });

  it("sorts offset-form history by UTC instant after canonicalization", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: {
        revision: "20",
        weekData: {
          weekStart: "2026-09-21",
          points: {},
          streak: {},
          lastActive: {},
          history: [
            {
              id: 2,
              timestamp: "2026-09-21T05:30:00-05:00",
              member: "Alex",
              type: "earn",
              amount: 2,
              description: "Later instant",
            },
            {
              id: 1,
              timestamp: "2026-09-21T12:00:00+02:00",
              member: "Alex",
              type: "earn",
              amount: 1,
              description: "Earlier instant",
            },
          ],
        },
      },
    });

    const result = await persistSnapshotWeek(pb, {
      weekStart: "2026-09-21",
      points: {},
      streak: {},
      lastActive: {},
      history: [],
    });

    expect(result.ok).toBe(true);
    const payload = collection.update.mock.calls[0][1] as any;
    expect(payload.data.weekData.history.map((transaction: any) => transaction.timestamp)).toEqual([
      "2026-09-21T10:00:00.000Z",
      "2026-09-21T10:30:00.000Z",
    ]);
  });

  it("recomputes balances on a task-only snapshot write while preserving streak data", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: {
        revision: "20",
        tasks: [t(42, "Dishes", { completed: false })],
        weekData: {
          weekStart: "2026-09-21",
          points: { Alex: 999 },
          streak: { Alex: 3 },
          lastActive: { Alex: "2026-09-21T10:00:00.000Z" },
          history: [
            {
              id: 1,
              timestamp: "2026-09-21T10:00:00.000Z",
              member: "Alex",
              type: "earn",
              amount: 5,
              description: "Completed: Dishes",
            },
          ],
        },
      },
    });

    const result = await persistSnapshotWeek(pb, null, { id: 42, completed: true });

    expect(result.ok).toBe(true);
    const payload = collection.update.mock.calls[0][1] as any;
    expect(payload.data.weekData.points).toEqual({ Alex: 5 });
    expect(payload.data.weekData.streak).toEqual({ Alex: 3 });
    expect(payload.data.weekData.lastActive).toEqual({ Alex: "2026-09-21T10:00:00.000Z" });
    expect(payload.data.weekData.history).toHaveLength(1);
  });

  it("fails closed when stored ledger history contains a malformed entry", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: {
        revision: "4",
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
              description: "Completed: Dishes",
            },
            {
              id: 2,
              timestamp: "2026-09-21T11:00:00.000Z",
              member: "Alex",
              type: "earn",
              amount: "not-a-number",
              description: "Malformed",
            },
          ],
        },
      },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await persistSnapshotWeek(pb, {
        weekStart: "2026-09-21",
        points: {},
        streak: {},
        lastActive: {},
        history: [],
      });

      expect(result).toEqual({
        ok: false,
        revision: { revision: "4", updatedAt: "" },
        error: "snapshot_write_failed",
      });
      expect(collection.update).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("stores every task outcome for one shared batch operation", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: { revision: "11", tasks: [] },
    });
    const receipts = [
      {
        operationId: "op-batch",
        action: "approve",
        taskId: 41,
        createdAt: "2026-09-21T11:00:00.000Z",
      },
      {
        operationId: "op-batch",
        action: "approve",
        taskId: 42,
        deleted: true,
        createdAt: "2026-09-21T11:00:01.000Z",
      },
    ];

    await mutateSnapshotWithMeta(
      (data) => ({
        data: {
          ...data,
          operationReceipts: { "op-batch": receipts } as any,
        },
        result: null,
      }),
      pb,
    );

    const payload = collection.update.mock.calls[0][1] as any;
    expect(payload.data.operationReceipts).toEqual({ "op-batch": receipts });
    expect(
      getSnapshotOperationReceipts(payload.data, "  op-batch  "),
    ).toEqual(receipts);
    expect(
      getSnapshotOperationReceipts(payload.data, "__proto__"),
    ).toEqual([]);
  });

  it("normalizes padded operation receipt IDs on replay", async () => {
    const { pb } = makePB({
      id: "snapshot-1",
      data: {
        revision: "12",
        operationReceipts: JSON.stringify({
          "  op-replay  ": [
            {
              operationId: "  op-replay  ",
              action: "approve-all",
              taskId: 42,
              createdAt: " 2026-09-21T11:00:00.000Z ",
            },
          ],
        }),
      },
      updated_at: "2026-09-21T11:01:00.000Z",
    });
    mocks.withAdmin.mockImplementation(async (fn: (client: unknown) => unknown) => fn(pb));

    const result = await readSnapshotWithRevision();

    expect(result.data.operationReceipts).toEqual({
      "op-replay": [
        {
          operationId: "op-replay",
          action: "approve-all",
          taskId: 42,
          createdAt: "2026-09-21T11:00:00.000Z",
        },
      ],
    });
  });

  it("drops receipts with invalid IDs, timestamps, or prototype-like operation IDs", async () => {
    const { pb, collection } = makePB({
      id: "snapshot-1",
      data: { revision: "13", tasks: [] },
    });
    const invalid = [
      ["zero", { operationId: "op-zero", action: "approve", taskId: 0, createdAt: "2026-09-21T11:00:00.000Z" }],
      ["negative", { operationId: "op-negative", action: "approve", taskId: -1, createdAt: "2026-09-21T11:00:00.000Z" }],
      ["fraction", { operationId: "op-fraction", action: "approve", taskId: 1.5, createdAt: "2026-09-21T11:00:00.000Z" }],
      ["blank-time", { operationId: "op-blank-time", action: "approve", taskId: 42, createdAt: " " }],
      ["bad-time", { operationId: "op-bad-time", action: "approve", taskId: 42, createdAt: "not-a-timestamp" }],
      ["__proto__", { operationId: "__proto__", action: "approve", taskId: 42, createdAt: "2026-09-21T11:00:00.000Z" }],
      ["constructor", { operationId: "constructor", action: "approve", taskId: 42, createdAt: "2026-09-21T11:00:00.000Z" }],
    ] as const;

    await mutateSnapshotWithMeta(
      (data) => ({
        data: {
          ...data,
          operationReceipts: Object.fromEntries(invalid) as any,
        },
        result: null,
      }),
      pb,
    );

    const receipts = (collection.update.mock.calls[0][1] as any).data.operationReceipts;
    expect(Object.keys(receipts)).toEqual([]);
    expect(Object.getPrototypeOf(receipts)).toBeNull();
  });

  it("serializes concurrent revision writes with the actual keyed lock", async () => {
    let storedRow: Record<string, unknown> = {
      id: "snapshot-1",
      data: { revision: "20", tasks: [] },
      updated_at: "2026-09-21T10:00:00.000Z",
    };
    let activeReads = 0;
    let maxActiveReads = 0;
    const collection = {
      getFullList: vi.fn(async () => {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeReads -= 1;
        return [structuredClone(storedRow)];
      }),
      update: vi.fn(async (id: string, payload: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        storedRow = { id, ...structuredClone(payload) };
        return storedRow;
      }),
      create: vi.fn(),
    };
    const pb = { collection: vi.fn(() => collection) } as any;

    const [first, second] = await Promise.all([
      mutateSnapshotWithMeta(
        (data) => ({ data: { ...data, taskWeekStart: "first" }, result: null }),
        pb,
      ),
      mutateSnapshotWithMeta(
        (data) => ({ data: { ...data, taskWeekStart: "second" }, result: null }),
        pb,
      ),
    ]);

    expect(first.revision.revision).toBe("21");
    expect(second.revision.revision).toBe("22");
    expect((storedRow.data as any).revision).toBe("22");
    expect((storedRow.data as any).taskWeekStart).toBe("second");
    expect(maxActiveReads).toBe(1);
  });

  it("returns a sanitized failure reason without exposing error details", async () => {
    const collection = {
      getFullList: vi.fn().mockRejectedValue(new Error("private-credential-material")),
      update: vi.fn(),
      create: vi.fn(),
    };
    const pb = { collection: vi.fn(() => collection) } as any;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await persistSnapshotWeek(pb, null, { id: 42, completed: true });

      expect(result).toEqual({
        ok: false,
        revision: { revision: "0", updatedAt: "" },
        error: "snapshot_write_failed",
      });
      expect(JSON.stringify(result)).not.toContain("private-credential-material");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("ledger repair markers survive the sanitizer and the mutation boundary", () => {
  const baseSnapshot = (markers: unknown[]) => ({
    revision: "1",
    taskWeekStart: "2026-09-21",
    tasks: [],
    deletedTaskIds: [],
    operationReceipts: {},
    configOperationReceipts: {},
    pendingProjectionRepairs: markers,
    weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
  });

  const ledgerMarker = (action: "penalty" | "adjust", operationId: string) => ({
    operationId,
    taskIds: [],
    action,
    actorId: "parent-1",
    fingerprint: "a".repeat(64),
    createdAt: "2026-09-24T10:01:00.000Z",
  });

  function snapshotHarness(initial: unknown[]) {
    let stored: any = {
      id: "snap-1",
      key: "tasks-snapshot",
      data: JSON.stringify(baseSnapshot(initial)),
    };
    const written: any[] = [];
    const pb = {
      collection: (name: string) => {
        if (name !== "consuela_data_snapshots") throw new Error("unexpected collection " + name);
        return {
          getFullList: async () => [structuredClone(stored)],
          update: async (id: string, payload: any) => {
            written.push(structuredClone(payload));
            stored = { ...stored, ...structuredClone(payload) };
            return stored;
          },
          create: async (payload: any) => {
            written.push(structuredClone(payload));
            stored = { id: "snap-1", ...structuredClone(payload) };
            return stored;
          },
        };
      },
    } as any;
    return {
      pb,
      written,
      data: () => (typeof stored.data === "string" ? JSON.parse(stored.data) : structuredClone(stored.data)),
    };
  }

  it("persists a penalty marker with an empty taskIds through a real snapshot write", async () => {
    const harness = snapshotHarness([ledgerMarker("penalty", "op-pen-persist")]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    // A 202 ledger command raises the marker, then the projection retries: the
    // write must not silently erase the record that it is unprojected.
    await mutateSnapshotWithMeta((data) => ({
      data: { ...data, revision: String(Number(data.revision ?? 0) + 1) },
      result: null,
    }));

    const persisted = harness.written.at(-1)!.data;
    const markers = JSON.parse(
      typeof persisted === "string" ? persisted : JSON.stringify(persisted),
    ).pendingProjectionRepairs;
    expect(markers).toEqual([ledgerMarker("penalty", "op-pen-persist")]);
  });

  it("persists an adjust marker with an empty taskIds, preserving every field", async () => {
    const harness = snapshotHarness([ledgerMarker("adjust", "op-adj-persist")]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    await mutateSnapshotWithMeta((data) => ({ data: { ...data }, result: null }));

    const markers = harness.data().pendingProjectionRepairs;
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      operationId: "op-adj-persist",
      taskIds: [],
      action: "adjust",
      actorId: "parent-1",
      fingerprint: "a".repeat(64),
      createdAt: "2026-09-24T10:01:00.000Z",
    });
  });

  it("reads a hand-written ledger marker back off the blob", async () => {
    const harness = snapshotHarness([ledgerMarker("penalty", "op-pen-read")]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const state = await readSnapshotWithRevision();
    expect(state.data.pendingProjectionRepairs).toEqual([
      ledgerMarker("penalty", "op-pen-read"),
    ]);
  });

  it("still drops an APPROVAL marker that carries no task id", async () => {
    const harness = snapshotHarness([
      { operationId: "op-approve-empty", taskIds: [], action: "approve", createdAt: "2026-09-24T10:01:00.000Z" },
    ]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const state = await readSnapshotWithRevision();
    expect(state.data.pendingProjectionRepairs).toEqual([]);
  });

  it("still validates a ledger marker's operationId, createdAt and action", async () => {
    const harness = snapshotHarness([
      { operationId: "", taskIds: [], action: "penalty", createdAt: "2026-09-24T10:01:00.000Z" },
      { operationId: "op-bad-time", taskIds: [], action: "penalty", createdAt: "not-a-time" },
      { operationId: "op-bad-action", taskIds: [], action: "explode", createdAt: "2026-09-24T10:01:00.000Z" },
      { operationId: "op-good", taskIds: [], action: "adjust", createdAt: "2026-09-24T10:01:00.000Z" },
    ]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const state = await readSnapshotWithRevision();
    expect(state.data.pendingProjectionRepairs).toEqual([
      { operationId: "op-good", taskIds: [], action: "adjust", createdAt: "2026-09-24T10:01:00.000Z" },
    ]);
  });

  it("a ledger marker survives a write that ALSO carries an approval marker", async () => {
    const harness = snapshotHarness([
      ledgerMarker("penalty", "op-pen-mixed"),
      { operationId: "op-approve-1", taskIds: [42], action: "approve", actorId: "parent-1", createdAt: "2026-09-24T10:02:00.000Z" },
    ]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    await mutateSnapshotWithMeta((data) => ({ data: { ...data }, result: null }));

    const markers = harness.data().pendingProjectionRepairs;
    expect(markers.map((m: any) => m.operationId).sort()).toEqual(["op-approve-1", "op-pen-mixed"]);
  });
});

describe("PB-source fallback (findCanonicalTask)", () => {
  it("carries crewCloseMode through the collection-row read (M2)", async () => {
    const pb = {
      collection: (name: string) => {
        if (name === "consuela_data_snapshots") {
          return {
            getFullList: async () => [{
              id: "snap-1",
              key: "tasks-snapshot",
              data: JSON.stringify({ revision: "7", tasks: [], deletedTaskIds: [] }),
            }],
          };
        }
        if (name === "tasks") {
          return {
            getFullList: async () => [{
              id: "pb-1", taskId: 77, title: "Garage reset", points: 15,
              crewSize: 3, crewCloseMode: "deadline", completed: true,
            }],
          };
        }
        return { getFullList: async () => [] };
      },
    } as any;

    const found = await findCanonicalTask(pb, 77);
    expect(found.source).toBe("pb");
    expect(found.task?.crewCloseMode).toBe("deadline");
  });
});
