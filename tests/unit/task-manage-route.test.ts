import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const parentTestCredential = "parent-test-credential";
const childTestCredential = "child-test-credential";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyLiveParentSession: vi.fn(),
  getLiveMembers: vi.fn(),
  lockOrder: [] as string[],
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/live-member", () => ({
  verifyLiveParentSession: mocks.verifyLiveParentSession,
  getLiveMembers: mocks.getLiveMembers,
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

vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: async <T>(_week: string, fn: () => Promise<T>): Promise<T> => {
    mocks.lockOrder.push("acquire:week-ledger");
    try {
      return await fn();
    } finally {
      mocks.lockOrder.push("release:week-ledger");
    }
  },
}));

type Row = Record<string, any>;

type Harness = {
  pb: any;
  snapshot: () => Row;
  tasks: () => Row[];
  snapshotWrites: () => number;
  taskWrites: () => number;
  removeTaskWithoutTombstone: (taskId: number) => void;
  failNextTaskWrite: () => void;
};

function defaultTask(): Row {
  return {
    id: 77,
    title: "Water plants",
    assignee: "Alex Child",
    assigneeEmoji: "🦊",
    due: "2026-09-24",
    points: 5,
    recurring: null,
    category: "Chores",
    priority: "medium",
    completed: false,
    universal: false,
    stealable: false,
    crewSize: null,
    crew: null,
  };
}

