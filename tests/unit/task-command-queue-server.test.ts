// Task 4 — the server-side task command queue. Pins enqueue idempotency, the
// sweep retention windows, drain replay order + due-filtering, list mapping,
// and cancel authorization. The fake PB records every create/update/delete so
// assertions pin exactly what was written.
//
// One deliberate fidelity point: the fake honors the `filter` argument the
// module passes, the way PocketBase does. Without it, drain's post-sweep
// `status = "pending"` re-read would replay a row the sweep just parked to
// `failed` — behavior the real server never exhibits.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withAdmin: vi.fn() }));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

// The drain replay path delegates to the SAME service seam the intake route
// used. Mocking the seam (and the claim-handler registration side effect)
// keeps this a unit test of the queue state machine; the wired end-to-end
// replay is covered by the Task 13 smoke test.
const taskCommandMocks = vi.hoisted(() => ({
  executeInternalTaskCommand: vi.fn(),
}));

// Partial mock: `task-manage`/`task-claim`/`task-approval` register their real
// handlers as an import side effect, so `registerInternalTaskCommandHandler`
// must stay live; only the dispatch entry point is stubbed.
vi.mock(import("@/lib/task-commands"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeInternalTaskCommand: taskCommandMocks.executeInternalTaskCommand,
  };
});

vi.mock("@/lib/task-claim", () => ({
  ensureTaskClaimHandlersRegistered: vi.fn(),
}));

import {
  TASK_COMMAND_QUEUE_COLLECTION,
  TASK_QUEUE_EXPIRY_MS,
  TASK_QUEUE_FAILED_RETENTION_MS,
  TASK_QUEUE_TERMINAL_RETENTION_MS,
  cancelTaskCommandQueueRow,
  drainDueTaskCommandQueue,
  enqueueTaskCommandRow,
  listTaskCommandQueueState,
  sweepTaskCommandQueueRows,
} from "@/lib/task-command-queue-server";

/** The only filters this suite exercises are single equality clauses
 *  (`status = "pending"`, `operationId = "…"`). */
