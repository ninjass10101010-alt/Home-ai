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

// B6: like `/api/tasks/claim`, this route is in the middleware's API_EXEMPT
// list, so no gate runs ahead of it. It must bound the body ITSELF, and BEFORE
// it reads, or an unauthenticated caller can make the server buffer an
// arbitrarily large body before the PIN is checked — a memory-exhaustion
// primitive against a single-container NAS. Declared length first, then the
// ACTUAL byte length of what arrived (a chunked body may omit or understate the
// header). Same value and same reason code as the claim and ledger routes.
const MAX_BODY_BYTES = 4 * 1024;

function statusForReason(reason: string | undefined): number {
  if (reason === "payload_too_large") return 413;
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
  // B7 (kept): the deliberate display/machine split. `reason`/`error` carry the
  // human-facing `unknown-task` while `code` keeps the real `unknown_task`, so
  // the outbox's machine classification reads a slug while the rendered message
  // reads as English.
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
  // Size guard, BEFORE any credential work.
  const oversized = () => errorResponse("", "payload_too_large", 413);
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return oversized();

  let text: string;
  try {
    text = await request.text();
  } catch {
    return errorResponse("", "invalid_body", 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return oversized();

  let body: unknown;
  try {
    body = JSON.parse(text);
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

  const reconciled = result.reconciled === true;
  const projectionFailures = Array.isArray(result.projectionFailures) ? result.projectionFailures : [];
  // B8: a partial projection was returned but read by NO surface — only
  // `skipped` was consumed anywhere. A parent approving 12 chores where 3 fail
  // projection got a 202, the outbox reconciled it silently, and nothing
  // anywhere said those 3 approvals had not reached the kitchen display.
  //
  // `error` is the DISPLAY channel the outbox reads via `serverMessageOf` and
  // persists into `lastErrorMessage`. Deliberately a fixed sentence and NOT a
  // member of `ERROR_CHANNEL_CODE_LIST`: a vocabulary member here would be
  // picked up by `reasonOf` as a machine code and reclassify a 202 that the
  // outbox is supposed to reconcile, not refuse. No task id, no title and no
  // PocketBase string ever reaches a client on this channel — only a count of
  // rows this handler already decided are ids, not names.
  const projectionFailureNotice = !reconciled && projectionFailures.length > 0
    ? `${projectionFailures.length} approval${projectionFailures.length === 1 ? "" : "s"} did not reach the kitchen display yet. Consuela is still retrying.`
    : null;
  return NextResponse.json({
    success: true,
    operationId: result.operationId,
    action: result.action,
    weekData: result.weekData,
    paid: result.paid,
    cleared: result.cleared,
    ...(result.skipped ? { skipped: result.skipped } : {}),
    reconciled,
    repairRequired: !reconciled || result.repairRequired === true,
    ...(reconciled ? {} : { retryable: true }),
    ...(projectionFailureNotice ? { error: projectionFailureNotice } : {}),
    ...(projectionFailures.length ? { projectionFailures } : {}),
    ...(result.duplicate ? { duplicate: true } : {}),
    ...(result.task !== undefined ? { task: result.task } : {}),
    ...(result.noCurrentTask ? { noCurrentTask: true } : {}),
  }, { status: reconciled ? 200 : 202 });
}
