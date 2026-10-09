import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireLiveSession: vi.fn(),
  listTaskCommandQueueState: vi.fn(),
  cancelTaskCommandQueueRow: vi.fn(),
  drainDueTaskCommandQueue: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ requireLiveSession: mocks.requireLiveSession }));
vi.mock("@/lib/task-command-queue-server", () => ({
  listTaskCommandQueueState: mocks.listTaskCommandQueueState,
  cancelTaskCommandQueueRow: mocks.cancelTaskCommandQueueRow,
  drainDueTaskCommandQueue: mocks.drainDueTaskCommandQueue,
}));

import { DELETE, GET } from "@/app/api/tasks/queue/route";

function get() {
  return GET(new NextRequest("http://localhost/api/tasks/queue"));
}
function del(body: unknown) {
  return DELETE(
    new NextRequest("http://localhost/api/tasks/queue", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.requireLiveSession.mockReset();
  mocks.listTaskCommandQueueState.mockReset();
  mocks.cancelTaskCommandQueueRow.mockReset();
  mocks.drainDueTaskCommandQueue.mockReset().mockResolvedValue({ acknowledged: 0, retryable: 0, permanent: 0 });
});

describe("GET /api/tasks/queue", () => {
  it("refuses an unauthenticated caller with the session status", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: false, error: "unauthorized", status: 401 });
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, rows: [] });
    expect(mocks.drainDueTaskCommandQueue).not.toHaveBeenCalled();
  });

  it("drains due rows BEFORE listing them — the status read is a drain trigger", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    mocks.listTaskCommandQueueState.mockResolvedValue([]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(mocks.drainDueTaskCommandQueue).toHaveBeenCalledTimes(1);
    expect(mocks.drainDueTaskCommandQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listTaskCommandQueueState.mock.invocationCallOrder[0],
    );
  });

  it("a failing drain never breaks the status read", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    mocks.drainDueTaskCommandQueue.mockRejectedValue(new Error("pb_down"));
    mocks.listTaskCommandQueueState.mockResolvedValue([]);
    const res = await get();
    expect(res.status).toBe(200);
  });

  it("returns the queue rows for a live session", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    mocks.listTaskCommandQueueState.mockResolvedValue([{ operationId: "op-1", status: "pending" }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rows: [{ operationId: "op-1" }] });
  });

  it("answers 503, never an empty 200, when the queue store is down", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    mocks.listTaskCommandQueueState.mockRejectedValue(new Error("pb_down"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "queue_unavailable" });
  });
});

describe("GET /api/tasks/queue — real queue server", () => {
  it("answers 503 when the real queue read fails, so an outage is never an empty 200", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    const throwingPb = {
      collection: () => ({
        getFullList: async () => {
          throw new Error("pb_down");
        },
      }),
    };
    vi.doMock("@/lib/pb-auth", () => ({
      withAdmin: (fn: (pb: unknown) => Promise<unknown>) => fn(throwingPb),
    }));
    vi.doUnmock("@/lib/task-command-queue-server");
    vi.resetModules();
    const { GET: realGet } = await import("@/app/api/tasks/queue/route");
    const res = await realGet(new NextRequest("http://localhost/api/tasks/queue"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "queue_unavailable", rows: [] });
    vi.doUnmock("@/lib/pb-auth");
  });
});

describe("DELETE /api/tasks/queue", () => {
  it("rejects a malformed body", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "child" } });
    const res = await del({ nope: true });
    expect(res.status).toBe(400);
  });

  it("maps a cancel refusal to its status", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "child" } });
    mocks.cancelTaskCommandQueueRow.mockResolvedValue({ ok: false, status: 403, reason: "not_allowed" });
    const res = await del({ operationId: "op-1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_allowed" });
  });

  it("cancels with the live identity and answers ok", async () => {
    mocks.requireLiveSession.mockResolvedValue({ ok: true, identity: { memberId: "m1", role: "parent" } });
    mocks.cancelTaskCommandQueueRow.mockResolvedValue({ ok: true });
    const res = await del({ operationId: "op-1" });
    expect(res.status).toBe(200);
    expect(mocks.cancelTaskCommandQueueRow).toHaveBeenCalledWith("op-1", "m1", true);
  });
});
