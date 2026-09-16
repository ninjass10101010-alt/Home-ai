/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import ConfettiBurst from "@/components/ui/ConfettiBurst";
import { loadHallOfFame, markWinCelebrated, uncelebratedWinFor } from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";

const MEDALS: Record<number, string> = { 1: "🏆", 2: "🥈", 3: "🥉" };

/**
 * The Monday ceremony: when the signed-in member has a top-3 week win with a
 * prize they haven't celebrated yet, this opens a small celebration modal
 * with a confetti burst. Single-fire is guaranteed by the celebrated flag on
 * the local hall entry — BOTH buttons (and scrim/Esc dismiss) claim it, so
 * the kid never sees it nine times.
 *
 * The server claim is best-effort: hall_of_fame gateway writes are
 * parent-policy, so the browser goes through /api/hall-of-fame/celebrate
 * (kid sessions may claim their OWN win there). The local flag is the
 * primary record; a failed POST just means the next cross-device sync still
 * sees the entry un-celebrated on the server.
 *
 * Guests render nothing. Reduced-motion skips the confetti (same guard as
 * the tasks page's triggerConfetti).
 */
export default function WeeklyWinModal({ memberName }: { memberName?: string | null }) {
  const [win, setWin] = useState<HallOfFameEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [confetti, setConfetti] = useState(false);

  useEffect(() => {
    if (!memberName) return;
    const found = uncelebratedWinFor(loadHallOfFame(), memberName);
    if (!found) return;
    setWin(found);
    setOpen(true);
    // Confetti on open, honoring reduced-motion — mirrors triggerConfetti in
    // src/app/tasks/page.tsx.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    setConfetti(true);
    const t = setTimeout(() => setConfetti(false), 1800);
    return () => clearTimeout(t);
  }, [memberName]);

  const claim = () => {
    if (win) {
      markWinCelebrated(win.member, win.weekStart);
      fetch("/api/hall-of-fame/celebrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberName: win.member, weekStart: win.weekStart }),
      }).catch(() => {});
    }
    setOpen(false);
    setConfetti(false);
  };

  const medal = win ? MEDALS[win.rank] ?? "🏅" : "🏆";

  return (
    <>
      <ConfettiBurst active={confetti} />
      <Modal
        open={open}
        onClose={claim}
        title="Weekly Winner!"
        description={win ? `You finished #${win.rank} last week` : undefined}
        footer={
          <>
            <SoftButton variant="secondary" className="flex-1" onClick={claim}>
              Close
            </SoftButton>
            <SoftButton className="flex-1" onClick={claim}>
              Tell my family! 🎉
            </SoftButton>
          </>
        }
      >
        {win && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="text-6xl" aria-hidden>
              {medal}
            </div>
            <p className="text-sm font-semibold text-text-primary">You won: {win.prize}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
