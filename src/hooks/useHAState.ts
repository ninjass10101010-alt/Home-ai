"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
}

const POLL_INTERVAL_MS = 60_000;
const MIN_REFETCH_GAP_MS = 5_000;
const GRACE_REFETCH_MS = 1_800;

// ---- Module-level shared store: ONE fetcher/poller serves every consumer. ----
// Multiple widgets call useHAState(); without this each instance would run its
// own interval and hammer /api/ha/sync N times per minute.
let sharedStates: HAState[] = [];
let sharedError: string | null = null;
let sharedLoaded = false; // false until the first fetch settles
let lastFetchAt = 0;
let fetchInFlight = false;

const subscribers = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityListenerAttached = false;

function notifySubscribers(): void {
  for (const fn of Array.from(subscribers)) {
    try {
      fn();
    } catch {
      /* one bad subscriber must not break the rest */
    }
  }
}

async function fetchStates(force = false): Promise<void> {
  if (fetchInFlight) return;
  if (!force && Date.now() - lastFetchAt < MIN_REFETCH_GAP_MS) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  fetchInFlight = true;
  try {
    const res = await fetch("/api/ha/sync", { method: "POST" });
    const data: unknown = await res.json().catch(() => null);
    const body = data as { success?: boolean; states?: unknown; error?: string } | null;
    if (!res.ok || !body || body.success !== true) {
      sharedError = body?.error || "Home Assistant sync failed";
    } else {
      sharedStates = Array.isArray(body.states) ? (body.states as HAState[]) : [];
      sharedError = null;
    }
  } catch (e) {
    sharedError = e instanceof Error ? e.message : String(e);
  } finally {
    fetchInFlight = false;
    lastFetchAt = Date.now();
    sharedLoaded = true;
    notifySubscribers();
  }
}

function handleVisibilityChange(): void {
  // Paused while hidden; catch up immediately on return.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    void fetchStates(true);
  }
}

function ensureStoreLoop(): void {
  if (typeof window === "undefined") return;
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void fetchStates();
  }, POLL_INTERVAL_MS);
  if (!visibilityListenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }
}

function teardownStoreLoopIfIdle(): void {
  if (subscribers.size > 0) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (visibilityListenerAttached && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = false;
  }
}

/** Refetch shortly after a control action so late-arriving HA state settles
 * over the optimistic gap instead of flashing stale values back. */
export function scheduleHARerefetch(delayMs = GRACE_REFETCH_MS): void {
  setTimeout(() => {
    void fetchStates(true);
  }, delayMs);
}

/** Test-only: reset the module-level shared store between tests. */
export function _resetHAStateForTests(): void {
  sharedStates = [];
  sharedError = null;
  sharedLoaded = false;
  lastFetchAt = 0;
  fetchInFlight = false;
}

/** Live Home Assistant entity states. All consumers share one poller that
 * runs every 60s while at least one consumer is mounted, pauses when the tab
 * is hidden, and refetches on visibility change. Never throws — failures land
 * in `error` (previous states are kept). */
export function useHAState(): {
  states: HAState[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [, bump] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    subscribers.add(bump);
    ensureStoreLoop();
    void fetchStates();
    return () => {
      subscribers.delete(bump);
      teardownStoreLoopIfIdle();
    };
  }, [bump]);

  const refresh = useCallback(() => fetchStates(true), []);

  return { states: sharedStates, loading: !sharedLoaded, error: sharedError, refresh };
}

/** Home Assistant service calls via POST /api/ha/call-service.
 * Returns true when the route reports success. Schedules a grace refetch so
 * the UI converges even when HA's own state event lands after our refresh. */
export function useHACall(): {
  calling: boolean;
  callService: (domain: string, service: string, serviceData?: Record<string, unknown>) => Promise<boolean>;
} {
  const [calling, setCalling] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const callService = useCallback(
    async (domain: string, service: string, serviceData?: Record<string, unknown>): Promise<boolean> => {
      setCalling(true);
      try {
        const res = await fetch("/api/ha/call-service", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, service, serviceData }),
        });
        const data: unknown = await res.json().catch(() => null);
        const body = data as { success?: boolean } | null;
        const ok = Boolean(body && body.success === true);
        if (ok) scheduleHARerefetch();
        return ok;
      } catch {
        return false;
      } finally {
        if (mountedRef.current) setCalling(false);
      }
    },
    []
  );

  return { calling, callService };
}

/** Entities whose id starts with the given domain (first segment before "."). */
export function entitiesByDomain(states: HAState[], domain: string): HAState[] {
  const prefix = `${domain}.`;
  return states.filter((s) => s.entity_id.startsWith(prefix));
}

/** `attributes.friendly_name` when it is a string, otherwise the entity id. */
export function entityFriendlyName(e: HAState): string {
  const name = e.attributes?.friendly_name;
  return typeof name === "string" && name.length > 0 ? name : e.entity_id;
}
