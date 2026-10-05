// @vitest-environment jsdom
/**
 * The outbox's LIFECYCLE, one test per defect, in the order a command meets
 * them: queued → in flight → landed / refused / dropped.
 *
 * The module's design is that there is NO `done` status. Removal from the outbox
 * IS the terminal event, and it is raised by exactly one signal —
 * `onTaskOutboxAcknowledged`. Every test below that says "terminal" means that
 * signal fired, and a consumer that keys an optimistic mark on the operation id
 * releases the mark on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  TASK_OUTBOX_MAX_ATTEMPTS,
  TASK_OUTBOX_MAX_ENTRIES,
  TASK_OUTBOX_STORAGE_KEY,
  __resetTaskOutboxForTests,
  cancelTaskOutboxEntry,
  enqueueTaskOperation,
  flushTaskOutbox,
  getTaskOutboxSnapshot,
  listTaskOutbox,
  onTaskOutboxAcknowledged,
  registerTaskOutboxDriver,
  requestTaskOutboxFlush,
  taskOutboxEntryStorageKey,
  type TaskOutboxAcknowledgedEvent,
  type TaskOutboxDriver,
  type TaskOutboxEntry,
  type TaskOutboxSendResult,
} from "@/lib/task-operation-outbox";
import {
  __resetTaskCommandCredentialsForTests,
  forgetTaskCommandCredential,
  listTaskCommandCredentialIds,
  queueTaskCommand,
  rememberTaskCommandCredential,
} from "@/lib/task-command-queue";
import { useTaskOperationOutbox } from "@/hooks/useTaskOperationOutbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEMBER_PIN = "member-pin-value";
const PARENT_PIN = "parent-pin-value";

const ADOPT = async () => {};

/** A claim completion on a task. `complete` needs no PIN, so a pump sends it bare. */
function enqueueClaim(operationId: string, taskId = 42): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/tasks/claim",
    action: "complete",
    payload: { taskId, memberName: "Caspian" },
    displayTarget: { taskId, kind: "claim" },
  });
}

/** A manage `update` on a task — two of these on ONE task is the ordering case. */
function enqueueUpdate(operationId: string, taskId: number, title: string): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/tasks/manage",
    action: "update",
    payload: { taskId, patch: { title } },
    displayTarget: { taskId, kind: "task" },
  });
}

function entryFor(operationId: string): TaskOutboxEntry {
  const found = listTaskOutbox().find((entry) => entry.operationId === operationId);
  if (!found) throw new Error(`missing outbox entry ${operationId}`);
  return found;
}

function ok(operationId: string): TaskOutboxSendResult {
  return { status: 200, body: { operationId, reconciled: true } };
}

function serverFault(operationId: string): TaskOutboxSendResult {
  return {
    status: 503,
    body: { operationId, reason: "task_store_unavailable", retryable: true },
  };
}

function refuse(operationId: string): TaskOutboxSendResult {
  return { status: 400, body: { operationId, reason: "invalid_task_command" } };
}

function sessionRefused(operationId: string): TaskOutboxSendResult {
  return { status: 401, body: { operationId, reason: "session_required" } };
}

/** A deferred promise a send can park on, so a test can act mid-request. */
function gate(): { wait: () => Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait: () => wait, open: () => open() };
}

/**
 * Make an entry due now, the way the passage of a backoff would.
 *
 * This writes the per-entry key AND re-commits the index, the way another tab's
 * write would, so the module re-reads. `__resetTaskOutboxForTests()` would also
 * work for that, but it additionally wipes every registered listener, which is
 * not what a backoff expiring does — and three of these tests are listening for
 * the terminal event while they drive the ladder.
 */
function expireBackoff(operationId: string): void {
  const entry = listTaskOutbox().find((candidate) => candidate.operationId === operationId);
  if (!entry) return;
  const nextValue = JSON.stringify({
    ...entry,
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
  });
  window.localStorage.setItem(taskOutboxEntryStorageKey(operationId), nextValue);
  const index = JSON.parse(
    window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY) ?? "{}",
  ) as { rev?: number; ids?: string[] };
  const indexValue = JSON.stringify({ rev: (index.rev ?? 0) + 1, ids: index.ids ?? [] });
  window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, indexValue);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: TASK_OUTBOX_STORAGE_KEY,
      newValue: indexValue,
      storageArea: window.localStorage,
    }),
  );
}

