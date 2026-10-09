import { NextRequest, NextResponse } from "next/server";
import { getLiveMemberById, type LiveMember } from "@/lib/live-member";
import { verifyPinFromPB } from "@/lib/server-auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import { enqueueTaskCommandRow } from "@/lib/task-command-queue-server";
import {
  ensureTaskClaimHandlersRegistered,
  parseClaimCommand,
  taskClaimInternalPayload,
  type ClaimActor,
  type ClaimFailureReason,
  type ClaimServiceResult,
} from "@/lib/task-claim";

export const dynamic = "force-dynamic";

// B6: this route is in the middleware's API_EXEMPT list, so no gate runs ahead
// of it and it must bound the body ITSELF, and do so BEFORE it reads —
// otherwise an unauthenticated caller on the LAN can make the server buffer an
// arbitrarily large JSON body before deciding the caller has no PIN, which is a
// memory-exhaustion primitive against a single-container NAS. The declared
// Content-Length is checked first (the cheap, pre-read case) and the ACTUAL byte
// length after the read, because a chunked body may omit or understate the
// header. The reason code is `payload_too_large`, the same as
// `/api/tasks/ledger`, so all three middleware-exempt PIN routes agree.
//
// The VALUE is not the ledger route's 4 KiB, and cannot be: `parseClaimCommand`
// admits an `assigneeEmoji` of up to 400,000 characters (`src/lib/task-claim.ts`
// ) — a base64 photo data-URL for a photo-assignee chore, a real supported
// completion body. A 4 KiB bound would 413 a value the parser documents as
// valid. 1 MiB admits that ceiling with room for astral characters (400,000
// UTF-16 units can be ~800 KB of UTF-8) plus JSON overhead, and is still a hard
// ceiling rather than "whatever the caller sends".
const MAX_BODY_BYTES = 1024 * 1024;

type AuthResult =
  | { ok: true; actor: ClaimActor }
  | { ok: false; status: 400 | 401 | 403 | 413 | 503; reason: string };

// B7: `member_roster_unavailable` is a 503 the client MUST be able to tell from
// a wrong PIN, so the retryable flag is stated explicitly rather than left to
// the status code alone.
const RETRYABLE_REASONS = new Set([
  "member_roster_unavailable",
  "task_store_unavailable",
]);

function errorResponse(
  operationId: string,
  reason: string,
  status: number,
  action?: string,
  claimedBy?: string,
) {
  // B7: `error` is the DISPLAY channel the outbox reads through
  // `serverMessageOf`, and this route was the only PIN command route that left
  // it empty — so a queued claim always rendered a bare reason slug. `code`
  // mirrors the machine reason so a caller reading only that channel is not
  // guessing either. Neither ever carries a PocketBase error string.
  return NextResponse.json({
    success: false,
    operationId,
    ...(action ? { action } : {}),
    reason,
    error: reason,
    code: reason,
    ...(RETRYABLE_REASONS.has(reason) ? { retryable: true } : {}),
    ...(claimedBy ? { claimedBy } : {}),
  }, { status });
}

function statusForReason(reason: ClaimFailureReason | string): number {
  if (reason === "payload_too_large") return 413;
  if (reason === "unknown_task") return 404;
  if (
    reason === "unauthorized" ||
    reason === "pin_required" ||
    reason === "session_required"
  ) return 401;
  if (
    reason === "not_allowed" ||
    reason === "adult_only" ||
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
    reason === "crew_close_not_allowed" ||
    reason === "no_checkins" ||
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
      return { ok: true, actor: liveActor(live, "pin", memberName) };
    } catch {
      return { ok: false, status: 503, reason: "member_roster_unavailable" };
    }
  }

  if (!(["complete", "undo", "crew-join", "crew-checkin"] as string[]).includes(action)) {
    return { ok: false, status: 401, reason: "pin_required" };
  }
  try {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session || typeof session.memberId !== "string" || !session.memberId.trim()) {
      return { ok: false, status: 401, reason: "unauthorized" };
    }
    const live = await getLiveMemberById(session.memberId);
    if (!live) return { ok: false, status: 401, reason: "unauthorized" };
    return { ok: true, actor: liveActor(live, "session", memberName) };
  } catch {
    return { ok: false, status: 503, reason: "member_roster_unavailable" };
  }
}

function liveActor(
  member: LiveMember,
  authentication: "pin" | "session",
  requestedName?: string,
): ClaimActor {
  return {
    memberId: member.id,
    name: member.name,
    role: member.role,
    authentication,
    ...(requestedName ? { requestedName } : {}),
  };
}

// Post-authentication service failures the queue can hold: the actor is
// verified and the command is replayable through the internal claim seam.
// Pre-auth failures (roster/PB unreachable while verifying) are NOT queueable
// — there is no verified identity to authorize a replay.
//
// `ledger_unavailable` / `snapshot_write_failed` are post-auth too, and a
// queued claim that replays later is guarded at drain time by the row's
// `sentBackAt` versus the queue row's `created` (a retraction at or after the
// intent's capture refuses with `already_undone`), so a tap that survived an
// outage can never pay for a completion the child has since taken back.
const QUEUEABLE_REASONS = new Set([
  "task_store_unavailable",
  "member_roster_unavailable",
  "ledger_unavailable",
  "snapshot_write_failed",
]);

function queuedResponse(operationId: string, reason: string, action?: string) {
  // 202 + `queued: true` is the server-queue contract: the command is durable
  // in PocketBase, the drain owns the retry ladder, and any device can watch
  // or cancel it. Distinct from the route's existing 202 (applied, projection
  // pending), which never carries `queued`.
  return NextResponse.json({
    success: false,
    queued: true,
    operationId,
    ...(action ? { action } : {}),
    reason,
    retryable: true,
  }, { status: 202 });
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

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(text);
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
    if (QUEUEABLE_REASONS.has(reason)) {
      let queued = false;
      try {
        queued = await enqueueTaskCommandRow({
          operationId: parsed.operationId,
          route: "/api/tasks/claim",
          action: parsed.action,
          payload: taskClaimInternalPayload(parsed),
          actor: {
            memberId: auth.actor.memberId,
            name: auth.actor.name,
            role: auth.actor.role,
            authentication: auth.actor.authentication === "pin" ? "pin" : "session",
          },
          displayTarget: { kind: "claim", ...(parsed.taskId ? { taskId: parsed.taskId } : {}) },
        });
      } catch {
        queued = false;
      }
      if (queued) return queuedResponse(parsed.operationId, reason, parsed.action);
    }
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