function makeHarness(options?: {
  snapshot?: Row;
  taskRows?: Row[];
  failTaskWrite?: boolean;
}): Harness {
  let snapshot = structuredClone(options?.snapshot ?? {
    revision: "4",
    tasks: [defaultTask()],
    deletedTaskIds: [],
    weekData: {
      weekStart: "2026-09-21",
      points: {},
      streak: {},
      lastActive: {},
      history: [],
    },
  });
  let taskRows = structuredClone(options?.taskRows ?? [{
    id: "pb-77",
    taskId: 77,
    title: "Water plants",
    assignee: "Alex Child",
    assigneeEmoji: "🦊",
    due: "2026-09-24",
    points: 5,
    category: "Chores",
    priority: "medium",
    status: "pending",
    completed: false,
    universal: false,
    stealable: false,
    crewSize: 0,
    crew: null,
    speedBonus: 0,
  }]);
  let snapshotWrites = 0;
  let taskWrites = 0;
  let failTaskWrite = Boolean(options?.failTaskWrite);

  const pb = {
    collection: vi.fn((name: string) => {
      if (name === "consuela_data_snapshots") {
        return {
          getFullList: vi.fn(async () => [{ id: "snapshot-1", data: structuredClone(snapshot), updated_at: "2026-09-24T10:00:00.000Z" }]),
          update: vi.fn(async (_id: string, payload: Row) => {
            snapshotWrites += 1;
            snapshot = structuredClone(payload.data);
            return { id: "snapshot-1", ...structuredClone(payload) };
          }),
          create: vi.fn(async (payload: Row) => {
            snapshotWrites += 1;
            snapshot = structuredClone(payload.data);
            return { id: "snapshot-1", ...structuredClone(payload) };
          }),
        };
      }
      if (name === "tasks") {
        return {
          getFullList: vi.fn(async () => structuredClone(taskRows)),
          create: vi.fn(async (payload: Row) => {
            taskWrites += 1;
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            const row = { id: `pb-${taskRows.length + 1}`, ...structuredClone(payload) };
            taskRows.push(row);
            return structuredClone(row);
          }),
          update: vi.fn(async (id: string, payload: Row) => {
            taskWrites += 1;
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            const index = taskRows.findIndex((row) => row.id === id);
            if (index < 0) throw new Error("missing task row");
            taskRows[index] = { ...taskRows[index], ...structuredClone(payload) };
            return structuredClone(taskRows[index]);
          }),
          delete: vi.fn(async (id: string) => {
            taskWrites += 1;
            if (failTaskWrite) {
              failTaskWrite = false;
              throw new Error("task projection failed");
            }
            taskRows = taskRows.filter((row) => row.id !== id);
            return true;
          }),
        };
      }
      if (name === "members") {
        return {
          getFullList: vi.fn(async () => [
            { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
            { id: "child-1", name: "Alex Child", role: "child", emoji: "🦊" },
            { id: "pet-1", name: "Pet A", role: "pet", emoji: "🐾" },
          ]),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    }),
  };

  return {
    pb,
    snapshot: () => structuredClone(snapshot),
    tasks: () => structuredClone(taskRows),
    snapshotWrites: () => snapshotWrites,
    taskWrites: () => taskWrites,
    removeTaskWithoutTombstone: (taskId: number) => {
      snapshot = {
        ...snapshot,
        tasks: (snapshot.tasks || []).filter((task: Row) => Number(task.id) !== taskId),
      };
    },
    failNextTaskWrite: () => {
      failTaskWrite = true;
    },
  };
}

function manageRequest(
  body: unknown,
  role: "parent" | "child" = "parent",
  options?: { liveMember?: "missing" },
): NextRequest {
  const credential = role === "parent" ? parentTestCredential : childTestCredential;
  return new NextRequest("http://localhost/api/tasks/manage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `consuela_session=${credential}`,
    },
    body: JSON.stringify(body),
  });
}

async function postManage(
  harness: Harness,
  body: unknown,
  role: "parent" | "child" = "parent",
  options?: { liveMember?: "missing" },
) {
  mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
  const { POST } = await import("@/app/api/tasks/manage/route");
  return POST(manageRequest(body, role, options));
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.verifyLiveParentSession.mockReset();
  mocks.getLiveMembers.mockReset();
  mocks.lockOrder.length = 0;
  mocks.getLiveMembers.mockResolvedValue([
    { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    { id: "child-1", name: "Alex Child", role: "child", emoji: "🦊" },
    { id: "pet-1", name: "Pet A", role: "pet", emoji: "🐾" },
  ]);
  mocks.verifyLiveParentSession.mockImplementation(async (request: NextRequest) => {
    if (request.cookies.get("consuela_session")?.value === childTestCredential) {
      return { ok: false as const, status: 403 as const, reason: "adult_only" };
    }
    return {
      ok: true as const,
      member: { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    };
  });
});

describe("POST /api/tasks/manage", () => {
  it("canonicalizes a unique live first name to the full PB name", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-first-name",
      task: { title: "First name", assignee: "Alex", points: 1 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.assignee).toBe("Alex Child");
  });

  it("normalizes a human assignee away when the task mode is open", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-open-mode",
      task: { title: "Open mode", assignee: "Alex Child", universal: true, points: 1 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task).toMatchObject({ assignee: "Open", assigneeEmoji: "🤝", universal: true });
  });

  it("does not rewrite an already canonical PB row on replay", async () => {
    const harness = makeHarness({ taskRows: [] });
    const command = {
      action: "add",
      operationId: "op-no-replay-write",
      task: { title: "Stable", assignee: "Alex Child", points: 1 },
    };
    expect((await postManage(harness, command)).status).toBe(200);
    const writesAfterFirst = harness.taskWrites();
    const second = await postManage(harness, command);

    expect(second.status).toBe(200);
    expect(harness.taskWrites()).toBe(writesAfterFirst);
  });

  it("normalizes an open task with the default speed bonus", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-open-default",
      task: { title: "Open default", universal: true, points: 1 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task).toMatchObject({ assignee: "Open", universal: true, speedBonus: 2 });
  });

  it("preserves member photo data in the snapshot but sanitizes the PB projection", async () => {
    const photo = "data:image/webp;base64,PHOTO";
    mocks.getLiveMembers.mockResolvedValue([
      { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
      { id: "child-1", name: "Alex Child", role: "child", emoji: photo },
    ]);
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-photo-canonical",
      task: { title: "Photo", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(200);
    const added = harness.snapshot().tasks.find((row: Row) => row.title === "Photo");
    expect(added?.assigneeEmoji).toBe(photo);
    expect(harness.tasks()[0]?.assigneeEmoji).toBe("👤");
  });

  it.each([
    ["universal", { universal: true }],
    ["assigned", { universal: false, crewSize: null, assignee: "Alex Child" }],
    ["crewSize null", { crewSize: null }],
  ])("rejects %s conversion that would lose crew state", async (_label, patch) => {
    const snapshot = {
      revision: "4",
      tasks: [{
        ...defaultTask(),
        assignee: "Crew",
        assigneeEmoji: "🤝",
        crewSize: 3,
        crew: {
          members: [{ name: "Alex Child", emoji: "🦊", joinedAt: "2026-09-24T09:00:00.000Z" }],
          removed: ["Removed Human"],
        },
      }],
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const harness = makeHarness({ snapshot, taskRows: [] });
    const response = await postManage(harness, {
      action: "update",
      operationId: `op-crew-convert-${_label.replace(/\s+/g, "-")}`,
      taskId: 77,
      patch,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_command" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("fails closed when duplicate exact live names exist", async () => {
    mocks.getLiveMembers.mockResolvedValue([
      { id: "child-a", name: "Alex Child", role: "child", emoji: "🦊" },
      { id: "child-b", name: "Alex Child", role: "child", emoji: "🐺" },
    ]);
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-duplicate-exact",
      task: { title: "Duplicate", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unknown_assignee" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("stores a normalized fingerprint in the task receipt", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-fingerprint-receipt",
      task: { title: "Fingerprint", assignee: "Alex Child", points: 1 },
    });
    expect(response.status).toBe(200);
    const receipt = harness.snapshot().operationReceipts["op-fingerprint-receipt"][0];
    expect(receipt.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("acknowledges an add replay after the added task is tombstoned", async () => {
    const harness = makeHarness({ taskRows: [] });
    const added = await postManage(harness, {
      action: "add",
      operationId: "op-add-later-delete",
      task: { title: "Delete later", assignee: "Alex Child", points: 1 },
    });
    const addedBody = await added.json();
    expect(added.status).toBe(200);
    const deleted = await postManage(harness, {
      action: "delete",
      operationId: "op-delete-after-add",
      taskId: addedBody.task.id,
    });
    expect(deleted.status).toBe(200);
    const writes = harness.snapshotWrites();

    const replay = await postManage(harness, {
      action: "add",
      operationId: "op-add-later-delete",
      task: { title: "Delete later", assignee: "Alex Child", points: 1 },
    });
    const replayBody = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayBody).toMatchObject({ success: true, duplicate: true, deleted: true, noCurrentTask: true, task: null });
    expect(harness.snapshotWrites()).toBe(writes);
    expect(harness.snapshot().tasks.some((row: Row) => row.id === addedBody.task.id)).toBe(false);
  });

  it("acknowledges an update replay after the updated task is tombstoned", async () => {
    const harness = makeHarness();
    const command = {
      action: "update",
      operationId: "op-update-later-delete",
      taskId: 77,
      patch: { title: "Deleted update" },
    };
    expect((await postManage(harness, command)).status).toBe(200);
    expect((await postManage(harness, {
      action: "delete",
      operationId: "op-delete-after-update",
      taskId: 77,
    })).status).toBe(200);
    const writes = harness.snapshotWrites();

    const replay = await postManage(harness, command);
    const replayBody = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayBody).toMatchObject({ success: true, duplicate: true, deleted: true, noCurrentTask: true, task: null });
    expect(harness.snapshotWrites()).toBe(writes);
  });

  it("keeps an untombstoned missing task repairable", async () => {
    const harness = makeHarness();
    const command = {
      action: "update",
      operationId: "op-missing-no-tombstone",
      taskId: 77,
      patch: { title: "Missing" },
    };
    expect((await postManage(harness, command)).status).toBe(200);
    harness.removeTaskWithoutTombstone(77);
    const writes = harness.snapshotWrites();

    const replay = await postManage(harness, command);
    const body = await replay.json();

    expect(replay.status).toBe(503);
    expect(body).toMatchObject({ error: "snapshot_write_failed" });
    expect(harness.snapshotWrites()).toBe(writes);
  });

  it("rejects a fingerprintless legacy receipt on replay", async () => {
    const snapshot = {
      revision: "4",
      tasks: [defaultTask()],
      deletedTaskIds: [],
      operationReceipts: {
        "op-legacy-route-receipt": [{
          operationId: "op-legacy-route-receipt",
          action: "update",
          taskId: 77,
          createdAt: "2026-09-24T10:00:00.000Z",
        }],
      },
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const harness = makeHarness({ snapshot, taskRows: [] });
    const response = await postManage(harness, {
      action: "update",
      operationId: "op-legacy-route-receipt",
      taskId: 77,
      patch: { title: "Replay" },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "operation_conflict" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("replays a prior operation after a later edit without changing canonical state", async () => {
    const harness = makeHarness();
    expect((await postManage(harness, {
      action: "update",
      operationId: "op-replay-later-original",
      taskId: 77,
      patch: { title: "Original" },
    })).status).toBe(200);
    expect((await postManage(harness, {
      action: "update",
      operationId: "op-replay-later-change",
      taskId: 77,
      patch: { title: "Changed later" },
    })).status).toBe(200);

    const replay = await postManage(harness, {
      action: "update",
      operationId: "op-replay-later-original",
      taskId: 77,
      patch: { title: "Original" },
    });

    expect(replay.status).toBe(200);
    expect(harness.snapshot().tasks.find((row: Row) => row.id === 77).title).toBe("Changed later");
  });

  it("rejects a reused operation with a different payload", async () => {
    const harness = makeHarness();
    expect((await postManage(harness, {
      action: "update",
      operationId: "op-reused-payload",
      taskId: 77,
      patch: { title: "First" },
    })).status).toBe(200);
    const response = await postManage(harness, {
      action: "update",
      operationId: "op-reused-payload",
      taskId: 77,
      patch: { title: "Second" },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "operation_conflict" });
  });

  it("returns 503 when roster lookup fails for a new add", async () => {
    mocks.getLiveMembers.mockRejectedValue(new Error("PB unavailable"));
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-roster-failure-route",
      task: { title: "Roster", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "member_roster_unavailable" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("rejects a pet assignee", async () => {
    const harness = makeHarness();
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-add-pet",
      task: { title: "Walk the pet", assignee: "Pet A", points: 5 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "pet_assignee" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("rejects completion fields in an update", async () => {
    const harness = makeHarness();
    const response = await postManage(harness, {
      action: "update",
      operationId: "op-update-forbidden",
      taskId: 77,
      patch: { completed: true },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "forbidden_task_field" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("deletes idempotently and records a server tombstone", async () => {
    const harness = makeHarness();
    const command = { action: "delete", operationId: "op-delete-77", taskId: 77 };

    const first = await postManage(harness, command);
    const second = await postManage(harness, command);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(harness.snapshot().deletedTaskIds).toContain(77);
    expect(harness.snapshot().tasks.some((task: Row) => task.id === 77)).toBe(false);
    expect(harness.tasks()).toHaveLength(0);
    expect(harness.snapshotWrites()).toBe(1);
  });

  it("does not require a roster lookup for delete", async () => {
    mocks.getLiveMembers.mockRejectedValue(new Error("roster unavailable"));
    const harness = makeHarness();
    const response = await postManage(harness, {
      action: "delete",
      operationId: "op-delete-no-roster",
      taskId: 77,
    });

    expect(response.status).toBe(200);
    expect(harness.snapshot().deletedTaskIds).toContain(77);
  });

  it("fails closed when the signed parent no longer exists in PB", async () => {
    const harness = makeHarness();
    mocks.verifyLiveParentSession.mockResolvedValue({ ok: false, status: 401, reason: "member_missing" });
    const response = await postManage(harness, {
      action: "delete",
      operationId: "op-delete-missing-parent",
      taskId: 77,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "member_missing" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("persists a valid add and mirrors the canonical row", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-add-valid",
      task: { title: "Read a book", assignee: "Alex Child", points: 8 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, operationId: "op-add-valid", reconciled: true });
    expect(body.task).toMatchObject({ title: "Read a book", assignee: "Alex Child", points: 8, completed: false });
    expect(harness.snapshot().tasks).toHaveLength(2);
    expect(harness.tasks()).toHaveLength(1);
    expect(harness.tasks()[0]).toMatchObject({ taskId: body.task.id, title: "Read a book" });
  });

  it("keeps the canonical receipt and repairs PB on the same operation retry", async () => {
    const harness = makeHarness({ taskRows: [], failTaskWrite: true });
    const command = {
      action: "add",
      operationId: "op-add-projection-retry",
      task: { title: "Repair me", assignee: "Alex Child", points: 3 },
    };

    const first = await postManage(harness, command);
    const firstBody = await first.json();
    const snapshotAfterFirst = harness.snapshot();
    expect(first.status).toBe(202);
    expect(firstBody).toMatchObject({ success: true, reconciled: false });
    expect(snapshotAfterFirst.operationReceipts["op-add-projection-retry"]).toEqual([
      expect.objectContaining({ action: "add", taskId: firstBody.task.id }),
    ]);

    const second = await postManage(harness, command);
    expect(second.status).toBe(200);
    expect((await second.json()).reconciled).toBe(true);
    expect(harness.snapshotWrites()).toBe(1);
    expect(harness.snapshot().tasks).toEqual(snapshotAfterFirst.tasks);
    expect(harness.tasks()).toHaveLength(1);
  });

  it("rejects a mismatched replay without changing canonical state", async () => {
    const harness = makeHarness();
    const first = await postManage(harness, {
      action: "add",
      operationId: "op-replay-conflict",
      task: { title: "First", assignee: "Alex Child", points: 1 },
    });
    expect(first.status).toBe(200);
    const before = harness.snapshot();

    const conflict = await postManage(harness, {
      action: "delete",
      operationId: "op-replay-conflict",
      taskId: 77,
    });

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "operation_conflict" });
    expect(harness.snapshot()).toEqual(before);
  });

  it("acquires the week lock before the snapshot lock", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-lock-order",
      task: { title: "Locked", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(200);
    expect(mocks.lockOrder).toEqual([
      "acquire:week-ledger",
      "acquire:task-command:allocation",
      "acquire:snapshot:tasks-snapshot",
      "release:snapshot:tasks-snapshot",
      "release:task-command:allocation",
      "release:week-ledger",
    ]);
  });

  it.each([
    ["update", { action: "update", operationId: "op-lock-update", taskId: 77, patch: { title: "Locked update" } }],
    ["delete", { action: "delete", operationId: "op-lock-delete", taskId: 77 }],
  ])("uses the per-task command lock for %s", async (_action, body) => {
    const harness = makeHarness();
    mocks.lockOrder.length = 0;
    const response = await postManage(harness, body);

    expect(response.status).toBe(200);
    expect(mocks.lockOrder).toEqual([
      "acquire:week-ledger",
      "acquire:task-command:77",
      "acquire:snapshot:tasks-snapshot",
      "release:snapshot:tasks-snapshot",
      "release:task-command:77",
      "release:week-ledger",
    ]);
  });

  it.each([
    ["title", { title: "x".repeat(201) }],
    ["due", { due: "2026-02-30" }],
    ["points", { points: 1.5 }],
    ["category", { category: "x".repeat(41) }],
    ["mode", { universal: true, crewSize: 2 }],
    ["crew", { crewSize: 1 }],
    ["speed", { universal: true, speedBonus: 6 }],
    ["speed-null", { universal: true, speedBonus: null }],
    ["emoji", { assigneeEmoji: {} }],
  ])("rejects invalid %s input before canonical writes", async (_label, invalid) => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: `op-invalid-${_label}`,
      task: { title: "Valid", assignee: "Alex Child", points: 1, ...invalid },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_command" });
    expect(harness.snapshotWrites()).toBe(0);
    expect(harness.tasks()).toHaveLength(0);
  });

  it("rejects nested operation IDs and approval or ledger fields", async () => {
    const harness = makeHarness();
    const cases = [
      { task: { title: "Nested", assignee: "Alex Child", points: 1, operationId: "inner" } },
      { task: { title: "Approval", assignee: "Alex Child", points: 1, pendingApproval: {} } },
      { task: { title: "Ledger", assignee: "Alex Child", points: 1, history: [] } },
    ];
    for (const [index, value] of cases.entries()) {
      const response = await postManage(harness, {
        action: "add",
        operationId: `op-forbidden-${index}`,
        ...value,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "forbidden_task_field" });
    }
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("uses only the live PB roster for assignees", async () => {
    mocks.getLiveMembers.mockResolvedValue([
      { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    ]);
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-no-fallback-assignee",
      task: { title: "No fallback", assignee: "Alex Child", points: 1 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unknown_assignee" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("allocates new IDs outside live rows and tombstones", async () => {
    const reserved = Date.now() + 10_000_000;
    const harness = makeHarness({
      taskRows: [],
      snapshot: {
        revision: "4",
        tasks: [defaultTask()],
        deletedTaskIds: [reserved],
        weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
      },
    });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-reserved-id",
      task: { title: "Fresh", assignee: "Alex Child", points: 1 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.id).not.toBe(77);
    expect(body.task.id).not.toBe(reserved);
  });

  it("rejects shrinking a crew below its joined members", async () => {
    const snapshot = {
      revision: "4",
      tasks: [{
        ...defaultTask(),
        assignee: "Crew",
        assigneeEmoji: "🤝",
        crewSize: 3,
        crew: {
          members: [
            { name: "Alex Child", emoji: "🦊", joinedAt: "2026-09-24T09:00:00.000Z" },
            { name: "Live Parent", emoji: "🧑", joinedAt: "2026-09-24T09:00:00.000Z" },
            { name: "Another Human", emoji: "🙂", joinedAt: "2026-09-24T09:00:00.000Z" },
          ],
        },
      }],
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const harness = makeHarness({ snapshot, taskRows: [] });
    const response = await postManage(harness, {
      action: "update",
      operationId: "op-crew-shrink",
      taskId: 77,
      patch: { crewSize: 2 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_command" });
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("normalizes legacy zero crew fields during an unrelated update", async () => {
    const snapshot = {
      revision: "4",
      tasks: [{ ...defaultTask(), crewSize: 0, speedBonus: 0 }],
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const harness = makeHarness({ snapshot, taskRows: [] });
    const response = await postManage(harness, {
      action: "update",
      operationId: "op-legacy-zero-crew",
      taskId: 77,
      patch: { title: "Legacy update" },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({ title: "Legacy update", crewSize: null });
  });

  it("repairs an update projection with the same operation", async () => {
    const harness = makeHarness();
    harness.failNextTaskWrite();
    const command = {
      action: "update",
      operationId: "op-update-projection-retry",
      taskId: 77,
      patch: { title: "Repaired title" },
    };
    const first = await postManage(harness, command);
    expect(first.status).toBe(202);
    const afterFirst = harness.snapshot();
    const second = await postManage(harness, command);

    expect(second.status).toBe(200);
    expect((await second.json()).reconciled).toBe(true);
    expect(harness.snapshotWrites()).toBe(1);
    expect(harness.snapshot().tasks).toEqual(afterFirst.tasks);
    expect(harness.tasks()[0]).toMatchObject({ taskId: 77, title: "Repaired title" });
  });

  it("rejects a same-operation update with a different payload", async () => {
    const harness = makeHarness();
    const first = await postManage(harness, {
      action: "update",
      operationId: "op-payload-conflict",
      taskId: 77,
      patch: { title: "Original" },
    });
    expect(first.status).toBe(200);
    const before = harness.snapshot();

    const conflict = await postManage(harness, {
      action: "update",
      operationId: "op-payload-conflict",
      taskId: 77,
      patch: { title: "Different" },
    });

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "operation_conflict" });
    expect(harness.snapshot()).toEqual(before);
  });
});

describe("POST /api/tasks/manage — crewCloseMode", () => {
  it("accepts a crew task with a valid crewCloseMode and stores it", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-crew-close-mode",
      task: { title: "Wash the car", crewSize: 3, crewCloseMode: "deadline", points: 15 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task).toMatchObject({ crewCloseMode: "deadline", crewSize: 3 });
    const stored = harness.snapshot().tasks.find((task: Row) => task.title === "Wash the car");
    expect(stored?.crewCloseMode).toBe("deadline");
  });

  it("defaults a crew task's crewCloseMode to strict", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-crew-close-default",
      task: { title: "Wash the car", crewSize: 3, points: 15 },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.crewCloseMode).toBe("strict");
    const stored = harness.snapshot().tasks.find((task: Row) => task.title === "Wash the car");
    expect(stored?.crewCloseMode).toBe("strict");
  });

  it("refuses crewCloseMode on a non-crew task", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-crew-close-solo",
      task: { title: "Dishes", assignee: "Alex Child", crewCloseMode: "parent", points: 15 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_command" });
    expect(harness.snapshotWrites()).toBe(0);
    expect(harness.snapshot().tasks.some((task: Row) => task.title === "Dishes")).toBe(false);
  });

  it("refuses an unknown crewCloseMode string", async () => {
    const harness = makeHarness({ taskRows: [] });
    const response = await postManage(harness, {
      action: "add",
      operationId: "op-crew-close-chaos",
      task: { title: "Wash the car", crewSize: 3, crewCloseMode: "chaos", points: 15 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_task_command" });
    expect(harness.snapshotWrites()).toBe(0);
    expect(harness.snapshot().tasks.some((task: Row) => task.title === "Wash the car")).toBe(false);
  });
});
