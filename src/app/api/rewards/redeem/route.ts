import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { namesMatch, verifyPinFromPB } from "@/lib/server-auth";
import { applyWeekLedgerOperation, type LedgerProjection } from "@/lib/ledger-operations";
import { localWeekStartISO } from "@/lib/local-date";
import {
  mutateSnapshotWithMeta,
  persistSnapshotWeek,
  type SnapshotData,
} from "@/lib/snapshot-tasks";
import { enqueueTaskCommandRow } from "@/lib/task-command-queue-server";
import { isRecord, normalizeOperationId } from "@/lib/task-operation-contract";
import type { LedgerOperationInput } from "@/types/tasks";

export const dynamic = "force-dynamic";

type RewardRedeemErrorCode =
  | "invalid_body"
  | "invalid_pin"
  | "parent_approval_required"
  | "parent_only"
  | "unknown_reward"
  | "insufficient"
  | "duplicate"
  | "ledger_unavailable";

// A reward above this cost needs a grown-up's say-so. The threshold was
// previously enforced ONLY in the browser, so any caller could skip it; the
// gate lives here, and a SEPARATE named parent credential is what satisfies it.
const PARENT_APPROVAL_MIN_COST = 100;

interface RedeemRequest {
  operationId: string;
  rewardId: string;
  rewardName: string | null;
  memberName: string;
  pin: string;
  parentName: string;
  parentPin: string;
}

interface RedeemReward {
  id: string;
  title: string;
  cost: number;
  emoji: string;
}

// The ONE week key, shared with the week rollover and the planner. The previous
// `setHours(0,0,0,0)` + `.toISOString()` here serialised local midnight as UTC,
// so east of UTC it resolved to the PREVIOUS day — and on a Sunday, the
// previous week. A redemption is a DEDUCTION, so the wrong key stranded it in a
// `week_data` row the rollover had already closed while the visible balance
// sprang back.
function currentWeekKey(): string {
  return localWeekStartISO();
}

function errorResponse(
  operationId: string,
  reason: RewardRedeemErrorCode,
  status: number,
  error: string,
) {
  return NextResponse.json(
    { ok: false, operationId, reason, error },
    { status },
  );
}

// The queue holds only the post-verification ledger failure — the member PIN
// (and any parent approval for a high-cost reward) were verified, the ledger
// operation is fully built, and the replay reuses it verbatim under the same
// operation id, so a partially applied redemption can never apply twice.
function queuedResponse(operationId: string, reason: string) {
  return NextResponse.json(
    { ok: false, queued: true, operationId, reason, retryable: true },
    { status: 202 },
  );
}

function parseRedeemRequest(body: unknown): RedeemRequest | null {
  if (!isRecord(body)) return null;
  // The operation id is validated FIRST: it is the retry identity for a
  // point-changing request, so a body without one is never acted on.
  const operationId = normalizeOperationId(body.operationId);
  if (!operationId) return null;
  const rawRewardId = body.rewardId;
  const rewardId =
    typeof rawRewardId === "number" && Number.isSafeInteger(rawRewardId)
      ? String(rawRewardId)
      : typeof rawRewardId === "string"
        ? rawRewardId.trim()
        : "";
  const memberName = typeof body.memberName === "string" ? body.memberName.trim() : "";
  if (!rewardId || !memberName) return null;
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  return {
    operationId,
    rewardId,
    rewardName: typeof body.rewardName === "string" ? body.rewardName.trim() || null : null,
    memberName,
    pin,
    parentName: typeof body.parentName === "string" ? body.parentName.trim() : "",
    parentPin: typeof body.parentPin === "string" ? body.parentPin.trim() : "",
  };
}

