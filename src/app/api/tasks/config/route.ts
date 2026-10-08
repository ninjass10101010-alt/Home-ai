import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/pb-auth";
import { verifyLiveParentSession } from "@/lib/live-member";
import { enqueueTaskCommandRow } from "@/lib/task-command-queue-server";
import { applyTaskConfigCommand, type ConfigApplyOutcome } from "@/lib/task-config-apply";
import { parseTaskConfigCommand } from "@/lib/task-config";
import { textEmoji } from "@/lib/consuela/live-reads";
import {
  InvalidStoredTaskConfigError,
  InvalidResultingTaskConfigError,
} from "@/lib/snapshot-tasks";

export const dynamic = "force-dynamic";

// The config route's POST body codes (kept for the response shape the client
// vocabulary reads). `config_store_unreachable` is the one queueable failure:
// the parent session is verified and the command replays through the shared
// apply seam, where the config receipts make the replay idempotent.
function queuedResponse(operationId: string, reason: string) {
  return NextResponse.json({
    success: false,
    queued: true,
    operationId,
    reason,
    retryable: true,
  }, { status: 202 });
}

function configCommandPayload(command: {
  operationId: string;
  action: string;
  kind: string;
  updatedAt?: string;
  items?: unknown;
  item?: unknown;
  itemId?: unknown;
}): Record<string, unknown> {
  return {
    operationId: command.operationId,
    action: command.action,
    kind: command.kind,
    ...(command.updatedAt !== undefined ? { updatedAt: command.updatedAt } : {}),
    ...(command.items !== undefined ? { items: command.items } : {}),
    ...(command.item !== undefined ? { item: command.item } : {}),
    ...(command.itemId !== undefined ? { itemId: command.itemId } : {}),
  };
}

export async function POST(request: NextRequest) {
  const auth = await verifyLiveParentSession(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_config_command" }, { status: 400 });
  }

  const command = parseTaskConfigCommand(body, textEmoji);
  if ("error" in command) {
    if (command.error === "config_natural_key_conflict" || command.error === "invalid_resulting_config") {
      return NextResponse.json({
        success: false,
        error: command.error,
        kind: command.kind,
      }, { status: command.error === "config_natural_key_conflict" ? 409 : 422 });
    }
    return NextResponse.json({ error: command.error }, { status: 400 });
  }

  let outcome: ConfigApplyOutcome;
  try {
    outcome = await withAdmin((pb) => applyTaskConfigCommand(pb, command));
  } catch (error) {
    if (error instanceof InvalidStoredTaskConfigError) {
      return NextResponse.json({
        success: false,
        error: "invalid_current_config",
        kind: error.kind,
      }, { status: 422 });
    }
    if (error instanceof InvalidResultingTaskConfigError) {
      return NextResponse.json({
        success: false,
        error: "invalid_resulting_config",
        kind: error.kind,
      }, { status: 422 });
    }
    // The store failed mid-apply: the command is verified and replayable, so
    // it becomes a queue row instead of a lost edit. If even the queue write
    // fails, the honest 502 stands and the client's thin buffer holds it.
    let queued = false;
    try {
      queued = await enqueueTaskCommandRow({
        operationId: command.operationId,
        route: "/api/tasks/config",
        action: command.action,
        payload: configCommandPayload(command),
        actor: {
          memberId: auth.member.id,
          name: auth.member.name,
          role: auth.member.role,
          authentication: "session",
        },
        displayTarget: { kind: "config" },
      });
    } catch {
      queued = false;
    }
    if (queued) return queuedResponse(command.operationId, "config_store_unreachable");
    return NextResponse.json({ error: "config_store_unreachable" }, { status: 502 });
  }
  if ("conflict" in outcome) {
    return NextResponse.json({
      success: false,
      error: "operation_conflict",
      operationId: outcome.operationId,
    }, { status: 409 });
  }
  if ("stale" in outcome) {
    return NextResponse.json(outcome.stale, { status: 409 });
  }
  return NextResponse.json(outcome.response);
}
