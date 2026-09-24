import { NextRequest, NextResponse } from "next/server";
import { getLiveMemberById } from "@/lib/live-member";
import { verifyPinFromPB } from "@/lib/server-auth";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import {
  ensureTaskApprovalHandlersRegistered,
  parseApproveCommand,
  taskApprovalInternalPayload,
  type ApprovalFailureReason,
  type ApprovalServiceResult,
  type ApproveAction,
} from "@/lib/task-approval";

export const dynamic = "force-dynamic";

function statusForReason(reason: string | undefined): number {
  if (reason === "unauthorized") return 401;
  if (reason === "adult_only") return 403;
  if (reason === "unknown_task") return 404;
  if (
    reason === "ambiguous_task" ||
    reason === "operation_conflict" ||
    reason === "semantic_duplicate"
  ) return 409;
  if (reason === "invalid_task_state") return 400;
  if (
    reason === "member_roster_unavailable" ||
    reason === "ledger_unavailable" ||
    reason === "snapshot_write_failed" ||
    reason === "task_store_unavailable"
  ) return 503;
  return 400;
}

function errorResponse(
  operationId: string,
  reason: string,
  status: number,
  action?: ApproveAction,
) {
  const publicReason = reason === "unknown_task" ? "unknown-task" : reason;
  const retryable = reason === "task_store_unavailable" ||
    reason === "member_roster_unavailable" ||
    reason === "ledger_unavailable" ||
    reason === "snapshot_write_failed";
  return NextResponse.json({
    success: false,
    operationId,
    ...(action ? { action } : {}),
    reason: publicReason,
    error: publicReason,
    code: reason,
    ...(retryable ? { retryable: true } : {}),
    ...(reason === "semantic_duplicate" ? { duplicate: true, semanticDuplicate: true } : {}),
  }, { status });
}

function rawOperationId(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const value = (body as Record<string, unknown>).operationId;
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("", "invalid_body", 400);
  }

  const parsed = parseApproveCommand(body);
  if ("error" in parsed) {
    return errorResponse(rawOperationId(body), parsed.error, statusForReason(parsed.error));
  }

  let verified: unknown;
  try {
    verified = await verifyPinFromPB(parsed.memberName, parsed.pin);
  } catch {
    return errorResponse(parsed.operationId, "member_roster_unavailable", 503, parsed.action);
  }
  const verifiedId = verified && typeof verified === "object" && !Array.isArray(verified) &&
    typeof (verified as Record<string, unknown>).id === "string"
    ? (verified as Record<string, string>).id.trim()
    : "";
  if (!verified || !verifiedId) {
    return errorResponse(parsed.operationId, "unauthorized", 401, parsed.action);
  }

  let live: Awaited<ReturnType<typeof getLiveMemberById>>;
  try {
    live = await getLiveMemberById(verifiedId);
  } catch {
    return errorResponse(parsed.operationId, "member_roster_unavailable", 503, parsed.action);
  }
  if (!live) {
    return errorResponse(parsed.operationId, "unauthorized", 401, parsed.action);
  }
  if (live.role !== "parent") {
    return errorResponse(parsed.operationId, "adult_only", 403, parsed.action);
  }

  ensureTaskApprovalHandlersRegistered();
  let internal: Awaited<ReturnType<typeof executeInternalTaskCommand>>;
  try {
    internal = await executeInternalTaskCommand(
      {
        operationId: parsed.operationId,
        kind: parsed.action,
        actor: {
          memberId: live.id,
          name: live.name,
          role: live.role,
        },
        payload: taskApprovalInternalPayload(parsed),
      },
      { source: "server" },
    );
  } catch {
    return errorResponse(parsed.operationId, "task_store_unavailable", 503, parsed.action);
  }
  const result = internal as unknown as ApprovalServiceResult;
  if (!result.ok) {
    const rawReason: string = result.reason ?? "task_store_unavailable";
    const reason = (
      rawReason === "task_command_handler_failed" || rawReason === "unsupported_task_command"
        ? "task_store_unavailable"
        : rawReason
    ) as ApprovalFailureReason;
    return errorResponse(result.operationId || parsed.operationId, reason, statusForReason(reason), parsed.action);
  }

  return NextResponse.json({
    success: true,
    operationId: result.operationId,
    action: result.action,
    weekData: result.weekData,
    paid: result.paid,
    cleared: result.cleared,
    skipped: result.skipped,
    reconciled: result.reconciled,
    repairRequired: result.repairRequired,
    ...(result.projectionFailures?.length ? { projectionFailures: result.projectionFailures } : {}),
    ...(result.duplicate ? { duplicate: true } : {}),
    ...(result.task !== undefined ? { task: result.task } : {}),
    ...(result.noCurrentTask ? { noCurrentTask: true } : {}),
  }, { status: result.reconciled ? 200 : 202 });
}
