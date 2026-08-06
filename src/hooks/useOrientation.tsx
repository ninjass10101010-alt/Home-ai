/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import type { Orientation } from "@/lib/layout-config";

const PORTRAIT_MQL = "(orientation: portrait)";

/**
 * Resolve the current orientation bucket. A viewport counts as "portrait"
 * only when BOTH the media query says portrait AND the width is < 1024px —
 * a wide portrait monitor or a landscape tablet keeps the landscape bento.
 * Mirrors the `lg:` breakpoint used by the Home grid (Tailwind lg = 1024px).
 */
function computeOrientation(): Orientation {
  if (typeof window === "undefined") return "landscape";
  const isPortraitMedia = window.matchMedia(PORTRAIT_MQL).matches;
  const isNarrow = window.innerWidth < 1024;
  return isPortraitMedia && isNarrow ? "portrait" : "landscape";
}

export function useOrientation(): { orientation: Orientation; mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>("landscape");

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
