import type { SnapshotRevision, SnapshotTask } from "@/lib/snapshot-tasks";
import type { Task, WeekData } from "@/types/tasks";
import {
  hasForbiddenTaskCommandPayloadKey,
  hasValidInternalTaskCommandShape,
  INTERNAL_TASK_COMMAND_KINDS,
  INTERNAL_TASK_COMMAND_SOURCES,
  isInternalTaskCommandKind,
  normalizeOperationId,
} from "@/lib/task-operation-contract";

export type InternalTaskCommandKind = (typeof INTERNAL_TASK_COMMAND_KINDS)[number];

export interface InternalTaskCommandActor {
  memberId: string;
  name: string;
  role: string;
  /** How the actor proved itself. The claim seam treats an absent value as
   *  "internal"; only a real session/PIN caller may carry the other two. */
  authentication?: "pin" | "session" | "internal";
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
  clearedTasks?: SnapshotTask[];
  skipped?: number;
  duplicate?: boolean;
  deleted?: boolean;
  noCurrentTask?: boolean;
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
  const rawOperationId =
    typeof command?.operationId === "string" ? command.operationId : "";
  const normalizedOperationId = normalizeOperationId(rawOperationId);
  const operationId = rawOperationId.trim();
  const normalizedInput =
    normalizedOperationId && typeof command === "object" && command !== null
      ? command.operationId === normalizedOperationId
        ? command
        : { ...command, operationId: normalizedOperationId }
      : command;

  if (!normalizedOperationId || !hasValidInternalTaskCommandShape(normalizedInput, context)) {
    return {
      ok: false,
      operationId,
      reason: "invalid_task_command",
      reconciled: false,
    };
  }

  if (hasForbiddenTaskCommandPayloadKey(normalizedInput.payload)) {
    return {
      ok: false,
      operationId: normalizedOperationId,
      reason: "forbidden_task_command_payload",
      reconciled: false,
    };
  }

  const handler = handlers.get(normalizedInput.kind);
  if (!handler) {
    return {
      ok: false,
      operationId: normalizedOperationId,
      reason: "unsupported_task_command",
      reconciled: false,
    };
  }

  try {
    const result = await handler(normalizedInput, context);
    return result.operationId === normalizedOperationId
      ? result
      : { ...result, operationId: normalizedOperationId };
  } catch {
    return {
      ok: false,
      operationId: normalizedOperationId,
      reason: "task_command_handler_failed",
      reconciled: false,
    };
  }
}
