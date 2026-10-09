import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// B1c — D11: one parent-role predicate for all four gates. The roster writer
// pins the lowercase vocabulary, but a reader that compares raw is one roster
// edit (or one imported fixture) away from refusing a parent. `isParentRole`
// folds and trims; a child is still refused.
const mocks = vi.hoisted(() => ({
  getLiveMemberById: vi.fn(),
  verifyPinFromPB: vi.fn(),
  executeInternalTaskCommand: vi.fn(),
  executeLedgerCommand: vi.fn(),
}));

vi.mock("@/lib/live-member", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLiveMemberById: mocks.getLiveMemberById };
});
vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyPinFromPB: mocks.verifyPinFromPB };
});
vi.mock("@/lib/task-commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeInternalTaskCommand: mocks.executeInternalTaskCommand,
}));
vi.mock("@/lib/task-approval", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureTaskApprovalHandlersRegistered: () => {} };
});
vi.mock("@/lib/task-ledger-command", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeLedgerCommand: mocks.executeLedgerCommand,
}));
vi.mock("@/lib/task-command-queue-server", () => ({
  enqueueTaskCommandRow: vi.fn(async () => false),
}));

import { POST as APPROVE_POST } from "@/app/api/tasks/approve/route";
import { POST as LEDGER_POST } from "@/app/api/tasks/ledger/route";

function request(route: string, body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  const req = new NextRequest(`http://localhost${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  (req as any).text = vi.fn(async () => text);
  return req;
}

beforeEach(() => {
  mocks.getLiveMemberById.mockReset();
  mocks.verifyPinFromPB.mockReset().mockResolvedValue({ id: "parent-rebecca" });
  mocks.executeInternalTaskCommand.mockReset();
  mocks.executeLedgerCommand.mockReset();
});

describe("D11 — the route gates fold the role the way the service does", () => {
  it("approve: a live role of 'Parent' is not pre-refused; the service answers", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "parent-rebecca", name: "Rebecca Garcia", role: "Parent" });
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: false,
      operationId: "op-parent-1",
      action: "approve",
      reason: "unknown_task",
      reconciled: false,
    });

    const res = await APPROVE_POST(
      request("/api/tasks/approve", { operationId: "op-parent-1", action: "approve", taskId: 101, memberName: "Rebecca Garcia", pin: "1234" }),
    );

    expect(mocks.executeInternalTaskCommand).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(404);
  });

  it("approve: a child is still refused 403 adult_only, before the service", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "kid-1", name: "Caspian Garcia", role: "child" });

    const res = await APPROVE_POST(
      request("/api/tasks/approve", { operationId: "op-kid-1", action: "approve", taskId: 101, memberName: "Caspian Garcia", pin: "1234" }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "adult_only" });
    expect(mocks.executeInternalTaskCommand).not.toHaveBeenCalled();
  });

  it("ledger: a live role of 'Parent' is not pre-refused; the service answers", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "parent-rebecca", name: "Rebecca Garcia", role: "Parent" });
    mocks.executeLedgerCommand.mockResolvedValue({
      ok: false,
      operationId: "op-parent-2",
      action: "adjust",
      reason: "unknown_member",
      reconciled: false,
    });

    const res = await LEDGER_POST(
      request("/api/tasks/ledger", { operationId: "op-parent-2", action: "adjust", memberName: "Rebecca Garcia", pin: "1234", amount: 5, reason: "chores" }),
    );

    expect(mocks.executeLedgerCommand).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(404);
  });

  it("ledger: a child is still refused 403 adult_only, before the service", async () => {
    mocks.getLiveMemberById.mockResolvedValue({ id: "kid-1", name: "Caspian Garcia", role: "child" });

    const res = await LEDGER_POST(
      request("/api/tasks/ledger", { operationId: "op-kid-2", action: "adjust", memberName: "Caspian Garcia", pin: "1234", amount: 5, reason: "chores" }),
    );

    expect(res.status).toBe(403);
    expect(mocks.executeLedgerCommand).not.toHaveBeenCalled();
  });
});
