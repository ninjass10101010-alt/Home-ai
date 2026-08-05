"use client";

import Surface from "@/components/ui/Surface";
import { BADGES, getLevel } from "@/types/tasks";

interface AchievementWallProps {
  allTimePoints: number;
  streak: number;
  completions: number;
}

export default function AchievementWall({ allTimePoints, streak, completions }: AchievementWallProps) {
  const earned = BADGES.filter(b => b.condition(allTimePoints, streak, completions));
  const locked = BADGES.filter(b => !b.condition(allTimePoints, streak, completions));

  return (
    <div className="space-y-3">
      {earned.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Earned ({earned.length})</p>
          <div className="grid grid-cols-4 gap-2">
            {earned.map(b => (
              <div key={b.id} className="flex flex-col items-center gap-1 rounded-xl bg-white/5 p-2">
                <span className="text-lg animate-badge-sparkle">{b.emoji}</span>
                <span className="text-[9px] text-text-secondary text-center leading-tight">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {locked.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">Locked ({locked.length})</p>
          <div className="grid grid-cols-4 gap-2">
            {locked.slice(0, 8).map(b => (
              <div key={b.id} className="flex flex-col items-center gap-1 rounded-xl bg-white/3 p-2 opacity-40">
                <span className="text-lg grayscale">❓</span>
                <span className="text-[9px] text-text-muted text-center leading-tight">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}