// @vitest-environment jsdom
/**
 * The command store's LIFECYCLE, one test per contract recovered from the
 * deleted outbox suite (`task-outbox-lifecycle-fixes.test.ts`), against the
 * server-queue successor in `src/lib/task-command-store.ts`.
 *
 * The module's design is that there is NO `done` status. Removal from the store
 * IS the terminal event, and it is raised by exactly one signal —
 * `onTaskOutboxAcknowledged`. Every test below that says "terminal" means that
 * signal fired, and a consumer that keys an optimistic mark on the operation id
 * releases the mark on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TASK_OUTBOX_MAX_ENTRIES,
  TASK_OUTBOX_STORAGE_KEY,
  __resetTaskOutboxForTests,
  cancelTaskOutboxEntry,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskCommandCredentialIds,
  listTaskOutbox,
  onTaskOutboxAcknowledged,
  registerTaskOutboxDriver,
  rememberTaskCommandCredential,
  __resetTaskCommandCredentialsForTests,
  type TaskOutboxAcknowledgedEvent,
  type TaskOutboxDriver,
  type TaskOutboxEntry,
  type TaskOutboxSendResult,
} from "@/lib/task-command-store";

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
  if (!found) throw new Error(`missing store entry ${operationId}`);
  return found;
}

function ok(operationId: string): TaskOutboxSendResult {
  return { status: 200, body: { operationId, reconciled: true } };
}

function serverFault(operationId: string): TaskOutboxSendResult {
  return {
    status: 503,
    body: { operationId, reason: "task_store_unavailable" },
  };
}

function refuse(operationId: string): TaskOutboxSendResult {
  return { status: 400, body: { operationId, reason: "invalid_task_command" } };
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
 * Make an entry due now, the way the passage of a backoff would: rewrite the
 * persisted array with `nextAttemptAt` in the past and raise the storage event
 * another tab's write would, so the module re-reads.
 */
