// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { loadTasks } from "@/lib/task-utils";
import type { SnapshotData } from "@/lib/snapshot-tasks";
import {
  TASK_OUTBOX_BASE_BACKOFF_MS,
  TASK_OUTBOX_MAX_ATTEMPTS,
  TASK_OUTBOX_MAX_AUTH_BACKOFF_MS,
  TASK_OUTBOX_MAX_BACKOFF_MS,
  TASK_OUTBOX_MAX_RECONCILE_BACKOFF_MS,
  TASK_OUTBOX_MAX_ENTRIES,
  TASK_OUTBOX_REQUEST_TIMEOUT_MS,
  TASK_OUTBOX_STORAGE_KEY,
  __resetTaskOutboxForTests,
  buildTaskOperationRequestBody,
  cancelTaskOutboxEntry,
  createTaskOperationId,
  enqueueTaskOperation,
  flushTaskOutbox,
  getTaskOutboxServerSnapshot,
  getTaskOutboxSnapshot,
  listTaskOutbox,
  pullTaskSnapshotDocument,
  createFetchTaskOutboxDriver,
  registerTaskOutboxDriver,
  removeTaskOutboxEntry,
  requestTaskOutboxFlush as requestFlush,
  requestTaskOutboxFlush,
  sendTaskOperationRequest,
  snapshotProvesResolved,
  subscribeTaskOutbox,
  taskOutboxAuthBackoffMs,
  taskOutboxBackoffMs,
  taskOutboxEntryStorageKey,
  taskOutboxOrphanStorageIds,
  taskOutboxReconcileBackoffMs,
  type SnapshotRead,
  type TaskOutboxAcknowledgement,
  type TaskOutboxDriver,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";
import { parseClaimCommand } from "@/lib/task-claim";
import { parseApproveCommand } from "@/lib/task-approval";
import { parseManageTaskCommand } from "@/lib/task-manage";
import { parseTaskConfigCommand } from "@/lib/task-config";
import { useTaskOperationOutbox, type UseTaskOperationOutboxResult } from "@/hooks/useTaskOperationOutbox";

vi.mock("@/db", () => ({
  db: {
    upsertTask: vi.fn(async () => null),
    selectHallOfFame: vi.fn(async () => []),
    insertHallOfFameEntry: vi.fn(async () => null),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PIN = "test-credential-value";
const OTHER_PIN = "second-credential-value";

function allStoredText(): string {
  const collected: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null) collected[key] = window.localStorage.getItem(key) ?? "";
  }
  return JSON.stringify(collected);
}

function readStoredEntry(operationId: string): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(taskOutboxEntryStorageKey(operationId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

function storedIds(): string[] {
  const raw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { rev?: number; ids?: string[] };
  return Array.isArray(parsed.ids) ? parsed.ids : [];
}

function writeForeignEntry(entry: Record<string, unknown>): void {
  const operationId = String(entry.operationId);
  window.localStorage.setItem(taskOutboxEntryStorageKey(operationId), JSON.stringify(entry));
  const ids = storedIds();
  window.localStorage.setItem(
    TASK_OUTBOX_STORAGE_KEY,
    JSON.stringify({ rev: 99, ids: [...new Set([...ids, operationId])] }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: taskOutboxEntryStorageKey(operationId),
      newValue: JSON.stringify(entry),
      storageArea: window.localStorage,
    }),
  );
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: TASK_OUTBOX_STORAGE_KEY,
      newValue: window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY),
      storageArea: window.localStorage,
    }),
  );
}

function expireBackoff(operationId: string): void {
  const entry = readStoredEntry(operationId);
  if (!entry) return;
  window.localStorage.setItem(
    taskOutboxEntryStorageKey(operationId),
    JSON.stringify({ ...entry, nextAttemptAt: new Date(Date.now() - 1_000).toISOString() }),
  );
  window.localStorage.setItem(
    TASK_OUTBOX_STORAGE_KEY,
    JSON.stringify({ rev: 100, ids: storedIds() }),
  );
}

function enqueueClaim(overrides: Partial<Parameters<typeof enqueueTaskOperation>[0]> = {}) {
  return enqueueTaskOperation({
    operationId: "op-claim-1",
    route: "/api/tasks/claim",
    action: "complete",
    payload: { taskId: 42, memberName: "Caspian", pin: PIN },
    displayTarget: { taskId: 42, title: "Dishes", kind: "claim" },
    ...overrides,
  });
}

function ack(
  operationId: string,
  overrides: Partial<TaskOutboxAcknowledgement> = {},
): TaskOutboxAcknowledgement {
  return { operationId, reconciled: true, ...overrides };
}

function errorAck(
  operationId: string,
  extra: Record<string, unknown> = {},
): TaskOutboxAcknowledgement {
  return { operationId, reconciled: false, ...extra };
}

const ADOPT_NOOP = async () => {};

async function flushWithAdoption(options: Partial<TaskOutboxDriver>) {
  return flushTaskOutbox({
    onAcknowledged: ADOPT_NOOP,
    adoptSnapshot: ADOPT_NOOP,
    ...options,
  } as TaskOutboxDriver);
}

function respond(status: number, body: TaskOutboxAcknowledgement) {
  return async () => ({ status, body });
}

function snapshotOf(
  tasks: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): SnapshotRead {
  return {
    snapshot: {
      tasks,
      deletedTaskIds: [],
      weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
      rewards: [],
      rewardsUpdatedAt: "",
      penalties: [],
      penaltiesUpdatedAt: "",
      weeklyPrizes: [],
      weeklyPrizesStamp: "",
      ...extra,
    } as unknown as SnapshotData,
    reconciled: true,
  };
}

function canonicalTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    title: "Dishes",
    assignee: "Caspian",
    points: 5,
    completed: false,
    crewSize: 0,
    ...overrides,
  };
}

function entryFor(operationId: string): TaskOutboxEntry {
  const found = listTaskOutbox().find((entry) => entry.operationId === operationId);
  if (!found) throw new Error(`missing outbox entry ${operationId}`);
  return found;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetTaskOutboxForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  __resetTaskOutboxForTests();
});

