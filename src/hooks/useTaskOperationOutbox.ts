"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  adoptTaskOutboxAcknowledgement,
  adoptTaskOutboxSnapshot,
  cancelTaskOutboxEntry,
  getTaskOutboxServerSnapshot,
  getTaskOutboxSnapshot,
  pullTaskSnapshotDocument,
  registerTaskOutboxDriver,
  requestTaskOutboxFlush,
  resolveTaskOutboxCredential,
  onTaskOutboxAcknowledged,
  subscribeTaskOutbox,
  type FlushTaskOutboxResult,
  type SnapshotRead,
  type TaskOutboxAcknowledgement,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";

export interface UseTaskOperationOutboxOptions {
  getCredential?: (entry: TaskOutboxEntry) => string | undefined;
  pullSnapshot?: () => Promise<SnapshotRead>;
  adoptSnapshot?: (read: SnapshotRead) => void | Promise<void>;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
  autoFlush?: boolean;
}

export interface UseTaskOperationOutboxResult {
  entries: TaskOutboxEntry[];
  onAcknowledged: (listener: (acknowledgement: { operationId?: string }) => void) => () => void;
  pending: number;
  queued: number;
  reconciling: number;
  authRequired: number;
  failed: number;
  flush: () => Promise<FlushTaskOutboxResult>;
  cancel: (operationId: string) => boolean;
}

export { adoptTaskOutboxAcknowledgement, adoptTaskOutboxSnapshot };

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
      getCredential: (entry) =>
        optionsRef.current.getCredential?.(entry) ?? resolveTaskOutboxCredential(entry),
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
    (listener: (acknowledgement: { operationId?: string }) => void) => onTaskOutboxAcknowledged(listener),
    [],
  );

  return useMemo<UseTaskOperationOutboxResult>(() => {
    const reconciling = entries.filter((entry) => entry.status === "reconciling").length;
    const authRequired = entries.filter((entry) => entry.status === "auth-required").length;
    const failed = entries.filter((entry) => entry.status === "failed").length;
    return {
      entries,
      pending: entries.length,
      queued: entries.length - reconciling - authRequired - failed,
      reconciling,
      authRequired,
      failed,
      flush,
      cancel,
      onAcknowledged,
    };
  }, [entries, flush, cancel, onAcknowledged]);
}
