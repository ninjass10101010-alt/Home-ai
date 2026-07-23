/**
 * LearningWidget — Track kids' education progress.
 *
 * Shows:
 *   - Math/science streak and progress
 *   - Reading minutes tracker
 *   - Learning milestones as bonus quests
 *   - Weekly learning summary for parents
 *
 * Requires: Khan Academy connected via Settings → Connections.
 * Falls back to manual tracking if not connected.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import { isConnected } from "@/lib/connections/store";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";

interface LearningGoal {
  id: string;
  subject: string;
  emoji: string;
  target: number;
  current: number;
  unit: string;
}

const SUBJECTS = [
  { id: "math", name: "Math", emoji: "🔢", color: "rgba(59, 130, 246, 0.15)", textColor: "#60a5fa" },
  { id: "reading", name: "Reading", emoji: "📚", color: "rgba(168, 85, 247, 0.15)", textColor: "#a855f7" },
  { id: "science", name: "Science", emoji: "🔬", color: "rgba(74, 222, 128, 0.15)", textColor: "#4ade80" },
  { id: "writing", name: "Writing", emoji: "✏️", color: "rgba(245, 158, 11, 0.15)", textColor: "#f59e0b" },
];

export default function LearningWidget() {
  const [enabled, setEnabled] = useState(false);
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [streak, setStreak] = useState(0);
  const { currentUser } = useAuth();
  const { mode } = useDashboardMode();

  const isKid = mode === "kid";

  useEffect(() => {
    // Check if Khan Academy is connected
    setEnabled(isConnected("khan_academy"));
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    // Load learning goals
    try {
      const stored = localStorage.getItem(`consuela-learning-${currentUser.name}`);
      if (stored) {
        setGoals(JSON.parse(stored));
      } else {
        // Default weekly goals
        setGoals([
          { id: "math", subject: "Math", emoji: "🔢", target: 30, current: 12, unit: "min" },
          { id: "reading", subject: "Reading", emoji: "📚", target: 60, current: 35, unit: "min" },
          { id: "science", subject: "Science", emoji: "🔬", target: 20, current: 8, unit: "min" },
          { id: "writing", subject: "Writing", emoji: "✏️", target: 15, current: 15, unit: "min" },
        ]);
      }

      const storedStreak = parseInt(localStorage.getItem(`consuela-learning-streak-${currentUser.name}`) || "0");
      setStreak(storedStreak);
    } catch {}
  }, [currentUser]);

  const logMinutes = useCallback((subjectId: string, minutes: number) => {
    if (!currentUser) return;

    const updated = goals.map((g) =>
      g.id === subjectId ? { ...g, current: Math.min(g.current + minutes, g.target * 2) } : g
    );
    setGoals(updated);
    localStorage.setItem(`consuela-learning-${currentUser.name}`, JSON.stringify(updated));

    // Update streak if all goals met
    const allMet = updated.every((g) => g.current >= g.target);
    if (allMet) {
      const newStreak = streak + 1;
      setStreak(newStreak);
      localStorage.setItem(`consuela-learning-streak-${currentUser.name}`, String(newStreak));
    }
  }, [goals, currentUser, streak]);

  const resetWeekly = useCallback(() => {
    if (!currentUser) return;
    const reset = goals.map((g) => ({ ...g, current: 0 }));
    setGoals(reset);
    localStorage.setItem(`consuela-learning-${currentUser.name}`, JSON.stringify(reset));
  }, [goals, currentUser]);

  const totalCurrent = goals.reduce((sum, g) => sum + g.current, 0);
  const totalTarget = goals.reduce((sum, g) => sum + g.target, 0);
  const overallProgress = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0;

  return (
    <Surface variant={isKid ? "warm" : "glass-subtle"} radius="2xl" padding="none">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📚</span>
            <h3 className="text-sm font-bold text-text-primary">
              {isKid ? "Learning Goals" : "Learning Progress"}
            </h3>
          </div>
          {streak > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
              <span className="text-xs">🔥</span>
              <span className="text-[10px] font-bold text-amber-400">{streak} day streak!</span>
            </div>
          )}
        </div>

        {/* Overall Progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-text-muted">This Week</span>
            <span className="text-[10px] font-bold text-text-primary tabular-nums">{overallProgress}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(overallProgress, 100)}%`,
                background: overallProgress >= 100
                  ? "linear-gradient(90deg, #4ade80, #22c55e)"
                  : "linear-gradient(90deg, var(--color-accent-selected), var(--color-accent-violet))",
              }}
            />
          </div>
          <p className="text-[10px] text-text-muted mt-1 tabular-nums">
            {totalCurrent} / {totalTarget} minutes
          </p>
        </div>

        {/* Subject Progress */}
        <div className="space-y-2.5 mb-4">
          {goals.map((goal) => {
            const subject = SUBJECTS.find((s) => s.id === goal.id) || SUBJECTS[0];
            const progress = Math.min(Math.round((goal.current / goal.target) * 100), 100);
            const isComplete = goal.current >= goal.target;

            return (
              <div key={goal.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{subject.emoji}</span>
                    <span className={`text-xs font-semibold ${isComplete ? "text-emerald-400" : "text-text-primary"}`}>
                      {goal.subject}
                    </span>
                    {isComplete && <span className="text-xs">✅</span>}
                  </div>
                  <span className="text-[10px] text-text-muted tabular-nums">
                    {goal.current}/{goal.target} {goal.unit}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${progress}%`,
                      background: isComplete
                        ? "linear-gradient(90deg, #4ade80, #22c55e)"
                        : subject.color.replace("0.15", "0.8"),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Kid Mode: Log minutes buttons */}
        {isKid && (
          <div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
              Log Learning Time
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SUBJECTS.map((subject) => (
                <div key={subject.id} className="flex gap-1">
                  <SoftButton
                    variant="secondary"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => logMinutes(subject.id, 5)}
                  >
                    {subject.emoji} +5m
                  </SoftButton>
                  <SoftButton
                    variant="secondary"
                    size="sm"
                    className="w-12 text-xs"
                    onClick={() => logMinutes(subject.id, 15)}
                  >
                    +15
                  </SoftButton>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parent Mode: Settings */}
        {!isKid && (
          <div className="flex gap-2">
            <SoftButton variant="secondary" size="sm" className="flex-1" onClick={resetWeekly}>
              Reset Week
            </SoftButton>
            <a href="https://www.khanacademy.org" target="_blank" rel="noopener noreferrer" className="flex-1">
              <SoftButton variant="secondary" size="sm" className="w-full">
                Open Khan Academy →
              </SoftButton>
            </a>
          </div>
        )}
      </div>
    </Surface>
  );
}
