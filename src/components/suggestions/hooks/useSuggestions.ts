/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import type { ProactiveSuggestion, SuggestionStatus } from "@/lib/consuela/types";
import { useAuth } from "@/hooks/useAuth";

const REFRESH_INTERVAL_MS = 60_000;

// C3 — the suggestions write routes (PATCH + POST /act) require the session
// PIN. The PIN is forwarded from the useAuth context (in-memory only, never
// persisted to localStorage).
export const PIN_HEADER = "x-consuela-pin";

export const VIEW_TOOLS = ["get_pending_tasks", "get_weekly_meals", "open_calendar"];

function actionMessage(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  if (Array.isArray(r.items) && (r.items as Array<Record<string, unknown>>).length > 0) {
    const names = (r.items as Array<Record<string, unknown>>)
      .map((i) => String(i.name || i.title || ""))
      .filter(Boolean)
      .join(", ");
    if (names) return `Added ${names} to grocery`;
  }
  if (typeof r.note === "string" && r.note) return r.note;
  return "Done";
}

export async function actSuggestion(id: string, pin?: string): Promise<{ ok: boolean; message: string; result?: unknown }> {
  try {
    const r = await fetch("/api/consuela/suggestions/act", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(pin ? { [PIN_HEADER]: pin } : {}) },
      body: JSON.stringify({ id }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) return { ok: false, message: data.error || "Action failed" };
    return { ok: true, message: actionMessage(data.result), result: data.result };
  } catch {
    return { ok: false, message: "Could not reach the dashboard" };
  }
}

export function useSuggestions(limit = 20) {
  const [items, setItems] = useState<ProactiveSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const pin = currentUser?.pin;

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
      headers: { "Content-Type": "application/json", ...(pin ? { [PIN_HEADER]: pin } : {}) },
      body: JSON.stringify({ id, ...body }),
    });
    await refresh();
  };

  const dismiss = (id: string) => patch(id, { status: "dismissed" as SuggestionStatus });

  const snooze = (id: string, untilISO?: string) =>
    patch(id, { snoozedUntil: untilISO ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);
  return { items, loading, refresh, patch, dismiss, snooze };
}