// Server-authoritative reward lookup: the stored row decides the real cost and
// title. The request body is never trusted for either — a forged body could
// otherwise buy a 150-point reward for 1 point under a title of its own. A row
// whose stored cost is not a usable point value is a broken catalog, not an
// unknown reward, and it fails closed rather than minting a bogus entry.
async function readReward(
  rewardId: string,
  rewardName: string | null,
): Promise<RedeemReward | null | "invalid_cost"> {
  return withAdmin(async (pb): Promise<RedeemReward | null | "invalid_cost"> => {
    const rows = await pb.collection("rewards").getFullList({ requestKey: null });
    const list = (Array.isArray(rows) ? rows : []) as Array<Record<string, any>>;
    const row =
      list.find((candidate) => String(candidate?.id) === rewardId) ||
      (rewardName ? list.find((candidate) => String(candidate?.name) === rewardName) : undefined);
    if (!row) return null;
    const cost = Number(row.cost ?? row.points);
    if (!Number.isSafeInteger(cost) || cost < 0) return "invalid_cost";
    return {
      id: String(row.id ?? ""),
      title: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "reward",
      cost,
      emoji: typeof row.emoji === "string" && row.emoji.trim() ? row.emoji.trim() : "🎁",
    };
  });
}

/**
 * A high-cost reward needs a parent who is NAMED and whose live PocketBase row
 * really is a parent. The name is resolved with the same matcher
 * `verifyPinFromPB` uses, so the approver is never a role-less guess: a kid,
 * a pet or a name that is not on the roster can never approve a purchase.
 */
async function parentApproval(
  parentName: string,
  parentPin: string,
): Promise<"approved" | "not_parent" | "invalid_pin"> {
  const roster = await withAdmin(async (pb) => {
    const rows = await pb.collection("members").getFullList({ requestKey: null });
    return Array.isArray(rows) ? (rows as Array<Record<string, any>>) : [];
  });
  const approver = roster.find(
    (candidate) => typeof candidate?.name === "string" && namesMatch(candidate.name, parentName),
  );
  if (!approver || String(approver.role ?? "").trim().toLowerCase() !== "parent") {
    return "not_parent";
  }
  const verified = await verifyPinFromPB(approver.name, parentPin);
  return verified ? "approved" : "invalid_pin";
}

function withRepairMarker(
  data: SnapshotData,
  operationId: string,
  actorId: string,
): SnapshotData {
  const current = Array.isArray(data.pendingProjectionRepairs) ? data.pendingProjectionRepairs : [];
  return {
    ...data,
    pendingProjectionRepairs: [
      ...current.filter((marker) => marker.operationId !== operationId),
      { operationId, taskIds: [], actorId, createdAt: new Date().toISOString() },
    ],
  };
}

