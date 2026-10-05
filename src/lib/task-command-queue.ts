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

export { onTaskOutboxAdopted } from "@/lib/task-operation-outbox";
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
  try {
    return enqueueTaskOperation({
      operationId,
      route: input.route,
      action: input.action,
      payload: input.payload,
      displayTarget: input.displayTarget,
    });
  } catch (error) {
    // The entry never exists, so nothing would ever evict this credential and
    // nothing would ever release it — a PIN in memory keyed to an id with no
    // record, which is exactly the leak `releaseEvictedCredentials` exists to
    // prevent. The remembered credential is only safe once the enqueue that
    // justifies it has landed.
    forgetTaskCommandCredential(operationId);
    throw error;
  }
}

// The persist-then-send seam for callers that do not mount the hook (the
// Settings config editors and the chat action runner): the command is durable
// before the first request, and a flush is requested so a live page does not
// wait for the next 60s CacheRefresher tick. The mount / interval /
// visibility flushes remain the durability backstop when the send fails.
export function queueTaskCommandAndFlush(input: QueueTaskCommandInput): TaskOutboxEntry {
  const entry = queueTaskCommand(input);
  // Drain on the next macrotask rather than inline: the caller is usually a
  // click handler inside an act() scope, and an inline flush would resolve
  // before React has finished committing the enqueue.
  scheduleFlush();
  return entry;
}

let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled || typeof queueMicrotask !== "function") {
    if (flushScheduled) return;
    void requestTaskOutboxFlush().catch(() => {});
    return;
  }
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void requestTaskOutboxFlush().catch(() => {});
  });
}
