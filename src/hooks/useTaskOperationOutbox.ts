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
  createFetchTaskOutboxDriver,
  getTaskOutboxServerSnapshot,
  getTaskOutboxSnapshot,
  requestTaskOutboxFlush,
  setTaskOutboxDriver,
  subscribeTaskOutbox,
  type FlushTaskOutboxResult,
  type SnapshotRead,
  type TaskOutboxAcknowledgement,
  type TaskOutboxEntry,
} from "@/lib/task-operation-outbox";

export interface UseTaskOperationOutboxOptions {
  getCredential?: (entry: TaskOutboxEntry) => string | undefined;
  onAcknowledged?: (acknowledgement: TaskOutboxAcknowledgement) => void | Promise<void>;
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

async function pullAuthoritativeSnapshot(): Promise<SnapshotRead> {
  const response = await fetch("/api/tasks/sync", { cache: "no-store" });
  if (!response.ok) throw new Error(`tasks_sync_${response.status}`);
  const body = await response.json().catch(() => ({}));
  const record = isRecord(body) ? body : {};
  const snapshot = isRecord(record.snapshot) ? record.snapshot : null;
  if (snapshot) applyTasksSnapshotToStores(snapshot);
  return { snapshot, reconciled: record.reconciled === true };
}

function adoptAuthoritativeAcknowledgement(acknowledgement: TaskOutboxAcknowledgement): void {
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
    setTaskOutboxDriver(
      createFetchTaskOutboxDriver({
        getCredential: (entry) => optionsRef.current.getCredential?.(entry),
        pullSnapshot: pullAuthoritativeSnapshot,
        onAcknowledged: (acknowledgement) =>
          (optionsRef.current.onAcknowledged ?? adoptAuthoritativeAcknowledgement)(acknowledgement),
      }),
    );
    return () => setTaskOutboxDriver(null);
  }, []);

  useEffect(() => {
    if (autoFlush) void requestTaskOutboxFlush();
    const onOnline = () => {
      void requestTaskOutboxFlush();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestTaskOutboxFlush();
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
