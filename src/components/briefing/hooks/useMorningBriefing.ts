/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { localTodayISO } from "@/lib/local-date";

const REFRESH_INTERVAL_MS = 60_000;

export interface BriefingSummary {
  events: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  meals: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
  generatedAt?: string;
}

export interface MorningBriefing {
  id: string;
  scopeDate: string;
  summary: BriefingSummary | null;
  acknowledged: boolean;
  createdAt?: string;
}

/** True when the briefing has no content at all (no events/tasks/meals/suggestions). */
export function briefingSectionsEmpty(briefing: MorningBriefing): boolean {
  const s = briefing.summary;
  if (!s) return true;
  return (
    (!Array.isArray(s.events) || s.events.length === 0) &&
    (!Array.isArray(s.tasks) || s.tasks.length === 0) &&
    (!Array.isArray(s.meals) || s.meals.length === 0) &&
    (!Array.isArray(s.suggestions) || s.suggestions.length === 0)
  );
}

export function useMorningBriefing() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackError, setAckError] = useState(false);
  const scopeDateRef = useRef(localTodayISO());

  // I7 — re-anchor on the local calendar date: recompute at every refresh tick
  // (and on tab visibility change) so the polling switches to the new day's
  // briefing at local midnight, not UTC midnight.
  const refresh = useCallback(async () => {
    const scopeDate = localTodayISO();
    const reanchored = scopeDate !== scopeDateRef.current;
    scopeDateRef.current = scopeDate;
    try {
      const res = await fetch(`/api/consuela/briefing?scopeDate=${scopeDate}`, { cache: "no-store" });
      const json = await res.json();
      setBriefing(json?.briefing ?? null);
    } catch {
      // keep last-known briefing so the card doesn't flicker when PB blips
    } finally {
      setLoading(false);
      if (reanchored) setAckError(false);
    }
  }, []);

  const ack = useCallback(
    async (id: string): Promise<boolean> => {
      // L4 — optimistic ack: collapse immediately; roll back if PATCH fails.
      setBriefing((prev) => (prev ? { ...prev, acknowledged: true } : prev));
      try {
        const res = await fetch("/api/consuela/briefing", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      } catch {
        setBriefing((prev) => (prev ? { ...prev, acknowledged: false } : prev));
        setAckError(true);
        setTimeout(() => setAckError(false), 4000);
        return false;
      }
      await refresh();
      return true;
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { briefing, loading, ack, ackError };
}