describe("storage and sanitization", () => {
  it("persists a sanitized entry and reuses its operation ID", () => {
    const entry = enqueueClaim();

    expect(listTaskOutbox()).toHaveLength(1);
    expect(entry.operationId).toBe("op-claim-1");
    expect(allStoredText()).not.toContain(PIN);
    expect(allStoredText()).not.toContain("pin");
  });

  it("never stores credentials, authority, history, or ledger fields", () => {
    enqueueTaskOperation({
      operationId: "op-manage-1",
      route: "/api/tasks/manage",
      action: "update",
      payload: {
        taskId: 7,
        patch: { title: "Trash", points: 9, pin: PIN, weekData: { points: { Caspian: 900 } } },
        token: OTHER_PIN,
        history: [{ id: 1 }],
        weekData: { history: [] },
        authorization: `Bearer ${PIN}`,
        secret: PIN,
        completedBy: "Alex",
      },
      displayTarget: { taskId: 7, kind: "task" },
    });

    const raw = allStoredText();
    for (const forbidden of [PIN, OTHER_PIN, "token", "secret", "authorization", "history", "weekData", "completedBy"]) {
      expect(raw).not.toContain(forbidden);
    }
    expect(readStoredEntry("op-manage-1")?.payload).toEqual({ taskId: 7, patch: { title: "Trash", points: 9 } });
  });

  it("keeps legitimate manage and config fields the routes require", () => {
    enqueueTaskOperation({
      operationId: "op-manage-add",
      route: "/api/tasks/manage",
      action: "add",
      payload: {
        task: {
          title: "Recycle",
          assignee: "Bailey",
          assigneeEmoji: "🐻",
          due: "2026-09-27",
          points: 10,
          recurring: "weekly",
          category: "chores",
          priority: "high",
          universal: true,
          stealable: true,
          crewSize: 3,
          speedBonus: 2,
          completed: true,
          pendingApproval: { byName: "X", at: "now", points: 999 },
        },
      },
      displayTarget: { temporaryId: 5150, title: "Recycle", kind: "task" },
    });
    enqueueTaskOperation({
      operationId: "op-config-replace",
      route: "/api/tasks/config",
      action: "replace",
      payload: {
        kind: "rewards",
        updatedAt: "2026-09-25T10:00:00.000Z",
        items: [{ name: "Ice cream", emoji: "🍦", cost: 40, category: "treat", weeklyPoints: 900 }],
      },
      displayTarget: { kind: "config" },
    });

    const added = entryFor("op-manage-add");
    const config = entryFor("op-config-replace");
    const task = added.payload.task as Record<string, unknown>;

    expect(task.points).toBe(10);
    expect(task.crewSize).toBe(3);
    expect(task.universal).toBe(true);
    expect(task.speedBonus).toBe(2);
    expect(task).not.toHaveProperty("completed");
    expect(task).not.toHaveProperty("pendingApproval");
    expect(config.payload.items).toEqual([
      { name: "Ice cream", emoji: "🍦", cost: 40, category: "treat" },
    ]);
  });

  it("restores queued entries after a reload with no credential material", async () => {
    enqueueClaim();
    vi.resetModules();
    const reloaded = await import("@/lib/task-operation-outbox");

    const restored = reloaded.listTaskOutbox();
    expect(restored).toHaveLength(1);
    expect(restored[0].operationId).toBe("op-claim-1");
    expect(restored[0].status).toBe("queued");
    expect(allStoredText()).not.toContain(PIN);
  });

  it("treats corrupt or foreign storage contents as an empty outbox", () => {
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, "{not json");
    expect(listTaskOutbox()).toEqual([]);

    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(listTaskOutbox()).toEqual([]);

    window.localStorage.setItem(
      TASK_OUTBOX_STORAGE_KEY,
      JSON.stringify({ rev: 1, ids: ["missing-entry", "toString"] }),
    );
    expect(listTaskOutbox()).toEqual([]);
  });

  it("keeps a session-usable entry when storage writes fail with a quota error", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => enqueueClaim()).not.toThrow();
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].operationId).toBe("op-claim-1");

    setItem.mockRestore();
  });

  it("bounds the stored count to the newest entries", () => {
    for (let index = 0; index < TASK_OUTBOX_MAX_ENTRIES + 5; index += 1) {
      enqueueTaskOperation({
        operationId: `op-bulk-${String(index).padStart(3, "0")}`,
        route: "/api/tasks/manage",
        action: "delete",
        payload: { taskId: index + 1 },
        displayTarget: { taskId: index + 1, kind: "task" },
      });
    }

    const stored = listTaskOutbox().map((entry) => entry.operationId);
    expect(stored).toHaveLength(TASK_OUTBOX_MAX_ENTRIES);
    expect(stored[0]).toBe("op-bulk-005");
    expect(stored[stored.length - 1]).toBe(
      `op-bulk-${String(TASK_OUTBOX_MAX_ENTRIES + 4).padStart(3, "0")}`,
    );
  });

  it("drops entries past the retention window on read", () => {
    enqueueClaim();
    writeForeignEntry({ ...readStoredEntry("op-claim-1"), operationId: "op-ancient", createdAt: "2020-01-01T00:00:00.000Z" });

    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-claim-1"]);
  });

  it("mints a distinct operation ID per call", () => {
    const ids = new Set(Array.from({ length: 25 }, () => createTaskOperationId()));
    expect(ids.size).toBe(25);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/);
  });

  it("replaces rather than duplicates an entry re-enqueued under the same operation ID", () => {
    enqueueClaim();
    enqueueClaim({ action: "undo" });
    expect(listTaskOutbox()).toHaveLength(1);
    expect(listTaskOutbox()[0].action).toBe("undo");
  });
});

describe("acknowledgement state machine", () => {
  it("adopts authoritative data before removing a 200 entry", async () => {
    const order: string[] = [];
    enqueueClaim();

    const result = await flushWithAdoption({
      send: async (entry) => {
        order.push(`send:${entry.operationId}`);
        return { status: 200, body: ack(entry.operationId) };
      },
      onAcknowledged: (acknowledgement) => {
        order.push(`adopt:${acknowledgement.operationId}`);
        expect(listTaskOutbox()).toHaveLength(1);
      },
    });

    expect(result).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(order).toEqual(["send:op-claim-1", "adopt:op-claim-1"]);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("retains a 202 until a pulled snapshot proves it resolved, then removes it", async () => {
    enqueueClaim();
    let pullCount = 0;

    const first = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false, repairRequired: true }),
      pullSnapshot: async () => {
        pullCount += 1;
        return snapshotOf([canonicalTask()]);
      },
    });

    expect(first).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(pullCount).toBe(1);
    expect(entryFor("op-claim-1").status).toBe("reconciling");
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("projection");

    expireBackoff("op-claim-1");
    const second = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false, repairRequired: true }),
      pullSnapshot: async () =>
        snapshotOf([
          canonicalTask({
            completed: true,
            pendingApproval: { byName: "Caspian", at: "2026-09-25T10:00:00.000Z", points: 5 },
          }),
        ]),
    });

    expect(second).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("keeps a 202 entry when no snapshot pull is available", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false }),
    });
    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);
  });

  it("keeps a 202 entry when the pulled snapshot does not prove the operation", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false }),
      pullSnapshot: async () => snapshotOf([canonicalTask()]),
    });
    expect(result.retryable).toBe(1);
    expect(listTaskOutbox()).toHaveLength(1);
  });

  it("removes a 409 semantic duplicate only when the snapshot proves this operation resolved", async () => {
    enqueueClaim();
    const unresolved = await flushWithAdoption({
      send: respond(
        409,
        errorAck("op-claim-1", { reason: "semantic_duplicate", semanticDuplicate: true }),
      ),
      pullSnapshot: async () => snapshotOf([canonicalTask()]),
    });

    expect(unresolved).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(entryFor("op-claim-1").status).toBe("failed");
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("semantic-duplicate");

    removeTaskOutboxEntry("op-claim-1");
    enqueueClaim();
    const resolved = await flushWithAdoption({
      send: respond(
        409,
        errorAck("op-claim-1", { reason: "semantic_duplicate", semanticDuplicate: true }),
      ),
      pullSnapshot: async () => snapshotOf([canonicalTask({ completed: true, completedBy: "Caspian" })]),
    });

    expect(resolved).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("classifies a retryable 409 by reason instead of dropping it", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(
        409,
        errorAck("op-claim-1", { reason: "operation_conflict", retryable: true }),
      ),
      pullSnapshot: async () => snapshotOf([canonicalTask()]),
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-claim-1").status).toBe("retrying");
  });

  it("marks 401 auth-required without hammering and never auto-retries it", async () => {
    enqueueClaim();
    const send = vi.fn(async () => ({
      status: 401,
      body: errorAck("op-claim-1", { reason: "unauthorized" }),
    }));

    const first = await flushWithAdoption({ send });
    expect(first).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-claim-1").status).toBe("auth-required");
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("unauthorized");
    expect(entryFor("op-claim-1").authAttemptCount).toBe(1);

    const second = await flushWithAdoption({ send });
    expect(second).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("classifies 403, 400, and 404 as permanent failures that stay queued", async () => {
    const cases: Array<[number, string, string]> = [
      [403, "adult_only", "unauthorized"],
      [400, "invalid_task_state", "validation"],
      [404, "unknown-task", "validation"],
    ];

    for (const [status, reason, category] of cases) {
      const operationId = `op-permanent-${status}`;
      enqueueClaim({ operationId });
      const result = await flushWithAdoption({
        send: async () => ({ status, body: errorAck(operationId, { reason }) }),
      });
      expect(result.permanent).toBe(1);
      expect(entryFor(operationId).status).toBe("failed");
      expect(entryFor(operationId).lastErrorCategory).toBe(category);
      removeTaskOutboxEntry(operationId);
    }
  });

  it("keeps the entry in place when adoption throws", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(200, ack("op-claim-1")),
      onAcknowledged: () => {
        throw new Error("store write failed");
      },
    });
    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);
  });
});

