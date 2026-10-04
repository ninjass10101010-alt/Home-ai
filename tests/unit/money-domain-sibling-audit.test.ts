/**
 * Sibling money-route gate AUDIT (recorded, not assumed).
 *
 * The money-mountain write hole was found by auditing its siblings, so the
 * audit result is pinned here instead of living in a report that drifts:
 *
 *   POST /api/tasks/ledger      — CORRECTLY GATED. Self-authenticates the
 *       member PIN, then hard-requires `role === "parent"` on the LIVE row and
 *       maps a PocketBase read failure to 503 `ledger_unavailable`. The
 *       existing suite covered `child`; these add `pet` (the role allowlist is
 *       `parent`-only, so a pet must be denied too — the same trap the
 *       middleware ledger allowlist documents) and the fail-closed path.
 *
 *   POST /api/rewards/redeem   — CORRECTLY GATED. The member PIN is the
 *       credential by design (a guest device auto-logs-out), the REAL cost is
 *       read from the stored reward row rather than the request body, and a
 *       purchase over 100 points needs a SEPARATE named credential whose live
 *       role is a parent. These pin the two properties that make it safe: the
 *       body cannot price itself, and a pet can never approve.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  verifyPinFromPB: vi.fn(),
  getLiveMemberById: vi.fn(),
  getLiveMembers: vi.fn(),
  ensureCurrentTaskWeek: vi.fn(),
  applyWeekLedgerOperationLocked: vi.fn(),
  applyWeekLedgerOperation: vi.fn(),
  mutateSnapshotWithMeta: vi.fn(),
  readSnapshotStateWithRevision: vi.fn(),
  persistSnapshotWeek: vi.fn(),
}));

vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, verifyPinFromPB: mocks.verifyPinFromPB };
});

vi.mock("@/lib/live-member", () => ({
  getLiveMemberById: mocks.getLiveMemberById,
  getLiveMembers: mocks.getLiveMembers,
}));

vi.mock("@/lib/task-week-rollover", () => ({
  ensureCurrentTaskWeek: mocks.ensureCurrentTaskWeek,
}));

vi.mock("@/lib/week-ledger-lock", () => ({
  withWeekLedgerLock: (_week: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/ledger-operations", () => ({
  applyWeekLedgerOperationLocked: mocks.applyWeekLedgerOperationLocked,
  applyWeekLedgerOperation: mocks.applyWeekLedgerOperation,
}));

vi.mock("@/lib/snapshot-tasks", () => ({
  mutateSnapshotWithMeta: mocks.mutateSnapshotWithMeta,
  readSnapshotStateWithRevision: mocks.readSnapshotStateWithRevision,
  persistSnapshotWeek: mocks.persistSnapshotWeek,
}));

import { POST as LEDGER_POST } from "@/app/api/tasks/ledger/route";
import { POST as REDEEM_POST } from "@/app/api/rewards/redeem/route";

const WEEK = "2026-09-21";
const PARENT = { id: "parent-1", name: "Rebecca Garcia", role: "parent", emoji: "👩", age: 40 };
const CHILD = { id: "child-1", name: "Caspian Garcia", role: "child", emoji: "🧒", age: 5 };
const PET = { id: "pet-1", name: "Whiskers Garcia", role: "pet", emoji: "🐈", age: 3 };

function ledgerReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function redeemReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rewards/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EXPENSIVE_REWARD = { id: "reward-1", name: "Movie night", emoji: "🎬", cost: 150 };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.withAdmin.mockImplementation((fn: any) =>
    fn({
      collection: (name: string) => ({
        getFullList: async () =>
          name === "rewards" ? [EXPENSIVE_REWARD] : [PARENT, CHILD, PET],
      }),
    }),
  );
  mocks.verifyPinFromPB.mockResolvedValue(CHILD);
  mocks.getLiveMemberById.mockResolvedValue(PARENT);
  mocks.getLiveMembers.mockResolvedValue([PARENT, CHILD, PET]);
  mocks.ensureCurrentTaskWeek.mockResolvedValue({ weekStart: WEEK, reconciled: true });
  mocks.applyWeekLedgerOperation.mockResolvedValue({ ok: false, code: "insufficient_balance" });
});

describe("audit: POST /api/tasks/ledger", () => {
  it("refuses a PET session with 403 adult_only and never writes the ledger", async () => {
    mocks.verifyPinFromPB.mockResolvedValue(PET);
    mocks.getLiveMemberById.mockResolvedValue(PET);

    const res = await LEDGER_POST(
      ledgerReq({
        operationId: "op-audit-pet",
        action: "adjust",
        memberName: "Whiskers Garcia",
        pin: "0000",
        amount: 5,
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("adult_only");
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });

  it("fails closed when the live member row cannot be read", async () => {
    mocks.getLiveMemberById.mockRejectedValue(new Error("PocketBase is unreachable"));

    const res = await LEDGER_POST(
      ledgerReq({
        operationId: "op-audit-outage",
        action: "adjust",
        memberName: "Caspian Garcia",
        pin: "3141",
        amount: 5,
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("ledger_unavailable");
    expect(mocks.applyWeekLedgerOperationLocked).not.toHaveBeenCalled();
  });
});

describe("audit: POST /api/rewards/redeem", () => {
  const base = {
    operationId: "op-audit-redeem",
    rewardId: EXPENSIVE_REWARD.id,
    memberName: CHILD.name,
    pin: "child-pin-fixture",
  };

  it("prices from the stored reward row, never from the request body", async () => {
    // A body claiming the 150-point reward costs 1 point must still be treated
    // as a 150-point purchase, i.e. still demand parent approval.
    const res = await REDEEM_POST(redeemReq({ ...base, cost: 1, points: 1 }));

    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("parent_approval_required");
    expect(mocks.applyWeekLedgerOperation).not.toHaveBeenCalled();
  });

  it("refuses a PET as the approving parent with 403 parent_only", async () => {
    const res = await REDEEM_POST(
      redeemReq({
        ...base,
        parentName: PET.name,
        parentPin: "0000",
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("parent_only");
    expect(mocks.applyWeekLedgerOperation).not.toHaveBeenCalled();
  });

  it("refuses a CHILD as the approving parent with 403 parent_only", async () => {
    const res = await REDEEM_POST(
      redeemReq({ ...base, parentName: CHILD.name, parentPin: "3141" }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("parent_only");
    expect(mocks.applyWeekLedgerOperation).not.toHaveBeenCalled();
  });
});
