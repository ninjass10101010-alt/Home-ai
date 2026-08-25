"use client";

import { useEffect, useState } from "react";

export interface RuntimeConfig {
  weather_location?: { LAT?: string; LON?: string };
}

let cached: RuntimeConfig | null = null;

/** Non-secret service config for client widgets (weather coordinates etc.).
 * Falls back gracefully — callers keep their own defaults while loading or
 * on failure, so visuals never break. */
export function useRuntimeConfig(): { runtime: RuntimeConfig | null } {
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetch("/api/services/runtime")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((body: RuntimeConfig) => {
        cached = body;
        if (alive) setRuntime(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return { runtime };
}