describe("backoff and retry", () => {
  it("schedules a bounded exponential next attempt for a 5xx", async () => {
    enqueueClaim();
    const before = Date.now();
    const result = await flushWithAdoption({
      send: respond(503, errorAck("op-claim-1", { reason: "task_store_unavailable", retryable: true })),
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = entryFor("op-claim-1");
    expect(entry.status).toBe("retrying");
    expect(entry.attemptCount).toBe(1);
    expect(entry.lastErrorCategory).toBe("server");
    expect(Date.parse(entry.nextAttemptAt ?? "")).toBeGreaterThanOrEqual(before + TASK_OUTBOX_BASE_BACKOFF_MS);
  });

  it("does not resend before nextAttemptAt and resends once it is due", async () => {
    enqueueClaim();
    await flushWithAdoption({
      send: respond(503, errorAck("op-claim-1", { reason: "task_store_unavailable", retryable: true })),
    });

    const blocked = vi.fn(async () => ({ status: 200, body: ack("op-claim-1") }));
    const skipped = await flushWithAdoption({ send: blocked });
    expect(skipped).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(blocked).not.toHaveBeenCalled();

    expireBackoff("op-claim-1");
    const allowed = await flushWithAdoption({ send: blocked });
    expect(allowed).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("retries a thrown network failure within the backoff cap", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const entry = entryFor("op-claim-1");
    expect(entry.lastErrorCategory).toBe("network");
    expect(entry.status).toBe("retrying");
    expect(taskOutboxBackoffMs(entry.attemptCount)).toBeLessThanOrEqual(TASK_OUTBOX_MAX_BACKOFF_MS);
  });

  it("gives up after the bounded attempt budget instead of retrying forever", async () => {
    enqueueClaim();
    const send = vi.fn(async () => ({
      status: 503,
      body: errorAck("op-claim-1", { reason: "task_store_unavailable", retryable: true }),
    }));

    for (let index = 0; index < TASK_OUTBOX_MAX_ATTEMPTS - 1; index += 1) {
      if (entryFor("op-claim-1").nextAttemptAt) expireBackoff("op-claim-1");
      const result = await flushWithAdoption({ send });
      expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    }
    expireBackoff("op-claim-1");
    const final = await flushWithAdoption({ send });
    expect(final).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });

    expect(send).toHaveBeenCalledTimes(TASK_OUTBOX_MAX_ATTEMPTS);
    expect(entryFor("op-claim-1").status).toBe("failed");
    expect(entryFor("op-claim-1").nextAttemptAt).toBeUndefined();

    const again = await flushWithAdoption({ send });
    expect(again).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(send).toHaveBeenCalledTimes(TASK_OUTBOX_MAX_ATTEMPTS);
  });

  it("grows the backoff exponentially and stays capped", () => {
    expect(taskOutboxBackoffMs(1)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS);
    expect(taskOutboxBackoffMs(2)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS * 2);
    expect(taskOutboxBackoffMs(3)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS * 4);
    expect(taskOutboxBackoffMs(40)).toBe(TASK_OUTBOX_MAX_BACKOFF_MS);
  });
});

describe("single in-flight flush and cross-tab subscription", () => {
  it("shares one in-flight flush across concurrent callers", async () => {
    enqueueClaim();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async (entry: TaskOutboxEntry) => {
      await gate;
      return { status: 200, body: ack(entry.operationId) };
    });

    const driver = { send, onAcknowledged: ADOPT_NOOP, adoptSnapshot: ADOPT_NOOP };
    const first = flushTaskOutbox(driver);
    const second = flushTaskOutbox(driver);
    expect(second).toBe(first);

    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("gives different drivers their own in-flight flush", async () => {
    enqueueClaim();
    const firstSend = vi.fn(async () => ({ status: 200, body: ack("op-claim-1") }));
    const secondSend = vi.fn(async () => ({ status: 200, body: ack("op-claim-1") }));
    const firstDriver = { send: firstSend, onAcknowledged: ADOPT_NOOP, adoptSnapshot: ADOPT_NOOP };
    const secondDriver = { send: secondSend, onAcknowledged: ADOPT_NOOP, adoptSnapshot: ADOPT_NOOP };

    const first = flushTaskOutbox(firstDriver);
    const second = flushTaskOutbox(secondDriver);
    expect(second).not.toBe(first);
    await Promise.all([first, second]);
    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(secondSend).toHaveBeenCalledTimes(1);
  });

  it("keeps notifying subscribers after one throws", () => {
    const seen: string[] = [];
    const unsubscribeThrower = subscribeTaskOutbox(() => {
      seen.push("thrower");
      throw new Error("subscriber exploded");
    });
    const unsubscribeSecond = subscribeTaskOutbox(() => seen.push("second"));
    const unsubscribeThird = subscribeTaskOutbox(() => seen.push("third"));

    enqueueClaim({ operationId: "op-notify" });

    expect(seen).toEqual(["thrower", "second", "third"]);
    unsubscribeThrower();
    unsubscribeSecond();
    unsubscribeThird();
  });

  it("notifies subscribers on a local enqueue and on another tab's write", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTaskOutbox(listener);

    enqueueClaim();
    expect(listener).toHaveBeenCalledTimes(1);

    writeForeignEntry({
      version: 1,
      operationId: "op-other-tab",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 5 },
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: "queued",
      displayTarget: { taskId: 5, kind: "task" },
    });

    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-claim-1",
      "op-other-tab",
    ]);

    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    enqueueClaim();
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });

  it("returns a stable snapshot reference and a frozen server snapshot", () => {
    expect(getTaskOutboxSnapshot()).toBe(getTaskOutboxSnapshot());
    expect(getTaskOutboxServerSnapshot()).toBe(getTaskOutboxServerSnapshot());
    expect(getTaskOutboxServerSnapshot()).toHaveLength(0);
  });

  it("short-circuits a flush with nothing queued through the driver seam", async () => {
    const send = vi.fn();
    registerTaskOutboxDriver({ send: send as never });
    await expect(requestTaskOutboxFlush()).resolves.toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps one hook's driver when another hook unmounts", async () => {
    const first = vi.fn(async () => ({ status: 200, body: ack("op-claim-1") }));
    const second = vi.fn(async () => ({ status: 200, body: ack("op-claim-1") }));
    const releaseFirst = registerTaskOutboxDriver({ send: first as never });
    const releaseSecond = registerTaskOutboxDriver({ send: second as never });

    releaseSecond();
    enqueueClaim();
    await requestTaskOutboxFlush();
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);

    releaseFirst();
  });
});

describe("explicit cancel", () => {
  it("cancels a non-applied entry and refuses one the server already applied", async () => {
    enqueueClaim();
    expect(cancelTaskOutboxEntry("op-claim-1")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);

    enqueueClaim();
    await flushWithAdoption({ send: respond(202, { operationId: "op-claim-1", reconciled: false }) });
    expect(entryFor("op-claim-1").status).toBe("reconciling");
    expect(cancelTaskOutboxEntry("op-claim-1")).toBe(false);
    expect(listTaskOutbox()).toHaveLength(1);
  });
});

