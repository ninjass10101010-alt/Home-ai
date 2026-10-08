"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  adoptTaskOutboxAcknowledgement,
  adoptTaskOutboxSnapshot,
  cancelTaskOutboxEntry,
  getTaskOutboxServerSnapshot,
  getTaskOutboxSnapshot,
  onTaskOutboxAcknowledged,
  pullTaskSnapshotDocument,
  registerTaskOutboxDriver,
  requestTaskOutboxFlush,
  subscribeTaskOutbox,
  type FlushTaskOutboxResult,
  type SnapshotRead,
  type TaskOutboxAcknowledgedEvent,
  type TaskOutboxAcknowledgement,
  type TaskOutboxEntry,
} from "@/lib/task-command-store";

export interface UseTaskOperationOutboxOptions {
  /** Kept for call-site compatibility; credentials ride the queueTaskCommand
   * input now, so this option is no longer read. */
  getCredential?: (entry: TaskOutboxEntry) => string | undefined;
  pullSnapshot?: () => Promise<SnapshotRead>;
  adoptSnapshot?: (read: SnapshotRead) => void | Promise<void>;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
  autoFlush?: boolean;
}

export interface UseTaskOperationOutboxResult {
  entries: TaskOutboxEntry[];
  onAcknowledged: (listener: (acknowledgement: TaskOutboxAcknowledgedEvent) => void) => () => void;
  pending: number;
  queued: number;
  /**
   * Entries sitting in a backoff — either the local replay buffer's ladder or
   * the server queue's `nextAttemptAt`. "Sending N changes" and "N waiting to
   * retry" stay different promises.
   */
  retrying: number;
  reconciling: number;
  /** Always 0 in the server-queue world: a wrong PIN fails at tap time now.
   * Kept so count consumers compile and render nothing for it. */
  authRequired: number;
  failed: number;
  flush: () => Promise<FlushTaskOutboxResult>;
  cancel: (operationId: string) => boolean;
}

export { adoptTaskOutboxAcknowledgement, adoptTaskOutboxSnapshot } from "@/lib/task-command-store";
export { pullTaskSnapshotDocument } from "@/lib/task-command-store";

export function useTaskOperationOutbox(
  options: UseTaskOperationOutboxOptions = {},
): UseTaskOperationOutboxResult {
  const { autoFlush = true } = options;
  const optionsRef = useRef(options);
  const entries = useSyncExternalStore(
    subscribeTaskOutbox,
    getTaskOutboxSnapshot,
    getTaskOutboxServerSnapshot,
  );

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const unregister = registerTaskOutboxDriver({
      pullSnapshot: () =>
        optionsRef.current.pullSnapshot
          ? optionsRef.current.pullSnapshot()
          : pullTaskSnapshotDocument(),
      adoptSnapshot: (read) =>
        (optionsRef.current.adoptSnapshot ?? adoptTaskOutboxSnapshot)(read),
      onAcknowledged: (acknowledgement) =>
        (optionsRef.current.onAcknowledged ?? adoptTaskOutboxAcknowledgement)(acknowledgement),
    });
    return unregister;
  }, []);

  useEffect(() => {
    if (autoFlush) void requestTaskOutboxFlush().catch(() => {});
    const onOnline = () => {
      void requestTaskOutboxFlush().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestTaskOutboxFlush().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoFlush]);

  const flush = useCallback(() => requestTaskOutboxFlush(), []);
  const cancel = useCallback((operationId: string) => cancelTaskOutboxEntry(operationId), []);
  const onAcknowledged = useCallback(
    (listener: (acknowledgement: TaskOutboxAcknowledgedEvent) => void) => onTaskOutboxAcknowledged(listener),
    [],
  );

  return useMemo<UseTaskOperationOutboxResult>(() => {
    const reconciling = entries.filter((entry) => entry.status === "reconciling").length;
    const authRequired = entries.filter((entry) => entry.status === "auth-required").length;
    const failed = entries.filter((entry) => entry.status === "failed").length;
    const retrying = entries.filter((entry) => entry.status === "retrying").length;
    return {
      entries,
      pending: entries.length,
      queued: entries.length - reconciling - authRequired - failed,
      retrying,
      reconciling,
      authRequired,
      failed,
      flush,
      cancel,
      onAcknowledged,
    };
  }, [entries, flush, cancel, onAcknowledged]);
}
