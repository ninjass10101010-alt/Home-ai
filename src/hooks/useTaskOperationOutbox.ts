"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isRecord } from "@/lib/task-operation-contract";
import {
  adoptServerWeekData,
  applyTasksSnapshotToStores,
  loadTasks,
  loadWeekData,
  mergeTasksSnapshot,
  saveTasks,
  saveWeekData,
} from "@/lib/task-utils";
import {
  cancelTaskOutboxEntry,
  pullTaskSnapshotDocument,
  getTaskOutboxServerSnapshot,
  getTaskOutboxSnapshot,
  registerTaskOutboxDriver,
  requestTaskOutboxFlush,
  subscribeTaskOutbox,
  type FlushTaskOutboxResult,
  type SnapshotRead,
  type TaskOutboxAcknowledgement,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";

export interface UseTaskOperationOutboxOptions {
  getCredential?: (entry: TaskOutboxEntry) => string | undefined;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
  pullSnapshot?: () => Promise<SnapshotRead>;
  autoFlush?: boolean;
}

export interface UseTaskOperationOutboxResult {
  entries: TaskOutboxEntry[];
  pending: number;
  queued: number;
  reconciling: number;
  authRequired: number;
  failed: number;
  flush: () => Promise<FlushTaskOutboxResult>;
  cancel: (operationId: string) => boolean;
}

export async function pullAdoptedTaskSnapshot(): Promise<SnapshotRead> {
  const read = await pullTaskSnapshotDocument();
  if (read.snapshot) applyTasksSnapshotToStores(read.snapshot);
  return read;
}

export function adoptAuthoritativeAcknowledgement(acknowledgement: TaskOutboxAcknowledgement): void {
  if (acknowledgement.task) {
    const merged = mergeTasksSnapshot(loadTasks(), loadWeekData(), {
      tasks: [acknowledgement.task],
    });
    if (merged.tasksChanged) saveTasks(merged.tasks);
    if (merged.weekChanged) saveWeekData(merged.weekData);
  }
  if (acknowledgement.weekData) {
    saveWeekData(adoptServerWeekData(loadWeekData(), acknowledgement.weekData));
  }
}

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
  }, [options]);

  useEffect(() => {
    const unregister = registerTaskOutboxDriver({
      getCredential: (entry) => optionsRef.current.getCredential?.(entry),
      pullSnapshot: () => {
        const override = optionsRef.current.pullSnapshot;
        return override ? override() : pullAdoptedTaskSnapshot();
      },
      onAcknowledged: (acknowledgement) =>
        (optionsRef.current.onAcknowledged ?? adoptAuthoritativeAcknowledgement)(acknowledgement),
    });
    return unregister;
  }, []);

  useEffect(() => {
    if (autoFlush) void requestTaskOutboxFlush();
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
    };
  }, [entries, flush, cancel]);
}