describe("route and action specific snapshot proof", () => {
  const cases: Array<{
    name: string;
    entry: TaskOutboxEntry;
    proving: Record<string, unknown>[][];
    notProving: Record<string, unknown>[][];
    provingExtra?: Record<string, unknown>;
    provingAck?: TaskOutboxAcknowledgement;
  }> = [
    {
      name: "send-back",
      entry: enqueueTaskOperation({
        operationId: "op-send-back-1",
        route: "/api/tasks/approve",
        action: "send-back",
        payload: { taskId: 42, memberName: "Alex" },
        displayTarget: { taskId: 42, kind: "approval" },
      }),
      proving: [[canonicalTask({ completed: false, sentBackAt: "2026-09-25T10:00:00.000Z" })]],
      notProving: [
        [canonicalTask({ completed: false })],
        [canonicalTask({ completed: true, sentBackAt: "2026-09-25T10:00:00.000Z" })],
      ],
    },
    {
      name: "claim that lands as a kid pending tap",
      entry: enqueueClaim(),
      proving: [
        [
          canonicalTask({
            completed: true,
            pendingApproval: { byName: "Caspian", at: "2026-09-25T10:00:00.000Z", points: 5 },
          }),
        ],
      ],
      notProving: [[canonicalTask({ completed: false })], []],
    },
    {
      name: "claim that lands an adult earn line",
      entry: enqueueClaim(),
      proving: [[canonicalTask({ completed: true })]],
      notProving: [[canonicalTask({ completed: false })]],
      provingExtra: {
        weekData: {
          weekStart: "2026-09-21",
          points: {},
          streak: {},
          lastActive: {},
          history: [{ id: 1, type: "earn", taskId: 42, member: "Caspian", amount: 5 }],
        },
      },
    },
    {
      name: "undo that reopens the row",
      entry: enqueueClaim({ action: "undo" }),
      proving: [[canonicalTask({ completed: false })]],
      notProving: [[canonicalTask({ completed: true })]],
    },
    {
      name: "crew-join that records the member",
      entry: enqueueClaim({ action: "crew-join" }),
      proving: [
        [
          canonicalTask({
            crewSize: 3,
            crew: { members: [{ name: "Caspian", emoji: "\ud83e\uddd2", joinedAt: "2026-09-25T10:00:00.000Z" }] },
          }),
        ],
      ],
      notProving: [
        [canonicalTask({ crewSize: 3, crew: { members: [] } })],
        [
          canonicalTask({
            crewSize: 3,
            crew: { members: [{ name: "Caspianian", emoji: "\ud83e\uddd2", joinedAt: "2026-09-25T10:00:00.000Z" }] },
          }),
        ],
      ],
    },
    {
      name: "crew-checkin that stamps the member",
      entry: enqueueClaim({ action: "crew-checkin" }),
      proving: [
        [
          canonicalTask({
            crewSize: 3,
            crew: {
              members: [
                {
                  name: "Caspian",
                  emoji: "\ud83e\uddd2",
                  joinedAt: "2026-09-25T10:00:00.000Z",
                  checkedInAt: "2026-09-25T10:05:00.000Z",
                },
              ],
            },
          }),
        ],
      ],
      notProving: [
        [
          canonicalTask({
            crewSize: 3,
            crew: { members: [{ name: "Caspian", emoji: "\ud83e\uddd2", joinedAt: "2026-09-25T10:00:00.000Z" }] },
          }),
        ],
      ],
    },
    {
      name: "crew-remove that drops the member",
      entry: enqueueClaim({
        action: "crew-remove",
        payload: { taskId: 42, memberName: "Alex", targetName: "Bailey" },
      }),
      proving: [[canonicalTask({ crewSize: 3, crew: { members: [], removed: ["Bailey"] } })]],
      notProving: [
        [
          canonicalTask({
            crewSize: 3,
            crew: { members: [{ name: "Bailey", emoji: "\ud83d\udc3b", joinedAt: "2026-09-25T10:00:00.000Z" }] },
          }),
        ],
      ],
    },
    {
      name: "manage update that writes the fields",
      entry: enqueueTaskOperation({
        operationId: "op-manage-update-1",
        route: "/api/tasks/manage",
        action: "update",
        payload: { taskId: 42, patch: { title: "Trash", points: 12 } },
        displayTarget: { taskId: 42, kind: "task" },
      }),
      proving: [[canonicalTask({ title: "Trash", points: 12 })]],
      notProving: [[canonicalTask({ title: "Trash", points: 5 })], []],
    },
    {
      name: "manage delete that removes the row",
      entry: enqueueTaskOperation({
        operationId: "op-manage-delete-1",
        route: "/api/tasks/manage",
        action: "delete",
        payload: { taskId: 42 },
        displayTarget: { taskId: 42, kind: "task" },
      }),
      proving: [[], [canonicalTask({ id: 43 })]],
      notProving: [[canonicalTask()]],
    },
  ];

  for (const testCase of cases) {
    it(`proves ${testCase.name} only from matching authoritative state`, () => {
      for (const tasks of testCase.proving) {
        expect(
          snapshotProvesResolved(testCase.entry, snapshotOf(tasks, testCase.provingExtra)),
        ).toBe(true);
        expect(
          snapshotProvesResolved(testCase.entry, snapshotOf(tasks)),
          testCase.provingExtra ? `${testCase.name} proved without its evidence` : "",
        ).toBe(testCase.provingExtra ? false : true);
      }
      for (const tasks of testCase.notProving) {
        expect(
          snapshotProvesResolved(testCase.entry, snapshotOf(tasks, testCase.provingExtra)),
        ).toBe(false);
      }
      expect(snapshotProvesResolved(testCase.entry, { snapshot: null })).toBe(false);
      expect(snapshotProvesResolved(testCase.entry, { snapshot: {} })).toBe(false);
    });
  }

  it("proves a manage add from the authoritative row the server assigned", () => {
    const entry = enqueueTaskOperation({
      operationId: "op-manage-add-1",
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { title: "Recycle", assignee: "Bailey", points: 10, due: "2026-09-27" } },
      displayTarget: { temporaryId: 5150, title: "Recycle", kind: "task" },
    });
    const authoritative = {
      operationId: "op-manage-add-1",
      reconciled: false,
      task: { id: 99, title: "Recycle", assignee: "Bailey", points: 10, due: "2026-09-27" },
    } as unknown as TaskOutboxAcknowledgement;

    expect(snapshotProvesResolved(entry, snapshotOf([]), authoritative)).toBe(true);
    expect(snapshotProvesResolved(entry, snapshotOf([]))).toBe(false);
    expect(
      snapshotProvesResolved(entry, snapshotOf([]), {
        operationId: "op-manage-add-1",
        task: { id: 5150, title: "Recycle", assignee: "Bailey", points: 10, due: "2026-09-27" },
      } as unknown as TaskOutboxAcknowledgement),
    ).toBe(false);
    expect(
      snapshotProvesResolved(entry, snapshotOf([]), {
        operationId: "op-manage-add-1",
        task: { id: 99, title: "Recycle", assignee: "Caspian", points: 10, due: "2026-09-27" },
      } as unknown as TaskOutboxAcknowledgement),
    ).toBe(false);
  });

  it("requires an exact member on the earn line", () => {
    const entry = enqueueClaim({ operationId: "op-exact-earn" });
    const earned = (member: string) =>
      snapshotOf([canonicalTask({ completed: true })], {
        weekData: {
          weekStart: "2026-09-21",
          points: {},
          streak: {},
          lastActive: {},
          history: [{ id: 1, type: "earn", taskId: 42, member, amount: 5 }],
        },
      });

    expect(snapshotProvesResolved(entry, earned("Caspian"))).toBe(true);
    expect(snapshotProvesResolved(entry, earned("Caspianian"))).toBe(false);
    expect(snapshotProvesResolved(entry, earned("Bailey"))).toBe(false);
  });

  it("honours a delete tombstone when proving a manage delete", () => {
    const entry = enqueueTaskOperation({
      operationId: "op-manage-delete-tombstone",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 42 },
      displayTarget: { taskId: 42, kind: "task" },
    });
    const read: SnapshotRead = {
      snapshot: { tasks: [canonicalTask()], deletedTaskIds: [42] } as unknown as SnapshotData,
    };
    expect(snapshotProvesResolved(entry, read)).toBe(true);
  });

  it("requires an exact approval receipt, never a cleared pending row", () => {
    const approve = enqueueTaskOperation({
      operationId: "op-approve-receipt",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 42, memberName: "Alex" },
      displayTarget: { taskId: 42, kind: "approval" },
    });
    const approveAll = enqueueTaskOperation({
      operationId: "op-approve-all-receipt",
      route: "/api/tasks/approve",
      action: "approve-all",
      payload: { taskIds: [42, 43], memberName: "Alex" },
      displayTarget: { kind: "approval" },
    });
    const settled = [canonicalTask({ completed: true }), canonicalTask({ id: 43, title: "Trash", completed: true })];
    const receipts = (operationReceipts: SnapshotRead["operationReceipts"]) => ({
      snapshot: { tasks: settled, deletedTaskIds: [], weekData: { history: [] } } as unknown as SnapshotData,
      operationReceipts,
    });

    expect(snapshotProvesResolved(approve, receipts(undefined))).toBe(false);
    expect(snapshotProvesResolved(approveAll, receipts(undefined))).toBe(false);
    expect(
      snapshotProvesResolved(
        approveAll,
        receipts({
          "op-approve-all-receipt": [
            { operationId: "op-approve-all-receipt", action: "approve-all", taskId: 42, taskIds: [42, 43], createdAt: "2026-09-25T10:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      snapshotProvesResolved(
        approve,
        receipts({
          "op-approve-receipt": [
            { operationId: "op-approve-receipt", action: "approve", taskId: 43, createdAt: "2026-09-25T10:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      snapshotProvesResolved(
        approve,
        receipts({
          "op-approve-receipt": [
            { operationId: "op-approve-receipt", action: "approve", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      snapshotProvesResolved(
        approveAll,
        receipts({
          "op-approve-all-receipt": [
            { operationId: "op-approve-all-receipt", action: "approve-all", taskId: 42, taskIds: [42, 43], createdAt: "2026-09-25T10:00:00.000Z" },
            { operationId: "op-approve-all-receipt", action: "approve-all", taskId: 43, taskIds: [42, 43], createdAt: "2026-09-25T10:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("proves from the canonical operation receipt before any state guess", () => {
    const addEntry = enqueueTaskOperation({
      operationId: "op-receipt-add",
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { title: "Recycle", assignee: "Bailey" } },
      displayTarget: { temporaryId: 5150, kind: "task" },
    });
    const updateEntry = enqueueTaskOperation({
      operationId: "op-receipt-update",
      route: "/api/tasks/manage",
      action: "update",
      payload: { taskId: 42, patch: { title: "Trash" } },
      displayTarget: { taskId: 42, kind: "task" },
    });
    const deleteEntry = enqueueTaskOperation({
      operationId: "op-receipt-delete",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 42 },
      displayTarget: { taskId: 42, kind: "task" },
    });
    const claimEntry = enqueueClaim({ operationId: "op-receipt-claim", action: "claim", payload: { taskId: 42, memberName: "Caspian" } });
    const approveEntry = enqueueTaskOperation({
      operationId: "op-receipt-approve",
      route: "/api/tasks/approve",
      action: "approve",
      payload: { taskId: 42, memberName: "Alex" },
      displayTarget: { taskId: 42, kind: "approval" },
    });

    const receipts = (operationReceipts: SnapshotRead["operationReceipts"]) => ({
      snapshot: { tasks: [canonicalTask()], deletedTaskIds: [], weekData: { history: [] } } as unknown as SnapshotData,
      operationReceipts,
    });

    const addReceipts = {
      "op-receipt-add": [{ operationId: "op-receipt-add", action: "add", taskId: 99, createdAt: "2026-09-25T10:00:00.000Z" }],
    };
    const updateReceipts = {
      "op-receipt-update": [{ operationId: "op-receipt-update", action: "update", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" }],
    };
    const deleteReceipts = {
      "op-receipt-delete": [{ operationId: "op-receipt-delete", action: "delete", taskId: 42, deleted: true, createdAt: "2026-09-25T10:00:00.000Z" }],
    };
    const claimReceipts = {
      "op-receipt-claim": [{ operationId: "op-receipt-claim", action: "claim", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" }],
    };
    const approveReceipts = {
      "op-receipt-approve": [{ operationId: "op-receipt-approve", action: "approve", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" }],
    };

    expect(snapshotProvesResolved(addEntry, receipts(addReceipts))).toBe(true);
    expect(snapshotProvesResolved(updateEntry, receipts(updateReceipts))).toBe(true);
    expect(snapshotProvesResolved(deleteEntry, receipts(deleteReceipts))).toBe(true);
    expect(snapshotProvesResolved(claimEntry, receipts(claimReceipts))).toBe(true);
    expect(snapshotProvesResolved(approveEntry, receipts(approveReceipts))).toBe(true);

    expect(snapshotProvesResolved(addEntry, receipts(updateReceipts))).toBe(false);
    expect(snapshotProvesResolved(updateEntry, receipts(addReceipts))).toBe(false);
    expect(snapshotProvesResolved(claimEntry, receipts({ "op-receipt-claim": [{ operationId: "op-receipt-claim", action: "undo", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" }] }))).toBe(false);
    expect(
      snapshotProvesResolved(
        updateEntry,
        receipts({ "op-receipt-update": [{ operationId: "op-receipt-update", action: "update", taskId: 43, createdAt: "2026-09-25T10:00:00.000Z" }] }),
      ),
    ).toBe(false);
  });

  it("proves config replace, upsert, and delete from receipts and stamped legs", () => {
    const replace = enqueueTaskOperation({
      operationId: "op-config-replace-1",
      route: "/api/tasks/config",
      action: "replace",
      payload: {
        kind: "rewards",
        updatedAt: "2026-09-25T10:00:00.000Z",
        items: [{ name: "Ice cream", emoji: "\ud83c\udf66", cost: 40 }],
      },
      displayTarget: { kind: "config" },
    });
    const upsert = enqueueTaskOperation({
      operationId: "op-config-upsert-1",
      route: "/api/tasks/config",
      action: "upsert",
      payload: {
        kind: "penalties",
        updatedAt: "2026-09-25T10:00:00.000Z",
        item: { name: "Late", emoji: "\u23f0", points: 5 },
      },
      displayTarget: { kind: "config" },
    });
    const remove = enqueueTaskOperation({
      operationId: "op-config-delete-1",
      route: "/api/tasks/config",
      action: "delete",
      payload: { kind: "weekly-prizes", updatedAt: "2026-09-25T10:00:00.000Z", itemId: "prize-2" },
      displayTarget: { kind: "config" },
    });

    const legs = {
      rewards: [{ id: "a", name: "Ice cream", emoji: "\ud83c\udf66", cost: 40 }],
      rewardsUpdatedAt: "2026-09-25T10:00:00.000Z",
      penalties: [{ id: "b", name: "Late", emoji: "\u23f0", points: 5 }],
      penaltiesUpdatedAt: "2026-09-25T10:00:00.000Z",
      weeklyPrizes: [{ id: "prize-1", rank: 1, emoji: "\ud83c\udfc7", text: "Movie" }],
      weeklyPrizesStamp: "2026-09-25T10:00:00.000Z",
    };
    const staleLegs = {
      ...legs,
      rewardsUpdatedAt: "2026-09-24T10:00:00.000Z",
      penaltiesUpdatedAt: "2026-09-24T10:00:00.000Z",
      weeklyPrizesStamp: "2026-09-24T10:00:00.000Z",
    };

    expect(snapshotProvesResolved(replace, snapshotOf([], legs))).toBe(true);
    expect(snapshotProvesResolved(replace, snapshotOf([], staleLegs))).toBe(false);
    expect(snapshotProvesResolved(upsert, snapshotOf([], legs))).toBe(true);
    expect(snapshotProvesResolved(remove, snapshotOf([], legs))).toBe(true);
    expect(
      snapshotProvesResolved(
        remove,
        snapshotOf([], {
          weeklyPrizes: [{ id: "prize-2", rank: 2, emoji: "\ud83c\udfc8", text: "Dessert" }],
          weeklyPrizesStamp: "2026-09-25T10:00:00.000Z",
        }),
      ),
    ).toBe(false);

    const receiptRead: SnapshotRead = {
      snapshot: { tasks: [] } as unknown as SnapshotData,
      configOperationReceipts: {
        "op-config-upsert-1": {
          kind: "penalties",
          action: "upsert",
          updatedAt: "2026-09-25T10:00:00.000Z",
        },
      },
    };
    expect(snapshotProvesResolved(upsert, receiptRead)).toBe(true);
    expect(snapshotProvesResolved(replace, receiptRead)).toBe(false);
  });
});

describe("auth recovery and classification", () => {
  it("retries a session-gated 401 on a bounded auth backoff without spending the attempt budget", async () => {
    enqueueClaim({ operationId: "op-session-401" });
    const first = await flushWithAdoption({
      send: respond(401, errorAck("op-session-401", { reason: "session_required" })),
    });

    expect(first).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    const blocked = entryFor("op-session-401");
    expect(blocked.status).toBe("auth-required");
    expect(blocked.attemptCount).toBe(0);
    expect(blocked.authAttemptCount).toBe(1);
    expect(Date.parse(blocked.nextAttemptAt ?? "")).toBeGreaterThan(Date.now());

    const skipped = await flushWithAdoption({ send: respond(200, ack("op-session-401")) });
    expect(skipped).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });

    expireBackoff("op-session-401");
    const recovered = await flushWithAdoption({ send: respond(200, ack("op-session-401")) });
    expect(recovered).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("retains a session-gated 401 indefinitely on a capped ladder and never fails it", async () => {
    enqueueTaskOperation({
      operationId: "op-manage-session",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 42 },
      displayTarget: { taskId: 42, kind: "task" },
    });
    const unauthorized = vi.fn(async () => ({
      status: 401,
      body: errorAck("op-manage-session", { reason: "unauthorized" }),
    }));

    for (let index = 0; index < 12; index += 1) {
      expireBackoff("op-manage-session");
      const result = await flushWithAdoption({ send: unauthorized });
      expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    }

    expect(unauthorized).toHaveBeenCalledTimes(12);
    const blocked = entryFor("op-manage-session");
    expect(blocked.status).toBe("auth-required");
    expect(blocked.attemptCount).toBe(0);
    expect(blocked.authAttemptCount).toBe(12);
    expect(
      Date.parse(blocked.nextAttemptAt ?? "") - Date.now(),
    ).toBeLessThanOrEqual(TASK_OUTBOX_MAX_AUTH_BACKOFF_MS + 1_000);

    expireBackoff("op-manage-session");
    const recovered = await flushWithAdoption({ send: respond(200, ack("op-manage-session")) });
    expect(recovered).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("caps the auth ladder and the reconcile ladder at their long backoff ceilings", () => {
    expect(taskOutboxAuthBackoffMs(1)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS);
    expect(taskOutboxAuthBackoffMs(3)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS * 4);
    expect(taskOutboxAuthBackoffMs(40)).toBe(TASK_OUTBOX_MAX_AUTH_BACKOFF_MS);
    expect(taskOutboxReconcileBackoffMs(1)).toBe(TASK_OUTBOX_BASE_BACKOFF_MS);
    expect(taskOutboxReconcileBackoffMs(40)).toBe(TASK_OUTBOX_MAX_RECONCILE_BACKOFF_MS);
  });

  it("classifies a deterministic operation_conflict as permanent", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(409, errorAck("op-claim-1", { reason: "operation_conflict" })),
      pullSnapshot: async () => snapshotOf([canonicalTask()]),
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(entryFor("op-claim-1").status).toBe("failed");
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("validation");
    expect(entryFor("op-claim-1").lastErrorReason).toBe("operation_conflict");
  });

  it("treats a 200 without a reconciled field as a route-declared success", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(200, { operationId: "op-claim-1" } as TaskOutboxAcknowledgement),
    });

    expect(result).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("never treats a 202 as reconciled, even when the body claims otherwise", async () => {
    enqueueClaim();
    await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: true } as TaskOutboxAcknowledgement),
      pullSnapshot: async () => snapshotOf([canonicalTask()]),
    });

    expect(listTaskOutbox()).toHaveLength(1);
    expect(entryFor("op-claim-1").status).toBe("reconciling");
  });

  it("classifies a throwing credential resolver instead of failing the flush", async () => {
    enqueueClaim({ operationId: "op-claim-1", action: "claim" });
    const result = await flushWithAdoption({
      send: respond(200, ack("op-claim-1")),
      getCredential: () => {
        throw new Error("resolver exploded");
      },
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-claim-1").lastErrorReason).toBe("credential_resolver_failed");
  });

  it("keeps a failed entry instead of dropping it when acknowledgement work throws", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(200, ack("op-claim-1")),
      onAcknowledged: () => {
        throw new Error("store write failed");
      },
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("projection");
    expect(entryFor("op-claim-1").lastErrorReason).toBe("adoption_failed");
  });
});

describe("request timeouts and the in-flight guard", () => {
  it("releases the in-flight guard when a hung send hits the request timeout", async () => {
    enqueueClaim();
    const hung = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", hung);

    const driver = createFetchTaskOutboxDriver({ requestTimeoutMs: 25 });
    const first = await flushWithAdoption(driver);

    expect(first).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(hung).toHaveBeenCalledTimes(1);
    expect(entryFor("op-claim-1").lastErrorCategory).toBe("network");

    expireBackoff("op-claim-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ack("op-claim-1") })),
    );
    const second = await flushWithAdoption(driver);
    expect(second).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
  });

  it("exports an explicit 30 second default request timeout", () => {
    expect(TASK_OUTBOX_REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

describe("default production driver", () => {
  it("pulls the tasks sync route so an unreconciled 202 can be proven", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tasks/claim") {
        return {
          ok: true,
          status: 202,
          json: async () => ({ operationId: "op-claim-1", reconciled: false, repairRequired: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          reconciled: true,
          snapshot: {
            tasks: [canonicalTask({ completed: true, pendingApproval: { byName: "Caspian", at: "now", points: 5 } })],
            weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
            operationReceipts: {
              "op-claim-1": [
                { operationId: "op-claim-1", action: "complete", taskId: 42, createdAt: "2026-09-25T10:00:00.000Z" },
              ],
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    enqueueClaim();

    await requestTaskOutboxFlush();

    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tasks/sync")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("exposes the canonical week data and receipts from the pulled document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          reconciled: true,
          snapshot: {
            tasks: [],
            weekData: { weekStart: "2026-09-21", points: {}, streak: {}, lastActive: {}, history: [] },
            operationReceipts: { "op-1": [] },
            configOperationReceipts: {},
          },
        }),
      })),
    );

    const read = await pullTaskSnapshotDocument();
    expect(read.weekData).toMatchObject({ weekStart: "2026-09-21" });
    expect(read.operationReceipts).toHaveProperty("op-1");
    expect(read.configOperationReceipts).toEqual({});
  });
});

describe("cross-tab storage coordination", () => {
  function foreignEntry(operationId: string, taskId: number): Record<string, unknown> {
    return {
      version: 1,
      operationId,
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId },
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: "queued",
      displayTarget: { taskId, kind: "task" },
    };
  }

  it("merges another tab's per-entry write instead of clobbering the list", () => {
    enqueueClaim({ operationId: "op-mine" });
    writeForeignEntry(foreignEntry("op-theirs", 9));
    enqueueTaskOperation({
      operationId: "op-third",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 11 },
      displayTarget: { taskId: 11, kind: "task" },
    });

    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-mine",
      "op-theirs",
      "op-third",
    ]);
  });

  it("keeps an in-memory quota-fallback entry when another tab writes", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    enqueueClaim({ operationId: "op-quota" });
    setItem.mockRestore();

    writeForeignEntry(foreignEntry("op-theirs", 9));
    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-quota",
      "op-theirs",
    ]);

    enqueueTaskOperation({
      operationId: "op-after-quota",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 12 },
      displayTarget: { taskId: 12, kind: "task" },
    });
    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-after-quota",
      "op-quota",
      "op-theirs",
    ]);
  });

  it("migrates a legacy whole-array key without losing live entries", () => {
    enqueueClaim({ operationId: "op-mine" });
    const legacyEntry = { ...foreignEntry("op-legacy", 21) };
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify([legacyEntry]));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: TASK_OUTBOX_STORAGE_KEY,
        newValue: JSON.stringify([legacyEntry]),
        storageArea: window.localStorage,
      }),
    );

    enqueueTaskOperation({
      operationId: "op-third",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 22 },
      displayTarget: { taskId: 22, kind: "task" },
    });

    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-legacy",
      "op-mine",
      "op-third",
    ]);
    expect(window.localStorage.getItem(taskOutboxEntryStorageKey("op-legacy"))).toContain("op-legacy");
  });

  it("clears module state on a storage reset", () => {
    enqueueClaim({ operationId: "op-before-reset" });
    const listener = vi.fn();
    subscribeTaskOutbox(listener);

    window.localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: null,
        newValue: null,
        storageArea: window.localStorage,
      }),
    );
    __resetTaskOutboxForTests();

    expect(listTaskOutbox()).toHaveLength(0);
    expect(window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY)).toBeNull();
  });

  it("rejects an enqueue for an unknown route or action", () => {
    expect(() =>
      enqueueTaskOperation({
        operationId: "op-bad-action",
        route: "/api/tasks/claim",
        action: "not-a-real-action",
        payload: { taskId: 1 },
        displayTarget: { kind: "claim" },
      }),
    ).toThrow(TypeError);
    expect(() =>
      enqueueTaskOperation({
        operationId: "op-bad-route",
        route: "/api/tasks/unknown" as never,
        action: "complete",
        payload: { taskId: 1 },
        displayTarget: { kind: "claim" },
      }),
    ).toThrow(TypeError);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("real route request bodies with an ephemeral PIN", () => {
  const cases: Array<{ name: string; entry: TaskOutboxEntry; accepted: (body: unknown) => boolean }> = [
    {
      name: "claim complete",
      entry: enqueueClaim({ operationId: "op-body-claim", action: "complete" }),
      accepted: (body) => !("error" in parseClaimCommand(body)),
    },
    {
      name: "claim crew-remove",
      entry: enqueueClaim({
        operationId: "op-body-crew-remove",
        action: "crew-remove",
        payload: { taskId: 42, memberName: "Alex", targetName: "Bailey" },
      }),
      accepted: (body) => !("error" in parseClaimCommand(body)),
    },
    {
      name: "approve",
      entry: enqueueTaskOperation({
        operationId: "op-body-approve",
        route: "/api/tasks/approve",
        action: "approve",
        payload: { taskId: 42, memberName: "Alex" },
        displayTarget: { taskId: 42, kind: "approval" },
      }),
      accepted: (body) => !("error" in parseApproveCommand(body)),
    },
    {
      name: "approve-all",
      entry: enqueueTaskOperation({
        operationId: "op-body-approve-all",
        route: "/api/tasks/approve",
        action: "approve-all",
        payload: { taskIds: [42, 43], memberName: "Alex" },
        displayTarget: { kind: "approval" },
      }),
      accepted: (body) => !("error" in parseApproveCommand(body)),
    },
    {
      name: "manage add",
      entry: enqueueTaskOperation({
        operationId: "op-body-manage-add",
        route: "/api/tasks/manage",
        action: "add",
        payload: {
          task: {
            title: "Recycle",
            assignee: "Bailey",
            assigneeEmoji: "🐻",
            due: "2026-09-27",
            points: 10,
            category: "chores",
            priority: "high",
          },
        },
        displayTarget: { temporaryId: 5150, title: "Recycle", kind: "task" },
      }),
      accepted: (body) => !("error" in parseManageTaskCommand(body)),
    },
    {
      name: "manage update",
      entry: enqueueTaskOperation({
        operationId: "op-body-manage-update",
        route: "/api/tasks/manage",
        action: "update",
        payload: { taskId: 42, patch: { title: "Trash", points: 12 } },
        displayTarget: { taskId: 42, kind: "task" },
      }),
      accepted: (body) => !("error" in parseManageTaskCommand(body)),
    },
    {
      name: "manage delete",
      entry: enqueueTaskOperation({
        operationId: "op-body-manage-delete",
        route: "/api/tasks/manage",
        action: "delete",
        payload: { taskId: 42 },
        displayTarget: { taskId: 42, kind: "task" },
      }),
      accepted: (body) => !("error" in parseManageTaskCommand(body)),
    },
    {
      name: "config replace",
      entry: enqueueTaskOperation({
        operationId: "op-body-config",
        route: "/api/tasks/config",
        action: "replace",
        payload: {
          kind: "rewards",
          updatedAt: "2026-09-25T10:00:00.000Z",
          items: [{ name: "Ice cream", emoji: "🍦", cost: 40 }],
        },
        displayTarget: { kind: "config" },
      }),
      accepted: (body) => !("error" in parseTaskConfigCommand(body, (value) => value)),
    },
  ];

  it("builds a body every real route parser accepts, with the PIN supplied only at send time", () => {
    for (const testCase of cases) {
      const body = buildTaskOperationRequestBody(testCase.entry, PIN);
      expect(testCase.accepted(body), `${testCase.name} body rejected`).toBe(true);
      expect(body).not.toHaveProperty("displayTarget");
      expect(JSON.stringify(testCase.entry.payload)).not.toContain(PIN);
      expect(allStoredText()).not.toContain(PIN);
    }
  });

  it("omits the PIN from the body when no credential is available", () => {
    const body = buildTaskOperationRequestBody(enqueueClaim(), undefined);
    expect(body).toEqual({
      taskId: 42,
      memberName: "Caspian",
      action: "complete",
      operationId: "op-claim-1",
    });
  });

  it("never sends a PIN-gated operation it has no credential for", async () => {
    enqueueClaim({ operationId: "op-needs-pin", action: "claim" });
    const send = vi.fn();

    const result = await flushWithAdoption({ send: send as never });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-needs-pin").status).toBe("auth-required");
    expect(entryFor("op-needs-pin").authAttemptCount).toBeUndefined();

    const withCredential = await flushWithAdoption({
      send: respond(200, ack("op-needs-pin")),
      getCredential: () => PIN,
    });
    expect(withCredential).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("sends the ephemeral credential over the real request path and never stores it", async () => {
    const entry = enqueueClaim({ operationId: "op-real-fetch" });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      status: 200,
      json: async () => ({ operationId: "op-real-fetch", reconciled: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await sendTaskOperationRequest(entry, PIN);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks/claim");
    expect(init.method).toBe("POST");
    expect((init.signal as AbortSignal).aborted).toBe(false);
    const body = JSON.parse(String(init.body));
    expect(body.pin).toBe(PIN);
    expect(body.operationId).toBe("op-real-fetch");
    expect(allStoredText()).not.toContain(PIN);
    vi.unstubAllGlobals();
  });

  it("reads the authoritative snapshot document over the real sync route", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, reconciled: true, snapshot: { tasks: [canonicalTask({ completed: true })] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const read = await pullTaskSnapshotDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/sync",
      expect.objectContaining({ cache: "no-store" }),
    );
    const signal = fetchMock.mock.calls[0]![1]!.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
    expect(
      snapshotProvesResolved(
        enqueueClaim({ operationId: "op-pull" }),
        read,
      ),
    ).toBe(false);
    const resolved = await pullTaskSnapshotDocument();
    expect(
      snapshotProvesResolved(
        enqueueClaim({ operationId: "op-pull" }),
        {
          ...resolved,
          snapshot: {
            tasks: [canonicalTask({ completed: true, completedBy: "Caspian" })],
          } as unknown as SnapshotData,
        },
      ),
    ).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("useTaskOperationOutbox", () => {
  let root: Root | null = null;
  let latest: UseTaskOperationOutboxResult | null = null;

  function Probe(props: { options?: Parameters<typeof useTaskOperationOutbox>[0] }) {
    latest = useTaskOperationOutbox(props.options);
    return null;
  }

  function mountHook(options?: Parameters<typeof useTaskOperationOutbox>[0]): void {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(createElement(Probe, { options }));
    });
  }

  function stubRoutes(handlers: {
    claim?: () => Promise<unknown>;
    sync?: () => Promise<unknown>;
  } = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tasks/claim") {
        const extra = (await handlers.claim?.()) as Record<string, unknown> | undefined;
        return {
          ok: true,
          status: 200,
          json: async () => ({ operationId: "op-claim-1", reconciled: true, ...extra }),
        };
      }
      if (url === "/api/tasks/sync") {
        return {
          ok: true,
          status: 200,
          json: async () =>
            handlers.sync
              ? await handlers.sync()
              : { ok: true, reconciled: true, snapshot: snapshotOf([]).snapshot },
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    latest = null;
    document.body.innerHTML = "";
  });

  it("sends a queued claim through the real route and adopts the authoritative row", async () => {
    const fetchMock = stubRoutes({
      claim: async () => ({
        reconciled: true,
        task: canonicalTask({ completed: true, pendingApproval: { byName: "Caspian", at: "now", points: 5 } }),
      }),
    });
    enqueueClaim();

    mountHook();

    await vi.waitFor(() => expect(listTaskOutbox()).toHaveLength(0));
    const claimCall = fetchMock.mock.calls.find(([url]) => url === "/api/tasks/claim");
    expect(claimCall).toBeDefined();
    expect(JSON.parse(String((claimCall![1] as RequestInit).body)).operationId).toBe("op-claim-1");
    expect(loadTasks().some((task) => task.id === 42)).toBe(true);
  });

  it("flushes on the online event and on a visibility return", async () => {
    const fetchMock = stubRoutes();
    mountHook({ autoFlush: false });

    enqueueClaim();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() => expect(listTaskOutbox()).toHaveLength(0));
    const afterOnline = fetchMock.mock.calls.length;

    enqueueClaim({ operationId: "op-claim-2", payload: { taskId: 43, memberName: "Caspian" } });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await vi.waitFor(() => expect(listTaskOutbox()).toHaveLength(0));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterOnline);
  });

  it("pulls the tasks sync route when a 202 needs authoritative proof", async () => {
    const fetchMock = stubRoutes({
      claim: async () => ({ reconciled: false, repairRequired: true }),
      sync: async () => ({
        ok: true,
        reconciled: true,
        snapshot: snapshotOf([
          canonicalTask({ completed: true, pendingApproval: { byName: "Caspian", at: "now", points: 5 } }),
        ]).snapshot,
      }),
    });
    enqueueClaim();

    mountHook();

    await vi.waitFor(() => expect(listTaskOutbox()).toHaveLength(0));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tasks/sync")).toBe(true);
  });

  it("reports status counts and only cancels a non-applied entry", async () => {
    stubRoutes();
    enqueueClaim({ operationId: "op-live" });
    enqueueClaim({ operationId: "op-doomed", action: "claim" });
    mountHook({ getCredential: () => PIN, autoFlush: false });

    await vi.waitFor(() => expect(latest?.pending).toBe(2));
    expect(latest?.queued).toBe(2);
    expect(latest?.reconciling).toBe(0);
    expect(latest?.authRequired).toBe(0);
    expect(latest?.failed).toBe(0);

    expect(latest?.cancel("op-live")).toBe(true);
    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-doomed"]);

    await act(async () => {
      await latest?.flush();
    });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("never posts a PIN-gated operation until a credential is supplied", async () => {
    const fetchMock = stubRoutes();
    let credential: string | undefined;
    enqueueClaim({ operationId: "op-claim-gated", action: "claim" });
    mountHook({ autoFlush: false, getCredential: () => credential });

    await act(async () => {
      await latest?.flush();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entryFor("op-claim-gated").status).toBe("auth-required");
    expect(entryFor("op-claim-gated").lastErrorReason).toBe("credential_missing");

    credential = PIN;
    await act(async () => {
      await latest?.flush();
    });

    expect(listTaskOutbox()).toHaveLength(0);
    const claimCall = fetchMock.mock.calls.find(([url]) => url === "/api/tasks/claim");
    expect(claimCall).toBeDefined();
    const body = JSON.parse(String((claimCall![1] as RequestInit).body));
    expect(body.pin).toBe(PIN);
    expect(allStoredText()).not.toContain(PIN);
  });
});

function OutboxProbe(props: { options: Parameters<typeof useTaskOperationOutbox>[0] }) {
  useTaskOperationOutbox(props.options);
  return null;
}

describe("useTaskOperationOutbox driver lifecycle", () => {
  function mountProbe(options: Parameters<typeof useTaskOperationOutbox>[0]): Root {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mounted = createRoot(host);
    act(() => {
      mounted.render(createElement(OutboxProbe, { options }));
    });
    return mounted;
  }

  it("keeps the surviving hook's driver when another hook unmounts", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tasks/claim") {
        return { ok: true, status: 200, json: async () => ({ operationId: "op-claim-1", reconciled: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, reconciled: true, snapshot: { tasks: [] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = mountProbe({ autoFlush: false });
    const second = mountProbe({ autoFlush: false });

    act(() => {
      first.unmount();
    });

    enqueueClaim();
    await act(async () => {
      await requestFlush();
    });

    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tasks/claim")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);

    act(() => {
      second.unmount();
    });
    document.body.innerHTML = "";
  });
});

describe("second review contracts", () => {
  it("never retires a 202 from a server-declared mid-repair snapshot", async () => {
    enqueueClaim();
    const pull = vi.fn(async () => ({ ...snapshotOf([canonicalTask({ completed: true })]), reconciled: false }));

    const result = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false, repairRequired: true }),
      pullSnapshot: pull,
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(entryFor("op-claim-1").status).toBe("reconciling");
    expect(listTaskOutbox()).toHaveLength(1);
  });

  it("never retires a 409 from a server-declared mid-repair snapshot", async () => {
    enqueueClaim();
    const result = await flushWithAdoption({
      send: respond(409, errorAck("op-claim-1", { reason: "semantic_duplicate" })),
      pullSnapshot: async () => ({ ...snapshotOf([canonicalTask({ completed: true })]), reconciled: false }),
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-claim-1").status).toBe("reconciling");
  });

  it("requires adoption before removing a proven 202", async () => {
    enqueueClaim();
    const proving = async () =>
      snapshotOf([canonicalTask({ completed: true, pendingApproval: { byName: "Caspian", at: "now", points: 5 } })]);

    const withoutAdoption = await flushTaskOutbox({
      send: respond(202, { operationId: "op-claim-1", reconciled: false }),
      pullSnapshot: proving,
      onAcknowledged: ADOPT_NOOP,
    });
    expect(withoutAdoption).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);
    expect(entryFor("op-claim-1").status).toBe("reconciling");

    expireBackoff("op-claim-1");
    const failingAdoption = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false }),
      pullSnapshot: proving,
      adoptSnapshot: async () => {
        throw new Error("store unavailable");
      },
    });
    expect(failingAdoption).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);

    expireBackoff("op-claim-1");
    const adopted: string[] = [];
    const adoptedResult = await flushWithAdoption({
      send: respond(202, { operationId: "op-claim-1", reconciled: false }),
      pullSnapshot: proving,
      adoptSnapshot: async (read) => {
        adopted.push(read.reconciled === true ? "reconciled" : "mid-repair");
      },
    });
    expect(adopted).toEqual(["reconciled"]);
    expect(adoptedResult).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("requires adoption before removing a plain 200", async () => {
    enqueueClaim();
    const result = await flushTaskOutbox({
      send: respond(200, ack("op-claim-1")),
      pullSnapshot: async () => snapshotOf([]),
    });

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(1);
    expect(entryFor("op-claim-1").status).toBe("reconciling");
  });

  it("keeps a reconciling entry forever, uncancellable, on a capped ladder", async () => {
    enqueueClaim();
    const unreconciled = respond(202, { operationId: "op-claim-1", reconciled: false, repairRequired: true });

    for (let index = 0; index < 12; index += 1) {
      expireBackoff("op-claim-1");
      const result = await flushWithAdoption({
        send: unreconciled,
        pullSnapshot: async () => snapshotOf([canonicalTask()]),
      });
      expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    }

    const entry = entryFor("op-claim-1");
    expect(entry.status).toBe("reconciling");
    expect(entry.reconcileAttemptCount).toBe(12);
    expect(entry.attemptCount).toBe(0);
    expect(entry.lastErrorCategory).toBe("projection");
    expect(entry.lastErrorReason).toBe("projection_pending");
    expect(Date.parse(entry.nextAttemptAt ?? "") - Date.now()).toBeLessThanOrEqual(
      TASK_OUTBOX_MAX_RECONCILE_BACKOFF_MS + 1_000,
    );
    expect(cancelTaskOutboxEntry("op-claim-1")).toBe(false);
    expect(listTaskOutbox()).toHaveLength(1);
  });

  it("keeps failed entries past the retention window until an explicit cancel", () => {
    enqueueClaim({ operationId: "op-failed" });
    const entryKey = taskOutboxEntryStorageKey("op-failed");
    const stored = JSON.parse(window.localStorage.getItem(entryKey) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(
      entryKey,
      JSON.stringify({ ...stored, status: "failed", createdAt: "2020-01-01T00:00:00.000Z" }),
    );
    window.localStorage.setItem(
      TASK_OUTBOX_STORAGE_KEY,
      JSON.stringify({ rev: 200, ids: storedIds() }),
    );
    __resetTaskOutboxForTests();

    expect(listTaskOutbox().map((candidate) => candidate.operationId)).toEqual(["op-failed"]);
    expect(cancelTaskOutboxEntry("op-failed")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("still drops a non-failed entry past the retention window", () => {
    enqueueClaim({ operationId: "op-ancient-queued" });
    const entryKey = taskOutboxEntryStorageKey("op-ancient-queued");
    const stored = JSON.parse(window.localStorage.getItem(entryKey) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(entryKey, JSON.stringify({ ...stored, createdAt: "2020-01-01T00:00:00.000Z" }));
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify({ rev: 201, ids: storedIds() }));
    __resetTaskOutboxForTests();

    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("reconstructs an entry key that a lost index still points at", () => {
    enqueueClaim({ operationId: "op-rebuild" });
    const indexRaw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify({ rev: 300, ids: ["op-rebuild", "op-ghost"] }));
    __resetTaskOutboxForTests();

    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-rebuild"]);
    expect(taskOutboxOrphanStorageIds()).toEqual(["op-ghost"]);

    enqueueTaskOperation({
      operationId: "op-after-prune",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 3 },
      displayTarget: { taskId: 3, kind: "task" },
    });

    const pruned = JSON.parse(window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY) ?? "{}") as {
      ids: string[];
    };
    expect(pruned.ids.sort()).toEqual(["op-after-prune", "op-rebuild"]);
    expect(indexRaw).not.toBeNull();
    expect(taskOutboxOrphanStorageIds()).toEqual([]);
  });

  it("warns once and keeps working when storage writes degrade", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => enqueueClaim({ operationId: "op-degraded" })).not.toThrow();
    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-degraded"]);
    expect(warn.mock.calls.some(([first]) => first === "[task-outbox] storage write degraded to memory only")).toBe(true);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call.slice(1))).not.toContain("op-degraded");
    }

    setItem.mockRestore();
    warn.mockRestore();
  });
});
