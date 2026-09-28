/**
 * useAnimationBudget — Limits concurrent CSS animations per viewport.
 *
 * Mobile devices struggle with 50+ simultaneous CSS animations. This hook
 * provides a simple budget system: components request animation slots, and
 * when the budget is exhausted, animations are skipped (element still
 * renders, just without motion).
 *
 * Usage:
 *   const { request, release, remaining } = useAnimationBudget(12);
 *   const allowed = request(); // true if slot available
 *   // ... render animation conditionally ...
 *   useEffect(() => () => release(), [release]);
 */
"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const DEFAULT_BUDGET = 12;

export function useAnimationBudget(maxConcurrent: number = DEFAULT_BUDGET) {
  const [remaining, setRemaining] = useState(maxConcurrent);
  const budgetRef = useRef(maxConcurrent);

  const request = useCallback((): boolean => {
    if (budgetRef.current > 0) {
      budgetRef.current -= 1;
      setRemaining(budgetRef.current);
      return true;
    }
    return false;
  }, []);

  const release = useCallback(() => {
    if (budgetRef.current < maxConcurrent) {
      budgetRef.current += 1;
      setRemaining(budgetRef.current);
    }
  }, [maxConcurrent]);

  return { request, release, remaining, maxConcurrent };
}

/**
 * usePrefersReducedMotion — OS preference OR the family's user-facing toggle
 * (UI audit 5.5: `<html data-reduce-motion="true">`, set in Settings →
 * Appearance and mirrored by ThemeProvider). The toggle dispatches
 * `consuela-motion-preference-change`, so flipping it mid-session updates
 * every mounted consumer immediately.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    // matchMedia is absent during SSR and in some test environments — treat its
    // absence as "no preference" rather than throwing.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const userPreference =
        typeof document !== "undefined" &&
        document.documentElement.getAttribute("data-reduce-motion") === "true";
      setPrefersReduced(mq.matches || userPreference);
    };
    sync();
    const handler = (e: MediaQueryListEvent | Event) => {
      sync();
      void e;
    };
    mq.addEventListener("change", handler as (e: MediaQueryListEvent) => void);
    window.addEventListener("consuela-motion-preference-change", handler);
    return () => {
      mq.removeEventListener("change", handler as (e: MediaQueryListEvent) => void);
      window.removeEventListener("consuela-motion-preference-change", handler);
    };
  }, []);

  return prefersReduced;
}
