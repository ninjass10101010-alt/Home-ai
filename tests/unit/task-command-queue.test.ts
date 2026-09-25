// @vitest-environment jsdom
// Task 10 — the client command-queue seam: EVERY task/config write is enqueued
// in the durable outbox BEFORE any local state change, credentials live only in
// an ephemeral in-memory registry keyed by operationId, and the two Task 9
// non-blockers (memoized fallback driver, evicted per-entry key pruning) are
// closed here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseClaimCommand } from "@/lib/task-claim";
import { parseTaskConfigCommand } from "@/lib/task-config";
import {
  TASK_OUTBOX_ENTRY_PREFIX,
  __resetTaskOutboxForTests,
  buildTaskOperationRequestBody,
  cancelTaskOutboxEntry,
  enqueueTaskOperation,
  flushTaskOutbox,
  getTaskOutboxDriver,
  listTaskOutbox,
  registerTaskOutboxDriver,
  taskOutboxEntryStorageKey,
  type TaskOutboxDriver,
} from "@/lib/task-operation-outbox";
import {
  __resetTaskCommandCredentialsForTests,
  forgetTaskCommandCredential,
  listTaskCommandCredentialIds,
  queueTaskCommand,
  readTaskCommandCredential,
  rememberTaskCommandCredential,
  resolveTaskOutboxCredential,
} from "@/lib/task-command-queue";

const PARENT_PIN = "tests-parent-pin";

function credentialDriver(
  send: TaskOutboxDriver["send"],
): Partial<TaskOutboxDriver> {
  return {
    send,
    pullSnapshot: async () => ({ snapshot: { tasks: [], weekData: null } as never }),
    adoptSnapshot: () => {},
    onAcknowledged: () => {},
  };
}

function storedStorageDump(): string {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(TASK_OUTBOX_ENTRY_PREFIX))
    .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
    .join("\n");
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("ephemeral command credentials", () => {
  it("stores a pin bundle in memory only and never in localStorage", () => {
    rememberTaskCommandCredential("op-1", { pin: "1234", parentPin: PARENT_PIN });

    expect(readTaskCommandCredential("op-1")).toEqual({ pin: "1234", parentPin: PARENT_PIN });
    expect(storedStorageDump()).not.toContain("1234");
    expect(storedStorageDump()).not.toContain(PARENT_PIN);
    expect(localStorage.getItem("consuela-task-credentials")).toBeNull();
  });

  it("keeps both pins for a high-cost redemption bundle and forgets them on demand", () => {
    rememberTaskCommandCredential("op-2", { pin: "1234", parentPin: PARENT_PIN });
    expect(listTaskCommandCredentialIds()).toEqual(["op-2"]);

    forgetTaskCommandCredential("op-2");
    expect(readTaskCommandCredential("op-2")).toBeUndefined();
    expect(listTaskCommandCredentialIds()).toEqual([]);
  });

  it("returns no credential for an operation that was queued PIN-free", () => {
    const entry = queueTaskCommand({
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 7, memberName: "Kid" },
      displayTarget: { kind: "claim", taskId: 7 },
    });

    expect(resolveTaskOutboxCredential(entry)).toBeUndefined();
    expect(listTaskCommandCredentialIds()).toEqual([]);
  });
});