/** Collect terminal events so a test can assert on their SHAPE and their count. */
function recordEvents(): { events: TaskOutboxAcknowledgedEvent[]; stop: () => void } {
  const events: TaskOutboxAcknowledgedEvent[] = [];
  const stop = onTaskOutboxAcknowledged((event) => events.push(event));
  return { events, stop };
}

/**
 * The consumer half of the contract, modelled the way the Tasks page and
 * KidHome model it: a mark keyed by operation id, released ONLY by the terminal
 * event. Nothing here knows or cares why the entry left the outbox.
 */
function optimisticConsumer(): {
  mark: (operationId: string) => void;
  heldCount: () => number;
  stop: () => void;
} {
  const marks = new Set<string>();
  const stop = onTaskOutboxAcknowledged((event) => {
    if (event?.operationId) marks.delete(event.operationId);
  });
  return {
    mark: (operationId) => marks.add(operationId),
    heldCount: () => marks.size,
    stop,
  };
}

function storedIndexIds(): string[] {
  const raw = window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { ids?: unknown };
  return Array.isArray(parsed.ids) ? parsed.ids.map(String) : [];
}

beforeEach(() => {
  window.localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("B1 — a cancel can never race a request the server may already have applied", () => {
  it("refuses an entry whose send is in flight and cancels a not-yet-sent one", async () => {
    enqueueClaim("op-inflight");
    enqueueClaim("op-waiting", 43);

    const barrier = gate();
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        if (entry.operationId === "op-inflight") await barrier.wait();
        return ok(entry.operationId);
      },
    };

    const running = flushTaskOutbox(driver);
    // The first request is on the wire; the second has not been attempted yet.
    await vi.waitFor(() => expect(sent).toEqual(["op-inflight"]));

    // The persisted status is the ONE the renderers' cancellable predicate
    // (`status !== "reconciling"`) excludes, so the button is not even offered.
    expect(entryFor("op-inflight").status).toBe("reconciling");
    expect(cancelTaskOutboxEntry("op-inflight")).toBe(false);
    expect(listTaskOutbox().map((entry) => entry.operationId)).toContain("op-inflight");

    // A command that has not been sent is still the family's to take back.
    expect(cancelTaskOutboxEntry("op-waiting")).toBe(true);
    expect(listTaskOutbox().map((entry) => entry.operationId)).not.toContain("op-waiting");

    barrier.open();
    await running;
    // The applied command landed and was adopted — nothing was thrown away.
    expect(sent).toEqual(["op-inflight"]);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("reverts to a cancellable status when the send fails before reaching the server", async () => {
    enqueueClaim("op-refused-socket");

    const result = await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send: async () => {
        throw new TypeError("Failed to fetch");
      },
    } as unknown as TaskOutboxDriver);

    expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    expect(entryFor("op-refused-socket").status).toBe("retrying");
    expect(cancelTaskOutboxEntry("op-refused-socket")).toBe(true);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("reverts to a cancellable status when a PIN-gated command has no credential to send", async () => {
    enqueueTaskOperation({
      operationId: "op-no-credential",
      route: "/api/tasks/claim",
      action: "claim",
      payload: { taskId: 44, memberName: "Caspian" },
      displayTarget: { taskId: 44, kind: "claim" },
    });
    // What a page reload leaves behind: no ephemeral credential in memory.
    forgetTaskCommandCredential("op-no-credential");
    const send = vi.fn();

    await flushTaskOutbox({ onAcknowledged: ADOPT, send } as unknown as TaskOutboxDriver);

    expect(send).not.toHaveBeenCalled();
    expect(entryFor("op-no-credential").status).toBe("auth-required");
    expect(cancelTaskOutboxEntry("op-no-credential")).toBe(true);
  });
});

describe("B2 — a terminal failure releases the optimistic mark, exactly like a landing", () => {
  it("raises the terminal event for a refusal and a consumer releases its mark", async () => {
    const consumer = optimisticConsumer();
    consumer.mark("op-refused");
    expect(consumer.heldCount()).toBe(1);
    enqueueClaim("op-refused");

    const result = await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => refuse(entry.operationId),
    } as unknown as TaskOutboxDriver);

    expect(result).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    // The entry is terminal but STAYS in the outbox, so the acknowledgment
    // listener is the only thing that can ever release the mark.
    expect(entryFor("op-refused").status).toBe("failed");
    expect(consumer.heldCount()).toBe(0);
    consumer.stop();
  });

  it("carries the operation id, the action, and a failed flag on the event", async () => {
    const { events, stop } = recordEvents();
    enqueueTaskOperation({
      operationId: "op-refused-add",
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { title: "Dishes", assignee: "Rebecca Mom" } },
      displayTarget: { kind: "task" },
    });

    await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => refuse(entry.operationId),
    } as unknown as TaskOutboxDriver);
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operationId: "op-refused-add",
      action: "add",
      failed: true,
    });
    // Nothing on a failure may read as a landing.
    expect(events[0]?.paid).toBeUndefined();
    expect(events[0]?.cleared).toBeUndefined();
    expect(events[0]?.skipped).toBeUndefined();
  });

  it("emits exactly one terminal event per refusal, never one per pump", async () => {
    const { events, stop } = recordEvents();
    enqueueClaim("op-refused-twice");

    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => refuse(entry.operationId),
    };
    await flushTaskOutbox(driver);
    await flushTaskOutbox(driver);
    stop();

    // `runFlush` skips a `failed` entry, so the second pump is silent.
    expect(events).toHaveLength(1);
  });

  it("emits nothing for a retryable failure, which is not terminal", async () => {
    const { events, stop } = recordEvents();
    enqueueClaim("op-retrying");

    await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => serverFault(entry.operationId),
    } as unknown as TaskOutboxDriver);
    stop();

    expect(entryFor("op-retrying").status).toBe("retrying");
    expect(events).toHaveLength(0);
  });
});

