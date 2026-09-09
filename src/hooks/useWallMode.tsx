/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { computeWallMode } from "@/lib/layout-config";

const PORTRAIT_MQL = "(orientation: portrait)";
const COARSE_MQL = "(pointer: coarse)";
export const WALL_MODE_KEY = "consuela-wall-mode";
export const WALL_MODE_EVENT = "consuela-wall-mode-changed";

function readManual(): boolean | null {
  try {
    const v = window.localStorage.getItem(WALL_MODE_KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

function readUrlParam(): string | null {
  const p = new URLSearchParams(window.location.search).get("wall");
  return p === "1" || p === "0" ? p : null;
}

function computeWall(): boolean {
  // matchMedia is absent in some test environments (jsdom) — treat the wall
  // profile as off there, same posture as useAnimationBudget's guard.
  if (typeof window.matchMedia !== "function") return false;
  const portrait = window.matchMedia(PORTRAIT_MQL).matches;
  const coarse = window.matchMedia(COARSE_MQL).matches;
  // Auto-detect only fires on portrait canvases >=1000x>=1600, which always
  // resolve to the tablet/desktop buckets, so no extra bucket gate is needed.
  // ?wall=1 / ?wall=0 and the manual toggle are explicit user overrides —
  // ?wall=1 forces the profile on even on a phone (the pinned Fully Kiosk
  // bookmark is authoritative).
  return computeWallMode({
    isPortrait: portrait,
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: coarse,
    manual: readManual(),
    urlParam: readUrlParam(),
  });
}

function syncAttr(wall: boolean) {
  if (wall) document.documentElement.setAttribute("data-wall", "true");
  else document.documentElement.removeAttribute("data-wall");
}

// Ref-count of live hook instances: page.tsx and the root WallModeSync BOTH
// consume this hook, so one consumer's cleanup must never strip the shared
// <html data-wall> attribute while another instance is still mounted
// (Home→other-page→Home navigation would silently turn wall CSS off).
// Each mount's update() re-writes the attribute to current truth, so the
// last-unmount removal below is always correct.
let instanceCount = 0;

/** Resolves the wall display profile (SSR-safe: defaults false) and mirrors
 *  it onto <html data-wall> so every surface — including portaled modals —
 *  can style from CSS. */
export function useWallMode(): { wall: boolean; mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [wall, setWall] = useState(false);

  useEffect(() => {
    instanceCount += 1;
    setMounted(true);
    const update = () => {
      const next = computeWall();
      setWall(next);
      syncAttr(next);
    };
    update();
    const hasMql = typeof window.matchMedia === "function";
    const portraitMql = hasMql ? window.matchMedia(PORTRAIT_MQL) : null;
    const coarseMql = hasMql ? window.matchMedia(COARSE_MQL) : null;
    if (portraitMql) portraitMql.addEventListener("change", update);
    if (coarseMql) coarseMql.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener(WALL_MODE_EVENT, update);
    return () => {
      if (portraitMql) portraitMql.removeEventListener("change", update);
      if (coarseMql) coarseMql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener(WALL_MODE_EVENT, update);
      instanceCount -= 1;
      if (instanceCount === 0) syncAttr(false);
    };
  }, []);

  return { wall, mounted };
}
