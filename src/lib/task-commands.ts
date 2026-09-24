import type { SnapshotRevision } from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";
import {
  hasForbiddenTaskCommandPayloadKey,
  hasValidInternalTaskCommandShape,
  INTERNAL_TASK_COMMAND_KINDS,
  INTERNAL_TASK_COMMAND_SOURCES,
  isInternalTaskCommandKind,
} from "@/lib/task-operation-contract";

export type InternalTaskCommandKind = (typeof INTERNAL_TASK_COMMAND_KINDS)[number];

export interface InternalTaskCommandActor {
  memberId: string;
  name: string;
  role: string;
}

export interface InternalTaskCommand {
  operationId: string;
  kind: InternalTaskCommandKind;
  actor: InternalTaskCommandActor;
  payload: Record<string, unknown>;
}

export interface InternalTaskCommandContext {
  source: (typeof INTERNAL_TASK_COMMAND_SOURCES)[number];
}

export interface InternalTaskCommandResult {
  ok: boolean;
  operationId: string;
  task?: Task;
  weekData?: WeekData;
  revision?: SnapshotRevision;
  reason?: string;
  reconciled: boolean;
  paid?: number;
  cleared?: number;
  skipped?: number;
}

export type InternalTaskCommandHandler = (
  command: InternalTaskCommand,
  context: InternalTaskCommandContext,
) => Promise<InternalTaskCommandResult>;

const handlers = new Map<InternalTaskCommandKind, InternalTaskCommandHandler>();

export function registerInternalTaskCommandHandler(
  kind: InternalTaskCommandKind,
  handler: InternalTaskCommandHandler,
): () => void {
  if (!isInternalTaskCommandKind(kind)) throw new TypeError("invalid_task_command_kind");
  if (typeof handler !== "function") throw new TypeError("invalid_task_command_handler");
  handlers.set(kind, handler);
  return () => {
    if (handlers.get(kind) === handler) handlers.delete(kind);
  };
}

export async function executeInternalTaskCommand(
  command: InternalTaskCommand,
  context: InternalTaskCommandContext,
): Promise<InternalTaskCommandResult> {
  const operationId =
    typeof command?.operationId === "string" ? command.operationId : "";

  if (!hasValidInternalTaskCommandShape(command, context)) {
    return {
      ok: false,
      operationId,
      reason: "invalid_task_command",
      reconciled: false,
    };
  }

  if (hasForbiddenTaskCommandPayloadKey(command.payload)) {
    return {
      ok: false,
      operationId,
      reason: "forbidden_task_command_payload",
      reconciled: false,
    };
  }

  const handler = handlers.get(command.kind);
  if (!handler) {
    return {
      ok: false,
      operationId,
      reason: "unsupported_task_command",
      reconciled: false,
    };
  }

  try {
    return await handler(command, context);
  } catch {
    return {
      ok: false,
      operationId,
      reason: "task_command_handler_failed",
      reconciled: false,
    };
  }
}
