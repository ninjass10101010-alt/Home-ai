"use client";

import { useEffect, useRef } from "react";

export interface GoogleSyncResult {
  ok: boolean;
  calendar?: { events: number; deleted: number };
  tasks?: { tasks: number; deleted: number };
  error?: string;
  code?: string;
}

interface UseGoogleSyncOptions {
  intervalMs?: number;
  enabled?: boolean;
  onResult?: (result: GoogleSyncResult) => void;
  onError?: (err: Error) => void;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export function useGoogleSync({
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
  onResult,
  onError,
}: UseGoogleSyncOptions = {}) {
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  });

  const triggerRef = useRef<() => Promise<GoogleSyncResult | null>>(async () => null);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        triggerRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        triggerRef.current();
      }
    }, intervalMs);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);

  useEffect(() => {
    triggerRef.current = async (): Promise<GoogleSyncResult | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/google/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: "all" }),
        });
        const data: GoogleSyncResult = await res.json().catch(() => ({ ok: false, error: "Bad JSON" }));
        if (!mountedRef.current) return data;
        if (data.ok) onResultRef.current?.(data);
        else onErrorRef.current?.(new Error(data.error || "Sync failed"));
        return data;
      } catch (e: any) {
        if (!mountedRef.current) return null;
        onErrorRef.current?.(e instanceof Error ? e : new Error(String(e)));
        return null;
      } finally {
        inFlightRef.current = false;
      }
    };
  });

  return {
    syncNow: async () => triggerRef.current(),
  };
}
