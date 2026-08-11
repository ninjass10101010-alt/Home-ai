/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { computeLayoutMode, type LayoutMode } from "@/lib/layout-config";

const PORTRAIT_MQL = "(orientation: portrait)";

/**
 * Resolve the current layout-mode bucket (SSR-safe): landscape always counts
 * as "desktop"; portrait splits by width — <700px phone, 700–1279px tablet,
 * >=1280px desktop (a wide portrait monitor keeps the desktop filmstrip).
 */
function computeOrientation(): LayoutMode {
  if (typeof window === "undefined") return "desktop";
  return computeLayoutMode(window.matchMedia(PORTRAIT_MQL).matches, window.innerWidth);
}

export function useOrientation(): { orientation: LayoutMode; mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [orientation, setOrientation] = useState<LayoutMode>("desktop");

  useEffect(() => {
    setMounted(true);
    const update = () => setOrientation(computeOrientation());
    update();
    const mql = window.matchMedia(PORTRAIT_MQL);
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { orientation, mounted };
}