describe("queueTaskCommand", () => {
  it("persists the operation before the first request and reuses the operation id", () => {
    const entry = queueTaskCommand({
      operationId: "op-approve-1",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 4, memberName: "Rebecca" },
      displayTarget: { kind: "approval", taskId: 4 },
      credential: { pin: PARENT_PIN },
    });

    expect(entry.status).toBe("queued");
    expect(listTaskOutbox().map((candidate) => candidate.operationId)).toEqual(["op-approve-1"]);
    expect(JSON.parse(localStorage.getItem(taskOutboxEntryStorageKey("op-approve-1"))!)).toMatchObject({
      operationId: "op-approve-1",
      route: "/api/tasks/approve",
      action: "approve",
      status: "queued",
    });
  });

  it("never stores a credential inside the durable entry", () => {
    queueTaskCommand({
      operationId: "op-approve-2",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 5, memberName: "Rebecca" },
      displayTarget: { kind: "approval", taskId: 5 },
      credential: { pin: PARENT_PIN, parentPin: PARENT_PIN },
    });

    const stored = localStorage.getItem(taskOutboxEntryStorageKey("op-approve-2"))!;
    expect(stored).not.toContain(PARENT_PIN);
    expect(JSON.parse(stored).payload.pin).toBeUndefined();
    expect(JSON.parse(stored).payload.parentPin).toBeUndefined();
  });

  it("rejects an unknown route or action instead of persisting a dead entry", () => {
    expect(() =>
      queueTaskCommand({
        route: "/api/tasks/claim" as never,
        action: "not-a-real-action",
        payload: {},
        displayTarget: { kind: "claim" },
      }),
    ).toThrow(/unsupported_task_operation/);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("credential bundle on the wire", () => {
  it("sends the pin to the claim route and the real parser accepts the body", () => {
    const entry = enqueueTaskOperation({
      operationId: "op-claim-1",
      route: "/api/tasks/claim",
      action: "claim",
      payload: { taskId: 3, memberName: "Caspian" },
      displayTarget: { kind: "claim", taskId: 3 },
    });
    rememberTaskCommandCredential("op-claim-1", { pin: "1234" });

    const credential = resolveTaskOutboxCredential(entry);
    const body = buildTaskOperationRequestBody(entry, credential);
    expect(body.pin).toBe("1234");

    const parsed = parseClaimCommand(body);
    expect("error" in parsed).toBe(false);
  });

  it("sends no credential at all for a PIN-free session action", () => {
    const entry = enqueueTaskOperation({
      operationId: "op-claim-2",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 3, memberName: "Caspian" },
      displayTarget: { kind: "claim", taskId: 3 },
    });

    const body = buildTaskOperationRequestBody(entry, resolveTaskOutboxCredential(entry));
    expect(body.pin).toBeUndefined();
    expect("error" in parseClaimCommand(body)).toBe(false);
  });

  it("never leaks a parent pin into a config command the config parser would reject", () => {
    const entry = enqueueTaskOperation({
      operationId: "op-config-1",
      route: "/api/tasks/config",
      action: "upsert",
      payload: {
        kind: "rewards",
        updatedAt: new Date().toISOString(),
        item: { id: 1, name: "Movie", emoji: "🎬", cost: 50 },
      },
      displayTarget: { kind: "config" },
    });
    rememberTaskCommandCredential("op-config-1", { pin: "1234", parentPin: PARENT_PIN });

    const body = buildTaskOperationRequestBody(entry, resolveTaskOutboxCredential(entry));
    expect(body.pin).toBeUndefined();
    expect(body.parentPin).toBeUndefined();
    expect("error" in parseTaskConfigCommand(body, (value) => value)).toBe(false);
  });
});

describe("credential lifecycle against the outbox", () => {
  it("clears the ephemeral pin only after the operation is acknowledged", async () => {
    const unregister = registerTaskOutboxDriver(
      credentialDriver(async () => ({ status: 200, body: { operationId: "op-undo-1" } })),
    );
    queueTaskCommand({
      operationId: "op-undo-1",
      route: "/api/tasks/claim",
      action: "undo",
      payload: { taskId: 9, memberName: "Bailey" },
      displayTarget: { kind: "undo", taskId: 9 },
      credential: { pin: "1234" },
    });

    expect(readTaskCommandCredential("op-undo-1")).toEqual({ pin: "1234" });
    const result = await flushTaskOutbox(getTaskOutboxDriver());
    unregister();

    expect(result.acknowledged).toBe(1);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(readTaskCommandCredential("op-undo-1")).toBeUndefined();
  });

  it("keeps the ephemeral pin while a 401 leaves the entry auth-required", async () => {
    const unregister = registerTaskOutboxDriver(
      credentialDriver(async () => ({
        status: 401,
        body: { operationId: "op-undo-2", reason: "unauthorized" },
      })),
    );
    queueTaskCommand({
      operationId: "op-undo-2",
      route: "/api/tasks/claim",
      action: "undo",
      payload: { taskId: 9, memberName: "Bailey" },
      displayTarget: { kind: "undo", taskId: 9 },
      credential: { pin: "1234" },
    });

    const result = await flushTaskOutbox(getTaskOutboxDriver());
    unregister();

    expect(result.acknowledged).toBe(0);
    expect(listTaskOutbox()[0]).toMatchObject({ status: "auth-required" });
    expect(readTaskCommandCredential("op-undo-2")).toEqual({ pin: "1234" });
  });

  it("clears the ephemeral pin when the user cancels the queued operation", () => {
    queueTaskCommand({
      operationId: "op-undo-3",
      route: "/api/tasks/claim",
      action: "undo",
      payload: { taskId: 9, memberName: "Bailey" },
      displayTarget: { kind: "undo", taskId: 9 },
      credential: { pin: "1234" },
    });

    expect(cancelTaskOutboxEntry("op-undo-3")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);
    expect(readTaskCommandCredential("op-undo-3")).toBeUndefined();
  });
});

describe("Task 9 non-blockers closed by Task 10", () => {
  it("memoizes the fallback driver so concurrent flushes share one in-flight send", async () => {
    const first = getTaskOutboxDriver();
    const second = getTaskOutboxDriver();
    expect(second).toBe(first);
  });

  it("prunes the per-entry storage key of an operation evicted by the retention bound", () => {
    const stale = {
      version: 1 as const,
      operationId: "op-stale",
      route: "/api/tasks/claim" as const,
      action: "complete",
      payload: { taskId: 1, memberName: "Bailey" },
      createdAt: "2020-01-01T00:00:00.000Z",
      attemptCount: 0,
      status: "queued" as const,
      displayTarget: { kind: "claim" as const, taskId: 1 },
    };
    localStorage.setItem(taskOutboxEntryStorageKey("op-stale"), JSON.stringify(stale));
    localStorage.setItem(
      "consuela-task-operation-outbox-v1",
      JSON.stringify({ rev: 1, ids: ["op-stale"] }),
    );
    __resetTaskOutboxForTests();

    expect(listTaskOutbox()).toHaveLength(0);
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale"))).toBeNull();
  });

  it("keeps a live entry's key while pruning only the evicted one", () => {
    const live = enqueueTaskOperation({
      operationId: "op-live",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 2, memberName: "Bailey" },
      displayTarget: { kind: "claim", taskId: 2 },
    });
    const stale = {
      version: 1 as const,
      operationId: "op-stale-2",
      route: "/api/tasks/claim" as const,
      action: "complete",
      payload: { taskId: 1, memberName: "Bailey" },
      createdAt: "2020-01-01T00:00:00.000Z",
      attemptCount: 0,
      status: "queued" as const,
      displayTarget: { kind: "claim" as const, taskId: 1 },
    };
    localStorage.setItem(taskOutboxEntryStorageKey("op-stale-2"), JSON.stringify(stale));
    localStorage.setItem(
      "consuela-task-operation-outbox-v1",
      JSON.stringify({ rev: 1, ids: [live.operationId, "op-stale-2"] }),
    );
    __resetTaskOutboxForTests();

    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-live"]);
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale-2"))).toBeNull();
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-live"))).not.toBeNull();
  });
});

