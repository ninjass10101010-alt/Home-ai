"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAnimationBudget } from "@/hooks/useAnimationBudget";

/**
 * Ambient-motion budget for Home (UI audit 4.5 — finding 8: 42 concurrently
 * running animations measured on one Home screen).
 *
 * Ambient surfaces (leaderboard row glows, the DayLine "NOW" pulse, …) claim
 * one of `AMBIENT_ANIMATION_BUDGET` slots for as long as they are mounted.
 * When the budget is exhausted the component still renders — just without the
 * loop (`useAmbientAnimation()` returns false). Widgets folded off the stack
 * never mount at all (see `PHONE_WIDGET_FOLD`), so ranking, folding and this
 * budget compound.
 *
 * Outside a provider (every route except Home) the hook returns true — no cap,
 * no behavior change. The context value is memoized on the hook's stable
 * request/release pair: each claim updates `remaining` inside the provider, and
 * a per-render value would re-trigger every consumer's claim effect (churn).
 */
export const AMBIENT_ANIMATION_BUDGET = 6;

type Budget = Pick<ReturnType<typeof useAnimationBudget>, "request" | "release">;
const AnimationBudgetContext = createContext<Budget | null>(null);

export function AnimationBudgetProvider({ children }: { children: ReactNode }) {
  const budget = useAnimationBudget(AMBIENT_ANIMATION_BUDGET);
  const value = useMemo(() => ({ request: budget.request, release: budget.release }), [budget.request, budget.release]);
  return <AnimationBudgetContext.Provider value={value}>{children}</AnimationBudgetContext.Provider>;
}

/** Claim a slot for this component's lifetime; `false` = render without motion. */
export function useAmbientAnimation(): boolean {
  const budget = useContext(AnimationBudgetContext);
  // Outside a provider this is `true` on the very first render (nothing to
  // claim); inside one, the claim happens in the mount effect below, so the
  // first paint is static and the loop fades in with its slot.
  const [claimed, setClaimed] = useState(() => !budget);

  useEffect(() => {
    if (!budget) return;
    const ok = budget.request();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- claiming a budget slot IS a mount-time subscription (claim on mount, release on unmount); no alternative exists for a per-instance slot, and the same pattern is disabled file-wide in chat/page.tsx.
    setClaimed(ok);
    return () => {
      if (ok) budget.release();
    };
  }, [budget]);

  return claimed;
}
