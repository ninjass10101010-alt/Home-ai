import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { executeInternalTaskCommand, type InternalTaskCommand } from "@/lib/task-commands";
import {
  parseManageTaskCommand,
  taskManageInternalPayload,
} from "@/lib/task-manage";
import { __resetKeyedLockForTests } from "@/lib/keyed-lock";

type Row = Record<string, any>;

type Harness = {
  pb: any;
  snapshot: () => Row;
  tasks: () => Row[];
  snapshotWrites: () => number;
};

function task(id: number, overrides: Row = {}): Row {
  return {
    id,
    title: "Existing task",
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
    ...overrides,
  };
}

function makeHarness(options?: { snapshot?: Row; taskRows?: Row[] }): Harness {
  let snapshot = structuredClone(options?.snapshot ?? {
    revision: "4",
    tasks: [task(77)],
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
    title: "Existing task",
    assignee: "Alex Child",
    assigneeEmoji: "🦊",
    due: "2026-09-24",
    points: 5,
    recurring: null,
    category: "Chores",
    priority: "medium",
    status: "pending",
    completed: false,
    universal: false,
    stealable: false,
    crewSize: null,
    crew: null,
    speedBonus: null,
  }]);
  let snapshotWrites = 0;
  let taskSequence = taskRows.length;
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
            const row = { id: `pb-${++taskSequence}`, ...structuredClone(payload) };
            taskRows.push(row);
            return structuredClone(row);
          }),
          update: vi.fn(async (id: string, payload: Row) => {
            const index = taskRows.findIndex((row) => row.id === id);
            if (index < 0) throw new Error("missing task row");
            taskRows[index] = { ...taskRows[index], ...structuredClone(payload) };
            return structuredClone(taskRows[index]);
          }),
          delete: vi.fn(async (id: string) => {
            taskRows = taskRows.filter((row) => row.id !== id);
            return true;
          }),
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
  };
}

function commandFor(action: "add" | "update" | "delete", operationId: string, value: Row): InternalTaskCommand {
  const parsed = parseManageTaskCommand({ action, operationId, ...value });
  if ("error" in parsed) throw new Error(parsed.error);
  return {
    operationId,
    kind: action,
    actor: { memberId: "parent-live", name: "Live Parent", role: "parent" },
    payload: taskManageInternalPayload(parsed),
  };
}

function rawCommand(action: "add" | "update" | "delete", operationId: string, value: Row): InternalTaskCommand {
  return {
    operationId,
    kind: action,
    actor: { memberId: "parent-live", name: "Live Parent", role: "parent" },
    payload: { taskData: JSON.stringify(value) },
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.getLiveMembers.mockReset();
  __resetKeyedLockForTests();
  mocks.getLiveMembers.mockResolvedValue([
    { id: "parent-live", name: "Live Parent", role: "parent", emoji: "🧑" },
    { id: "child-1", name: "Alex Child", role: "child", emoji: "🦊" },
  ]);
});

