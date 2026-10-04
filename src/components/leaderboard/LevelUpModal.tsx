"use client";
import { createPortal } from "react-dom";

import SoftButton from "@/components/ui/SoftButton";
import { LEVELS } from "@/types/tasks";
import useDialogA11y from "@/components/ui/useDialogA11y";

interface LevelUpModalProps {
  open: boolean;
  memberName: string;
  memberEmoji: string;
  oldLevel: number;
  newLevel: number;
  onClose: () => void;
}

export default function LevelUpModal({ open, memberName, memberEmoji, oldLevel, newLevel, onClose }: LevelUpModalProps) {
  const panelRef = useDialogA11y<HTMLDivElement>({ active: open && newLevel > oldLevel, onClose });

  if (!open || newLevel <= oldLevel) return null;

  const levelInfo = LEVELS[newLevel - 1] || LEVELS[LEVELS.length - 1];
  const firstName = memberName.split(" ")[0];

  // Portaled to <body>: rendered inline this overlay inherited PageShell's
  // `relative z-10` <main> stacking context, so the portaled z-50 CapsuleNav
  // painted straight over it — on the wall and on phones the dock swallowed
  // the sheet's own footer. A z index only means anything at body level.
  return createPortal(
    <div ref={panelRef} tabIndex={-1} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/62 backdrop-blur-md outline-none" role="dialog" aria-modal="true" aria-label="Level up" onClick={onClose}>
      <div
        className="relative mx-4 max-w-sm w-full rounded-2xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-surface-2)] p-8 text-center animate-level-up-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <span className="text-6xl animate-crown-glow">{levelInfo.emoji}</span>
        </div>

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--color-accent-amber)] mb-2">Level Up!</p>
          <h2 className="text-2xl font-bold text-text-primary">
            {firstName} became a
          </h2>
          <h2 className="text-2xl font-bold text-[var(--color-accent-amber)] mt-1">
            {levelInfo.title}!
          </h2>
          <p className="mt-4 text-sm text-text-secondary">
            You&apos;ve reached level {newLevel}. Keep completing tasks to unlock even higher ranks!
          </p>
        </div>

        <div className="mt-6">
          <SoftButton onClick={onClose} className="w-full">
            Keep going! 🚀
          </SoftButton>
        </div>
      </div>
    </div>
    ,
    document.body
  );
}
