"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";

export type ConnectionStatus =
  | "unconnected"
  | "waiting"
  | "connected"
  | "error:denied"
  | "error:expired"
  | "error:revoked"
  | "error:config"
  | "error:unknown";

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
  attempt_id: string;
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_at: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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

function isDeviceGrant(value: unknown): value is {
  attempt_id: string;
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
} {
  if (!isRecord(value) || value.ok !== true) return false;
  return typeof value.attempt_id === "string"
    && value.attempt_id.length > 0
    && typeof value.device_code === "string"
    && value.device_code.length > 0
    && typeof value.user_code === "string"
    && value.user_code.length > 0
    && typeof value.verification_url === "string"
    && value.verification_url.length > 0
    && typeof value.expires_in === "number"
    && Number.isFinite(value.expires_in)
    && value.expires_in > 0
    && typeof value.interval === "number"
    && Number.isFinite(value.interval)
    && value.interval > 0;
}

function isPollResult(value: unknown): value is {
  status: "pending" | "denied" | "expired" | "complete";
  next_interval?: number;
} {
  if (!isRecord(value) || value.ok !== true) return false;
  if (value.status === "pending") {
    return typeof value.next_interval === "number" && Number.isFinite(value.next_interval) && value.next_interval > 0;
  }
  return value.status === "denied" || value.status === "expired" || value.status === "complete";
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

export function useGoogleConnection() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("unconnected");
  const [statusVersion, setStatusVersion] = useState(0);
  const [state, setState] = useState<PublicState | null>(null);
  const [waiting, setWaiting] = useState<WaitingState | null>(null);
  const [errorMessageState, setErrorMessage] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const statusRef = useRef<ConnectionStatus>("unconnected");
  const statusVersionRef = useRef(0);
  const disconnectInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const waitingRef = useRef<WaitingState | null>(null);

  useLayoutEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);

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
    (attemptId: string, deviceCode: string, initialInterval: number, pollGeneration: number) => {
      const pollStatusVersion = statusVersionRef.current;
      const requestIsCurrent = () => generationIsCurrent(pollGeneration)
        && statusVersionRef.current === pollStatusVersion;
      if (!requestIsCurrent()) return;
      stopPolling();
      let interval = initialInterval;
      const tick = async () => {
        if (!requestIsCurrent()) return;
        try {
          const res = await fetch("/api/google/device-poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ attempt_id: attemptId, device_code: deviceCode, interval }),
          });
          if (!requestIsCurrent()) return;
          const data = await res.json() as unknown;
          if (!requestIsCurrent()) return;
          if (!res.ok) {
            updateStatus("error:unknown");
            setErrorMessage(isRecord(data) && typeof data.error === "string" ? data.error : "Poll failed");
            return;
          }
          if (!isPollResult(data)) {
            updateStatus("error:unknown");
            setErrorMessage("Google returned an invalid device-flow response.");
            setWaiting(null);
            return;
          }
          if (data.status === "pending") {
            if (data.next_interval && data.next_interval > interval) interval = data.next_interval;
            if (requestIsCurrent()) {
              pollTimerRef.current = setTimeout(tick, interval * 1000);
            }
            return;
          }
          if (data.status === "denied") {
            updateStatus("error:denied");
            setErrorMessage("Access was denied at the Google screen. Try again to grant access.");
            setWaiting(null);
            return;
          }
          if (data.status === "expired") {
            updateStatus("error:expired");
            setErrorMessage("The device code expired before you granted access. Tap Connect to get a new code.");
            setWaiting(null);
            return;
          }
          if (data.status === "complete") {
            setWaiting(null);
            await readState(pollGeneration, pollStatusVersion, true);
          }
        } catch (error: unknown) {
          if (!requestIsCurrent()) return;
          updateStatus("error:unknown");
          setErrorMessage(errorMessage(error, "Poll failed"));
        }
      };
      pollTimerRef.current = setTimeout(tick, interval * 1000);
    },
     [generationIsCurrent, readState, stopPolling, updateStatus],
  );

  const connect = useCallback(async () => {
    const pollGeneration = advanceGeneration();
    stopPolling();
    setErrorMessage(null);
    updateStatus("unconnected");
    setWaiting(null);
    try {
      const res = await fetch("/api/google/device-grant", { method: "POST" });
      if (!generationIsCurrent(pollGeneration)) return;
      const data = await res.json() as unknown;
      if (!generationIsCurrent(pollGeneration)) return;
      if (!res.ok) {
        if (isRecord(data) && data.code === "config") {
          updateStatus("error:config");
          setErrorMessage(typeof data.error === "string" ? data.error : "Google credentials are not configured.");
        } else {
          updateStatus("error:unknown");
          setErrorMessage(isRecord(data) && typeof data.error === "string" ? data.error : "Failed to start Google sign-in");
        }
        return;
      }
      if (!isDeviceGrant(data)) {
        updateStatus("error:unknown");
        setErrorMessage("Google sign-in returned an invalid device code.");
        return;
      }
      const grant = data;
      setWaiting({
        attempt_id: grant.attempt_id,
        device_code: grant.device_code,
        user_code: grant.user_code,
        verification_url: grant.verification_url,
        expires_at: Date.now() + grant.expires_in * 1000,
        interval: grant.interval,
      });
      updateStatus("waiting");
      startPolling(grant.attempt_id, grant.device_code, grant.interval, pollGeneration);
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
      const res = await fetch("/api/google/device-revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
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
    const attemptId = waiting?.attempt_id;
    if (attemptId) {
      void fetch("/api/google/device-revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", attempt_id: attemptId }),
      }).catch(() => undefined);
    }
    invalidatePolling();
    setWaiting(null);
    updateStatus("unconnected");
    setErrorMessage(null);
  }, [invalidatePolling, updateStatus, waiting]);

  useEffect(() => {
    mountedRef.current = true;
    const initialGeneration = pollGenerationRef.current;
    const initialStatusVersion = statusVersionRef.current;
    const timer = window.setTimeout(() => {
      setMounted(true);
      void readState(initialGeneration, initialStatusVersion, true);
    }, 0);
    return () => {
      const attemptId = waitingRef.current?.attempt_id;
      if (attemptId) {
        void fetch("/api/google/device-revoke", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", attempt_id: attemptId }),
        }).catch(() => undefined);
      }
      mountedRef.current = false;
      window.clearTimeout(timer);
      invalidatePolling();
    };
  }, [invalidatePolling, readState]);

  return {
    mounted,
    status,
    statusVersion,
    state,
    waiting,
    errorMessage: errorMessageState,
    generation,
    isCurrentGeneration: generationIsCurrent,
    connect,
    disconnect,
    cancel,
    refresh,
  };
}
