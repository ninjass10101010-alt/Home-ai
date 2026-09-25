import { NextRequest, NextResponse } from "next/server";
import { getLiveMemberById } from "@/lib/live-member";
import { verifyPinFromPB } from "@/lib/server-auth";
import {
  executeLedgerCommand,
  parseLedgerCommand,
  type LedgerCommandAction,
  type LedgerFailureReason,
} from "@/lib/task-ledger-command";

export const dynamic = "force-dynamic";

function statusForReason(reason: LedgerFailureReason | string): number {
  if (reason === "unauthorized") return 401;
  if (reason === "adult_only") return 403;
  if (reason === "unknown_member") return 404;
  if (reason === "unknown_penalty") return 404;
  if (reason === "operation_conflict" || reason === "insufficient_balance") return 409;
  if (reason === "invalid_action" || reason === "invalid_body") return 400;
  if (reason === "invalid_task_state") return 400;
  return 503;
}

const RETRYABLE = new Set<LedgerFailureReason>(["ledger_unavailable", "snapshot_write_failed"]);

function errorResponse(
  operationId: string,
  action: LedgerCommandAction | "",
  reason: LedgerFailureReason,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({
    success: false,
    operationId,
    ...(action ? { action } : {}),
    reason,
    error: reason,
    code: reason,
    ...(RETRYABLE.has(reason) ? { retryable: true } : {}),
    ...extra,
  }, { status: statusForReason(reason) });
}

function rawOperationId(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const value = (body as Record<string, unknown>).operationId;
  return typeof value === "string" ? value.trim() : "";
}

function rawAction(body: unknown): LedgerCommandAction | "" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const value = (body as Record<string, unknown>).action;
  return typeof value === "string" && (value === "penalty" || value === "adjust") ? value : "";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("", "", "invalid_body");
  }

  const parsed = parseLedgerCommand(body);
  if (!parsed.ok) {
    return errorResponse(rawOperationId(body), rawAction(body), parsed.reason);
  }

  let verified: unknown;
  try {
    verified = await verifyPinFromPB(parsed.command.memberName, parsed.command.pin);
  } catch {
    return errorResponse(parsed.command.operationId, parsed.command.action, "ledger_unavailable");
  }
  const verifiedId = verified && typeof verified === "object" && !Array.isArray(verified) &&
    typeof (verified as Record<string, unknown>).id === "string"
    ? (verified as Record<string, string>).id.trim()
    : "";
  if (!verified || !verifiedId) {
    return errorResponse(parsed.command.operationId, parsed.command.action, "unauthorized");
  }

  let live: Awaited<ReturnType<typeof getLiveMemberById>>;
  try {
    live = await getLiveMemberById(verifiedId);
  } catch {
    return errorResponse(parsed.command.operationId, parsed.command.action, "ledger_unavailable");
  }
  if (!live) {
    return errorResponse(parsed.command.operationId, parsed.command.action, "unauthorized");
  }
  if (live.role !== "parent") {
    return errorResponse(parsed.command.operationId, parsed.command.action, "adult_only");
  }

  const result = await executeLedgerCommand({
    ...parsed.command,
    memberId: live.id,
  });
  if (!result.ok) {
    return errorResponse(
      result.operationId,
      result.action,
      result.reason ?? "ledger_unavailable",
      { member: result.member || undefined, points: result.points },
    );
  }

  const reconciled = result.reconciled === true;
  return NextResponse.json({
    success: true,
    operationId: result.operationId,
    action: result.action,
    weekData: result.weekData,
    weekStart: result.weekStart,
    member: result.member,
    points: result.points,
    applied: result.applied,
    reconciled,
    repairRequired: !reconciled || result.repairRequired === true,
    ...(reconciled ? {} : { retryable: true }),
    ...(result.duplicate ? { duplicate: true } : {}),
    ...(result.revision ? { revision: result.revision } : {}),
  }, { status: reconciled ? 200 : 202 });
}
