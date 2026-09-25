// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  executeInternalTaskCommand: vi.fn(),
  localWeekStartISO: vi.fn(() => "2026-09-21"),
  ensureTaskApprovalHandlersRegistered: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/server-auth", () => ({ verifyPinFromPB: (name: string, pin: string) => mocks.verifyPinFromPB(name, pin) }));
vi.mock("@/lib/live-member", () => ({ getLiveMemberById: (id: string) => mocks.getLiveMemberById(id) }));
vi.mock("@/lib/local-date", () => ({
  localWeekStartISO: () => mocks.localWeekStartISO(),
  localTodayISO: () => "2026-09-24",
}));
vi.mock("@/lib/task-commands", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    executeInternalTaskCommand: (command: unknown, options: unknown) =>
      mocks.executeInternalTaskCommand(command, options),
  };
});
vi.mock("@/lib/task-approval", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ensureTaskApprovalHandlersRegistered: () => mocks.ensureTaskApprovalHandlersRegistered(),
  };
});

import { POST } from "@/app/api/tasks/approve/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://x/api/tasks/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.withAdmin.mockImplementation(async (fn: any) => fn({ collection: () => ({ getFullList: async () => [] }) }));
  mocks.verifyPinFromPB.mockResolvedValue({ id: "parent-1" });
  mocks.getLiveMemberById.mockResolvedValue({ id: "parent-1", name: "Rebecca (Mom)", role: "parent" });
  mocks.executeInternalTaskCommand.mockReset();
});

describe("approve route retryable failures", () => {
  it("marks a repair_required failure as a retryable 503", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: false,
      operationId: "op-repair-required",
      action: "approve",
      weekData: null,
      paid: 0,
      cleared: 0,
      skipped: 0,
      reconciled: false,
      repairRequired: true,
      reason: "repair_required",
    });

    const res = await POST(request({
      action: "approve",
      operationId: "op-repair-required",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      success: false,
      error: "repair_required",
      retryable: true,
      repairRequired: true,
    });
  });

  it("leaves terminal failures non-retryable", async () => {
    mocks.executeInternalTaskCommand.mockResolvedValue({
      ok: false,
      operationId: "op-unknown-task",
      action: "approve",
      weekData: null,
      paid: 0,
      cleared: 0,
      skipped: 0,
      reconciled: false,
      repairRequired: false,
      reason: "unknown_task",
    });

    const res = await POST(request({
      action: "approve",
      operationId: "op-unknown-task",
      memberName: "Rebecca (Mom)",
      pin: "0202",
      taskId: 101,
    }));

    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("retryable");
  });
});
