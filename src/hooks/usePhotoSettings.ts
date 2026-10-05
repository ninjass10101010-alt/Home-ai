"use client";

/* eslint-disable react-hooks/set-state-in-effect -- this hook's state IS the
   mount fetch: it reads an external system (the settings route) and lands the
   result as state, which is exactly the subscribe-for-updates shape the rule
   allows. Same posture as useFogConfig/useWeather and PhotosWidget itself. */

/**
 * The wall's photo settings: seconds per photo, transition, order, caption
 * (spec §3). Server-backed and family-shared — the widget runs on the wall,
 * which is its own device, so a localStorage value changed on a phone would
 * never reach it.
 *
 * One GET on mount plus a refresh on `visibilitychange → visible`; there is
 * deliberately NO polling timer (§3.1) — `PhotosWidget` calls `refresh()` at
 * the end of each rotation, so a change lands within one rotation for free,
 * and the visibility listener covers the cases rotation never reaches
 * (paused wall, single-photo library, decode-failing advance).
 *
 * Failure semantics are defined and total (§3, amendment 2): a rejected
 * fetch, a non-200, a non-JSON body, or a body without a `settings` key all
 * resolve to `{ settings: PHOTO_SETTINGS_DEFAULTS, loading: false,
 * degraded: true }` — `loading` always clears (§5.1's "disabled until GET
 * resolves" would otherwise disable the card forever), and the existing
 * widget test suites stub EVERY url with feed-shaped JSON, so that body must
 * normalise silently to defaults instead of throwing.
 *
 * No provider/context: the widget and the settings page never coexist, so a
 * plain hook keeps one read path with no shared-state machinery.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PHOTO_SETTINGS_DEFAULTS,
  normalizePhotoSettings,
  type PhotoSettings,
} from "@/lib/photos/settings";

export interface PhotoSettingsSnapshot {
  /** Starts at `PHOTO_SETTINGS_DEFAULTS`, so the first photo never waits. */
  settings: PhotoSettings;
  /** True only until the first fetch settles — it always settles. */
  loading: boolean;
  /** The read failed and `settings` fell back to defaults (route §2). */
  degraded: boolean;
  /** Re-read now. Never throws; a failure lands on defaults + `degraded`. */
  refresh: () => Promise<void>;
}

export function usePhotoSettings(): PhotoSettingsSnapshot {
  const [settings, setSettings] = useState<PhotoSettings>(PHOTO_SETTINGS_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  // A settings response that lands after unmount must not setState.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/photos/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`photo settings returned ${res.status}`);
      const body: unknown = await res.json();
      if (typeof body !== "object" || body === null || !("settings" in body)) {
        // Feed-shaped or otherwise malformed bodies (the widget suites' shared
        // stub answers every url with feed JSON) are a failed read, not a crash.
        throw new Error("photo settings response has no settings key");
      }
      if (!mountedRef.current) return;
      const payload = body as { settings: unknown; degraded?: unknown };
      setSettings(normalizePhotoSettings(payload.settings));
      setDegraded(payload.degraded === true);
      setLoading(false);
    } catch {
      if (!mountedRef.current) return;
      setSettings(PHOTO_SETTINGS_DEFAULTS);
      setDegraded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { settings, loading, degraded, refresh };
}