describe("B3 — an evicted entry is terminal for its consumer too", () => {
  it("raises a terminal event for every entry the cap drops", async () => {
    const { events, stop } = recordEvents();
    for (let index = 0; index < TASK_OUTBOX_MAX_ENTRIES + 3; index += 1) {
      enqueueUpdate(`op-bulk-${String(index).padStart(3, "0")}`, index + 1, `Chore ${index}`);
    }
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    stop();

    const stored = listTaskOutbox().map((entry) => entry.operationId);
    expect(stored).toHaveLength(TASK_OUTBOX_MAX_ENTRIES);
    // The cap keeps the NEWEST, so the three oldest are the ones dropped.
    expect(stored[0]).toBe("op-bulk-003");
    expect(stored[stored.length - 1]).toBe(
      `op-bulk-${String(TASK_OUTBOX_MAX_ENTRIES + 2).padStart(3, "0")}`,
    );

    const evicted = events
      .filter((event) => event.evicted === true)
      .map((event) => event.operationId);
    expect(evicted).toEqual(["op-bulk-000", "op-bulk-001", "op-bulk-002"]);
    for (const event of events) {
      expect(event.failed).toBe(true);
      expect(event.reason).toBe("outbox_evicted");
      expect(event.action).toBe("update");
    }
  });

  it("leaves a consumer's mark releasable rather than orphaned by the cap", async () => {
    const consumer = optimisticConsumer();
    consumer.mark("op-bulk-000");
    for (let index = 0; index < TASK_OUTBOX_MAX_ENTRIES + 1; index += 1) {
      enqueueUpdate(`op-bulk-${String(index).padStart(3, "0")}`, index + 1, `Chore ${index}`);
    }

    await vi.waitFor(() => expect(consumer.heldCount()).toBe(0));
    expect(listTaskOutbox().some((entry) => entry.operationId === "op-bulk-000")).toBe(false);
    consumer.stop();
  });

  it("drops the per-entry key of an evicted entry and prunes the index", async () => {
    for (let index = 0; index < TASK_OUTBOX_MAX_ENTRIES + 2; index += 1) {
      enqueueUpdate(`op-bulk-${String(index).padStart(3, "0")}`, index + 1, `Chore ${index}`);
    }

    await vi.waitFor(() =>
      expect(window.localStorage.getItem(taskOutboxEntryStorageKey("op-bulk-000"))).toBeNull(),
    );
    expect(storedIndexIds()).not.toContain("op-bulk-000");
  });

  it("prunes an index id whose record is already gone, without a mutation", async () => {
    enqueueClaim("op-real");
    const index = JSON.parse(window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY) ?? "{}") as {
      rev: number;
      ids: string[];
    };
    // Another tab's index survived, but its record did not.
    window.localStorage.setItem(
      TASK_OUTBOX_STORAGE_KEY,
      JSON.stringify({ rev: index.rev + 1, ids: [...index.ids, "op-ghost"] }),
    );
    __resetTaskOutboxForTests();

    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-real"]);
    await vi.waitFor(() => expect(storedIndexIds()).not.toContain("op-ghost"));
  });
});