function insufficientMessage(
  member: string,
  reward: RedeemReward,
  balance: number,
): string {
  const firstName = member.split(" ")[0];
  return `${firstName} needs ${Math.max(reward.cost - balance, 0)} more pts for ${reward.emoji} ${reward.title}`;
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("", "invalid_body", 400, "That redemption request could not be read.");
  }

  const parsed = parseRedeemRequest(rawBody);
  if (!parsed) {
    return errorResponse("", "invalid_body", 400, "A reward, a member and an operation id are required.");
  }
  const { operationId } = parsed;
  if (!parsed.pin) {
    return errorResponse(operationId, "invalid_pin", 401, "Invalid PIN");
  }

  try {
    const verified = await verifyPinFromPB(parsed.memberName, parsed.pin);
    if (!verified) {
      return errorResponse(operationId, "invalid_pin", 401, "Invalid PIN");
    }
    const member = typeof verified.name === "string" && verified.name.trim()
      ? verified.name.trim()
      : parsed.memberName;
    const memberId = typeof verified.id === "string" ? verified.id.trim() : "";

    const reward = await readReward(parsed.rewardId, parsed.rewardName);
    if (reward === "invalid_cost") {
      return errorResponse(
        operationId,
        "ledger_unavailable",
        503,
        "That reward is misconfigured, so it cannot be redeemed right now.",
      );
    }
    if (!reward) {
      return errorResponse(
        operationId,
        "unknown_reward",
        404,
        "That reward isn't available anymore.",
      );
    }

    if (reward.cost > PARENT_APPROVAL_MIN_COST) {
      if (!parsed.parentName || !parsed.parentPin) {
        return errorResponse(
          operationId,
          "parent_approval_required",
          401,
          "A parent has to approve this reward.",
        );
      }
      const approval = await parentApproval(parsed.parentName, parsed.parentPin);
      if (approval === "not_parent") {
        return errorResponse(
          operationId,
          "parent_only",
          403,
          "Only a parent can approve this reward.",
        );
      }
      if (approval === "invalid_pin") {
        return errorResponse(operationId, "invalid_pin", 401, "Invalid PIN");
      }
    }

    const operation: LedgerOperationInput = {
      operationId,
      source: "reward-redeem",
      ...(memberId ? { actorId: memberId } : {}),
      entries: [
        {
          type: "redeem",
          member,
          amount: -reward.cost,
          description: `Redeemed: ${reward.title} (-${reward.cost}pts)`,
        },
      ],
    };

    // The shared helper OWNS the week-ledger lock, the canonical week read, the
    // balance recomputation, the write and the post-write verification, and it
    // invokes the projection WHILE that lock is held — so the lock order stays
    // week-ledger -> snapshot and this route never wraps it in another lock.
    // The snapshot leg runs only after the canonical write verified, and a leg
    // that cannot be written leaves an honest pending repair instead of a false
    // success (the route answers 202).
    const project: LedgerProjection = async ({ pb, weekData }) => {
      const projected = await persistSnapshotWeek(pb, weekData);
      if (projected.ok) return true;
      try {
        await mutateSnapshotWithMeta(
          (data) => ({ data: withRepairMarker(data, operationId, memberId), result: null }),
          pb,
        );
      } catch {
        // Best effort: the marker is a hint, the reconciler still sees the gap.
      }
      return false;
    };
    const weekStart = currentWeekKey();

    let result = await applyWeekLedgerOperation({ weekStart, operation, project });

    // A lost update (another process wrote the week between our read and our
    // write) is recoverable ONCE, and the retry reuses the SAME operation id,
    // so a partially applied operation can never be applied twice.
    if (!result.ok && result.code === "ledger_write_conflict") {
      result = await applyWeekLedgerOperation({ weekStart, operation, project });
    }

    if (!result.ok) {
      if (result.code === "insufficient_balance") {
        return errorResponse(
          result.operationId,
          "insufficient",
          400,
          insufficientMessage(member, reward, result.weekData.points[member] ?? 0),
        );
      }
      if (result.code === "operation_conflict") {
        return errorResponse(
          result.operationId,
          "duplicate",
          409,
          "That redemption already went through — check your points.",
        );
      }
      let queued = false;
      try {
        queued = await enqueueTaskCommandRow({
          operationId,
          route: "/api/rewards/redeem",
          action: "redeem",
          payload: { weekStart, operation, actorId: memberId },
          actor: {
            memberId,
            name: member,
            role: typeof verified.role === "string" ? verified.role : "",
            authentication: "pin",
          },
          displayTarget: { kind: "config", title: reward.title },
        });
      } catch {
        queued = false;
      }
      if (queued) return queuedResponse(operationId, "ledger_unavailable");
      return errorResponse(
        result.operationId,
        "ledger_unavailable",
        503,
        "Points could not be updated just now. Please try again.",
      );
    }

    return NextResponse.json(
      {
        ok: true,
        applied: result.applied,
        duplicate: result.duplicate,
        reconciled: result.reconciled,
        operationId: result.operationId,
        member,
        reward: {
          id: reward.id,
          name: reward.title,
          cost: reward.cost,
          emoji: reward.emoji,
        },
        weekData: result.weekData,
      },
      { status: result.reconciled ? 200 : 202 },
    );
  } catch (error) {
    console.error("Reward redeem API error:", error);
    return errorResponse(
      operationId,
      "ledger_unavailable",
      503,
      "Points could not be updated just now. Please try again.",
    );
  }
}
