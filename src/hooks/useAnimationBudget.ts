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
 * `usePrefersReducedMotion` now lives in `./useReducedMotionPreference`, its
 * single owner, where the OS query and the family's in-app toggle are composed
 * once for every animation site. Re-exported here so the existing AnimatedEmoji
 * import path — and the module mock in its suite — keep resolving.
 */
export { usePrefersReducedMotion } from "./useReducedMotionPreference";