function expireBackoff(operationId: string): void {
  const entries = listTaskOutbox().map((entry) =>
    entry.operationId === operationId
      ? { ...entry, nextAttemptAt: new Date(Date.now() - 1_000).toISOString() }
      : entry,
  );
  window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: TASK_OUTBOX_STORAGE_KEY,
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

async function withDriver<T>(driver: TaskOutboxDriver, run: () => Promise<T>): Promise<T> {
  const restore = registerTaskOutboxDriver(driver);
  try {
    return await run();
  } finally {
    restore();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("B1 — a cancel can never race a request the server may already have applied", () => {
  it("refuses an entry whose send is in flight and cancels a not-yet-sent one", async () => {
    enqueueClaim("op-inflight", 42);
    enqueueClaim("op-waiting", 43);

    const barrier = gate();
    const sent: string[] = [];
    const release = registerTaskOutboxDriver({
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        if (entry.operationId === "op-inflight") await barrier.wait();
        return ok(entry.operationId);
      },
    });

    const running = flushTaskOutbox();
    // The first request is on the wire: its persisted status is the ONE the
    // renderers' cancellable predicate (`status !== "reconciling"`) excludes.
    await vi.waitFor(() => expect(entryFor("op-inflight").status).toBe("reconciling"));

    expect(cancelTaskOutboxEntry("op-inflight")).toBe(false);
    expect(listTaskOutbox().map((entry) => entry.operationId)).toContain("op-inflight");

    // A command that has not been sent is still the family's to take back.
    const { events, stop } = recordEvents();
    enqueueClaim("op-late", 44);
    expect(cancelTaskOutboxEntry("op-late")).toBe(true);
    stop();
    expect(listTaskOutbox().map((entry) => entry.operationId)).not.toContain("op-late");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operationId: "op-late", action: "complete" });

    barrier.open();
    await running;
    release();
    // The applied commands landed and were adopted — nothing was thrown away.
    expect(sent).toContain("op-inflight");
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("B2 — a terminal failure emits exactly one terminal event and releases the credential", () => {
  it("raises one event for a refusal and forgets the command's credential", async () => {
    const { events, stop } = recordEvents();
    enqueueTaskOperation({
      operationId: "op-refused-add",
      route: "/api/tasks/manage",
      action: "add",
      payload: { task: { title: "Dishes", assignee: "Rebecca Mom" } },
      displayTarget: { kind: "task" },
    });
    rememberTaskCommandCredential("op-refused-add", { parentPin: PARENT_PIN });

    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => refuse(entry.operationId),
    };
    const first = await withDriver(driver, () => flushTaskOutbox());
    const second = await withDriver(driver, () => flushTaskOutbox());
    stop();

    expect(first).toEqual({ acknowledged: 0, retryable: 0, permanent: 1 });
    expect(second).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    // The entry is terminal but STAYS in the store, so the acknowledgment
    // listener is the only thing that can ever release the consumer's mark.
    expect(entryFor("op-refused-add").status).toBe("failed");
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
    expect(listTaskCommandCredentialIds()).not.toContain("op-refused-add");
  });
});

describe("B3 — an evicted entry is terminal for its consumer too", () => {
  function seedEntries(count: number): void {
    const entries = Array.from({ length: count }, (_, index) => ({
      version: 1,
      operationId: `op-bulk-${String(index).padStart(3, "0")}`,
      route: "/api/tasks/manage",
      action: "update",
      payload: { taskId: index + 1, patch: { title: `Chore ${index}` } },
      createdAt: new Date(Date.now() - (count - index) * 1_000).toISOString(),
      attemptCount: 0,
      status: "queued",
      displayTarget: { taskId: index + 1, kind: "task" },
    }));
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify(entries));
  }

  it("raises a terminal event for the evicted entry and forgets its credential", async () => {
    const { events, stop } = recordEvents();
    seedEntries(TASK_OUTBOX_MAX_ENTRIES);
    rememberTaskCommandCredential("op-bulk-000", { pin: MEMBER_PIN });

    // The cap keeps the NEWEST, so the oldest seeded entry is the one dropped.
    enqueueUpdate("op-bulk-new", 999, "Newest");

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    stop();

    expect(events[0]).toMatchObject({
      operationId: "op-bulk-000",
      action: "update",
      failed: true,
      evicted: true,
      reason: "outbox_evicted",
    });
    expect(listTaskOutbox()).toHaveLength(TASK_OUTBOX_MAX_ENTRIES);
    expect(listTaskOutbox().some((entry) => entry.operationId === "op-bulk-000")).toBe(false);
    // The credential for an evicted entry must die with it, or a tab that ages
    // entries out would keep PINs in memory forever.
    expect(listTaskCommandCredentialIds()).not.toContain("op-bulk-000");
  });
});

describe("B4 — the flush keeps going for work that arrives while it runs", () => {
  it("sends an operation enqueued during an in-flight flush in that same flush", async () => {
    enqueueClaim("op-first", 71);
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        // A modal, the chat action runner, or a second tap queues here.
        if (entry.operationId === "op-first") enqueueClaim("op-second", 72);
        return ok(entry.operationId);
      },
    };

    const result = await withDriver(driver, () => flushTaskOutbox());

    expect(sent).toEqual(["op-first", "op-second"]);
    expect(result).toEqual({ acknowledged: 2, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("picks up work enqueued by a LATER entry in the same pass, not just the first", async () => {
    enqueueClaim("op-a", 73);
    enqueueClaim("op-b", 74);
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        if (entry.operationId === "op-b") enqueueClaim("op-c", 75);
        return ok(entry.operationId);
      },
    };

    const result = await withDriver(driver, () => flushTaskOutbox());

    expect(sent).toEqual(["op-a", "op-b", "op-c"]);
    expect(result).toEqual({ acknowledged: 3, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("bounds self-renewing work to the two-pass cap and leaves the rest queued", async () => {
    enqueueClaim("op-cap-0", 81);
    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        // Every send queues one more command; three follow-ups are available,
        // so an unbounded pass loop would send four before the store drains.
        if (sent.length <= 3) enqueueClaim(`op-cap-${sent.length}`, 81 + sent.length);
        return ok(entry.operationId);
      },
    };

    const result = await withDriver(driver, () => flushTaskOutbox());

    expect(sent).toEqual(["op-cap-0", "op-cap-1"]);
    expect(result).toEqual({ acknowledged: 2, retryable: 0, permanent: 0 });
    const remaining = listTaskOutbox();
    expect(remaining.map((entry) => entry.operationId)).toEqual(["op-cap-2"]);
    expect(remaining[0]?.status).toBe("queued");
  });
});

describe("B5 — commands on one task row go out in creation order", () => {
  it("holds a later command on the same task behind an earlier one in backoff", async () => {
    enqueueUpdate("op-order-1", 7, "First");
    const first = vi.fn(async () => serverFault("op-order-1"));
    const second = vi.fn(async () => ok("op-order-2"));
    const driver = (): TaskOutboxDriver => ({
      onAcknowledged: ADOPT,
      send: async (entry) =>
        entry.operationId === "op-order-1" ? first() : second(),
    });

    await withDriver(driver(), () => flushTaskOutbox());
    expect(entryFor("op-order-1").status).toBe("retrying");
    expect(first).toHaveBeenCalledTimes(1);

    // The family's second edit of the SAME chore is queued while the first is
    // in a 2s backoff. Sending it now would let the server apply the OLD value
    // after the new one, while the app's own ledger showed the new one.
    enqueueUpdate("op-order-2", 7, "Second");
    const held = await withDriver(driver(), () => flushTaskOutbox());
    expect(held).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(second).not.toHaveBeenCalled();
    expect(entryFor("op-order-2").status).toBe("queued");

    // Once the first is due again, both go out oldest-first.
    first.mockImplementation(async () => ok("op-order-1"));
    expireBackoff("op-order-1");
    const landed = await withDriver(driver(), () => flushTaskOutbox());
    expect(landed).toEqual({ acknowledged: 2, retryable: 0, permanent: 0 });
    expect(second).toHaveBeenCalledTimes(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("never holds commands on DIFFERENT tasks behind each other", async () => {
    enqueueUpdate("op-other-1", 7, "First");
    enqueueUpdate("op-other-2", 8, "Unrelated");

    const send = vi.fn(async (entry: TaskOutboxEntry) =>
      entry.operationId === "op-other-1" ? serverFault(entry.operationId) : ok(entry.operationId),
    );

    const result = await withDriver({ onAcknowledged: ADOPT, send }, () => flushTaskOutbox());

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ acknowledged: 1, retryable: 1, permanent: 0 });
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

    const first = vi.fn(async () => serverFault("op-approve-all"));
    const second = vi.fn(async () => ok("op-followup"));
    const driver = (): TaskOutboxDriver => ({
      onAcknowledged: ADOPT,
      send: async (entry) =>
        entry.operationId === "op-approve-all" ? first() : second(),
    });

    await withDriver(driver(), () => flushTaskOutbox());
    expect(entryFor("op-approve-all").status).toBe("retrying");

    // Task 12 is one of the rows that approval is still holding.
    enqueueUpdate("op-followup", 12, "Renamed");
    const held = await withDriver(driver(), () => flushTaskOutbox());
    expect(held).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(second).not.toHaveBeenCalled();
    expect(entryFor("op-followup").status).toBe("queued");
  });
});

describe("B5b — a persisted reconciling entry re-sends instead of blocking its task forever", () => {
  it("re-sends a stale reconciling entry and the later same-task command it held", async () => {
    // Any mount/flush attaches the storage listener; attach it before the raw
    // write below so the module actually re-reads the "other tab's" array.
    await withDriver(
      { onAcknowledged: ADOPT, send: async (entry) => ok(entry.operationId) },
      () => flushTaskOutbox(),
    );

    enqueueUpdate("op-stale-1", 91, "First");
    enqueueUpdate("op-stale-2", 91, "Second");

    // A tab was killed mid-send: the first entry was persisted `reconciling`
    // and the in-memory in-flight set died with the tab. Sweep, cancel and
    // retry all refuse it, so only the flush can ever clear it.
    const persisted = listTaskOutbox().map((entry) =>
      entry.operationId === "op-stale-1" ? { ...entry, status: "reconciling" as const } : entry,
    );
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify(persisted));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: TASK_OUTBOX_STORAGE_KEY,
        storageArea: window.localStorage,
      }),
    );

    const sent: string[] = [];
    const driver: TaskOutboxDriver = {
      onAcknowledged: ADOPT,
      send: async (entry) => {
        sent.push(entry.operationId);
        return ok(entry.operationId);
      },
    };

    const result = await withDriver(driver, () => flushTaskOutbox());

    expect(sent).toEqual(["op-stale-1", "op-stale-2"]);
    expect(result).toEqual({ acknowledged: 2, retryable: 0, permanent: 0 });
    expect(listTaskOutbox()).toHaveLength(0);
  });
});

describe("B8 — a legacy index plus per-entry records survive a cold load", () => {
  it("rehydrates the per-entry records into the array and drops the legacy keys", () => {
    window.localStorage.setItem(TASK_OUTBOX_STORAGE_KEY, JSON.stringify({ ids: ["op-legacy"] }));
    window.localStorage.setItem(
      `${TASK_OUTBOX_STORAGE_KEY}:entry:op-legacy`,
      JSON.stringify({
        version: 1,
        operationId: "op-legacy",
        route: "/api/tasks/claim",
        action: "complete",
        payload: { taskId: 42, memberName: "Caspian" },
        createdAt: new Date().toISOString(),
        attemptCount: 0,
        status: "queued",
        displayTarget: { taskId: 42, kind: "claim" },
      }),
    );

    // A cold read: no enqueue, patch or migration has run first.
    const entries = listTaskOutbox();

    expect(entries.map((entry) => entry.operationId)).toEqual(["op-legacy"]);
    expect(window.localStorage.getItem(`${TASK_OUTBOX_STORAGE_KEY}:entry:op-legacy`)).toBeNull();
    const stored = JSON.parse(String(window.localStorage.getItem(TASK_OUTBOX_STORAGE_KEY)));
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.map((entry: { operationId: string }) => entry.operationId)).toEqual(["op-legacy"]);
  });
});

