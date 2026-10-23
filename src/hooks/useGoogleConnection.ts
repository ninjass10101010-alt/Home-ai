"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export type ConnectionStatus =
  | "unconnected"
  | "waiting"
  | "connected"
  | "error:denied"
  | "error:expired"
  | "error:revoked"
  | "error:config"
  | "error:unknown";

export type GoogleToolkit = "googlecalendar" | "googletasks";

export interface PublicState {
  connected: boolean;
  account_email: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  scope: string | null;
  minutes_until_expiry: number | null;
}

export interface WaitingState {
  auth_url: string;
  expires_at: number;
  toolkit: GoogleToolkit;
  interval: number;
}

export type DisconnectOutcome = "disconnected" | "local_only" | "failed";

export interface DisconnectResult {
  outcome: DisconnectOutcome;
  remoteRevoked: boolean;
  localRevoked: boolean;
  warning?: string;
  error?: string;
}

const CONSENT_POLL_INTERVAL_MS = 5000;
const CONSENT_FALLBACK_TTL_MS = 10 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isGoogleToolkit(value: unknown): value is GoogleToolkit {
  return value === "googlecalendar" || value === "googletasks";
}

function isGoogleState(value: unknown): value is PublicState {
  if (!isRecord(value) || value.ok !== true || typeof value.connected !== "boolean") return false;
  return isNullableString(value.account_email)
    && isNullableString(value.granted_at)
    && isNullableString(value.revoked_at)
    && isNullableString(value.expires_at)
    && isNullableString(value.scope)
    && (value.minutes_until_expiry === null || (typeof value.minutes_until_expiry === "number" && Number.isFinite(value.minutes_until_expiry)));
}

function isSetupPayload(value: unknown): value is {
  auth_url: string;
  expires_at: string | null;
  toolkit: GoogleToolkit;
} {
  if (!isRecord(value) || value.ok !== true) return false;
  return typeof value.auth_url === "string"
    && value.auth_url.length > 0
    && (value.expires_at === null || typeof value.expires_at === "string")
    && isGoogleToolkit(value.toolkit);
}

function isToolkitStatusPayload(value: unknown): value is {
  connected: boolean;
  status?: string;
  reason?: string;
} {
  if (!isRecord(value) || value.ok !== true || typeof value.connected !== "boolean") return false;
  if (value.status !== undefined && typeof value.status !== "string") return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;
  return true;
}

function isDisconnectPayload(value: unknown): value is DisconnectResult {
  if (!isRecord(value)) return false;
  if (typeof value.remoteRevoked !== "boolean" || typeof value.localRevoked !== "boolean") return false;
  if (value.outcome === "disconnected") {
    return value.remoteRevoked && value.localRevoked;
  }
  if (value.outcome === "local_only") {
    return !value.remoteRevoked
      && value.localRevoked
      && typeof value.warning === "string"
      && value.warning.length > 0;
  }
  if (value.outcome === "failed") {
    return typeof value.error === "string" && value.error.length > 0;
  }
  return false;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function failedDisconnect(error: string): DisconnectResult {
  return { outcome: "failed", remoteRevoked: false, localRevoked: false, error };
}

function parseConsentExpiry(value: string | null): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + CONSENT_FALLBACK_TTL_MS;
}

