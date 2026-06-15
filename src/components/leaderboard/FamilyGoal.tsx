/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import { loadFamilyGoal, saveFamilyGoal, getFamilyGoalProgress } from "@/lib/task-utils";
import type { WeekData, FamilyGoal } from "@/types/tasks";
import { useState, useEffect } from "react";

interface FamilyGoalProps {
  weekData: WeekData;
  isParent: boolean;
}

export default function FamilyGoalCard({ weekData, isParent }: FamilyGoalProps) {
  const [goal, setGoal] = useState<FamilyGoal | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("Family outing 🎡");
  const [target, setTarget] = useState("200");
  const [reward, setReward] = useState("Movie night! 🍿");

  useEffect(() => {
    setGoal(loadFamilyGoal());
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const progress = getFamilyGoalProgress(weekData, goal);
  const totalEarned = Object.values(weekData.points).reduce((a, b) => a + b, 0);
  const isComplete = goal && totalEarned >= goal.targetPoints;

  const handleCreateGoal = () => {
    const newGoal: FamilyGoal = {
      id: Date.now(),
      title,
      emoji: title.match(/\p{Emoji}/u)?.[0] || "🎯",
      targetPoints: parseInt(target) || 200,
      reward,
      weekStart: weekData.weekStart,
    };
    saveFamilyGoal(newGoal);
    setGoal(newGoal);
    setShowForm(false);
  };

  if (!goal && !showForm) {
    return (
      <SectionCard title="Family Goal" description="Set a shared weekly goal!" icon="🎯">
        {isParent ? (
          <SoftButton onClick={() => setShowForm(true)} className="w-full">Set a Family Goal</SoftButton>
        ) : (
          <p className="text-sm text-text-muted text-center py-2">Ask a parent to set a family goal!</p>
        )}
      </SectionCard>
    );
  }

  if (showForm) {
    return (
      <SectionCard title="Create Family Goal" icon="🎯">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Goal</span>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Family outing 🎡" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Target points</span>
            <input type="number" value={target} onChange={e => setTarget(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Reward when achieved</span>
            <input value={reward} onChange={e => setReward(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Movie night! 🍿" />
          </label>
          <div className="flex gap-2">
            <SoftButton onClick={handleCreateGoal} className="flex-1">Create</SoftButton>
            <SoftButton variant="secondary" onClick={() => setShowForm(false)} className="flex-1">Cancel</SoftButton>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={goal?.emoji + " " + (goal?.title || "Family Goal")}
      description={isComplete ? "🎉 Goal achieved! Great teamwork!" : `${totalEarned} / ${goal?.targetPoints} pts this week`}
      icon="🎯"
    >
      <div className="space-y-3">
        <div className="h-4 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-[var(--color-accent-selected)]/50 to-[var(--color-accent-selected)]"}`}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">{totalEarned} pts earned</span>
          <span className={`font-semibold ${isComplete ? "text-emerald-400" : "text-text-secondary"}`}>
            {isComplete ? "✨ Complete!" : `${progress}%`}
          </span>
        </div>
        {goal?.reward && (
          <p className="text-xs text-text-secondary text-center">
            Reward: <span className="font-semibold text-text-primary">{goal.reward}</span>
          </p>
        )}
        {isParent && (
          <SoftButton variant="ghost" onClick={() => { localStorage.removeItem("consuela-family-goal"); setGoal(null); }} className="w-full text-xs">
            Remove goal
          </SoftButton>
        )}
      </div>
    </SectionCard>
  );
}