describe("B4 — the pump keeps going for work that arrives while it runs", () => {
  it("sends an operation enqueued during an in-flight flush in that same flush", async () => {
    enqueueClaim("op-first");
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        // A modal, the chat action runner, or a second tap queues here.
        if (entry.operationId === "op-first") enqueueClaim("op-second", 45);
        return ok(entry.operationId);
      },
    };

    const result = await flushTaskOutbox(driver);

    expect(sent).toEqual(["op-first", "op-second"]);
    expect(result.acknowledged).toBe(2);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("picks up work enqueued by a LATER entry in the same pass, not just the first", async () => {
    enqueueClaim("op-a");
    enqueueClaim("op-b", 46);
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        if (entry.operationId === "op-b") enqueueClaim("op-c", 47);
        return ok(entry.operationId);
      },
    };

    const result = await flushTaskOutbox(driver);

    expect(sent).toEqual(["op-a", "op-b", "op-c"]);
    expect(result.acknowledged).toBe(3);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("schedules a coalesced flush from the enqueue path when a driver is registered", async () => {
    const sent: string[] = [];
    const release = registerTaskOutboxDriver({
      send: (async (entry: TaskOutboxEntry) => {
        sent.push(entry.operationId);
        return ok(entry.operationId);
      }) as never,
      onAcknowledged: ADOPT,
    });

    enqueueClaim("op-scheduled");
    enqueueClaim("op-scheduled-2", 48);
    // Two enqueues, ONE scheduled pump: the in-flight guard collapses them.
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual(["op-scheduled", "op-scheduled-2"]);
    expect(listTaskOutbox()).toHaveLength(0);
    release();
  });

  it("schedules nothing when no driver is registered, so a storage write provokes no request", async () => {
    enqueueClaim("op-no-driver");
    await Promise.resolve();
    await Promise.resolve();
    // Still queued, and nothing tried to send it.
    expect(entryFor("op-no-driver").status).toBe("queued");
  });
});

