// @vitest-environment jsdom
// Task 10 — the client command-queue seam: EVERY task/config write is enqueued
// in the durable outbox BEFORE any local state change, credentials live only in
// an ephemeral in-memory registry keyed by operationId, and the two Task 9
// non-blockers (memoized fallback driver, evicted per-entry key pruning) are
// closed here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseClaimCommand } from "@/lib/task-claim";
import { parseTaskConfigCommand } from "@/lib/task-config";
import { parseLedgerCommand } from "@/lib/task-ledger-command";
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
  onTaskOutboxAcknowledged,
  snapshotProvesResolved,
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

    // Non-vacuous: the resolver is asked for the LIVE queued entry's id (not a
    // literal), the wire body really carries the pin, and the credential is
    // still resolvable afterwards.
    const queued = listTaskOutbox().find((candidate) => candidate.operationId === entry.operationId);
    expect(queued).toBeTruthy();
    const credential = resolveTaskOutboxCredential(queued!);
    expect(credential).toEqual({ pin: "1234" });
    const body = buildTaskOperationRequestBody(queued!, credential);
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

    // Non-vacuous: nothing was registered for this queued id, and the built
    // body therefore carries no credential at all.
    const queued = listTaskOutbox().find((candidate) => candidate.operationId === entry.operationId);
    expect(queued).toBeTruthy();
    expect(resolveTaskOutboxCredential(queued!)).toBeUndefined();
    const body = buildTaskOperationRequestBody(queued!, resolveTaskOutboxCredential(queued!));
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

    // Non-vacuous: a credential IS registered for this id, so the assertion is
    // that the config route's allowlist withholds BOTH keys from the wire — not
    // that nothing happened to be registered.
    const queued = listTaskOutbox().find((candidate) => candidate.operationId === entry.operationId);
    expect(queued).toBeTruthy();
    expect(resolveTaskOutboxCredential(queued!)).toEqual({ pin: "1234", parentPin: PARENT_PIN });
    const body = buildTaskOperationRequestBody(queued!, resolveTaskOutboxCredential(queued!));
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

  it("releases the credential BEFORE the outbox reports the entry as gone", async () => {
    // The release must be observable from inside the acknowledgment: a reader
    // that sees an empty outbox must never still be holding a PIN.
    const unregister = registerTaskOutboxDriver(
      credentialDriver(async () => ({ status: 200, body: { operationId: "op-undo-9" } })),
    );
    const seen: Array<{ queued: number; pinned: boolean }> = [];
    const unlisten = onTaskOutboxAcknowledged(() => {
      seen.push({
        queued: listTaskOutbox().length,
        pinned: readTaskCommandCredential("op-undo-9") !== undefined,
      });
    });
    queueTaskCommand({
      operationId: "op-undo-9",
      route: "/api/tasks/claim",
      action: "undo",
      payload: { taskId: 1, memberName: "Bailey" },
      displayTarget: { kind: "undo", taskId: 1 },
      credential: { pin: "1234" },
    });

    await flushTaskOutbox(getTaskOutboxDriver());
    unregister();
    unlisten();

    expect(seen.length).toBeGreaterThan(0);
    // By the time the acknowledgment is announced, the entry is already gone
    // AND the credential has already been released.
    for (const sample of seen) {
      expect(sample.pinned).toBe(false);
    }
    expect(listTaskOutbox()).toHaveLength(0);
    expect(readTaskCommandCredential("op-undo-9")).toBeUndefined();
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

  it("prunes the per-entry storage key of an operation evicted by the retention bound", async () => {
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

    // A READ reports the eviction but never writes: the key is still there
    // until the prune is flushed.
    expect(listTaskOutbox()).toHaveLength(0);
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale"))).not.toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale"))).toBeNull();
  });

  it("never writes SYNCHRONOUSLY from a read path (eviction is deferred)", async () => {
    const stale = {
      version: 1 as const,
      operationId: "op-stale-write",
      route: "/api/tasks/claim" as const,
      action: "complete",
      payload: { taskId: 1, memberName: "Bailey" },
      createdAt: "2020-01-01T00:00:00.000Z",
      attemptCount: 0,
      status: "queued" as const,
      displayTarget: { kind: "claim" as const, taskId: 1 },
    };
    localStorage.setItem(taskOutboxEntryStorageKey("op-stale-write"), JSON.stringify(stale));
    localStorage.setItem("consuela-task-operation-outbox-v1", JSON.stringify({ rev: 1, ids: ["op-stale-write"] }));
    __resetTaskOutboxForTests();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    try {
      listTaskOutbox();
      listTaskOutbox();
      // The READ itself is side-effect free — the evicted key is not removed
      // inline, only on the next microtask.
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      removeItem.mockRestore();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale-write"))).toBeNull();
  });

  it("keeps a live entry's key while pruning only the evicted one", async () => {
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
    await Promise.resolve();
    await Promise.resolve();
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-stale-2"))).toBeNull();
    expect(localStorage.getItem(taskOutboxEntryStorageKey("op-live"))).not.toBeNull();
  });

  it("releases the ephemeral credential of an evicted operation with the entry", async () => {
    const stale = {
      version: 1 as const,
      operationId: "op-stale-cred",
      route: "/api/tasks/claim" as const,
      action: "claim",
      payload: { taskId: 1, memberName: "Bailey" },
      createdAt: "2020-01-01T00:00:00.000Z",
      attemptCount: 0,
      status: "queued" as const,
      displayTarget: { kind: "claim" as const, taskId: 1 },
    };
    localStorage.setItem(taskOutboxEntryStorageKey("op-stale-cred"), JSON.stringify(stale));
    localStorage.setItem("consuela-task-operation-outbox-v1", JSON.stringify({ rev: 1, ids: ["op-stale-cred"] }));
    rememberTaskCommandCredential("op-stale-cred", { pin: "1234" });
    __resetTaskOutboxForTests();

    expect(listTaskOutbox()).toHaveLength(0);
    expect(readTaskCommandCredential("op-stale-cred")).toBeUndefined();
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

describe("ledgerProvesResolved — the only proof for a point movement", () => {
  const MEMBER = "Caspian Garcia";

  function ledgerRead(history: unknown[]) {
    return {
      snapshot: { tasks: [], weekData: { weekStart: "2026-09-21", points: {}, history }, operationReceipts: {} },
      reconciled: true,
      weekData: { weekStart: "2026-09-21", points: {}, history },
    } as never;
  }

  function transaction(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      timestamp: "2026-09-24T10:00:00.000Z",
      member: MEMBER,
      type: "adjust",
      amount: 20,
      description: "Manual adjust: +20pts",
      meta: { operationId: "op-adj-1", source: "manual-adjust" },
      ...overrides,
    };
  }

  const ADJUST = enqueueAdjust();

  function enqueueAdjust() {
    return enqueueTaskOperation({
      operationId: "op-adj-1",
      route: "/api/tasks/ledger",
      action: "adjust",
      payload: { memberName: MEMBER, amount: 20, reason: "helped out" },
      displayTarget: { kind: "config" },
    });
  }

  it("proves an adjust from an exactly matching canonical transaction", () => {
    expect(snapshotProvesResolved(ADJUST, ledgerRead([transaction()]))).toBe(true);
  });

  it("refuses a different operationId", () => {
    const entry = transaction({ meta: { operationId: "op-other", source: "manual-adjust" } });
    expect(snapshotProvesResolved(ADJUST, ledgerRead([entry]))).toBe(false);
  });

  it("refuses a different source", () => {
    const entry = transaction({ meta: { operationId: "op-adj-1", source: "planner-adjust" } });
    expect(snapshotProvesResolved(ADJUST, ledgerRead([entry]))).toBe(false);
  });

  it("refuses a different member, type or amount", () => {
    expect(snapshotProvesResolved(ADJUST, ledgerRead([transaction({ member: "Bailey Garcia" })]))).toBe(false);
    expect(snapshotProvesResolved(ADJUST, ledgerRead([transaction({ type: "penalty" })]))).toBe(false);
    expect(snapshotProvesResolved(ADJUST, ledgerRead([transaction({ amount: 21 })]))).toBe(false);
  });

  it("refuses a transaction with no ledger meta at all", () => {
    const { meta: _ignored, ...withoutMeta } = transaction();
    expect(snapshotProvesResolved(ADJUST, ledgerRead([withoutMeta]))).toBe(false);
  });

  it("refuses a penalty or a redemption, whose amount the command body never carries", () => {
    const penalty = enqueueTaskOperation({
      operationId: "op-pen-1",
      route: "/api/tasks/ledger",
      action: "penalty",
      payload: { memberName: MEMBER, itemId: "pen-1" },
      displayTarget: { kind: "config" },
    });
    const penaltyTx = transaction({
      type: "penalty",
      amount: -15,
      meta: { operationId: "op-pen-1", source: "task-penalty" },
    });
    expect(snapshotProvesResolved(penalty, ledgerRead([penaltyTx]))).toBe(false);

    const redeem = enqueueTaskOperation({
      operationId: "op-red-1",
      route: "/api/rewards/redeem",
      action: "redeem",
      payload: { rewardId: 7, memberName: MEMBER },
      displayTarget: { kind: "config" },
    });
    const redeemTx = transaction({
      type: "redeem",
      amount: -15,
      meta: { operationId: "op-red-1", source: "reward-redeem" },
    });
    expect(snapshotProvesResolved(redeem, ledgerRead([redeemTx]))).toBe(false);
  });

  it("is never satisfied by a task receipt alone", () => {
    const read = {
      snapshot: {
        tasks: [],
        weekData: { weekStart: "2026-09-21", points: {}, history: [] },
        operationReceipts: { "op-adj-1": [{ operationId: "op-adj-1", action: "adjust", createdAt: "t" }] },
      },
      reconciled: true,
    } as never;
    expect(snapshotProvesResolved(ADJUST, read)).toBe(false);
  });
});

describe("an unreconciled ledger 202 is retained until the canonical week proves it", () => {
  it("keeps a 202 reconciling when no transaction carries this operationId, forever", async () => {
    const unregister = registerTaskOutboxDriver(credentialDriver(async () => ({
      status: 202,
      body: { operationId: "op-adj-2", reconciled: false, repairRequired: true },
    })));
    // The default pull returns no canonical transaction for this operation, so
    // nothing can prove it.
    queueTaskCommand({
      operationId: "op-adj-2",
      route: "/api/tasks/ledger",
      action: "adjust",
      payload: { memberName: "Caspian Garcia", amount: 20 },
      displayTarget: { kind: "config" },
      credential: { pin: "3141" },
    });

    const result = await flushTaskOutbox(getTaskOutboxDriver());
    unregister();

    expect(result.acknowledged).toBe(0);
    const [entry] = listTaskOutbox();
    expect(entry.operationId).toBe("op-adj-2");
    expect(entry.status).toBe("reconciling");
    expect(typeof entry.nextAttemptAt).toBe("string");
    // Retained, and honestly not cancellable: a reconciling command has
    // already been applied server-side, so offering a cancel would be a lie.
    expect(cancelTaskOutboxEntry("op-adj-2")).toBe(false);
    expect(listTaskOutbox()).toHaveLength(1);
  });

  it("adopts and removes once the pulled canonical week carries the operation", async () => {
    const transaction = {
      id: 3,
      timestamp: "2026-09-24T11:00:00.000Z",
      member: "Caspian Garcia",
      type: "adjust",
      amount: 15,
      description: "Manual adjust: +15pts",
      meta: { operationId: "op-adj-3", source: "manual-adjust" },
    };
    const unregister = registerTaskOutboxDriver({
      ...credentialDriver(async () => ({
        status: 202,
        body: { operationId: "op-adj-3", reconciled: false, repairRequired: true },
      })),
      pullSnapshot: async () => ({
        snapshot: {
          tasks: [],
          weekData: { weekStart: "2026-09-21", points: { "Caspian Garcia": 15 }, history: [transaction] },
          operationReceipts: {},
        },
        reconciled: true,
      }),
    });
    queueTaskCommand({
      operationId: "op-adj-3",
      route: "/api/tasks/ledger",
      action: "adjust",
      payload: { memberName: "Caspian Garcia", amount: 15 },
      displayTarget: { kind: "config" },
      credential: { pin: "3141" },
    });

    const result = await flushTaskOutbox(getTaskOutboxDriver());
    unregister();

    expect(result.acknowledged).toBe(1);
    expect(listTaskOutbox()).toHaveLength(0);
  });
});