describe("B9 — a failed enqueue leaves no credential behind", () => {
  it("forgets the remembered credential when the route is unsupported", () => {
    rememberTaskCommandCredential("op-bogus", { pin: MEMBER_PIN });
    expect(listTaskCommandCredentialIds()).toEqual(["op-bogus"]);

    expect(() =>
      enqueueTaskOperation({
        operationId: "op-bogus",
        route: "/api/tasks/nope" as never,
        action: "claim",
        payload: { taskId: 1 },
        displayTarget: { taskId: 1, kind: "claim" },
      }),
    ).toThrow(/unsupported_task_operation/);

    // No entry exists, so nothing would ever evict or release this credential.
    expect(listTaskCommandCredentialIds()).toEqual([]);
    expect(listTaskOutbox()).toHaveLength(0);
  });

  it("forgets the remembered credential when the action is unsupported", () => {
    rememberTaskCommandCredential("op-bogus-action", { pin: MEMBER_PIN });

    expect(() =>
      enqueueTaskOperation({
        operationId: "op-bogus-action",
        route: "/api/tasks/claim",
        action: "teleport",
        payload: { taskId: 1 },
        displayTarget: { taskId: 1, kind: "claim" },
      }),
    ).toThrow(/unsupported_task_operation/);

    expect(listTaskCommandCredentialIds()).toEqual([]);
  });
});
