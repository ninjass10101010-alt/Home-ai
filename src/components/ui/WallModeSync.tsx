"use client";

import { useWallMode } from "@/hooks/useWallMode";

/** Mounts once in the root layout; the hook's effect owns <html data-wall>. */
export default function WallModeSync() {
  useWallMode();
  return null;
}
