/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import type { ProactiveSuggestion, SuggestionStatus } from "@/lib/consuela/types";

const REFRESH_INTERVAL_MS = 60_000;

export function useSuggestions(limit = 20) {
  const [items, setItems] = useState<ProactiveSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await fetch(`/api/consuela/suggestions?limit=${limit}`).then((r) => r.json());
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/consuela/suggestions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    await refresh();
  };

  const dismiss = (id: string) => patch(id, { status: "dismissed" as SuggestionStatus });

  const snooze = (id: string, untilISO?: string) =>
    patch(id, { status: "snoozed" as SuggestionStatus, snoozedUntil: untilISO ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);
  return { items, loading, refresh, patch, dismiss, snooze };
}
