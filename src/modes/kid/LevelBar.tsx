/**
 * LevelBar — XP progress bar for Kid Mode.
 *
 * Shows the kid's current level, points toward next level,
 * and a glowing progress bar. Celebrates when a level is reached.
 */
"use client";

import { useState, useEffect } from "react";

interface LevelBarProps {
  points: number;
  pointsPerLevel?: number;
  /** Called when the user levels up */
  onLevelUp?: (newLevel: number) => void;
}

export default function LevelBar({
  points,
  pointsPerLevel = 50,
  onLevelUp,
}: LevelBarProps) {
  const [prevLevel, setPrevLevel] = useState(() => Math.floor(points / pointsPerLevel) + 1);
  const [animating, setAnimating] = useState(false);

  const level = Math.floor(points / pointsPerLevel) + 1;
  const pointsInLevel = points % pointsPerLevel;
  const progress = (pointsInLevel / pointsPerLevel) * 100;
  const nextLevel = level + 1;
  const pointsToNext = pointsPerLevel - pointsInLevel;

  // Detect level up
  useEffect(() => {
    if (level > prevLevel) {
      setAnimating(true);
      onLevelUp?.(level);
      const timer = setTimeout(() => {
        setPrevLevel(level);
        setAnimating(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [level, prevLevel, onLevelUp]);

  return (
    <div className="w-full">
      {/* Level header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-black ${animating ? "level-up-pulse" : ""}`}
            style={{
              background: "linear-gradient(135deg, var(--color-accent-selected), var(--color-accent-violet))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ⭐ Level {level}
          </span>
          {animating && (
            <span
              className="text-xs font-bold text-amber-400"
              style={{ animation: "levelBadgePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
            >
              LEVEL UP!
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold text-text-secondary tabular-nums">
          {pointsInLevel}/{pointsPerLevel} → Lv{nextLevel}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="relative h-3.5 rounded-full overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, var(--color-accent-selected), var(--color-accent-violet), var(--color-accent-lavender))",
            boxShadow: "0 0 12px var(--color-accent-selected), inset 0 1px 0 rgba(255,255,255,0.3)",
          }}
        >
          {/* Shimmer effect on the bar */}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)",
              animation: "levelShimmer 2s ease-in-out infinite",
            }}
          />
        </div>

        {/* Glow when close to next level */}
        {progress > 80 && (
          <div
            className="absolute inset-y-0 right-0 w-8"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.4))",
              animation: "levelNearPulse 1s ease-in-out infinite",
            }}
          />
        )}
      </div>

      {/* Points remaining */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-text-muted">
          {pointsToNext > 0 ? `${pointsToNext} more pts to Level ${nextLevel}` : "Almost there!"}
        </span>
        <span className="text-[10px] font-bold text-text-secondary tabular-nums">
          {points} total pts
        </span>
      </div>

      <style>{`
        @keyframes levelShimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }

        @keyframes levelNearPulse {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1; }
        }

        @keyframes levelBadgePop {
          0%   { transform: scale(0); opacity: 0; }
          50%  { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }

        .level-up-pulse {
          animation: levelUpGlow 1s ease-in-out;
        }

        @keyframes levelUpGlow {
          0%   { filter: brightness(1); transform: scale(1); }
          25%  { filter: brightness(1.5); transform: scale(1.1); }
          50%  { filter: brightness(1.2); transform: scale(1.05); }
          100% { filter: brightness(1); transform: scale(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .level-up-pulse { animation: none !important; }
          @keyframes levelShimmer { 0%, 100% { transform: none; } }
          @keyframes levelNearPulse { 0%, 100% { opacity: 0.6; } }
        }
      `}</style>
    </div>
  );
}
