"use client";

import { useState } from "react";

/** Wall 2-step confirm for chore rows (Task 9): on the wall, the FIRST tap on
 *  a pending row only arms it — the row reveals a "✓ Complete — tap to
 *  confirm" pill — and the second tap (on the row or the pill) runs the row's
 *  original completion path via `proceed`. Off the wall this is a pass-through:
 *  `armOrConfirm` calls `proceed(id)` immediately, so the non-wall single-tap
 *  behavior is byte-identical. `resetKey` should change whenever the row list
 *  changes context (filter member / tab switch) — it clears any armed row so a
 *  stale confirm can never fire against a row the user is no longer looking at. */
export function useWallConfirm(wall: boolean, resetKey: string) {
  const [confirmId, setConfirmId] = useState<string | number | null>(null);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  // React's documented "adjusting state when a prop changes" pattern: reset
  // during render (no effect, no cascading set-state-in-effect).
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setConfirmId(null);
  }

  const armOrConfirm = (id: string | number, proceed: () => void) => {
    if (!wall) {
      proceed();
      return;
    }
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    proceed();
  };

  return { confirmId, armOrConfirm };
}
