// @vitest-environment jsdom
// B1a D4 — a 202 that did not reconcile is NOT a success the client may bank.
//
// The old store acknowledged ANY non-queued 2xx, so an approval whose
// projection leg failed cleared device-side while the kitchen display never
// received it — strictly worse than a stuck row, because a stuck row is at
// least visibly wrong. The entry must stay retryable and carry the server's
// own sentence.
import { describe, it, expect, beforeEach } from "vitest";

import {
  __resetTaskCommandCredentialsForTests,
  __resetTaskOutboxForTests,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskOutbox,
  onTaskOutboxAcknowledged,
  registerTaskOutboxDriver,
  type TaskOutboxAcknowledgedEvent,
} from "@/lib/task-command-store";

const SENTENCE = "1 approval did not reach the kitchen display yet. Consuela is still retrying.";

function enqueueApprove() {
  return enqueueTaskOperation({
    operationId: "op-ack-classification",
    route: "/api/tasks/approve",
    action: "approve",
    payload: { taskId: 101, memberName: "Rebecca (Mom)" },
    displayTarget: { kind: "approval", taskId: 101, title: "Dishes" },
  });
}

async function flushWithSend(body: Record<string, unknown>, status = 202): Promise<TaskOutboxAcknowledgedEvent[]> {
  const events: TaskOutboxAcknowledgedEvent[] = [];
  const unsubscribe = onTaskOutboxAcknowledged((event) => events.push(event));
  const restore = registerTaskOutboxDriver({
    send: async () => ({ status, body: body as any }),
    onAcknowledged: async () => {},
  });
  try {
    await flushTaskOutbox();
  } finally {
    restore();
    unsubscribe();
  }
  return events;
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("a 202 that did not reconcile is not a banked success", () => {
  it("keeps the entry retryable with the server's sentence and no ack event", async () => {
    enqueueApprove();
    const events = await flushWithSend({
      success: true,
      reconciled: false,
      repairRequired: true,
      retryable: true,
      error: SENTENCE,
    });

    const entry = listTaskOutbox()[0];
    expect(entry.status).not.toBe("failed");
    expect(entry.status).toBe("retrying");
    expect(entry.lastErrorReason).toBe("projection_pending");
    expect(entry.lastErrorMessage).toBe(SENTENCE);
    expect(events.some((event) => event.failed !== true)).toBe(false);
  });

  it("still acks a fully reconciled 200", async () => {
    enqueueApprove();
    const events = await flushWithSend(
      {
        success: true,
        reconciled: true,
        repairRequired: false,
        weekData: { weekStart: "2026-10-05", points: {}, streak: {}, lastActive: {}, history: [] },
      },
      200,
    );

    expect(listTaskOutbox()).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0].failed).not.toBe(true);
  });
});
