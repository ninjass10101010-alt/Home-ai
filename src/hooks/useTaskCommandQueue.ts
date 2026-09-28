"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { queueTaskCommand, type QueueTaskCommandInput } from "@/lib/task-command-queue";
import { useTaskOperationOutbox } from "@/hooks/useTaskOperationOutbox";
import type { FlushTaskOutboxResult, TaskOutboxEntry } from "@/lib/task-operation-outbox";

export interface UseTaskCommandQueueOptions {
  onAdopted?: () => void;
  autoFlush?: boolean;
}

export interface TaskCommandCounts {
  pending: number;
  queued: number;
  reconciling: number;
  authRequired: number;
  failed: number;
}

export type TaskOutboxAcknowledgementListener = (acknowledgement: { operationId?: string }) => void;

export interface TaskCommandQueue {
  queue: (input: QueueTaskCommandInput) => TaskOutboxEntry;
  entries: TaskOutboxEntry[];
  counts: TaskCommandCounts;
  flush: () => Promise<FlushTaskOutboxResult>;
  cancel: (operationId: string) => boolean;
  onAcknowledged: (listener: TaskOutboxAcknowledgementListener) => () => void;
}

export function useTaskCommandQueue(
  options: UseTaskCommandQueueOptions = {},
): TaskCommandQueue {
  const onAdoptedRef = useRef(options.onAdopted);
  useEffect(() => {
    onAdoptedRef.current = options.onAdopted;
  });

  const {
    entries,
    pending,
    queued,
    reconciling,
    authRequired,
    failed,
    flush,
    cancel,
    onAcknowledged,
  } = useTaskOperationOutbox({ autoFlush: options.autoFlush });

  const runFlush = useCallback(async () => {
    const result = await flush();
    if (result.acknowledged > 0) onAdoptedRef.current?.();
    return result;
  }, [flush]);

  const queue = useCallback(
    (input: QueueTaskCommandInput) => {
      const entry = queueTaskCommand(input);
      void runFlush().catch(() => {});
      return entry;
    },
    [runFlush],
  );

  return useMemo(
    () => ({
      queue,
      entries,
      counts: { pending, queued, reconciling, authRequired, failed },
      flush: runFlush,
      cancel,
      onAcknowledged,
    }),
    [
      queue,
      entries,
      pending,
      queued,
      reconciling,
      authRequired,
      failed,
      runFlush,
      cancel,
      onAcknowledged,
    ],
  );
}
