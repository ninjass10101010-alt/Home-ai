/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_at: number;
  interval: number;
}

export function useGoogleConnection() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("unconnected");
  const [state, setState] = useState<PublicState | null>(null);
  const [waiting, setWaiting] = useState<WaitingState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch("/api/google/state", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error:unknown");
        setErrorMessage(data?.error || "Failed to read Google state");
        return;
      }
      setState(data);
      if (data.connected) {
        setStatus("connected");
        setErrorMessage(null);
      } else if (data.revoked_at) {
        setStatus("error:revoked");
        setErrorMessage("Connection was revoked. Please reconnect.");
      } else {
        setStatus("unconnected");
        setErrorMessage(null);
      }
    } catch (e: any) {
      setStatus("error:unknown");
      setErrorMessage(e?.message || "Failed to read Google state");
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (deviceCode: string, initialInterval: number) => {
      stopPolling();
      let interval = initialInterval;
      const tick = async () => {
        if (abortRef.current) return;
        try {
          const res = await fetch("/api/google/device-poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: deviceCode, interval }),
          });
          const data = await res.json();
          if (!res.ok) {
            setStatus("error:unknown");
            setErrorMessage(data?.error || "Poll failed");
            return;
          }
          if (data.status === "pending") {
            if (data.next_interval && data.next_interval > interval) {
              interval = data.next_interval;
            }
            pollTimerRef.current = setTimeout(tick, interval * 1000);
            return;
          }
          if (data.status === "denied") {
            setStatus("error:denied");
            setErrorMessage(
              "Access was denied at the Google screen. Try again to grant access.",
            );
            setWaiting(null);
            return;
          }
          if (data.status === "expired") {
            setStatus("error:expired");
            setErrorMessage(
              "The device code expired before you granted access. Tap Connect to get a new code.",
            );
            setWaiting(null);
            return;
          }
          if (data.status === "complete") {
            setWaiting(null);
            await refreshState();
            return;
          }
        } catch (e: any) {
          setStatus("error:unknown");
          setErrorMessage(e?.message || "Poll failed");
        }
      };
      pollTimerRef.current = setTimeout(tick, interval * 1000);
    },
    [refreshState, stopPolling],
  );

  const connect = useCallback(async () => {
    setErrorMessage(null);
    setStatus("unconnected");
    setWaiting(null);
    try {
      const res = await fetch("/api/google/device-grant", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "config") {
          setStatus("error:config");
          setErrorMessage(
            data.error ||
              "Google credentials are not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.",
          );
        } else {
          setStatus("error:unknown");
          setErrorMessage(data.error || "Failed to start Google sign-in");
        }
        return;
      }
      setWaiting({
        device_code: data.device_code,
        user_code: data.user_code,
        verification_url: data.verification_url,
        expires_at: data.expires_at,
        interval: data.interval,
      });
      setStatus("waiting");
      abortRef.current = false;
      startPolling(data.device_code, data.interval);
    } catch (e: any) {
      setStatus("error:unknown");
      setErrorMessage(e?.message || "Failed to start Google sign-in");
    }
  }, [startPolling]);

  const disconnect = useCallback(async () => {
    stopPolling();
    setErrorMessage(null);
    try {
      const res = await fetch("/api/google/device-revoke", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data?.error || "Disconnect failed");
        return;
      }
      setWaiting(null);
      setStatus("unconnected");
      await refreshState();
    } catch (e: any) {
      setErrorMessage(e?.message || "Disconnect failed");
    }
  }, [refreshState, stopPolling]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    stopPolling();
    setWaiting(null);
    setStatus("unconnected");
    setErrorMessage(null);
  }, [stopPolling]);

  useEffect(() => {
    setMounted(true);
    abortRef.current = false;
    const t = window.setTimeout(refreshState, 0);
    return () => {
      window.clearTimeout(t);
      abortRef.current = true;
      stopPolling();
    };
  }, [refreshState, stopPolling]);

  return {
    mounted,
    status,
    state,
    waiting,
    errorMessage,
    connect,
    disconnect,
    cancel,
    refresh: refreshState,
  };
}