describe("task manage internal registry", () => {
  it("dispatches add, update, and delete through the registered handlers", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));

    const added = await executeInternalTaskCommand(
      commandFor("add", "op-registry-add", { task: { title: "Registry add", assignee: "Alex Child", points: 1 } }),
      { source: "server" },
    );
    const updated = await executeInternalTaskCommand(
      commandFor("update", "op-registry-update", { taskId: 77, patch: { title: "Registry update" } }),
      { source: "server" },
    );
    const deleted = await executeInternalTaskCommand(
      commandFor("delete", "op-registry-delete", { taskId: 77 }),
      { source: "server" },
    );

    expect(added.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(harness.snapshot().tasks.some((row: Row) => row.id === 77)).toBe(false);
  });

  it.each([
    ["memberId", { memberId: "member-hidden" }],
    ["operationId", { operationId: "inner-operation" }],
    ["completed", { completed: true }],
    ["pendingApproval", { pendingApproval: {} }],
    ["deletedTaskIds", { deletedTaskIds: [77] }],
    ["history", { history: [] }],
    ["unknown", { mystery: true }],
  ])("rejects hidden %s fields before dispatch", async (_label, hidden) => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const result = await executeInternalTaskCommand(
      rawCommand("add", `op-hidden-${_label}`, {
        task: { title: "Hidden", assignee: "Alex Child", points: 1, ...hidden },
      }),
      { source: "hermes" },
    );

    expect(result.ok).toBe(false);
    expect(["forbidden_task_field", "forbidden_task_command_payload"]).toContain(result.reason);
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("replays by stored fingerprint after a later canonical edit", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const first = commandFor("update", "op-fingerprint-replay", { taskId: 77, patch: { title: "First title" } });
    const later = commandFor("update", "op-fingerprint-later", { taskId: 77, patch: { title: "Later title" } });

    expect((await executeInternalTaskCommand(first, { source: "server" })).ok).toBe(true);
    expect((await executeInternalTaskCommand(later, { source: "server" })).ok).toBe(true);
    const replay = await executeInternalTaskCommand(first, { source: "server" });

    expect(replay.ok).toBe(true);
    expect(harness.snapshot().tasks.find((row: Row) => row.id === 77).title).toBe("Later title");
  });

  it("rejects a reused operation with a different payload fingerprint", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const original = commandFor("update", "op-fingerprint-conflict", { taskId: 77, patch: { title: "Original" } });
    const changed = commandFor("update", "op-fingerprint-conflict", { taskId: 77, patch: { title: "Changed" } });

    expect((await executeInternalTaskCommand(original, { source: "server" })).ok).toBe(true);
    const replay = await executeInternalTaskCommand(changed, { source: "server" });

    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("operation_conflict");
  });

  it("rejects fingerprintless legacy receipts", async () => {
    const snapshot = {
      revision: "4",
      tasks: [task(77)],
      deletedTaskIds: [],
      operationReceipts: {
        "op-legacy-receipt": [{
          operationId: "op-legacy-receipt",
          action: "update",
          taskId: 77,
          createdAt: "2026-09-24T10:00:00.000Z",
        }],
      },
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    };
    const harness = makeHarness({ snapshot, taskRows: [] });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const result = await executeInternalTaskCommand(
      commandFor("update", "op-legacy-receipt", { taskId: 77, patch: { title: "Replay" } }),
      { source: "server" },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("operation_conflict");
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("returns roster failure instead of treating a failed read as an empty roster", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    mocks.getLiveMembers.mockRejectedValueOnce(new Error("PB unavailable"));
    const result = await executeInternalTaskCommand(
      commandFor("add", "op-roster-failure", { task: { title: "Roster", assignee: "Alex Child", points: 1 } }),
      { source: "server" },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("member_roster_unavailable");
    expect(harness.snapshotWrites()).toBe(0);
  });

  it("returns roster failure on a fingerprint replay instead of skipping validation", async () => {
    const harness = makeHarness();
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const command = commandFor("update", "op-replay-roster-failure", { taskId: 77, patch: { title: "First" } });
    expect((await executeInternalTaskCommand(command, { source: "server" })).ok).toBe(true);
    mocks.getLiveMembers.mockRejectedValueOnce(new Error("PB unavailable"));
    const writes = harness.snapshotWrites();
    const replay = await executeInternalTaskCommand(command, { source: "server" });

    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("member_roster_unavailable");
    expect(harness.snapshotWrites()).toBe(writes);
  });

  it("serializes concurrent add ID allocation with the actual keyed lock", async () => {
    const harness = makeHarness({ taskRows: [], snapshot: {
      revision: "4",
      tasks: [],
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
    } });
    mocks.withAdmin.mockImplementation((fn: any) => fn(harness.pb));
    const commands = [
      commandFor("add", "op-concurrent-a", { task: { title: "Concurrent A", assignee: "Alex Child", points: 1 } }),
      commandFor("add", "op-concurrent-b", { task: { title: "Concurrent B", assignee: "Alex Child", points: 1 } }),
    ];

    const results = await Promise.all(commands.map((command) => executeInternalTaskCommand(command, { source: "server" })));

    expect(results.every((result) => result.ok)).toBe(true);
    const ids = results.map((result) => result.task?.id);
    expect(new Set(ids).size).toBe(2);
    expect(harness.snapshot().tasks).toHaveLength(2);
  });
});
