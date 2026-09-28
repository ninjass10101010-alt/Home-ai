import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  withWeekLedgerLock: vi.fn(),
  applyWeekLedgerOperationLocked: vi.fn(),
  mutateSnapshotWithMeta: vi.fn(),
  readSnapshotStateWithRevision: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));
vi.mock("@/lib/server-auth", () => ({ verifyPinFromPB: mocks.verifyPinFromPB }));
vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));
vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));
vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: (week: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperationLocked: mocks.applyWeekLedgerOperationLocked,
}));
vi.mock("@/lib/snapshot-tasks", () => ({
  mutateSnapshotWithMeta: mocks.mutateSnapshotWithMeta,
  readSnapshotStateWithRevision: mocks.readSnapshotStateWithRevision,
  SNAPSHOT_COLLECTION: "consuela_data_snapshots",
  SNAPSHOT_KEY: "tasks-snapshot",
  normalizeWeekData: (value: unknown) => value,
}));

import { POST } from "@/app/api/tasks/ledger/route";
import { parseLedgerCommand } from "@/lib/task-ledger-command";

const WEEK = "2026-09-21";

const PARENT = { id: "parent-1", name: "Rebecca Garcia", role: "parent", emoji: "👩", age: 40 };
const CHILD = { id: "child-1", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 };

function emptyWeek() {
  return { weekStart: WEEK, points: {}, streak: {}, lastActive: {}, history: [] };
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okLedgerResult(weekData: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    applied: true,
    duplicate: false,
    semanticDuplicate: false,
    reconciled: true,
    weekData,
    operationId: "op-ledger-1",
    ...extra,
  };
}

beforeEach(() => {
  mocks.withAdmin.mockReset().mockImplementation((fn: any) => fn({}));
  mocks.verifyPinFromPB.mockReset().mockResolvedValue(PARENT);
  mocks.getLiveMemberById.mockReset().mockResolvedValue(PARENT);
  mocks.getLiveMembers.mockReset().mockResolvedValue([PARENT, CHILD]);
  mocks.ensureCurrentTaskWeek.mockReset().mockResolvedValue({ weekStart: WEEK, reconciled: true });
  mocks.applyWeekLedgerOperationLocked.mockReset();
  mocks.mutateSnapshotWithMeta.mockReset().mockResolvedValue({
    result: null,
    revision: { revision: "9", updatedAt: "2026-09-24T10:00:00.000Z" },
  });
  mocks.readSnapshotStateWithRevision.mockReset().mockResolvedValue({
    data: {
      tasks: [],
      weekData: emptyWeek(),
      penalties: [{ id: "pen-1", name: "Mess", emoji: "⚠️", points: 15 }],
      rewards: [],
      penaltiesUpdatedAt: "2026-09-24T09:00:00.000Z",
      configOperationReceipts: {},
    },
    revision: { revision: "9", updatedAt: "2026-09-24T10:00:00.000Z" },
  });
});

