/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";

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

export function useMorningBriefing() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/consuela/briefing", { cache: "no-store" });
      const json = await res.json();
      setBriefing(json?.briefing ?? null);
    } catch {
      // keep last-known briefing so the card doesn't flicker when PB blips
    } finally {
      setLoading(false);
    }
  }, []);

  const ack = useCallback(
    async (id: string) => {
      try {
        await fetch("/api/consuela/briefing", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
      } catch {
        // fall through to refresh; PATCH failure surfaces on the next poll
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { briefing, loading, ack };
}
