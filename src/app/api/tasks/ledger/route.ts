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

// A ledger command is a handful of short fields (operation id, two names, an
// item id, an amount, a <=120 char reason). This route is in the middleware's
// API_EXEMPT list, so no gate runs ahead of it: it must therefore bound the body
// ITSELF, and it must do so BEFORE it reads — otherwise an unauthenticated
// caller can make the server buffer an arbitrarily large body. The declared
// Content-Length is checked first (the cheap, pre-read case) and the ACTUAL byte
// length after the read, because a chunked body may omit or understate the
// header. 4 KiB is ~10x the largest legitimate command.
const MAX_BODY_BYTES = 4 * 1024;

type LedgerRouteReason = LedgerFailureReason | "payload_too_large";

function statusForReason(reason: LedgerRouteReason | string): number {
  if (reason === "unauthorized") return 401;
  if (reason === "adult_only" || reason === "pet_target") return 403;
  if (reason === "unknown_member") return 404;
  if (reason === "unknown_penalty") return 404;
  if (reason === "payload_too_large") return 413;
  if (reason === "operation_conflict" || reason === "insufficient_balance") return 409;
  if (reason === "invalid_action" || reason === "invalid_body") return 400;
  if (reason === "invalid_task_state") return 400;
  return 503;
}

const RETRYABLE = new Set<LedgerRouteReason>([
  "ledger_unavailable",
  "snapshot_write_failed",
  "member_roster_unavailable",
]);

function errorResponse(
  operationId: string,
  action: LedgerCommandAction | "",
  reason: LedgerRouteReason,
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
  // Size guard, BEFORE any credential work: the declared length when the client
  // sent one, then the real byte length of what arrived (a chunked body may omit
  // or understate the header).
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse("", "", "payload_too_large");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return errorResponse("", "", "invalid_body");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return errorResponse("", "", "payload_too_large");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse("", "", "invalid_body");
  }

  const parsed = parseLedgerCommand(body);
  if (!parsed.ok) {
    return errorResponse(rawOperationId(body), rawAction(body), parsed.reason);
  }

  // The ACTOR is whoever presented the PIN. The member whose points move is the
  // command's TARGET (`targetMemberName`, defaulting to the actor) and is
  // resolved from the live roster inside the command — so a parent moving a
  // child's points no longer has to be that child.
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

  // `memberId` is the LIVE actor; the target rides along on the command.
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