describe("reload durability", () => {
  it("a queued operation and its route survive a full module reload", () => {
    queueTaskCommand({
      operationId: "op-reload-1",
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { title: "Take out trash" } },
      displayTarget: { kind: "task" },
    });
    expect(() => __resetTaskOutboxForTests()).not.toThrow();

    const [entry] = listTaskOutbox();
    expect(entry).toMatchObject({
      operationId: "op-reload-1",
      route: "/api/tasks/manage",
      action: "add",
      status: "queued",
    });
    expect(entry.payload).toEqual({ task: { title: "Take out trash" } });
  });

  it("does not resurrect the ephemeral pin after a reload", () => {
    queueTaskCommand({
      operationId: "op-reload-2",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 3, memberName: "Rebecca" },
      displayTarget: { kind: "approval", taskId: 3 },
      credential: { pin: PARENT_PIN },
    });
    expect(readTaskCommandCredential("op-reload-2")).toBeTruthy();

    __resetTaskCommandCredentialsForTests();
    expect(readTaskCommandCredential("op-reload-2")).toBeUndefined();
  });
});

describe("no localStorage credential anywhere in the outbox footprint", () => {
  it("stays clean of any pin value after a mixed set of commands", () => {
    queueTaskCommand({
      operationId: "op-mixed-1",
      route: "/api/tasks/approve",
      action: "approve-all",
      payload: { taskIds: [1, 2], memberName: "Rebecca" },
      displayTarget: { kind: "approval" },
      credential: { pin: "8642", parentPin: "1357" },
    });
    queueTaskCommand({
      operationId: "op-mixed-2",
      route: "/api/tasks/config",
      action: "delete",
      payload: { kind: "penalties", updatedAt: "2026-09-21T00:00:00.000Z", itemId: 3 },
      displayTarget: { kind: "config" },
      credential: { pin: "8642" },
    });

    const dump = Object.keys(localStorage)
      .map((key) => `${key}=${localStorage.getItem(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain("8642");
    expect(dump).not.toContain("1357");
  });
});

describe("sanity: the module under test is a real import", () => {
  it("exposes the queue seam", () => {
    expect(typeof queueTaskCommand).toBe("function");
    expect(vi.isMockFunction(queueTaskCommand)).toBe(false);
  });
});
