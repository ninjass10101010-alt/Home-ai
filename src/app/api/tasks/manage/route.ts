import { NextRequest, NextResponse } from "next/server";
import { executeInternalTaskCommand } from "@/lib/task-commands";
import { verifyLiveParentSession } from "@/lib/live-member";
import {
  parseManageTaskCommand,
  ensureTaskManageHandlersRegistered,
  taskManageInternalPayload,
  type TaskManageErrorCode,
} from "@/lib/task-manage";

export const dynamic = "force-dynamic";

function statusForReason(reason: string | undefined): number {
  if (reason === "adult_only") return 403;
  if (reason === "unknown_task") return 404;
  if (reason === "operation_conflict") return 409;
  if (reason === "member_roster_unavailable" || reason === "snapshot_write_failed" || reason === "task_store_unavailable") return 503;
  return 400;
}

function errorForReason(reason: string | undefined): TaskManageErrorCode | string {
  if (reason === "forbidden_task_command_payload") return "forbidden_task_field";
  if (reason === "task_command_handler_failed") return "task_store_unavailable";
  return reason ?? "invalid_task_command";
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
    return NextResponse.json({ error: "invalid_task_command" }, { status: 400 });
  }

  const command = parseManageTaskCommand(body);
  if ("error" in command) {
    return NextResponse.json({ error: command.error }, { status: 400 });
  }

  ensureTaskManageHandlersRegistered();
  const result = await executeInternalTaskCommand(
    {
      operationId: command.operationId,
      kind: command.action,
      actor: {
        memberId: auth.member.id,
        name: auth.member.name,
        role: auth.member.role,
      },
      payload: taskManageInternalPayload(command),
    },
    { source: "server" },
  );

  if (!result.ok) {
    const reason = errorForReason(result.reason);
    return NextResponse.json({ error: reason }, { status: statusForReason(reason) });
  }

  const revision = result.revision ?? { revision: "0", updatedAt: "" };
  return NextResponse.json(
    {
      success: true,
      operationId: result.operationId,
      action: command.action,
      task: result.task ?? null,
      revision,
      updatedAt: revision.updatedAt,
      reconciled: result.reconciled,
      ...(result.duplicate ? { duplicate: true } : {}),
      ...(result.deleted || command.action === "delete" ? { deleted: true } : {}),
      ...(result.noCurrentTask ? { noCurrentTask: true } : {}),
    },
    { status: result.reconciled ? 200 : 202 },
  );
}
