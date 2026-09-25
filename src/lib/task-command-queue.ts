"use client";

import {
  createTaskOperationId,
  enqueueTaskOperation,
  requestTaskOutboxFlush,
  forgetTaskCommandCredential,
  listTaskCommandCredentialIds,
  readTaskCommandCredential,
  rememberTaskCommandCredential,
  resolveTaskOutboxCredential,
  type TaskOperationRoute,
  type TaskOutboxCredential,
  type TaskOutboxDisplayTarget,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";

export interface QueueTaskCommandInput {
  operationId?: string;
  route: TaskOperationRoute;
  action: string;
  payload: Record<string, unknown>;
  displayTarget: TaskOutboxDisplayTarget;
  credential?: TaskOutboxCredential;
}

export {
  forgetTaskCommandCredential,
  listTaskCommandCredentialIds,
  readTaskCommandCredential,
  rememberTaskCommandCredential,
  resolveTaskOutboxCredential,
};
export { __resetTaskCommandCredentialsForTests } from "@/lib/task-operation-outbox";
export type { TaskOutboxCredential };

export function queueTaskCommand(input: QueueTaskCommandInput): TaskOutboxEntry {
  const operationId = input.operationId?.trim() || createTaskOperationId();
  rememberTaskCommandCredential(operationId, input.credential);
  return enqueueTaskOperation({
    operationId,
    route: input.route,
    action: input.action,
    payload: input.payload,
    displayTarget: input.displayTarget,
  });
}

// The persist-then-send seam for callers that do not mount the hook (the
// Settings config editors and the chat action runner): the command is durable
// before the first request, and a flush is requested so a live page does not
// wait for the next 60s CacheRefresher tick. The mount / interval /
// visibility flushes remain the durability backstop when the send fails.
export function queueTaskCommandAndFlush(input: QueueTaskCommandInput): TaskOutboxEntry {
  const entry = queueTaskCommand(input);
  void requestTaskOutboxFlush().catch(() => {});
  return entry;
}
