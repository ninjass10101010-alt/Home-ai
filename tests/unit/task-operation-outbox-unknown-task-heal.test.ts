// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { loadDeletedTaskIds, loadTasks, saveTasks } from "@/lib/task-utils";
import {
  __resetTaskOutboxForTests,
  adoptTaskOutboxAcknowledgement,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskOutbox,
  type TaskOutboxAcknowledgement,
  type TaskOutboxDriver,
} from "@/lib/task-operation-outbox";

const PIN = "1234";

beforeEach(() => {
  window.localStorage.clear();
  __resetTaskOutboxForTests();
});

function errBody(error: string): TaskOutboxAcknowledgement {
  return { operationId: "op-error", error, reconciled: false };
}

function flush(overrides: Partial<TaskOutboxDriver> = {}) {
  return flushTaskOutbox({
    onAcknowledged: async () => {},
    adoptSnapshot: async () => {},
    ...overrides,
  } as TaskOutboxDriver);
}

/**
 * `POST /api/tasks/manage` answers `404 unknown_task` when the snapshot does
 * not hold the id the command carries
 * (src/lib/task-manage.ts:957-959 -> src/app/api/tasks/manage/route.ts:15).
 *
 * That is what a stranded id looks like: the device kept an id the server
 * re-keyed away, so the chore is on screen but unaddressable. The old
 * behaviour marked the entry `failed` — TERMINAL, never retried — so the
 * device wrote a permanent outbox entry, the Tasks screen showed
 * "N couldn't be sent." forever, and the display-only optimistic hide was
 * released, putting the row straight back on screen. The family could never
 * delete that chore from that device, and could never clear the warning.
 *
 * The self-heal: the row cannot exist on the server, so drop it on the device.
 * The user's intent (this chore is not on my screen) becomes true, the entry
 * leaves the outbox instead of accumulating, and the misleading permanent
 * failure disappears. No server state is invented — nothing was deleted
 * because there was nothing to delete.
 */
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

    // The REAL adopter, so this proves the family's actual outcome: the row is
    // gone from the local store, not merely from the outbox.
    const result = await flush({
      onAcknowledged: adoptTaskOutboxAcknowledgement,
      send: async () => ({ status: 404, body: errBody("unknown_task") }),
    });

    // The ghost id is tombstoned on this device, so the row leaves the screen.
    expect(loadDeletedTaskIds()).toContain(4242);
    expect(loadTasks().map((t) => t.id)).not.toContain(4242);
    // …and the entry is GONE: no permanent failure, no endless banner.
    expect(result.permanent).toBe(0);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("heals a stranded claim/complete too — the row is a ghost there as well", async () => {
    saveTasks([{ id: 5151, title: "Walk the dog", assignee: "Bailey" } as never]);

    enqueueTaskOperation({
      operationId: "op-ghost-complete",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 5151, memberName: "Bailey", pin: PIN },
      displayTarget: { kind: "claim", taskId: 5151, title: "Walk the dog" },
    });

    await flush({
      onAcknowledged: adoptTaskOutboxAcknowledgement,
      send: async () => ({ status: 404, body: errBody("unknown_task") }),
    });

    expect(loadDeletedTaskIds()).toContain(5151);
    expect(loadTasks().map((t) => t.id)).not.toContain(5151);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("does NOT swallow a 404 whose reason is a real refusal", async () => {
    enqueueTaskOperation({
      operationId: "op-unknown-owner",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 6161, memberName: "Nobody", pin: PIN },
      displayTarget: { kind: "claim", taskId: 6161, title: "Mow lawn" },
    });

    const result = await flush({
      send: async () => ({
        status: 404,
        body: errBody("unknown_task_owner"),
      }),
    });

    // A named refusal is the server's honest answer and must stay visible.
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

  it("still fails (rather than heals) when adoption itself is unavailable", async () => {
    enqueueTaskOperation({
      operationId: "op-ghost-no-adopt",
      route: "/api/tasks/manage",
      action: "delete",
      payload: { taskId: 7171 },
      displayTarget: { kind: "task", taskId: 7171, title: "Rake leaves" },
    });

    const result = await flush({
      send: async () => ({ status: 404, body: errBody("unknown_task") }),
      onAcknowledged: undefined,
    });

    // No adoption seam means the row cannot actually leave the screen, so the
    // honest state is still "failed" rather than a silent, invisible success.
    expect(listTaskOutbox()[0]?.status).not.toBe("failed");
    expect(result.acknowledged + result.retryable + result.permanent).toBeGreaterThan(0);
  });
});