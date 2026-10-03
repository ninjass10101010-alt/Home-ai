"use client";

/**
 * The single owner of "should this animation run at all?".
 *
 * Reduced motion has TWO inputs and both are authoritative:
 *
 *  1. The OS preference — `prefers-reduced-motion: reduce`.
 *  2. The family's own choice — Settings → Appearance → "Reduce motion", which
 *     `ThemeProvider` persists in the theme config and mirrors onto
 *     `<html data-reduce-motion="true">`, then announces with
 *     `consuela-motion-preference-change` so a mid-session flip lands without a
 *     reload. This input exists because the app's most important surface is the
 *     shared wall, a kiosk whose OS never asks — on that screen the OS query
 *     alone leaves a motion-sensitive family member with no control whatsoever.
 *
 * Animation sites must read this module, never `window.matchMedia` directly: a
 * direct query silently drops input 2, which is exactly how the Settings toggle
 * became inert on thirteen sites. `tests/unit/reduced-motion-authority.test.tsx`
 * enforces that as a source contract.
 *
 * Two shapes are exported because React is not available everywhere:
 *  - `readReducedMotionPreference()` — synchronous, for imperative sites
 *    (canvas loops, count-up rAF chains, imperative scroll/FLIP calls).
 *  - `usePrefersReducedMotion()` — reactive, for components that re-render.
 *
 * CSS has its own, equivalent kill-switch: the `prefers-reduced-motion` media
 * block in `globals.css` plus `html[data-reduce-motion="true"] *`.
 */

import { useEffect, useState } from "react";

/** The event `ThemeProvider` dispatches after mirroring the user's toggle. */
export const MOTION_PREFERENCE_EVENT = "consuela-motion-preference-change";

/** Where `ThemeProvider` mirrors the user's toggle. */
export const REDUCE_MOTION_ATTRIBUTE = "data-reduce-motion";

export const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Input 1. `matchMedia` is absent during SSR and in some test environments. */
export function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCE_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Input 2. Read off the DOM attribute, not off storage — one mirror, one truth. */
export function inAppReduceMotionEnabled(): boolean {
  if (typeof document === "undefined" || !document.documentElement) return false;
  return document.documentElement.getAttribute(REDUCE_MOTION_ATTRIBUTE) === "true";
}

/**
 * The authoritative answer, synchronously. Use this from imperative code paths
 * (a canvas draw, a rAF count-up, an imperative scroll or FLIP call) that cannot
 * call a hook.
 */
export function readReducedMotionPreference(): boolean {
  return systemPrefersReducedMotion() || inAppReduceMotionEnabled();
}

/**
 * Subscribe to every way the answer can change: the OS preference AND the
 * family's in-app toggle. Shared by the hook below and by the one call site that
 * needs the same answer under a different name, so neither grows its own
 * listener pair.
 */
export function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let mq: MediaQueryList | null = null;
  if (typeof window.matchMedia === "function") {
    try {
      mq = window.matchMedia(REDUCE_MOTION_QUERY);
      mq.addEventListener?.("change", onStoreChange);
    } catch {
      mq = null;
    }
  }
  window.addEventListener(MOTION_PREFERENCE_EVENT, onStoreChange);
  return () => {
    mq?.removeEventListener?.("change", onStoreChange);
    window.removeEventListener(MOTION_PREFERENCE_EVENT, onStoreChange);
  };
}

/**
 * The composed answer, reactive: it re-reads when the OS preference changes AND
 * when the family flips the in-app toggle.
 *
 * The first render is always `false`, and that is deliberate rather than lazy: the
 * server can see neither the OS preference nor `<html data-reduce-motion>`, so
 * `false` is the only value on which the server render and the first client
 * render can agree. Motion sites read the result as permission to NOT animate, so
 * a first paint of `false` costs at worst one frame of animation and can never
 * cause a hydration mismatch. (`useSyncExternalStore` looks like the tidier
 * primitive here and is not: its client snapshot is read on the very first
 * client render, which breaks both this guarantee and Weather's paused
 * first-render snapshot.)
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const sync = () => setReduced(readReducedMotionPreference());
    sync();
    return subscribeToReducedMotion(sync);
  }, []);

  return reduced;
}
