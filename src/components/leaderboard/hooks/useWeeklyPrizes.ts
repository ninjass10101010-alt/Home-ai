/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { loadWeeklyPrizes } from "@/lib/task-utils";
import type { WeeklyPrize } from "@/types/tasks";

/**
 * The configured weekly prizes (localStorage source of truth), for any
 * surface that shows the race — the Home leaderboard widget, KidHome, and
 * the Tasks-page prize card. Mounted-gated so SSR/hydration frames match;
 * re-reads on the shared 60s `consuela-data-refreshed` pulse so a prize
 * edited on another device (or in Settings) lands without a reload.
 * Pre-mount returns [] (nothing prize-related renders until mounted).
 */
export function useWeeklyPrizes(): WeeklyPrize[] {
  const [mounted, setMounted] = useState(false);
  const [prizes, setPrizes] = useState<WeeklyPrize[]>([]);

  useEffect(() => {
    // Guarded like every other store read on these surfaces (KidHome wraps
    // loadTasks/loadWeekData the same way): an unreadable store must hide the
    // race line, never break the card.
    const read = () => {
      try {
        setPrizes(loadWeeklyPrizes());
      } catch {
        setPrizes([]);
      }
    };
    read();
    setMounted(true);
    window.addEventListener("consuela-data-refreshed", read);
    return () => window.removeEventListener("consuela-data-refreshed", read);
  }, []);

  return mounted ? prizes : [];
}
