"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js", { type: "module" }).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}