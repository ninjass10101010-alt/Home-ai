/**
 * QuestCard — A gamified task card for Kid Mode.
 *
 * Features:
 *   - Large touch target (72px min height, 52px touch area)
 *   - Spring-bounce on tap
 *   - Confetti burst from the checkbox on completion
 *   - Points fly up as golden numbers
 *   - Completed state with green checkmark
 *   - Streak fire for repeated completions
 *
 * The quest card is the PRIMARY interaction in kid mode.
 * It should feel satisfying, not clinical.
 */
"use client";

import { useState, useCallback, useRef } from "react";

interface QuestCardProps {
  task: {
    id: number;
    title: string;
    points: number;
    assignee?: string;
    due?: string;
    priority?: string;
    completed?: boolean;
    emoji?: string;
  };
  /** Called when the quest is completed */
  onComplete: (task: any) => void;
  /** Whether the quest is disabled (e.g. bedtime mode) */
  disabled?: boolean;
}

export default function QuestCard({ task, onComplete, disabled = false }: QuestCardProps) {
  const [completed, setCompleted] = useState(task.completed || false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTap = useCallback(() => {
    if (completed || disabled) return;

    // Visual feedback: press down
    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 150);

    // Mark complete
    setCompleted(true);
    setShowCelebration(true);

    // Trigger parent callback
    onComplete(task);

    // Clear celebration after animation
    setTimeout(() => setShowCelebration(false), 1500);
  }, [completed, disabled, onComplete, task]);

  // Determine quest difficulty tier
  const tier = task.points > 15 ? "epic" : task.points > 10 ? "hard" : "normal";
  const tierConfig = {
    epic: {
      icon: "🔥",
      label: "Epic Quest",
      bg: "rgba(244, 63, 94, 0.12)",
      border: "rgba(244, 63, 94, 0.25)",
      glow: "rgba(244, 63, 94, 0.15)",
      pointColor: "var(--color-accent-rose)",
    },
    hard: {
      icon: "⭐",
      label: "Big Quest",
      bg: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.25)",
      glow: "rgba(245, 158, 11, 0.15)",
      pointColor: "var(--color-accent-amber)",
    },
    normal: {
      icon: "🎯",
      label: "Quest",
      bg: "rgba(74, 222, 128, 0.10)",
      border: "rgba(74, 222, 128, 0.20)",
      glow: "rgba(74, 222, 128, 0.12)",
      pointColor: "var(--color-accent-mint)",
    },
  };

  const config = tierConfig[tier];

  if (completed) {
    return (
      <div
        ref={cardRef}
        className="relative flex items-center gap-3 p-4 rounded-[1.25rem] transition-all duration-500"
        style={{
          background: "rgba(74, 222, 128, 0.06)",
          border: "1px solid rgba(74, 222, 128, 0.15)",
          opacity: 0.6,
        }}
      >
        <div className="w-12 h-12 rounded-2xl grid place-items-center text-xl shrink-0 bg-emerald-500/15">
          ✅
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text-muted line-through">{task.title}</h3>
          <p className="text-[11px] text-text-muted mt-0.5">Completed! +{task.points} pts</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleTap}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleTap();
        }
      }}
      className={`quest-card relative flex items-center gap-3 p-4 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer tap"}`}
      style={{
        background: `linear-gradient(135deg, ${config.bg}, rgba(255,255,255,0.03))`,
        border: `1px solid ${config.border}`,
        borderRadius: "1.25rem",
        transform: isPressed ? "scale(0.95)" : "scale(1)",
        transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
        boxShadow: `0 4px 16px ${config.glow}`,
      }}
      aria-label={disabled ? `${task.title} — disabled` : `Complete quest: ${task.title} for ${task.points} points`}
    >
      {/* Quest icon */}
      <div
        className="w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0"
        style={{
          background: config.bg,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1)`,
        }}
      >
        {task.emoji || config.icon}
      </div>

      {/* Quest info */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-text-primary leading-tight">
          {task.title}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: config.pointColor }}>
            {config.label}
          </span>
          {task.assignee && (
            <>
              <span className="text-text-dim">·</span>
              <span className="text-[10px] text-text-secondary">{task.assignee.split(" ")[0]}</span>
            </>
          )}
          {task.due && (
            <>
              <span className="text-text-dim">·</span>
              <span className="text-[10px] text-text-secondary">{task.due}</span>
            </>
          )}
        </div>
      </div>

      {/* Points badge */}
      <div
        className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-2xl"
        style={{
          background: `linear-gradient(135deg, ${config.bg}, transparent)`,
          border: `1px solid ${config.border}`,
        }}
      >
        <span className="text-lg font-black tabular-nums" style={{ color: config.pointColor }}>
          +{task.points}
        </span>
        <span className="text-[9px] text-text-muted font-bold -mt-0.5">pts</span>
      </div>

      {/* Tap hint (subtle) */}
      {!disabled && !isPressed && (
        <div
          className="absolute inset-0 rounded-[1.25rem] pointer-events-none"
          style={{
            background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03), transparent 70%)",
          }}
        />
      )}

      {/* Local celebration particles (smaller than full-screen burst) */}
      {showCelebration && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[1.25rem]">
          {Array.from({ length: 6 }).map((_, i) => {
            const colors = ["#fbbf24", "#f43f5e", "#3b82f6", "#4ade80", "#a855f7", "#06b6d4"];
            const color = colors[i % colors.length];
            const x = (Math.random() - 0.5) * 80;
            const y = -(20 + Math.random() * 40);
            return (
              <span
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  left: "50%",
                  top: "50%",
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                  animation: `questParticle 0.6s ease-out ${i * 0.04}s forwards`,
                  "--px": `${x}px`,
                  "--py": `${y}px`,
                } as React.CSSProperties}
              />
            );
          })}
          {/* Local points fly */}
          <span
            className="absolute left-1/2 top-1/3 -translate-x-1/2 text-base font-black tabular-nums"
            style={{
              color: "#fbbf24",
              textShadow: "0 0 10px rgba(251, 191, 36, 0.5)",
              animation: "questLocalFly 0.7s ease-out forwards",
            }}
          >
            +{task.points}
          </span>
        </div>
      )}

      <style>{`
        @keyframes questParticle {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--px)), calc(-50% + var(--py))) scale(0); }
        }
        @keyframes questLocalFly {
          0%   { opacity: 0; transform: translate(-50%, 0) scale(0.5); }
          20%  { opacity: 1; transform: translate(-50%, -5px) scale(1.2); }
          100% { opacity: 0; transform: translate(-50%, -35px) scale(0.5); }
        }
      `}</style>
    </div>
  );
}