describe("B5 — commands on one task row go out in creation order", () => {
  it("holds a later command on the same task behind an earlier one in backoff", async () => {
    enqueueUpdate("op-order-1", 7, "First");
    const first = vi.fn(async () => serverFault("op-order-1"));
    const second = vi.fn(async () => ok("op-order-2"));
    const driver = (): TaskOutboxDriver =>
      ({
        onAcknowledged: ADOPT,
        send: async (entry: TaskOutboxEntry) =>
          entry.operationId === "op-order-1" ? first() : second(),
      }) as TaskOutboxDriver;

    await flushTaskOutbox(driver());
    expect(entryFor("op-order-1").status).toBe("retrying");
    expect(first).toHaveBeenCalledTimes(1);

    // The family's second edit of the SAME chore is queued while the first is
    // in a 2s backoff. Sending it now would let the server apply the OLD value
    // after the new one, while the app's own ledger showed the new one.
    enqueueUpdate("op-order-2", 7, "Second");
    const held = await flushTaskOutbox(driver());
    expect(held).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(second).not.toHaveBeenCalled();
    expect(entryFor("op-order-2").status).toBe("queued");

    // Once the first is due again, both go out oldest-first.
    first.mockImplementation(async () => ok("op-order-1"));
    expireBackoff("op-order-1");
    const landed = await flushTaskOutbox(driver());
    expect(landed.acknowledged).toBe(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("never holds commands on DIFFERENT tasks behind each other", async () => {
    enqueueUpdate("op-other-1", 7, "First");
    enqueueUpdate("op-other-2", 8, "Unrelated");

    const send = vi.fn(async (entry: TaskOutboxEntry) =>
      entry.operationId === "op-other-1" ? serverFault(entry.operationId) : ok(entry.operationId),
    );

    const result = await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send,
    } as unknown as TaskOutboxDriver);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.acknowledged).toBe(1);
    expect(entryFor("op-other-1").status).toBe("retrying");
  });

  it("holds on taskIds as well as on a single taskId", async () => {
    enqueueTaskOperation({
      operationId: "op-approve-all",
      route: "/api/tasks/approve",
      action: "approve-all",
      payload: { taskIds: [11, 12], memberName: "Rebecca Mom" },
      displayTarget: { kind: "approval" },
    });
    rememberTaskCommandCredential("op-approve-all", { pin: PARENT_PIN });

    const first = vi.fn(async () => sessionRefused("op-approve-all"));
    const second = vi.fn(async () => ok("op-followup"));
    const driver = (): TaskOutboxDriver =>
      ({
        onAcknowledged: ADOPT,
        getCredential: (entry: TaskOutboxEntry) =>
          entry.operationId === "op-approve-all" ? { pin: PARENT_PIN } : undefined,
        send: async (entry: TaskOutboxEntry) =>
          entry.operationId === "op-approve-all" ? first() : second(),
      }) as TaskOutboxDriver;

    await flushTaskOutbox(driver());
    expect(entryFor("op-approve-all").status).toBe("auth-required");

    // Task 12 is one of the rows that approval is still holding.
    enqueueUpdate("op-followup", 12, "Renamed");
    const held = await flushTaskOutbox(driver());
    expect(held).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(second).not.toHaveBeenCalled();
    expect(entryFor("op-followup").status).toBe("queued");
  });
});

describe("B6 — the deferred auth ladder is bounded like every other one", () => {
  it("stops after TASK_OUTBOX_MAX_ATTEMPTS instead of re-POSTing forever", async () => {
    enqueueUpdate("op-session-loop", 9, "Renamed");
    const send = vi.fn(async () => sessionRefused("op-session-loop"));
    const driver = { onAcknowledged: ADOPT, send } as unknown as TaskOutboxDriver;

    for (let index = 0; index < TASK_OUTBOX_MAX_ATTEMPTS - 1; index += 1) {
      expireBackoff("op-session-loop");
      const result = await flushTaskOutbox(driver);
      expect(result).toEqual({ acknowledged: 0, retryable: 1, permanent: 0 });
    }
    expireBackoff("op-session-loop");
    const final = await flushTaskOutbox(driver);

    expect(final).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(send).toHaveBeenCalledTimes(TASK_OUTBOX_MAX_ATTEMPTS);
    expect(entryFor("op-session-loop").status).toBe("failed");
    expect(entryFor("op-session-loop").nextAttemptAt).toBeUndefined();

    // And it stays refused — the pump no longer touches it.
    const again = await flushTaskOutbox(driver);
    expect(again).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(send).toHaveBeenCalledTimes(TASK_OUTBOX_MAX_ATTEMPTS);
  });

  it("ends a session loop with the terminal event, so the mark comes off", async () => {
    const consumer = optimisticConsumer();
    consumer.mark("op-session-loop-event");
    enqueueUpdate("op-session-loop-event", 10, "Renamed");
    const { events, stop } = recordEvents();
    const driver = {
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => sessionRefused(entry.operationId),
    } as unknown as TaskOutboxDriver;

    for (let index = 0; index < TASK_OUTBOX_MAX_ATTEMPTS; index += 1) {
      expireBackoff("op-session-loop-event");
      await flushTaskOutbox(driver);
    }
    stop();

    expect(entryFor("op-session-loop-event").status).toBe("failed");
    expect(consumer.heldCount()).toBe(0);
    expect(events.filter((event) => event.failed === true)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      operationId: "op-session-loop-event",
      failed: true,
    });
  });
});

