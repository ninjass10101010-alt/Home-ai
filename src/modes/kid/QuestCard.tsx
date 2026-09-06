/**
 * QuestCard — A gamified task card for Kid Mode.
 *
 * Features:
 *   - Large touch target (72px min height, 52px touch area)
 *   - Spring-bounce on tap
 *   - Completed state with green checkmark
 *
 * The quest card is the PRIMARY interaction in kid mode.
 * It should feel satisfying, not clinical.
 *
 * Kid-safety contract: tapping a quest does NOT complete it. The card only
 * reports the tap via onComplete — the parent (KidHome) runs the shared
 * server-verified PIN gate and fires the celebration after a SUCCESSFUL
 * completion. No optimistic self-complete, no premature confetti.
 */
"use client";

import { useState, useCallback } from "react";

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
  /** Called when the quest is tapped — the parent gates the real completion behind the PIN flow */
  onComplete: (task: any) => void;
  /** Whether the quest is disabled (e.g. bedtime mode) */
  disabled?: boolean;
}

export default function QuestCard({ task, onComplete, disabled = false }: QuestCardProps) {
  const [isPressed, setIsPressed] = useState(false);

  const handleTap = useCallback(() => {
    if (task.completed || disabled) return;

    // Visual feedback: press down. Completion + celebration belong to the
    // parent's PIN-verified flow, never to this tap.
    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 150);

    onComplete(task);
  }, [disabled, onComplete, task]);

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

  if (task.completed) {
    return (
      <div
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
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: config.pointColor }}>
            {config.label}
          </span>
          {task.assignee && (
            <>
              <span className="text-text-dim">·</span>
              <span className="text-[11px] text-text-secondary">{task.assignee.split(" ")[0]}</span>
            </>
          )}
          {task.due && (
            <>
              <span className="text-text-dim">·</span>
              <span className="text-[11px] text-text-secondary">{task.due}</span>
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
        <span className="text-[11px] text-text-muted font-bold -mt-0.5">pts</span>
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

    </div>
  );
}
