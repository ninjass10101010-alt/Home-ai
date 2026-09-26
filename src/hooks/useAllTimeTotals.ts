/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AllTimeMemberTotal, AllTimeTotalsPayload } from "@/lib/all-time-totals";

export const ALL_TIME_CACHE_KEY = "consuela-all-time-cache-v1";
export const ALL_TIME_ROUTE = "/api/tasks/all-time";

export type AllTimeReadState = "loading" | "authoritative" | "offline_cache" | "error";

export type AllTimeRead = {
  totals: Record<string, AllTimeMemberTotal>;
  state: AllTimeReadState;
  source: "pocketbase" | "local_cache" | null;
  updatedAt: string | null;
  error: string | null;
};

const INITIAL: AllTimeRead = {
  totals: {},
  state: "loading",
  source: null,
  updatedAt: null,
  error: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTotal(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseAllTimePayload(value: unknown): AllTimeTotalsPayload | null {
  if (!isRecord(value)) return null;
  if (value.source !== "pocketbase") return null;
  if (typeof value.historyComplete !== "boolean") return null;
  if (typeof value.fetchedAt !== "string" || value.fetchedAt.length === 0) return null;
  if (!isRecord(value.totals)) return null;
  const historyComplete = value.historyComplete;
  const totals: Record<string, AllTimeMemberTotal> = {};
  for (const [name, total] of Object.entries(value.totals)) {
    if (name.trim().length === 0 || !isRecord(total)) return null;
    totals[name] = historyComplete
      ? { points: readTotal(total.points), completions: readTotal(total.completions) }
      : { points: null, completions: null };
  }
  return {
    weekStart: typeof value.weekStart === "string" ? value.weekStart : "",
    totals,
    historyComplete,
    source: "pocketbase",
    fetchedAt: value.fetchedAt,
  };
}

function readCache(): AllTimeTotalsPayload | null {
  try {
    const raw = window.localStorage.getItem(ALL_TIME_CACHE_KEY);
    if (!raw) return null;
    return parseAllTimePayload(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeCache(payload: AllTimeTotalsPayload): void {
  try {
    window.localStorage.setItem(ALL_TIME_CACHE_KEY, JSON.stringify(payload));
  } catch {
    return;
  }
}

export function useAllTimeTotals(): AllTimeRead & { refresh: () => Promise<void> } {
  const [read, setRead] = useState<AllTimeRead>(INITIAL);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setRead((prev) =>
      prev.state === "authoritative" || prev.state === "offline_cache"
        ? prev
        : { ...prev, state: "loading", error: null },
    );
    let payload: AllTimeTotalsPayload | null = null;
    let failure: string | null = null;
    let retriable = true;
    try {
      const response = await fetch(ALL_TIME_ROUTE, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json();
        payload = parseAllTimePayload(body);
        if (!payload) failure = "unreadable";
      } else {
        retriable = response.status === 0 || response.status >= 500;
        failure = retriable ? "unreachable" : "refused";
      }
    } catch {
      failure = "unreachable";
    }
    if (!aliveRef.current) return;
    if (payload) {
      writeCache(payload);
      setRead({
        totals: payload.totals,
        state: "authoritative",
        source: "pocketbase",
        updatedAt: payload.fetchedAt,
        error: null,
      });
      return;
    }
    const cached = retriable ? readCache() : null;
    if (cached) {
      setRead({
        totals: cached.totals,
        state: "offline_cache",
        source: "local_cache",
        updatedAt: cached.fetchedAt,
        error: failure,
      });
      return;
    }
    setRead({ totals: {}, state: "error", source: null, updatedAt: null, error: failure });
  }, []);

  useEffect(() => {
    void load();
    const onRefreshed = () => {
      void load();
    };
    window.addEventListener("consuela-data-refreshed", onRefreshed);
    return () => {
      window.removeEventListener("consuela-data-refreshed", onRefreshed);
    };
  }, [load]);

  return { ...read, refresh: load };
}
