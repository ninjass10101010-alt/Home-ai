import { describe, expect, it, vi } from "vitest";
import {
  executeInternalTaskCommand,
  registerInternalTaskCommandHandler,
  type InternalTaskCommand,
  type InternalTaskCommandResult,
} from "@/lib/task-commands";

const baseCommand: InternalTaskCommand = {
  operationId: "op-internal-1",
  kind: "complete",
  actor: { memberId: "member-1", name: "Child A", role: "child" },
  payload: { taskId: 42 },
};

describe("internal task command registry", () => {
  it("routes a registered command through one seam", async () => {
    const expected: InternalTaskCommandResult = {
      ok: true,
      operationId: baseCommand.operationId,
      task: { id: 42, title: "Dishes" } as InternalTaskCommandResult["task"],
      reconciled: true,
    };
    const contextArg = { source: "hermes" as const };
    const handler = vi.fn(async (received, context) => {
      expect(received).toBe(baseCommand);
      expect(context).toBe(contextArg);
      return expected;
    });
    const unregister = registerInternalTaskCommandHandler("complete", handler);

    try {
      const result = await executeInternalTaskCommand(baseCommand, contextArg);
      expect(handler).toHaveBeenCalledOnce();
      expect(result).toBe(expected);
      expect(result.operationId).toBe("op-internal-1");
      expect(result.ok).toBe(true);
    } finally {
      unregister();
    }
  });

  it.each([
    "member",
    "memberId",
    "memberName",
    "memberid",
    "amount",
    "amountTotal",
    "amounttotal",
    "payee",
    "payeeId",
    "payeeid",
    "points",
    "completed",
    "completedBy",
    "completion",
    "pendingApproval",
    "history",
    "ledgerHistory",
    "ledgerhistory",
    "pin",
    "pinCode",
    "claimantPin",
    "password",
    "sessionToken",
    "apiKey",
    "token",
    "authorization",
  ])("rejects forbidden payload key %s before dispatch", async (key) => {
    const handler = vi.fn(async (): Promise<InternalTaskCommandResult> => ({
      ok: true,
      operationId: baseCommand.operationId,
      reconciled: true,
    }));
    const unregister = registerInternalTaskCommandHandler("complete", handler);
    const command: InternalTaskCommand = {
      ...baseCommand,
      operationId: `op-${key}`,
      payload: { taskId: 42, [key]: "forbidden" },
    };

    try {
      const result = await executeInternalTaskCommand(command, { source: "server" });
      expect(result).toEqual({
        ok: false,
        operationId: command.operationId,
        reason: "forbidden_task_command_payload",
        reconciled: false,
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("rejects forbidden keys nested in the payload", async () => {
    const handler = vi.fn(async (): Promise<InternalTaskCommandResult> => ({
      ok: true,
      operationId: baseCommand.operationId,
      reconciled: true,
    }));
    const unregister = registerInternalTaskCommandHandler("complete", handler);
    const command: InternalTaskCommand = {
      ...baseCommand,
      payload: { taskId: 42, metadata: { completedAt: "2026-09-21T10:00:00.000Z" } },
    };

    try {
      const result = await executeInternalTaskCommand(command, { source: "muse" });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("forbidden_task_command_payload");
      expect(handler).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("preserves legitimate task and action identity fields", async () => {
    const payload = {
      taskId: 42,
      title: "Dishes",
      assignee: "Child A",
      targetName: "Child B",
      operationId: "op-payload-identity",
      shipping: true,
    };
    const handler = vi.fn(async (received): Promise<InternalTaskCommandResult> => {
      expect(received.payload).toBe(payload);
      return { ok: true, operationId: received.operationId, reconciled: true };
    });
    const unregister = registerInternalTaskCommandHandler("update", handler);
    const command: InternalTaskCommand = { ...baseCommand, kind: "update", payload };

    try {
      const result = await executeInternalTaskCommand(command, { source: "server" });
      expect(result.ok).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("normalizes a padded operation ID once before dispatch", async () => {
    const handler = vi.fn(async (received): Promise<InternalTaskCommandResult> => {
      expect(received.operationId).toBe("op-padded");
      return { ok: true, operationId: received.operationId, reconciled: true };
    });
    const unregister = registerInternalTaskCommandHandler("complete", handler);
    const command = { ...baseCommand, operationId: "  op-padded  " };

    try {
      const result = await executeInternalTaskCommand(command, { source: "hermes" });
      expect(handler).toHaveBeenCalledWith(
        { ...baseCommand, operationId: "op-padded" },
        { source: "hermes" },
      );
      expect(result.operationId).toBe("op-padded");
      expect(result.ok).toBe(true);
    } finally {
      unregister();
    }
  });

  it("does not let a handler substitute the operation ID", async () => {
    const unregister = registerInternalTaskCommandHandler("complete", async () => ({
      ok: true,
      operationId: "op-substituted",
      reconciled: true,
    }));

    try {
      const result = await executeInternalTaskCommand(
        { ...baseCommand, operationId: "  op-authoritative  " },
        { source: "server" },
      );
      expect(result).toEqual({
        ok: true,
        operationId: "op-authoritative",
        reconciled: true,
      });
    } finally {
      unregister();
    }
  });

  it.each(["__proto__", "constructor", "prototype", "toString"])(
    "rejects prototype-like operation ID %s",
    async (operationId) => {
      const handler = vi.fn(async (): Promise<InternalTaskCommandResult> => ({
        ok: true,
        operationId: baseCommand.operationId,
        reconciled: true,
      }));
      const unregister = registerInternalTaskCommandHandler("complete", handler);

      try {
        const result = await executeInternalTaskCommand(
          { ...baseCommand, operationId: `  ${operationId}  ` },
          { source: "muse" },
        );
        expect(result).toEqual({
          ok: false,
          operationId: operationId,
          reason: "invalid_task_command",
          reconciled: false,
        });
        expect(handler).not.toHaveBeenCalled();
      } finally {
        unregister();
      }
    },
  );

  it("cleans up registration and returns unsupported without a handler", async () => {
    const handler = vi.fn(async (): Promise<InternalTaskCommandResult> => ({
      ok: true,
      operationId: baseCommand.operationId,
      reconciled: true,
    }));
    const unregister = registerInternalTaskCommandHandler("complete", handler);
    unregister();

    const result = await executeInternalTaskCommand(baseCommand, { source: "hermes" });
    expect(result).toEqual({
      ok: false,
      operationId: baseCommand.operationId,
      reason: "unsupported_task_command",
      reconciled: false,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates the command shape before dispatch", async () => {
    const handler = vi.fn(async (): Promise<InternalTaskCommandResult> => ({
      ok: true,
      operationId: baseCommand.operationId,
      reconciled: true,
    }));
    const unregister = registerInternalTaskCommandHandler("complete", handler);
    const invalid = {
      ...baseCommand,
      operationId: "",
      actor: { ...baseCommand.actor, name: "" },
      payload: null,
    } as unknown as InternalTaskCommand;

    try {
      const result = await executeInternalTaskCommand(invalid, { source: "hermes" });
      expect(result).toEqual({
        ok: false,
        operationId: "",
        reason: "invalid_task_command",
        reconciled: false,
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("turns handler failures into a sanitized result", async () => {
    const unregister = registerInternalTaskCommandHandler("complete", async () => {
      throw new Error("private request material");
    });

    try {
      const result = await executeInternalTaskCommand(baseCommand, { source: "server" });
      expect(result).toEqual({
        ok: false,
        operationId: baseCommand.operationId,
        reason: "task_command_handler_failed",
        reconciled: false,
      });
      expect(JSON.stringify(result)).not.toContain("private request material");
    } finally {
      unregister();
    }
  });
});
