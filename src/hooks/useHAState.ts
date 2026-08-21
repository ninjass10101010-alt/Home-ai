"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
}

const POLL_INTERVAL_MS = 60_000;

/** Live Home Assistant entity states, refreshed via POST /api/ha/sync on mount
 * and every 60s. Never throws — failures land in `error`. */
export function useHAState(): {
  states: HAState[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [states, setStates] = useState<HAState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/ha/sync", { method: "POST" });
      const data: unknown = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      const body = data as { success?: boolean; states?: unknown; error?: string } | null;
      if (!res.ok || !body || body.success !== true) {
        setError(body?.error || "Home Assistant sync failed");
        return;
      }
      setStates(Array.isArray(body.states) ? (body.states as HAState[]) : []);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(() => {
      refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { states, loading, error, refresh };
}

/** Home Assistant service calls via POST /api/ha/call-service.
 * Returns true when the route reports success. */
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
        return Boolean(body && body.success === true);
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