describe("parseLedgerCommand", () => {
  it("accepts a penalty with a catalog item id and no client amount", () => {
    const parsed = parseLedgerCommand({
      operationId: "op-1",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-1",
    });
    expect(parsed).toEqual({
      ok: true,
      command: { operationId: "op-1", action: "penalty", memberName: "Caspian Garcia", pin: "3141", itemId: "pen-1" },
    });
  });

  it("refuses a client-chosen point value on a penalty", () => {
    expect(parseLedgerCommand({
      operationId: "op-1",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-1",
      points: 9999,
    })).toMatchObject({ ok: false, reason: "invalid_body" });
  });

  it("accepts a manual adjust with a non-negative amount and a reason", () => {
    const parsed = parseLedgerCommand({
      operationId: "op-2",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "3141",
      amount: -5,
      reason: "helped out",
    });
    expect(parsed).toMatchObject({ ok: true });
  });

  it("accepts a signed amount but refuses a non-integer, a missing one, and a missing PIN", () => {
    // A deduction is an adjust too; the non-negative BALANCE is enforced by the
    // locked ledger helper (insufficient_balance), not by the parser.
    expect(parseLedgerCommand({
      operationId: "op-2", action: "adjust", memberName: "Caspian Garcia", pin: "3141", amount: -1,
    })).toMatchObject({ ok: true });
    expect(parseLedgerCommand({
      operationId: "op-2", action: "adjust", memberName: "Caspian Garcia", pin: "3141", amount: 1.5,
    })).toMatchObject({ ok: false, reason: "invalid_task_state" });
    expect(parseLedgerCommand({
      operationId: "op-2", action: "adjust", memberName: "Caspian Garcia", pin: "3141",
    })).toMatchObject({ ok: false, reason: "invalid_task_state" });
    expect(parseLedgerCommand({
      operationId: "op-2", action: "adjust", memberName: "Caspian Garcia", amount: 5,
    })).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("refuses an unknown action and a missing operation id", () => {
    expect(parseLedgerCommand({
      operationId: "op-2", action: "nuke", memberName: "X", pin: "1",
    })).toMatchObject({ ok: false, reason: "invalid_action" });
    expect(parseLedgerCommand({ action: "adjust", memberName: "X", pin: "1", amount: 1 }))
      .toMatchObject({ ok: false, reason: "invalid_body" });
  });
});

describe("POST /api/tasks/ledger", () => {
  it("a penalty reads the CATALOG points and never the body", async () => {
    mocks.applyWeekLedgerOperationLocked.mockImplementation(async (args: any) =>
      okLedgerResult({
        ...emptyWeek(),
        points: { "Caspian Garcia": 5 },
        history: [{
          id: 1,
          timestamp: "2026-09-24T10:00:00.000Z",
          member: "Caspian Garcia",
          type: "penalty",
          amount: -15,
          description: "Penalty: Mess (-15pts)",
        }],
      }));

    const res = await POST(jsonReq({
      operationId: "op-pen-1",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-1",
      points: 1,
    }));

    // The forged `points` is refused outright, not silently ignored.
    expect(res.status).toBe(400);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();

    const ok = await POST(jsonReq({
      operationId: "op-pen-2",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-1",
    }));
    expect(ok.status).toBe(200);
    const operation = mocks.applyWeekLedgerOperationLocked.mock.calls[0][0].operation;
    expect(operation).toMatchObject({ operationId: "op-pen-2", source: "task-penalty" });
    expect(operation.entries[0]).toMatchObject({
      type: "penalty",
      member: "Caspian Garcia",
      amount: -15,
      description: "Penalty: Mess (-15pts)",
    });
    expect(operation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a manual adjust carries the signed amount and the parent's reason", async () => {
    mocks.applyWeekLedgerOperationLocked.mockResolvedValue(okLedgerResult({
      ...emptyWeek(),
      points: { "Caspian Garcia": 15 },
      history: [{
        id: 2,
        timestamp: "2026-09-24T10:00:00.000Z",
        member: "Caspian Garcia",
        type: "adjust",
        amount: 20,
        description: "Manual adjust: +20pts (helped out)",
      }],
    }));

    const res = await POST(jsonReq({
      operationId: "op-adj-1",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "3141",
      amount: 20,
      reason: "helped out",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      action: "adjust",
      member: "Caspian Garcia",
      weekStart: WEEK,
      reconciled: true,
      repairRequired: false,
    });
    expect(body.applied).toBeGreaterThanOrEqual(1);
    expect(body.weekData.points["Caspian Garcia"]).toBe(15);
    const operation = mocks.applyWeekLedgerOperationLocked.mock.calls[0][0].operation;
    expect(operation).toMatchObject({ source: "manual-adjust", actorId: "parent-1" });
    expect(operation.entries[0]).toMatchObject({ type: "adjust", amount: 20, appliedBy: "parent-1" });
  });

  it("replays the same operationId without paying twice", async () => {
    mocks.applyWeekLedgerOperationLocked.mockResolvedValue(okLedgerResult(
      {
        ...emptyWeek(),
        points: { "Caspian Garcia": 5 },
        history: [{
          id: 1,
          timestamp: "2026-09-24T10:00:00.000Z",
          member: "Caspian Garcia",
          type: "penalty",
          amount: -15,
          description: "Penalty: Mess (-15pts)",
        }],
      },
      { duplicate: true },
    ));

    const res = await POST(jsonReq({
      operationId: "op-pen-3",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-1",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.applied).toBe(0);
  });

  it("refuses an unknown catalog penalty with 404", async () => {
    const res = await POST(jsonReq({
      operationId: "op-pen-4",
      action: "penalty",
      memberName: "Caspian Garcia",
      pin: "3141",
      itemId: "pen-missing",
    }));
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("unknown_penalty");
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });

  it("refuses a wrong PIN with 401 and never writes", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(null);
    const res = await POST(jsonReq({
      operationId: "op-adj-2",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "0000",
      amount: 5,
    }));
    expect(res.status).toBe(401);
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });

  it("refuses a CHILD session with 403 adult_only", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(CHILD);
    mocks.getLiveMemberById.mockResolvedValue(CHILD);
    const res = await POST(jsonReq({
      operationId: "op-adj-3",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "3141",
      amount: 5,
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("adult_only");
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });

  it("refuses an unknown member with 404", async () => {
    const res = await POST(jsonReq({
      operationId: "op-adj-4",
      action: "adjust",
      memberName: "Nobody At All",
      pin: "3141",
      amount: 5,
    }));
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("unknown_member");
  });

  it("surfaces an insufficient balance as a stable 409", async () => {
    mocks.applyWeekLedgerOperationLocked.mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
      applied: false,
      duplicate: false,
      semanticDuplicate: false,
      reconciled: false,
      weekData: { ...emptyWeek(), points: { "Caspian Garcia": 0 } },
      operationId: "op-adj-5",
    });
    const res = await POST(jsonReq({
      operationId: "op-adj-5",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "3141",
      amount: -50,
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("insufficient_balance");
  });

  it("answers 202 with a repair marker when the snapshot projection fails", async () => {
    mocks.mutateSnapshotWithMeta.mockRejectedValue(new Error("snapshot down"));
    mocks.applyWeekLedgerOperationLocked.mockImplementation(async (args: any) => ({
      ...okLedgerResult({ ...emptyWeek(), points: { "Caspian Garcia": 5 }, history: [] }),
      reconciled: false,
    }));
    const res = await POST(jsonReq({
      operationId: "op-adj-6",
      action: "adjust",
      memberName: "Caspian Garcia",
      pin: "3141",
      amount: 5,
    }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ reconciled: false, repairRequired: true, retryable: true });
  });

  it("resolves the ledger key to the roster full name", async () => {
    mocks.applyWeekLedgerOperationLocked.mockResolvedValue(okLedgerResult(emptyWeek()));
    await POST(jsonReq({
      operationId: "op-adj-7",
      action: "adjust",
      memberName: "Caspian",
      pin: "3141",
      amount: 5,
    }));
    const operation = mocks.applyWeekLedgerOperationLocked.mock.calls[0][0].operation;
    expect(operation.entries[0].member).toBe("Caspian Garcia");
  });
});