export function useGoogleConnection() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("unconnected");
  const [statusVersion, setStatusVersion] = useState(0);
  const [state, setState] = useState<PublicState | null>(null);
  const [waiting, setWaiting] = useState<WaitingState | null>(null);
  const [tasksAccountActive, setTasksAccountActive] = useState(false);
  const [errorMessageState, setErrorMessage] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const statusRef = useRef<ConnectionStatus>("unconnected");
  const statusVersionRef = useRef(0);
  const disconnectInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const preWaitingStatusRef = useRef<"connected" | "unconnected">("unconnected");

  const updateStatus = useCallback((next: SetStateAction<ConnectionStatus>) => {
    const resolved = typeof next === "function" ? next(statusRef.current) : next;
    statusRef.current = resolved;
    statusVersionRef.current += 1;
    setStatus(resolved);
    setStatusVersion(statusVersionRef.current);
  }, []);

  const generationIsCurrent = useCallback((candidate: number) => {
    return mountedRef.current && pollGenerationRef.current === candidate;
  }, []);

  const advanceGeneration = useCallback(() => {
    const next = pollGenerationRef.current + 1;
    pollGenerationRef.current = next;
    if (mountedRef.current) setGeneration(next);
    return next;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const invalidatePolling = useCallback(() => {
    advanceGeneration();
    stopPolling();
  }, [advanceGeneration, stopPolling]);

  const readState = useCallback(async (
    requestedGeneration: number,
    requestedStatusVersion: number,
    allowConnected: boolean,
  ): Promise<boolean> => {
    const requestIsCurrent = () => generationIsCurrent(requestedGeneration)
      && statusVersionRef.current === requestedStatusVersion;
    try {
      const res = await fetch("/api/google/state", { cache: "no-store" });
      if (!requestIsCurrent()) return false;
      const data = await res.json() as unknown;
      if (!requestIsCurrent()) return false;
      if (!res.ok) {
        updateStatus("error:unknown");
        setErrorMessage(isRecord(data) && typeof data.error === "string" ? data.error : "Failed to read Google state");
        return false;
      }
      if (!isGoogleState(data)) {
        updateStatus("error:unknown");
        setErrorMessage("Google returned an invalid connection state.");
        return false;
      }
      if (data.connected && !allowConnected) return false;
      setState(data);
      if (data.connected) {
        updateStatus("connected");
        setErrorMessage(null);
      } else if (data.revoked_at) {
        updateStatus("error:revoked");
        setErrorMessage("Connection was revoked. Please reconnect.");
      } else {
        updateStatus("unconnected");
        setErrorMessage(null);
      }
      return true;
    } catch (error: unknown) {
      if (!requestIsCurrent()) return false;
      updateStatus("error:unknown");
      setErrorMessage(errorMessage(error, "Failed to read Google state"));
      return false;
    }
  }, [generationIsCurrent, updateStatus]);

  const refresh = useCallback((): Promise<boolean> => {
    if (disconnectInFlightRef.current || statusRef.current !== "connected") return Promise.resolve(false);
    const requestedGeneration = pollGenerationRef.current;
    const requestedStatusVersion = statusVersionRef.current;
    return readState(requestedGeneration, requestedStatusVersion, true);
  }, [readState]);

  const startPolling = useCallback(
    (toolkit: GoogleToolkit, expiresAt: number, pollGeneration: number) => {
      const pollStatusVersion = statusVersionRef.current;
      const requestIsCurrent = () => generationIsCurrent(pollGeneration)
        && statusVersionRef.current === pollStatusVersion;
      if (!requestIsCurrent()) return;
      stopPolling();
      const tick = async () => {
        if (!requestIsCurrent()) return;
        try {
          const res = await fetch(`/api/google/composio/status?toolkit=${encodeURIComponent(toolkit)}`, {
            cache: "no-store",
          });
          if (!requestIsCurrent()) return;
          const data = await res.json().catch(() => null) as unknown;
          if (!requestIsCurrent()) return;
          if (!res.ok) {
            setWaiting(null);
            updateStatus("error:unknown");
            setErrorMessage(isRecord(data) && typeof data.error === "string" ? data.error : "Status check failed");
            return;
          }
          if (!isToolkitStatusPayload(data)) {
            setWaiting(null);
            updateStatus("error:unknown");
            setErrorMessage("Google returned an invalid connection response.");
            return;
          }
          if (data.connected && data.status === "ACTIVE") {
            setWaiting(null);
            if (toolkit === "googletasks" && preWaitingStatusRef.current === "connected") {
              setTasksAccountActive(true);
              updateStatus("connected");
              return;
            }
            await readState(pollGeneration, pollStatusVersion, true);
            return;
          }
          if (Date.now() >= expiresAt || data.reason === "account_not_found") {
            setWaiting(null);
            updateStatus("error:expired");
            setErrorMessage("The Google sign-in link expired before access was granted. Tap Connect to try again.");
            return;
          }
          if (requestIsCurrent()) {
            pollTimerRef.current = setTimeout(tick, CONSENT_POLL_INTERVAL_MS);
          }
        } catch (error: unknown) {
          if (!requestIsCurrent()) return;
          setWaiting(null);
          updateStatus("error:unknown");
          setErrorMessage(errorMessage(error, "Status check failed"));
        }
      };
      pollTimerRef.current = setTimeout(tick, CONSENT_POLL_INTERVAL_MS);
    },
    [generationIsCurrent, readState, stopPolling, updateStatus],
  );

  const connect = useCallback(async (toolkit: GoogleToolkit = "googlecalendar") => {
    const pollGeneration = advanceGeneration();
    stopPolling();
    setErrorMessage(null);
    setWaiting(null);
    const previousStatus = statusRef.current === "waiting" ? preWaitingStatusRef.current : statusRef.current;
    preWaitingStatusRef.current = previousStatus === "connected" ? "connected" : "unconnected";
    try {
      const res = await fetch("/api/google/composio/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      if (!generationIsCurrent(pollGeneration)) return;
      const data = await res.json().catch(() => null) as unknown;
      if (!generationIsCurrent(pollGeneration)) return;
      if (!res.ok) {
        if (isRecord(data) && data.code === "not_configured") {
          updateStatus("error:config");
          setErrorMessage(typeof data.error === "string" ? data.error : "Google credentials are not configured.");
        } else {
          updateStatus("error:unknown");
          setErrorMessage(isRecord(data) && typeof data.error === "string" ? data.error : "Failed to start Google sign-in");
        }
        return;
      }
      if (!isSetupPayload(data)) {
        updateStatus("error:unknown");
        setErrorMessage("Google sign-in returned an invalid consent link.");
        return;
      }
      const expiresAt = parseConsentExpiry(data.expires_at);
      setWaiting({
        auth_url: data.auth_url,
        expires_at: expiresAt,
        toolkit: data.toolkit,
        interval: CONSENT_POLL_INTERVAL_MS / 1000,
      });
      updateStatus("waiting");
      startPolling(data.toolkit, expiresAt, pollGeneration);
    } catch (error: unknown) {
      if (!generationIsCurrent(pollGeneration)) return;
      updateStatus("error:unknown");
      setErrorMessage(errorMessage(error, "Failed to start Google sign-in"));
    }
  }, [advanceGeneration, generationIsCurrent, startPolling, stopPolling, updateStatus]);

  const disconnect = useCallback(async (): Promise<DisconnectResult> => {
    disconnectInFlightRef.current = true;
    const disconnectGeneration = advanceGeneration();
    stopPolling();
    setErrorMessage(null);
    try {
      const res = await fetch("/api/google/composio/disconnect", { method: "POST" });
      if (!generationIsCurrent(disconnectGeneration)) return failedDisconnect("Disconnect was superseded.");
      const data = await res.json().catch(() => null) as unknown;
      if (!generationIsCurrent(disconnectGeneration)) return failedDisconnect("Disconnect was superseded.");
      const payload = isDisconnectPayload(data) ? data : null;
      if (!payload || (!res.ok && payload.outcome !== "failed")) {
        const message = "Disconnect failed";
        setErrorMessage(message);
        return failedDisconnect(message);
      }
      if (payload.outcome === "failed") {
        setErrorMessage(payload.error || "Disconnect failed");
        return payload;
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("consuela-google-disconnected"));
      setWaiting(null);
      setState(null);
      updateStatus("unconnected");
      return payload;
    } catch (error: unknown) {
      const message = errorMessage(error, "Disconnect failed");
      if (generationIsCurrent(disconnectGeneration)) setErrorMessage(message);
      return failedDisconnect(message);
    } finally {
      disconnectInFlightRef.current = false;
    }
  }, [advanceGeneration, generationIsCurrent, stopPolling, updateStatus]);

  const cancel = useCallback(() => {
    invalidatePolling();
    setWaiting(null);
    updateStatus(preWaitingStatusRef.current === "connected" ? "connected" : "unconnected");
    setErrorMessage(null);
  }, [invalidatePolling, updateStatus]);

  useEffect(() => {
    if (status !== "connected") return;
    const requestedGeneration = generation;
    const requestedStatusVersion = statusVersion;
    let cancelled = false;
    const requestIsCurrent = () => !cancelled
      && generationIsCurrent(requestedGeneration)
      && statusVersionRef.current === requestedStatusVersion;
    void (async () => {
      try {
        const res = await fetch("/api/google/composio/status?toolkit=googletasks", { cache: "no-store" });
        if (!requestIsCurrent()) return;
        const data = await res.json().catch(() => null) as unknown;
        if (!requestIsCurrent()) return;
        setTasksAccountActive(res.ok && isToolkitStatusPayload(data) && data.connected === true && data.status === "ACTIVE");
      } catch {
        if (requestIsCurrent()) setTasksAccountActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, generationIsCurrent, status, statusVersion]);

  useEffect(() => {
    mountedRef.current = true;
    const initialGeneration = pollGenerationRef.current;
    const initialStatusVersion = statusVersionRef.current;
    const timer = window.setTimeout(() => {
      setMounted(true);
      void readState(initialGeneration, initialStatusVersion, true);
    }, 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      invalidatePolling();
    };
  }, [invalidatePolling, readState]);

  const tasksConnected = status === "connected" && tasksAccountActive;

  return {
    mounted,
    status,
    statusVersion,
    state,
    waiting,
    tasksConnected,
    errorMessage: errorMessageState,
    generation,
    isCurrentGeneration: generationIsCurrent,
    connect,
    disconnect,
    cancel,
    refresh,
  };
}