describe("B7 — one pump per outbox, whatever the driver identity is", () => {
  it("awaits the running flush when the top of the driver stack changes mid-flight", async () => {
    enqueueClaim("op-remount");
    const barrier = gate();
    const firstSend = vi.fn(async (entry: TaskOutboxEntry) => {
      await barrier.wait();
      return ok(entry.operationId);
    });
    const secondSend = vi.fn(async (entry: TaskOutboxEntry) => ok(entry.operationId));

    // The hook mounts: a driver is registered and a pump starts.
    const releaseFirst = registerTaskOutboxDriver({
      send: firstSend as never,
      onAcknowledged: ADOPT,
    });
    const first = requestTaskOutboxFlush();
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledTimes(1));

    // The hook UNMOUNTS and another one mounts, registering a DIFFERENT driver
    // while the first pump is still awaiting its response.
    releaseFirst();
    const releaseSecond = registerTaskOutboxDriver({
      send: secondSend as never,
      onAcknowledged: ADOPT,
    });
    const second = requestTaskOutboxFlush();

    // Same outbox, so the same pump — not a second POST of the same id, and not
    // a second `attemptCount` computed from the same stale value.
    expect(second).toBe(first);
    barrier.open();
    await Promise.all([first, second]);

    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(secondSend).not.toHaveBeenCalled();
    expect(listTaskOutbox()).toHaveLength(0);
    releaseSecond();
  });

  it("shares one promise for the same driver and never re-sends an in-flight operation", async () => {
    enqueueClaim("op-shared");
    const barrier = gate();
    const send = vi.fn(async (entry: TaskOutboxEntry) => {
      await barrier.wait();
      return ok(entry.operationId);
    });
    const driver: TaskOutboxDriver = { onAcknowledged: ADOPT, send };
    const other: TaskOutboxDriver = { onAcknowledged: ADOPT, send };

    const first = flushTaskOutbox(driver);
    const same = flushTaskOutbox(driver);
    expect(same).toBe(first);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    // A second pump over the same entries is refused the in-flight operation
    // rather than POSTing it a second time.
    await flushTaskOutbox(other);
    expect(send).toHaveBeenCalledTimes(1);

    barrier.open();
    await first;
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("B8 — a legacy array index survives a cold load", () => {
  function writeLegacyArrayIndex(entries: Record<string, unknown>[]): void {
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify(entries));
  }

  const legacyEntry = (operationId: string): Record<string, unknown> => ({
    version: 1,
    operationId,
    route: "/api/tasks/claim",
    action: "complete",
    payload: { taskId: 42, memberName: "Caspian" },
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: "queued",
    displayTarget: { taskId: 42, kind: "claim" },
  });

  it("reads a queued command on the FIRST read, before any mutation", () => {
    writeLegacyArrayIndex([legacyEntry("op-legacy-1"), legacyEntry("op-legacy-2")]);
    // A cold module: nothing has enqueued, migrated or patched anything yet.
    __resetTaskOutboxForTests();
    expect(window.localStorage.getItem(taskOutboxEntryStorageKey("op-legacy-1"))).toBeNull();

    // `getTaskOutboxSnapshot` is what useSyncExternalStore calls DURING render,
    // long before any mutation could have run migrateLegacyIndex.
    expect(getTaskOutboxSnapshot().map((entry) => entry.operationId)).toEqual([
      "op-legacy-1",
      "op-legacy-2",
    ]);
    expect(listTaskOutbox()).toHaveLength(2);
  });

  it("sends a legacy-index command instead of stranding it until a new one is queued", async () => {
    writeLegacyArrayIndex([legacyEntry("op-legacy-send")]);
    __resetTaskOutboxForTests();

    const send = vi.fn(async (entry: TaskOutboxEntry) => ok(entry.operationId));
    const result = await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send,
    } as unknown as TaskOutboxDriver);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.acknowledged).toBe(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("rehydrates into per-entry keys and still READS the array shape", async () => {
    writeLegacyArrayIndex([legacyEntry("op-legacy-keys")]);
    __resetTaskOutboxForTests();

    listTaskOutbox();
    expect(window.localStorage.getItem(taskOutboxEntryStorageKey("op-legacy-keys"))).not.toBeNull();
    // The array is not rewritten in place, so entries the current build wrote
    // are never orphaned by the rehydration.
    expect(JSON.parse(window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY) ?? "[]")).toHaveLength(1);

    // A mutation commits the modern shape and the command is still there.
    enqueueClaim("op-legacy-plus");
    expect(listTaskOutbox().map((entry) => entry.operationId).sort()).toEqual([
      "op-legacy-keys",
      "op-legacy-plus",
    ]);
    expect(storedIndexIds().sort()).toEqual(["op-legacy-keys", "op-legacy-plus"]);
  });

  it("degrades a corrupt legacy value to an empty outbox rather than throwing", () => {
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, "{not json");
    __resetTaskOutboxForTests();
    expect(listTaskOutbox()).toEqual([]);
  });
});

