import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// B1b — the claim queueable-reason promotion. A claim that fails POST-AUTH on
// a ledger/snapshot outage is replayable through the internal claim seam, so
// `ledger_unavailable` and `snapshot_write_failed` must hold the family's tap
// in the server queue instead of losing it with the browser. The stored row
// carries the VERIFIED actor identity and never a PIN — the same shape the
// approve route already writes.
//
// The guard that makes the promotion safe (`sentBackAt` vs the queue row's
// `created`) lives in the drain and is proven in
// task-claim-queue-supersede-guard.test.ts.

const mocks = vi.hoisted(() => ({
  getLiveMemberById: vi.fn(),
  verifyPinFromPB: vi.fn(),
  executeInternalTaskCommand: vi.fn(),
  enqueueTaskCommandRow: vi.fn(),
}));

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
}));
vi.mock("@/lib/server-auth", () => ({
  verifyPinFromPB: mocks.verifyPinFromPB,
}));
vi.mock("@/lib/task-commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeInternalTaskCommand: mocks.executeInternalTaskCommand,
}));
vi.mock("@/lib/task-command-queue-server", () => ({
  enqueueTaskCommandRow: mocks.enqueueTaskCommandRow,
}));
vi.mock("@/lib/task-claim", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureTaskClaimHandlersRegistered: () => {} };
});

import { POST } from "@/app/api/tasks/claim/route";

const PIN = "0202";

function request(body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  const req = new NextRequest("http://localhost/api/tasks/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  (req as any).text = vi.fn(async () => text);
  return req;
}

function failing(reason: string) {
  mocks.executeInternalTaskCommand.mockResolvedValue({
    ok: false,
    operationId: "op-claim-1",
    reason,
    reconciled: false,
  });
}

beforeEach(() => {
  mocks.getLiveMemberById.mockReset().mockResolvedValue({
    id: "parent-rebecca",
    name: "Rebecca Garcia",
    role: "parent",
  });
  mocks.verifyPinFromPB.mockReset().mockResolvedValue({ id: "parent-rebecca" });
  mocks.executeInternalTaskCommand.mockReset();
  mocks.enqueueTaskCommandRow.mockReset().mockResolvedValue(true);
});

describe("claim queueable reasons — a verified tap survives a ledger/snapshot outage", () => {
  for (const reason of ["ledger_unavailable", "snapshot_write_failed"]) {
    it(`queues ${reason} as 202 {queued:true} with the verified actor and no PIN`, async () => {
      failing(reason);

      const res = await POST(
        request({ operationId: "op-claim-1", action: "complete", taskId: 101, memberName: "Rebecca Garcia", pin: PIN }),
      );

      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ queued: true, reason, retryable: true });
      expect(mocks.enqueueTaskCommandRow).toHaveBeenCalledTimes(1);
      const row = mocks.enqueueTaskCommandRow.mock.calls[0][0];
      expect(row).toMatchObject({
        operationId: "op-claim-1",
        route: "/api/tasks/claim",
        action: "complete",
        actor: {
          memberId: "parent-rebecca",
          name: "Rebecca Garcia",
          role: "parent",
          authentication: "pin",
        },
      });
      // The raw PIN never reaches the durable row — identity, not credential.
      expect(row.actor).not.toHaveProperty("pin");
      expect(row.payload).not.toHaveProperty("pin");
      expect(JSON.stringify(row)).not.toContain(PIN);
    });
  }

  it("keeps member_roster_unavailable queueable", async () => {
    failing("member_roster_unavailable");

    const res = await POST(
      request({ operationId: "op-claim-2", action: "complete", taskId: 101, memberName: "Rebecca Garcia", pin: PIN }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true, reason: "member_roster_unavailable" });
    expect(mocks.enqueueTaskCommandRow).toHaveBeenCalledTimes(1);
  });

  it("never queues a PRE-auth refusal: not_allowed stays a 403 refusal", async () => {
    failing("not_allowed");

    const res = await POST(
      request({ operationId: "op-claim-3", action: "complete", taskId: 101, memberName: "Rebecca Garcia", pin: PIN }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, reason: "not_allowed" });
    expect(mocks.enqueueTaskCommandRow).not.toHaveBeenCalled();
  });

  it("never queues unknown_actor: the identity was not verified", async () => {
    failing("unknown_actor");

    const res = await POST(
      request({ operationId: "op-claim-4", action: "complete", taskId: 101, memberName: "Rebecca Garcia", pin: PIN }),
    );

    expect(res.status).toBe(403);
    expect(mocks.enqueueTaskCommandRow).not.toHaveBeenCalled();
  });
});
