// @vitest-environment jsdom
// B1a critic BLOCKER 1 — a parked `auth-required` command must not hold later
// same-task commands.
//
// An auth-required entry is PARKED awaiting a user credential: it is not in
// flight, never due, and (before this fix) never released the ordering hold —
// so an approve parked for task 102 held an approve-all [102,105] forever and
// the approve-all never POSTed (the harness b4 repro). The hold now exempts it
// exactly like a terminal `failed` entry. The parked command's own replay
// protection (operationId receipts + semantic-duplicate suppression) is what
// keeps a later retry from double-paying after the newer command lands; that
// half is proven against the real route in task-approve-route.test.ts.
import { describe, it, expect, beforeEach } from "vitest";

import {
  __resetTaskCommandCredentialsForTests,
  __resetTaskOutboxForTests,
  enqueueTaskOperation,
  flushTaskOutbox,
  listTaskOutbox,
  registerTaskOutboxDriver,
  type TaskOutboxEntry,
} from "@/lib/task-command-store";

function enqueueApprove(operationId: string, taskId: number): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/tasks/approve",
    action: "approve",
    payload: { taskId, memberName: "Rebecca (Mom)" },
    displayTarget: { kind: "approval", taskId, title: "Quest" },
  });
}

function enqueueApproveAll(operationId: string, taskIds: number[]): TaskOutboxEntry {
  return enqueueTaskOperation({
    operationId,
    route: "/api/tasks/approve",
    action: "approve-all",
    payload: { taskIds, memberName: "Rebecca (Mom)" },
    displayTarget: { kind: "approval", title: `${taskIds.length} tapped tasks` },
  });
}

async function flushWith(send: (operationId: string) => Promise<{ status: number; body: any }>) {
  const sent: string[] = [];
  const restore = registerTaskOutboxDriver({
    send: async (entry) => {
      sent.push(entry.operationId);
      return send(entry.operationId);
    },
    onAcknowledged: async () => {},
  });
  try {
    await flushTaskOutbox();
  } finally {
    restore();
  }
  return sent;
}

beforeEach(() => {
  localStorage.clear();
  __resetTaskOutboxForTests();
  __resetTaskCommandCredentialsForTests();
});

describe("a parked auth-required command does not hold later same-task commands", () => {
  it("lets an approve-all proceed past an auth-required approve for the same task", async () => {
    // Park op-a: the credential-less approve is refused 400 invalid_body by the
    // route parser (the reload case) → auth-required, not in flight.
    enqueueApprove("op-parked", 102);
    await flushWith(async () => ({
      status: 400,
      body: { operationId: "op-parked", success: false, reason: "invalid_body", code: "invalid_body" },
    }));
    expect(listTaskOutbox().find((entry) => entry.operationId === "op-parked")?.status).toBe("auth-required");

    // A later command on the SAME task (and another) must still send.
    enqueueApproveAll("op-approve-all", [102, 105]);
    const sent = await flushWith(async (operationId) => ({
      status: operationId === "op-approve-all" ? 200 : 400,
      body:
        operationId === "op-approve-all"
          ? {
              success: true,
              reconciled: true,
              weekData: { weekStart: "2026-10-05", points: {}, streak: {}, lastActive: {}, history: [] },
            }
          : { success: false, reason: "invalid_body", code: "invalid_body" },
    }));

    expect(sent).toContain("op-approve-all");
    // The parked entry stays parked and visible (banner count + Cancel).
    expect(listTaskOutbox().find((entry) => entry.operationId === "op-parked")?.status).toBe("auth-required");
    // The newer command left; the parked one remains for a re-prompt.
    expect(listTaskOutbox().map((entry) => entry.operationId)).toEqual(["op-parked"]);
  });

  it("a parked entry retried with a fresh credential is sent (and no longer blocks anything)", async () => {
    enqueueApprove("op-parked", 102);
    await flushWith(async () => ({
      status: 400,
      body: { operationId: "op-parked", success: false, reason: "invalid_body", code: "invalid_body" },
    }));

    const { rememberTaskCommandCredential, retryTaskCommand } = await import("@/lib/task-command-store");
    const sent: string[] = [];
    const restore = registerTaskOutboxDriver({
      send: async (entry) => {
        sent.push(entry.operationId);
        return {
          status: 200,
          body: {
            operationId: entry.operationId,
            success: true,
            reconciled: true,
            weekData: { weekStart: "2026-10-05", points: {}, streak: {}, lastActive: {}, history: [] },
          },
        };
      },
      onAcknowledged: async () => {},
    });
    try {
      rememberTaskCommandCredential("op-parked", { pin: "0202" });
      retryTaskCommand("op-parked");
      await flushTaskOutbox();
      // `retryTaskCommand` sends asynchronously; let the ack land.
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      restore();
    }

    expect(sent).toContain("op-parked");
    expect(listTaskOutbox()).toHaveLength(0);
  });
});
