"use client";

import { getLevel, LEVELS } from "@/types/tasks";

interface TreasurePathProps {
  allTimePoints: number;
  memberEmoji: string;
  memberColor: string;
}

export default function TreasurePath({ allTimePoints, memberEmoji, memberColor }: TreasurePathProps) {
  const current = getLevel(allTimePoints);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Level Journey</p>
        <span className="text-xs text-text-muted">{current.title} → {current.next ? LEVELS[current.level]?.title : "MAX"}</span>
      </div>

      <div className="relative">
        <div className="absolute top-1/2 left-0 right-0 h-1 rounded-full bg-white/5" />
        <div
          className="absolute top-1/2 left-0 h-1 rounded-full bg-gradient-to-r from-[var(--color-accent-selected)]/40 to-[var(--color-accent-selected)]"
          style={{ width: `${current.progress}%`, transform: "translateY(-50%)" }}
        />
        <div className="relative flex justify-between items-center py-2">
          {LEVELS.map((level, i) => {
            const isReached = allTimePoints >= level.points;
            const isCurrent = i + 1 === current.level;
            return (
              <div key={level.points} className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-500 ${
                    isCurrent
                      ? "bg-[var(--color-accent-selected)] scale-110 shadow-lg"
                      : isReached
                      ? "bg-[var(--color-accent-selected)]/30"
                      : "bg-white/5"
                  }`}
                >
                  {isReached ? level.emoji : "🔒"}
                </div>
                {isCurrent && (
                  <span
                    className="absolute -bottom-4 text-xs animate-badge-sparkle"
                    style={{ color: memberColor }}
                  >
                    {memberEmoji}
                  </span>
                )}
                <span className="text-[9px] text-text-muted mt-1">{level.title.split(" ").pop()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}