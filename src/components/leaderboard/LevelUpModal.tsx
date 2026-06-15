"use client";

import SoftButton from "@/components/ui/SoftButton";
import { LEVELS } from "@/types/tasks";

interface LevelUpModalProps {
  open: boolean;
  memberName: string;
  memberEmoji: string;
  oldLevel: number;
  newLevel: number;
  onClose: () => void;
}

export default function LevelUpModal({ open, memberName, memberEmoji, oldLevel, newLevel, onClose }: LevelUpModalProps) {
  if (!open || newLevel <= oldLevel) return null;

  const levelInfo = LEVELS[newLevel - 1] || LEVELS[LEVELS.length - 1];
  const firstName = memberName.split(" ")[0];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 max-w-sm w-full rounded-3xl border border-amber-400/30 bg-[var(--color-surface-2)] p-8 text-center animate-level-up-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <span className="text-6xl animate-crown-glow">{levelInfo.emoji}</span>
        </div>

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-400 mb-2">Level Up!</p>
          <h2 className="text-2xl font-bold text-text-primary">
            {firstName} became a
          </h2>
          <h2 className="text-2xl font-bold text-amber-400 mt-1">
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
  );
}