describe("B9 — a failed enqueue leaves no credential behind", () => {
  it("forgets the remembered PIN when the route is unsupported", () => {
    rememberTaskCommandCredential("op-bogus", { pin: MEMBER_PIN });
    expect(listTaskCommandCredentialIds()).toEqual(["op-bogus"]);

    expect(() =>
      queueTaskCommand({
        operationId: "op-bogus",
        route: "/api/tasks/nope" as never,
        action: "claim",
        payload: { taskId: 1 },
        displayTarget: { taskId: 1, kind: "claim" },
        credential: { pin: MEMBER_PIN },
      }),
    ).toThrow(/unsupported_task_operation/);

    // No entry exists, so nothing would ever evict or release this credential.
    expect(listTaskCommandCredentialIds()).toEqual([]);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("forgets the remembered PIN when the ACTION is unsupported", () => {
    expect(() =>
      queueTaskCommand({
        operationId: "op-bogus-action",
        route: "/api/tasks/claim",
        action: "teleport",
        payload: { taskId: 1 },
        displayTarget: { taskId: 1, kind: "claim" },
        credential: { pin: MEMBER_PIN },
      }),
    ).toThrow(/unsupported_task_operation/);

    expect(listTaskCommandCredentialIds()).toEqual([]);
  });

  it("still remembers the PIN for an enqueue that succeeded", () => {
    queueTaskCommand({
      operationId: "op-good",
      route: "/api/tasks/claim",
      action: "claim",
      payload: { taskId: 1 },
      displayTarget: { taskId: 1, kind: "claim" },
      credential: { pin: MEMBER_PIN },
    });
    expect(listTaskCommandCredentialIds()).toEqual(["op-good"]);
  });
});

describe("B10 — re-queuing a known operation id is the SAME command's retry", () => {
  it("does not reset the attempt budget", async () => {
    enqueueUpdate("op-requeue", 11, "Renamed");
    const send = vi.fn(async (entry: TaskOutboxEntry) => serverFault(entry.operationId));
    const driver = { onAcknowledged: ADOPT, send } as unknown as TaskOutboxDriver;

    await flushTaskOutbox(driver);
    expect(entryFor("op-requeue").attemptCount).toBe(1);

    // `RewardsShop` reuses one operation id across its retries. That must not
    // hand the command a fresh budget, or TASK_OUTBOX_MAX_ATTEMPTS bounds
    // nothing.
    enqueueUpdate("op-requeue", 11, "Renamed again");
    expect(entryFor("op-requeue").attemptCount).toBe(1);
    expect(listTaskOutbox()).toHaveLength(1);

    for (let attempt = 1; attempt <= TASK_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1) enqueueUpdate("op-requeue", 11, `Renamed ${attempt}`);
      await flushTaskOutbox(driver);
      if (entryFor("op-requeue").status === "failed") break;
    }

    expect(send).toHaveBeenCalledTimes(TASK_OUTBOX_MAX_ATTEMPTS);
    expect(entryFor("op-requeue").status).toBe("failed");
  });

  it("keeps a first-time enqueue's budget at zero", () => {
    enqueueUpdate("op-first-enqueue", 12, "Renamed");
    expect(entryFor("op-first-enqueue").attemptCount).toBe(0);
    expect(entryFor("op-first-enqueue").nextAttemptAt).toBeUndefined();
  });

  it("lets a deliberate re-queue land instead of serving out a backoff", async () => {
    enqueueClaim("op-retap");
    const driver = {
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => serverFault(entry.operationId),
    } as unknown as TaskOutboxDriver;
    await flushTaskOutbox(driver);
    expect(entryFor("op-retap").status).toBe("retrying");

    // The family tapped again: that IS the retry the backoff was waiting for.
    enqueueClaim("op-retap");
    const landed = await flushTaskOutbox({
      onAcknowledged: ADOPT,
      send: async (entry: TaskOutboxEntry) => ok(entry.operationId),
    } as unknown as TaskOutboxDriver);

    expect(landed.acknowledged).toBe(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("the hook counts a backing-off entry separately from a queued one", () => {
  it("exposes `retrying` while keeping every count the banners already read", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const seen: Array<Record<string, number>> = [];
    let latest: ReturnType<typeof useTaskOperationOutbox> | null = null;
    let root: ReturnType<typeof createRoot> | null = null;

    function Probe() {
      const counts = useTaskOperationOutbox({ autoFlush: false });
      // Assigning in an effect, not during render: the count snapshot is a test
      // observation, not part of the component's output.
      useEffect(() => {
        latest = counts;
        seen.push({
          pending: counts.pending,
          queued: counts.queued,
          retrying: counts.retrying,
          reconciling: counts.reconciling,
          authRequired: counts.authRequired,
          failed: counts.failed,
        });
      });
      return null;
    }

    // A root is created per mount, because the hook registers a driver per mount
    // and React 19 will not re-render an unmounted root.
    const mount = async () => {
      root = createRoot(host);
      await act(async () => {
        root!.render(createElement(Probe));
      });
    };
    const unmount = async () => {
      const current = root!;
      await act(async () => {
        current.unmount();
      });
      root = null;
    };

    enqueueClaim("op-hook-one");
    enqueueClaim("op-hook-two", 51);
    await mount();
    expect(seen.at(-1)).toMatchObject({ pending: 2, queued: 2, retrying: 0 });

    // Put both entries into a backoff through the hook's own flush.
    await act(async () => {
      await latest!.flush();
    });
    expect(listTaskOutbox().map((entry) => entry.status)).toEqual(["retrying", "retrying"]);

    // Unmount, queue a third command while nothing is registered (so the enqueue
    // path schedules no pump), then mount again.
    await unmount();
    enqueueClaim("op-hook-three", 52);
    await mount();

    const last = seen.at(-1)!;
    expect(last.pending).toBe(3);
    // The backoff is now visible as its OWN count.
    expect(last.retrying).toBe(2);
    // `queued` keeps its existing meaning ("in flight or about to be"), so no
    // banner loses a count — and that is exactly why `retrying` has to be
    // exposed separately: `queued` alone cannot tell a 2-second wait from a
    // 5-minute one.
    expect(last.queued).toBe(3);
    expect(last.queued - last.retrying).toBe(1);
    expect(last).toHaveProperty("reconciling");
    expect(last).toHaveProperty("authRequired");
    expect(last).toHaveProperty("failed");

    await unmount();
    host.remove();
  });
});
