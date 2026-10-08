// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { loadDeletedTaskIds, loadTasks, saveTasks } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  adoptTaskOutboxAcknowledgement,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskOutbox,
  registerTaskOutboxDriver,
  type TaskOutboxAcknowledgement,
  type TaskOutboxDriver,
} from "@/lib/task-command-store";

beforeEach(() => {
  window.localStorage.clear();
  __resetTaskOutboxForTests();
});

function errBody(error: string): TaskOutboxAcknowledgement {
  return { operationId: "op-error", error, reconciled: false };
}

async function flush(overrides: Partial<TaskOutboxDriver> = {}) {
  const restore = registerTaskOutboxDriver({
    onAcknowledged: adoptTaskOutboxAcknowledgement,
    adoptSnapshot: async () => {},
    ...overrides,
  });
  try {
    return await flushTaskOutbox();
  } finally {
    restore();
  }
}

describe("outbox self-heal — a terminal unknown_task drops the stranded row", () => {
  it("tombstones the id device-side and removes the entry instead of failing forever", async () => {
    saveTasks([{ id: 4242, title: "Feed the cat", assignee: "Emily" } as never]);
    enqueueTaskOperation({
      operationId: "op-ghost-delete",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 4242 },
      displayTarget: { kind: "task", taskId: 4242, title: "Feed the cat" },
    });

    const result = await flush({
      send: async () => ({ status: 404, body: errBody("unknown_task") }),
    });

    expect(loadDeletedTaskIds()).toContain(4242);
    expect(loadTasks().map((t) => t.id)).not.toContain(4242);
    expect(result.permanent).toBe(0);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("does NOT swallow a 404 whose reason is a real refusal", async () => {
    enqueueTaskOperation({
      operationId: "op-unknown-owner",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 6161, memberName: "Nobody" },
      displayTarget: { kind: "claim", taskId: 6161, title: "Mow lawn" },
    });

    const result = await flush({
      send: async () => ({ status: 404, body: errBody("unknown_task_owner") }),
    });

    expect(result.permanent).toBe(1);
    expect(loadDeletedTaskIds()).not.toContain(6161);
    expect(listTaskOutbox()[0]?.status).toBe("failed");
  });

  it("does NOT heal an unknown_task that carries no taskId", async () => {
    enqueueTaskOperation({
      operationId: "op-config-unknown",
      route: "/api/tasks/config",
      action: "upsert",
      payload: { kind: "rewards", items: [], updatedAt: new Date().toISOString() },
      displayTarget: { kind: "config" },
    });

    const result = await flush({
      send: async () => ({ status: 404, body: errBody("unknown_task") }),
    });

    expect(result.permanent).toBe(1);
    expect(listTaskOutbox()[0]?.status).toBe("failed");
  });
});