function parseQueueRowFilter(filter: string): { field: string; value: string } | null {
  const match = /^\s*([A-Za-z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(filter);
  if (!match) return null;
  return { field: match[1], value: match[2].replace(/\\(.)/g, "$1") };
}

function makePb(rows: Record<string, any>[] = []) {
  const state = {
    rows: [...rows],
    created: [] as any[],
    updated: [] as any[],
    deleted: [] as string[],
    collections: [] as string[],
  };
  const pb = {
    collection: (name: string) => {
      state.collections.push(name);
      return {
        getFullList: async (options?: { filter?: string }) => {
          const filter = parseQueueRowFilter(options?.filter ?? "");
          if (!filter) return state.rows;
          return state.rows.filter((row) => String(row[filter.field] ?? "") === filter.value);
        },
        create: async (data: any) => {
          state.created.push(data);
          const row = { id: `row-${state.created.length}`, created: new Date().toISOString(), ...data };
          state.rows.push(row);
          return row;
        },
        update: async (id: string, data: any) => {
          state.updated.push({ id, data });
          const row = state.rows.find((r) => r.id === id);
          if (row) Object.assign(row, data);
          return row;
        },
        delete: async (id: string) => {
          state.deleted.push(id);
        },
      };
    },
  };
  return { state, pb };
}

const actor = { memberId: "member-kid", name: "Caspian Garcia", role: "child", authentication: "pin" as const };

beforeEach(() => {
  mocks.withAdmin.mockReset();
});

describe("enqueueTaskCommandRow", () => {
  it("writes a pending row with the verified actor and never a credential", async () => {
    const { state, pb } = makePb();
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const ok = await enqueueTaskCommandRow({
      operationId: "op-queue-1",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 42, memberName: actor.name },
      actor,
      displayTarget: { kind: "claim", taskId: 42 },
    });

    expect(ok).toBe(true);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      operationId: "op-queue-1",
      status: "pending",
      actorMemberId: "member-kid",
      actorAuthentication: "pin",
    });
    // A credential would be a `pin`/`parentPin`/`password`/`token` KEY. The
    // required `actorAuthentication` VALUE "pin" is the verified-actor record,
    // not a credential, so the guard keys on the quoted key form.
    expect(JSON.stringify(state.created[0])).not.toMatch(/"(pin|parentPin|password|token)":/);
    // Both the dedupe read and the write target the queue collection.
    expect(state.collections).toEqual([
      TASK_COMMAND_QUEUE_COLLECTION,
      TASK_COMMAND_QUEUE_COLLECTION,
    ]);
  });

  it("is idempotent on the operation id (a re-queue preserves the existing row)", async () => {
    const { state, pb } = makePb([{ id: "row-existing", operationId: "op-queue-1", status: "pending" }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const ok = await enqueueTaskCommandRow({
      operationId: "op-queue-1",
      route: "/api/tasks/claim",
      action: "complete",
      payload: { taskId: 42 },
      actor,
    });

    expect(ok).toBe(true);
    expect(state.created).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });

  it("refuses a blank operation id without touching PB", async () => {
    const ok = await enqueueTaskCommandRow({
      operationId: "  ",
      route: "/api/tasks/claim",
      action: "complete",
      payload: {},
      actor,
    });
    expect(ok).toBe(false);
    expect(mocks.withAdmin).not.toHaveBeenCalled();
  });
});

describe("sweepTaskCommandQueueRows", () => {
  it("parks a pending row older than 24h to failed", async () => {
    const old = new Date(Date.now() - TASK_QUEUE_EXPIRY_MS - 1000).toISOString();
    const { state, pb } = makePb([{ id: "row-old", status: "pending", created: old }]);
    await sweepTaskCommandQueueRows(pb as never);
    expect(state.updated[0]).toMatchObject({ id: "row-old", data: { status: "failed", lastErrorReason: "queue_expired" } });
  });

  it("deletes a terminal marker past its retention window", async () => {
    const old = new Date(Date.now() - TASK_QUEUE_TERMINAL_RETENTION_MS - 1000).toISOString();
    const { state, pb } = makePb([{ id: "row-done", status: "resolved", created: old }]);
    await sweepTaskCommandQueueRows(pb as never);
    expect(state.deleted).toContain("row-done");
  });

  it("deletes a failed row past the 7-day retention window (not parked to another update)", async () => {
    const old = new Date(Date.now() - TASK_QUEUE_FAILED_RETENTION_MS - 1000).toISOString();
    const { state, pb } = makePb([{ id: "row-failed-old", status: "failed", created: old }]);
    await sweepTaskCommandQueueRows(pb as never);
    expect(state.deleted).toContain("row-failed-old");
    expect(state.updated).toHaveLength(0);
  });

  it("leaves a fresh pending row untouched", async () => {
    const { state, pb } = makePb([{ id: "row-fresh", status: "pending", created: new Date().toISOString() }]);
    await sweepTaskCommandQueueRows(pb as never);
    expect(state.updated).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
  });
});

describe("cancelTaskCommandQueueRow", () => {
  it("lets the original actor cancel their own pending row", async () => {
    const { state, pb } = makePb([{ id: "row-1", operationId: "op-1", status: "pending", actorMemberId: "member-kid" }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const result = await cancelTaskCommandQueueRow("op-1", "member-kid", false);
    expect(result).toEqual({ ok: true });
    expect(state.updated[0].data).toMatchObject({ status: "cancelled" });
  });

  it("refuses a non-actor child", async () => {
    const { state, pb } = makePb([{ id: "row-1", operationId: "op-1", status: "pending", actorMemberId: "member-kid" }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const result = await cancelTaskCommandQueueRow("op-1", "member-other", false);
    expect(result).toEqual({ ok: false, status: 403, reason: "not_allowed" });
    expect(state.updated).toHaveLength(0);
  });

  it("lets a parent cancel anyone's row and treats an unknown id as 404", async () => {
    const { state, pb } = makePb([{ id: "row-1", operationId: "op-1", status: "pending", actorMemberId: "member-kid" }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    expect(await cancelTaskCommandQueueRow("op-1", "member-parent", true)).toEqual({ ok: true });
    expect(await cancelTaskCommandQueueRow("op-missing", "member-parent", true)).toEqual({
      ok: false,
      status: 404,
      reason: "unknown_operation",
    });
    expect(state.updated).toHaveLength(1);
  });

  it("is a no-op success on an already-terminal row", async () => {
    const { state, pb } = makePb([{ id: "row-1", operationId: "op-1", status: "resolved", actorMemberId: "member-kid" }]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    expect(await cancelTaskCommandQueueRow("op-1", "member-kid", false)).toEqual({ ok: true });
    expect(state.updated).toHaveLength(0);
  });
});

describe("listTaskCommandQueueState", () => {
  it("keeps pending/failed rows and drops terminal rows past retention", async () => {
    const old = new Date(Date.now() - TASK_QUEUE_TERMINAL_RETENTION_MS - 1000).toISOString();
    const { pb } = makePb([
      { id: "a", operationId: "op-a", route: "/api/tasks/claim", action: "complete", status: "pending", created: new Date().toISOString() },
      { id: "b", operationId: "op-b", route: "/api/tasks/manage", action: "delete", status: "resolved", created: old },
    ]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));
    const rows = await listTaskCommandQueueState();
    expect(rows.map((r) => r.operationId)).toEqual(["op-a"]);
  });

  it("returns an empty list when PB throws (an outage is not an empty queue)", async () => {
    mocks.withAdmin.mockImplementation((fn: any) =>
      fn({
        collection: () => ({
          getFullList: async () => {
            throw new Error("pb_down");
          },
        }),
      }),
    );
    expect(await listTaskCommandQueueState()).toEqual([]);
  });
});

describe("drainDueTaskCommandQueue", () => {
  const dueRow = () => ({
    id: "row-drain",
    operationId: "op-drain-1",
    route: "/api/tasks/claim",
    action: "complete",
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    created: new Date().toISOString(),
    payload: { taskId: 42 },
    actorMemberId: "member-kid",
    actorName: "Caspian Garcia",
    actorRole: "child",
    actorAuthentication: "pin",
  });

  beforeEach(() => {
    taskCommandMocks.executeInternalTaskCommand.mockReset();
    taskCommandMocks.executeInternalTaskCommand.mockResolvedValue({
      ok: true,
      operationId: "op-drain-1",
      weekData: null,
    });
  });

  it("replays a due pending row through the service seam and records the resolved marker", async () => {
    const { state, pb } = makePb([dueRow()]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const summary = await drainDueTaskCommandQueue();

    expect(summary).toEqual({ acknowledged: 1, retryable: 0, permanent: 0 });
    expect(taskCommandMocks.executeInternalTaskCommand).toHaveBeenCalledTimes(1);
    expect(taskCommandMocks.executeInternalTaskCommand).toHaveBeenCalledWith(
      {
        operationId: "op-drain-1",
        kind: "complete",
        actor: {
          memberId: "member-kid",
          name: "Caspian Garcia",
          role: "child",
          authentication: "pin",
        },
        payload: { taskId: 42 },
      },
      { source: "server" },
    );
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({
      id: "row-drain",
      data: {
        status: "resolved",
        nextAttemptAt: null,
        result: { operationId: "op-drain-1", weekData: null },
      },
    });
    expect(typeof state.updated[0].data.resolvedAt).toBe("string");
  });

  it("sweeps first: an expired pending row is parked to failed and never replayed", async () => {
    const expired = {
      ...dueRow(),
      id: "row-expired",
      operationId: "op-expired",
      nextAttemptAt: null,
      created: new Date(Date.now() - TASK_QUEUE_EXPIRY_MS - 1_000).toISOString(),
    };
    const { state, pb } = makePb([expired]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const summary = await drainDueTaskCommandQueue();

    expect(summary).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(taskCommandMocks.executeInternalTaskCommand).not.toHaveBeenCalled();
    expect(state.updated).toEqual([
      {
        id: "row-expired",
        data: {
          status: "failed",
          lastErrorReason: "queue_expired",
          lastErrorMessage:
            "The family server could not take this chore for over a day — tap the chore again.",
          nextAttemptAt: null,
        },
      },
    ]);
  });

  it("leaves a pending row whose nextAttemptAt is still in the future untouched", async () => {
    const waiting = {
      ...dueRow(),
      id: "row-waiting",
      operationId: "op-waiting",
      nextAttemptAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const { state, pb } = makePb([waiting]);
    mocks.withAdmin.mockImplementation((fn: any) => fn(pb));

    const summary = await drainDueTaskCommandQueue();

    expect(summary).toEqual({ acknowledged: 0, retryable: 0, permanent: 0 });
    expect(taskCommandMocks.executeInternalTaskCommand).not.toHaveBeenCalled();
    expect(state.updated).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
  });
});
