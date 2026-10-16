"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import { useAuth } from "@/hooks/useAuth";

type Status = "loading" | "unsupported" | "signed_out" | "default" | "subscribed" | "denied";

/** VAPID public keys arrive base64url; pushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android device";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows device";
  return "This device";
}

function isIosNotInstalled(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ios = /(iPad|iPhone|iPod)/.test(navigator.userAgent);
  const standalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

export default function DeviceNotificationsCard() {
  const { currentUser, hydrated } = useAuth();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const capable = useCallback((): boolean => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    if (!window.isSecureContext) return false;
    if (!("serviceWorker" in navigator)) return false;
    if (typeof window.Notification === "undefined") return false;
    return true;
  }, []);

  const currentSubscription = useCallback(async (): Promise<PushSubscription | null> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      return await reg.pushManager.getSubscription();
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!capable()) {
      setStatus("unsupported");
      return;
    }
    if (!hydrated) {
      setStatus("loading");
      return;
    }
    if (!currentUser) {
      setStatus("signed_out");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const sub = await currentSubscription();
    setStatus(sub ? "subscribed" : "default");
  }, [capable, currentSubscription, currentUser, hydrated]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refresh();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const enable = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }
      const res = await fetch("/api/push/vapid-public");
      const data = (await res.json().catch(() => null)) as { ok?: boolean; publicKey?: string | null } | null;
      const publicKey = data?.publicKey ?? null;
      if (!res.ok || !publicKey) {
        setError("Notifications aren't configured yet. Ask a parent to set up Push notifications in Services & Keys.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      const save = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), deviceLabel: deviceLabel() }),
      });
      const saveBody = (await save.json().catch(() => null)) as { ok?: boolean } | null;
      if (!save.ok || saveBody?.ok !== true) {
        // Roll back the browser subscription so the device cannot report "On"
        // with no server row to deliver to.
        await sub.unsubscribe().catch(() => undefined);
        throw new Error("subscribe failed");
      }
      setStatus("subscribed");
    } catch {
      setError("Couldn't turn on notifications on this device. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        const unsubscribed = await sub.unsubscribe().catch(() => false);
        const del = await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => null);
        // Only claim "off" when the browser subscription is really gone.
        if (!unsubscribed && (await currentSubscription())) {
          setError("Couldn't turn off notifications. Try again.");
          return;
        }
        if (del && !del.ok) {
          setError("Turned off on this device, but the server didn't confirm. Try again if it reappears.");
        }
      }
      setStatus("default");
    } catch {
      setError("Couldn't turn off notifications. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [currentSubscription]);

  const sendTest = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setTested(false);
    setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; sent?: number; error?: string } | null;
      if (res.status === 403) {
        setError("Only a parent can send a test notification.");
        return;
      }
      if (res.status === 409 || body?.error === "push_not_configured") {
        setError("Notifications aren't configured yet.");
        return;
      }
      if (!res.ok || body?.ok !== true) throw new Error("test failed");
      setTested(true);
    } catch {
      setError("Couldn't send a test notification. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return (
    <SectionCard
      title="This device's notifications"
      description="Get a heads-up on this device when a routine or event is about to start."
      icon="🔔"
      tone="var(--color-accent-amber)"
      headingLevel="h2"
    >
      {error ? (
        <p role="alert" className="mb-3 text-sm font-semibold text-[var(--color-accent-rose)]">
          {error}
        </p>
      ) : null}

      {status === "loading" ? (
        <p role="status" className="text-sm text-text-secondary">Checking this device…</p>
      ) : status === "unsupported" ? (
        <p className="text-sm text-text-secondary">
          This browser can&apos;t show notifications. On iPhone or iPad, open the family URL over HTTPS and use
          Share → Add to Home Screen, then open Consuela from the home-screen icon.
        </p>
      ) : status === "signed_out" ? (
        <p className="text-sm text-text-secondary">Sign in to turn on notifications on this device.</p>
      ) : status === "denied" ? (
        <p className="text-sm text-text-secondary">
          Notifications are blocked for this site. Re-enable them in your browser settings, then reload.
        </p>
      ) : (
        <div className="space-y-3">
          {status === "subscribed" ? (
            <div className="flex items-center gap-2">
              <Chip size="sm" tone="success" as="span">On · this device</Chip>
              {tested ? <Chip size="sm" tone="success" as="span">Sent ✓</Chip> : null}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Notifications are off on this device.</p>
          )}

          {isIosNotInstalled() ? (
            <p className="text-xs text-text-muted">
              On iPhone/iPad, notifications work only after Add to Home Screen.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {status === "subscribed" ? (
              <>
                <SoftButton size="sm" variant="secondary" disabled={busy} onClick={() => void sendTest()}>
                  Send test
                </SoftButton>
                <SoftButton size="sm" variant="ghost" disabled={busy} onClick={() => void disable()}>
                  Turn off
                </SoftButton>
              </>
            ) : (
              <SoftButton size="sm" variant="primary" disabled={busy} onClick={() => void enable()}>
                {busy ? "Enabling…" : "Enable on this device"}
              </SoftButton>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
