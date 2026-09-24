import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  withKeyedLock: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({ withAdmin: mocks.withAdmin }));
vi.mock("@/lib/keyed-lock", () => ({ withKeyedLock: mocks.withKeyedLock }));

import {
  liveSnapshotTasks,
  findSnapshotTask,
  deleteSnapshotTask,
  upsertSnapshotTask,
  readSnapshotWithRevision,
  mutateSnapshotWithMeta,
  persistSnapshotWeek,
  getSnapshotOperationReceipts,
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
  mocks.withKeyedLock.mockReset();
  mocks.withKeyedLock.mockImplementation(async (_key: string, fn: () => unknown) => fn());
});

describe("snapshot-tasks pure helpers", () => {
  it("liveSnapshotTasks hides tombstoned rows", () => {
    const data = { tasks: [t(1, "Dishes"), t(2, "Trash")], deletedTaskIds: [2] };
    expect(liveSnapshotTasks(data as any).map((x) => x.id)).toEqual([1]);
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
