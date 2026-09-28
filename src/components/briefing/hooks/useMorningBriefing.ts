/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { localTodayISO } from "@/lib/local-date";
import { classifyReadError, classifyStatus, type ReadFailure } from "@/lib/read-state";

const REFRESH_INTERVAL_MS = 60_000;

export interface BriefingSummary {
  events: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  meals: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
  taskSource?: string;
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

/** The honest statement about the chore list the briefing could not read.
 *  An `unavailable` source means "unknown" — saying nothing would let a shorter
 *  section count read as a calm, quiet day. */
export function briefingTaskSourceNote(briefing: MorningBriefing): string | null {
  const source = briefing.summary?.taskSource;
  if (source === "unavailable") return "❓ Chore list unavailable — Consuela couldn't read it";
  if (source === "pb") return "⚠️ Chores are from a backup copy, not the live list";
  return null;
}

/** True when the card has something to show OR something to admit. */
export function briefingShowsCard(briefing: MorningBriefing): boolean {
  return !briefingSectionsEmpty(briefing) || briefingTaskSourceNote(briefing) !== null;
}

export function useMorningBriefing() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackError, setAckError] = useState(false);
  // Audit P0-4: a failed read used to leave `briefing` null, and the widget
  // renders `null` for a null briefing — so "Consuela is unreachable", "you are
  // signed out" and "there is no briefing today" were all one invisible state.
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  // True while any refresh is in flight — including the 60s auto-heal ticks, so
  // the pill on a failed card shows "Trying…" rather than looking dead.
  const [retrying, setRetrying] = useState(false);
  const scopeDateRef = useRef(localTodayISO());

  // I7 — re-anchor on the local calendar date: recompute at every refresh tick
  // (and on tab visibility change) so the polling switches to the new day's
  // briefing at local midnight, not UTC midnight.
  const refresh = useCallback(async () => {
    const scopeDate = localTodayISO();
    const reanchored = scopeDate !== scopeDateRef.current;
    scopeDateRef.current = scopeDate;
    setRetrying(true);
    try {
      const res = await fetch(`/api/consuela/briefing?scopeDate=${scopeDate}`, { cache: "no-store" });
      if (!res.ok) {
        // Keep the last-known briefing on screen (no flicker) but say why it is stale.
        setFailure(classifyStatus(res.status));
        return;
      }
      const json = await res.json();
      setBriefing(json?.briefing ?? null);
      setFailure(null);
    } catch (err) {
      // keep last-known briefing so the card doesn't flicker when PB blips
      setFailure(classifyReadError(err));
    } finally {
      setLoading(false);
      setRetrying(false);
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

  // `stale` is derived, not stored: the briefing on screen is only stale when a
  // read has failed *and* there is still a briefing under it.
  return { briefing, loading, ack, ackError, failure, stale: failure !== null && briefing !== null, retrying, retry: refresh };
}
