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
      "acquire:snapshot:tasks-snapshot",
      "release:snapshot:tasks-snapshot",
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
