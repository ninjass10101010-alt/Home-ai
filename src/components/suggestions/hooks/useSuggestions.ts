/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useRef, useState } from "react";
import type { ProactiveSuggestion, SuggestionStatus } from "@/lib/consuela/types";
import { useAuth } from "@/hooks/useAuth";

const REFRESH_INTERVAL_MS = 60_000;

// C3 — the suggestions write routes (PATCH + POST /act) require the session
// PIN. The PIN is forwarded from the useAuth context (in-memory only, never
// persisted to localStorage). Because the PIN only exists in memory after a
// login(), a reloaded session (or a guest) has no PIN: the hook then surfaces
// needsPin and queues the pending action until submitPin() supplies one.
export const PIN_HEADER = "x-consuela-pin";

export const VIEW_TOOLS = ["get_pending_tasks", "get_weekly_meals", "open_calendar"];

export interface SuggestionActionResult {
  ok: boolean;
  message: string;
  result?: unknown;
  // prompted=true means the action was queued for the PIN modal instead of
  // completing — callers should NOT surface an error toast.
  prompted?: boolean;
}

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

export async function actSuggestion(id: string, pin?: string): Promise<SuggestionActionResult> {
  try {
    const r = await fetch("/api/consuela/suggestions/act", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(pin ? { [PIN_HEADER]: pin } : {}) },
      body: JSON.stringify({ id }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) return { ok: false, message: "pin required", prompted: true };
    if (!r.ok || !data.ok) return { ok: false, message: data.error || "Action failed" };
    return { ok: true, message: actionMessage(data.result), result: data.result };
  } catch {
    return { ok: false, message: "Could not reach the dashboard" };
  }
}

type PendingAction =
  | { type: "patch"; id: string; body: Record<string, unknown> }
  | { type: "act"; id: string };

export function useSuggestions(limit = 20) {
  const [items, setItems] = useState<ProactiveSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsPin, setNeedsPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const { currentUser } = useAuth();

  // In-memory PIN cache: seeded from the auth session (login()), extended by
  // submitPin(). Never persisted. Cleared when the server rejects it (401).
  const pinRef = useRef<string | undefined>(currentUser?.pin);
  const pendingRef = useRef<PendingAction | null>(null);

  useEffect(() => {
    if (currentUser?.pin) pinRef.current = currentUser.pin;
  }, [currentUser?.pin]);

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

  const promptForPin = (action: PendingAction) => {
    pendingRef.current = action;
    setPinError(null);
    setNeedsPin(true);
  };

  const patch = async (
    id: string,
    body: Record<string, unknown>,
    suppliedPin?: string
  ): Promise<SuggestionActionResult> => {
    const pin = suppliedPin !== undefined ? suppliedPin : pinRef.current;
    try {
      const r = await fetch("/api/consuela/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(pin ? { [PIN_HEADER]: pin } : {}) },
        body: JSON.stringify({ id, ...body }),
      });
      if (r.status === 401) {
        if (pin) pinRef.current = undefined; // supplied pin was rejected — re-prompt
        promptForPin({ type: "patch", id, body });
        return { ok: false, message: "pin required", prompted: true };
      }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return { ok: false, message: data.error || "Couldn't save — try again" };
      }
      await refresh();
      return { ok: true, message: "Saved" };
    } catch {
      return { ok: false, message: "Could not reach the dashboard" };
    }
  };

  const dismiss = (id: string) => patch(id, { status: "dismissed" as SuggestionStatus });

  const snooze = (id: string, untilISO?: string) =>
    patch(id, { snoozedUntil: untilISO ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });

  const act = async (
    suggestion: ProactiveSuggestion | { id: string },
    suppliedPin?: string
  ): Promise<SuggestionActionResult> => {
    const pin = suppliedPin !== undefined ? suppliedPin : pinRef.current;
    try {
      const r = await fetch("/api/consuela/suggestions/act", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(pin ? { [PIN_HEADER]: pin } : {}) },
        body: JSON.stringify({ id: suggestion.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) {
        if (pin) pinRef.current = undefined; // supplied pin was rejected — re-prompt
        promptForPin({ type: "act", id: suggestion.id });
        return { ok: false, message: "pin required", prompted: true };
      }
      if (!r.ok || !data.ok) return { ok: false, message: data.error || "Action failed" };
      await refresh();
      return { ok: true, message: actionMessage(data.result), result: data.result };
    } catch {
      return { ok: false, message: "Could not reach the dashboard" };
    }
  };

  // Stores the pin in memory, then retries the queued action. If the server
  // rejects it (401 → wrong pin), the pin is cleared and the modal stays open.
  const submitPin = async (pin: string) => {
    if (!pin) return;
    pinRef.current = pin;
    const action = pendingRef.current;
    pendingRef.current = null;
    setPinError(null);
    let result: SuggestionActionResult | undefined;
    if (action?.type === "patch") {
      result = await patch(action.id, action.body, pin);
    } else if (action?.type === "act") {
      result = await act({ id: action.id }, pin);
    } else {
      setNeedsPin(false);
      return;
    }
    if (result && !result.ok && result.prompted) {
      setPinError("Wrong PIN. Try again.");
      setNeedsPin(true);
      return;
    }
    setNeedsPin(false);
  };

  const cancelPin = () => {
    pendingRef.current = null;
    setPinError(null);
    setNeedsPin(false);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);
  return { items, loading, refresh, patch, dismiss, snooze, act, needsPin, pinError, submitPin, cancelPin };
}
