import { NextRequest, NextResponse } from "next/server";
import { getLiveMemberById } from "@/lib/live-member";
import { requireLiveSession, verifyPinFromPB } from "@/lib/server-auth";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import {
  ensureTaskClaimHandlersRegistered,
  parseClaimCommand,
  taskClaimInternalPayload,
  type ClaimActor,
  type ClaimFailureReason,
  type ClaimServiceResult,
} from "@/lib/task-claim";

export const dynamic = "force-dynamic";

type AuthResult =
  | { ok: true; actor: ClaimActor }
  | { ok: false; status: 400 | 401 | 403 | 503; reason: string };

function errorResponse(
  operationId: string,
  reason: string,
  status: number,
  action?: string,
  claimedBy?: string,
) {
  return NextResponse.json({
    success: false,
    operationId,
    ...(action ? { action } : {}),
    reason,
    ...(claimedBy ? { claimedBy } : {}),
  }, { status });
}

function statusForReason(reason: ClaimFailureReason | string): number {
  if (reason === "unknown_task") return 404;
  if (
    reason === "unauthorized" ||
    reason === "pin_required" ||
    reason === "session_required"
  ) return 401;
  if (
    reason === "not_allowed" ||
    reason === "adult_only" ||
    reason === "session_role_changed" ||
    reason === "unknown_actor" ||
    reason === "unknown_task_owner" ||
    reason === "not_task_owner" ||
    reason === "removed_crew_member" ||
    reason === "not_in_crew" ||
    reason === "unknown_crew_member"
  ) return 403;
  if (
    reason === "invalid_body" ||
    reason === "invalid_action" ||
    reason === "invalid_task_id" ||
    reason === "forbidden_claim_payload" ||
    reason === "not_universal" ||
    reason === "not_late_yet" ||
    reason === "crew_task" ||
    reason === "not_assigned" ||
    reason === "not_crew_task" ||
    reason === "target_required" ||
    reason === "invalid_task_state" ||
    reason === "invalid_crew_member"
  ) return 400;
  if (
    reason === "ambiguous_task" ||
    reason === "already_completed" ||
    reason === "already_claimed" ||
    reason === "already_undone" ||
    reason === "nothing_to_undo" ||
    reason === "crew_full" ||
    reason === "member_checked_in" ||
    reason === "operation_conflict" ||
    reason === "insufficient_balance"
  ) return 409;
  return 503;
}

function normalizeRegistryReason(reason: string | undefined): string {
  if (reason === "forbidden_task_command_payload") return "forbidden_claim_payload";
  if (reason === "invalid_task_command") return "invalid_body";
  if (reason === "unsupported_task_command" || reason === "task_command_handler_failed") {
    return "task_store_unavailable";
  }
  return reason ?? "task_store_unavailable";
}

async function authenticate(
  request: NextRequest,
  action: string,
  memberName: string | undefined,
  pin: string | undefined,
): Promise<AuthResult> {
  if (pin) {
    if (!memberName) return { ok: false, status: 400, reason: "invalid_body" };
    let verified: any;
    try {
      verified = await verifyPinFromPB(memberName, pin);
    } catch {
      return { ok: false, status: 503, reason: "member_roster_unavailable" };
    }
    const memberId = typeof verified?.id === "string" ? verified.id.trim() : "";
    if (!verified || !memberId) return { ok: false, status: 401, reason: "unauthorized" };
    try {
      const live = await getLiveMemberById(memberId);
      if (!live) return { ok: false, status: 401, reason: "unauthorized" };
      return {
        ok: true,
        actor: liveActor({ memberId: live.id, name: live.name, role: live.role }, "pin", memberName),
      };
    } catch {
      return { ok: false, status: 503, reason: "member_roster_unavailable" };
    }
  }

  if (!(["complete", "undo", "crew-join", "crew-checkin"] as string[]).includes(action)) {
    return { ok: false, status: 401, reason: "pin_required" };
  }
  const live = await requireLiveSession(request);
  if (!live.ok) {
    return { ok: false, status: live.status, reason: live.error };
  }
  return { ok: true, actor: liveActor(live.identity, "session", memberName) };
}

function liveActor(
  member: { memberId: string; name: string; role: string },
  authentication: "pin" | "session",
  requestedName?: string,
): ClaimActor {
  return {
    memberId: member.memberId,
    name: member.name,
    role: member.role,
    authentication,
    ...(requestedName ? { requestedName } : {}),
  };
}

function successResponse(result: ClaimServiceResult) {
  return NextResponse.json({
    success: true,
    operationId: result.operationId,
    action: result.action,
    ...(result.task ? { task: result.task } : {}),
    ...(result.weekData ? { weekData: result.weekData } : {}),
    ...(result.pending !== undefined ? { pending: result.pending } : {}),
    ...(result.claimedBy ? { claimedBy: result.claimedBy } : {}),
    ...(result.alreadyJoined !== undefined ? { alreadyJoined: result.alreadyJoined } : {}),
    ...(result.reopened !== undefined ? { reopened: result.reopened } : {}),
    revision: result.revision ?? { revision: "0", updatedAt: "" },
    reconciled: result.reconciled,
    ...(result.duplicate ? { duplicate: true } : {}),
  }, { status: result.reconciled ? 200 : 202 });
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("", "invalid_body", 400);
  }

  const parsed = parseClaimCommand(rawBody);
  if ("error" in parsed) {
    const operationId = typeof rawBody === "object" && rawBody !== null && "operationId" in rawBody &&
      typeof (rawBody as Record<string, unknown>).operationId === "string"
      ? (rawBody as Record<string, unknown>).operationId as string
      : "";
    return errorResponse(operationId, parsed.error, statusForReason(parsed.error));
  }

  const auth = await authenticate(
    request,
    parsed.action,
    parsed.memberName,
    parsed.pin,
  );
  if (!auth.ok) {
    return errorResponse(parsed.operationId, auth.reason, auth.status, parsed.action);
  }

  ensureTaskClaimHandlersRegistered();
  const internal = await executeInternalTaskCommand(
    {
      operationId: parsed.operationId,
      kind: parsed.action,
      actor: auth.actor,
      payload: taskClaimInternalPayload(parsed),
    },
    { source: "server" },
  );
  const result = internal as ClaimServiceResult;
  if (!result.ok) {
    const reason = normalizeRegistryReason(result.reason);
    return errorResponse(
      result.operationId || parsed.operationId,
      reason,
      statusForReason(reason),
      parsed.action,
      result.claimedBy,
    );
  }
  return successResponse({ ...result, operationId: parsed.operationId, action: parsed.action });
}
