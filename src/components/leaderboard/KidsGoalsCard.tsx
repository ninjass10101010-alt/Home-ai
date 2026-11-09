"use client";

import { useState, useEffect } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import Surface from "@/components/ui/Surface";
import Avatar from "@/components/ui/Avatar";
import SoftButton from "@/components/ui/SoftButton";
import type { KidGoalView } from "@/lib/goals";

interface KidsGoalsCardProps {
  isParent?: boolean;
  currentUserName?: string | null;
  onRefresh?: () => void;
}

export default function KidsGoalsCard({
  isParent = false,
  currentUserName,
  onRefresh,
}: KidsGoalsCardProps) {
  const [goals, setGoals] = useState<KidGoalView[]>([]);
  const [cycleInfo, setCycleInfo] = useState<{ cycleStart: string; cycleEnd: string; daysRemaining: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingKid, setEditingKid] = useState<KidGoalView | null>(null);
  const [editTarget, setEditTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const fetchGoals = async () => {
    try {
      const res = await fetch("/api/goals");
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.goals)) {
          setGoals(data.goals);
          setCycleInfo(data.cycle);
        }
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  const handleSaveGoal = async () => {
    if (!editingKid) return;
    const num = parseInt(editTarget, 10);
    if (isNaN(num) || num < 1) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member: editingKid.member,
          targetPoints: num,
          cycleStart: editingKid.cycleStart,
        }),
      });
      if (res.ok) {
        await fetchGoals();
        setEditingKid(null);
        if (onRefresh) onRefresh();
      }
    } catch {}
    setSaving(false);
  };

  if (loading) {
    return (
      <SectionCard title="2-Week Goals" icon="🎯" description="Individual goals scaled to age & schedule">
        <div className="py-6 text-center text-sm text-text-muted">Loading goals...</div>
      </SectionCard>
    );
  }

  if (goals.length === 0) return null;

  // Format cycle range label (e.g. "Nov 9 – Nov 22")
  const formatCycleRange = (start?: string, end?: string) => {
    if (!start || !end) return "";
    try {
      const s = new Date(`${start}T00:00:00`);
      const e = new Date(`${end}T00:00:00`);
      const sStr = s.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const eStr = e.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `${sStr} – ${eStr}`;
    } catch {
      return `${start} to ${end}`;
    }
  };

  const cycleRange = cycleInfo ? formatCycleRange(cycleInfo.cycleStart, cycleInfo.cycleEnd) : "";

  // Sort: logged in user first, then by progress percentage descending
  const myFirstName = currentUserName ? currentUserName.split(" ")[0].toLowerCase() : "";
  const sortedGoals = [...goals].sort((a, b) => {
    const aIsMe = myFirstName && (a.displayName.toLowerCase() === myFirstName || a.member.toLowerCase().includes(myFirstName));
    const bIsMe = myFirstName && (b.displayName.toLowerCase() === myFirstName || b.member.toLowerCase().includes(myFirstName));
    if (aIsMe && !bIsMe) return -1;
    if (!aIsMe && bIsMe) return 1;
    return b.progress - a.progress;
  });

  return (
    <SectionCard
      title="2-Week Goals"
      icon="🎯"
      description={`${cycleRange ? `${cycleRange} • ` : ""}${cycleInfo?.daysRemaining ?? 14} days left`}
    >
      <div className="mb-3 text-xs text-text-muted">
        Individual targets tailored to custody schedules and ages — everyone has their own summit to reach!
      </div>

      <div className="space-y-3">
        {sortedGoals.map((g) => {
          const isMe = myFirstName && (g.displayName.toLowerCase() === myFirstName || g.member.toLowerCase().includes(myFirstName));
          const isDone = g.status === "completed" || g.currentPoints >= g.targetPoints;
          const isPartTime = g.displayName === "Emily" || g.displayName === "Bailey";

          return (
            <Surface
              key={g.id || g.member}
              variant={isMe ? "glass" : "glass-subtle"}
              radius="xl"
              padding="md"
              className={`transition-all ${isMe ? "ring-2 ring-[var(--color-accent-amber)]" : ""}`}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={g.displayName} emoji={g.emoji} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-text-primary truncate">{g.displayName}</span>
                      {g.age && <span className="text-[11px] text-text-muted">({g.age}y)</span>}
                      {isPartTime ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                          Alternating
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                          Full-time
                        </span>
                      )}
                      {isMe && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)] font-bold">
                          You
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right">
                  <div>
                    <span className="text-sm font-bold text-text-primary">
                      {g.currentPoints}
                    </span>
                    <span className="text-xs text-text-muted font-normal"> / {g.targetPoints} pts</span>
                  </div>
                  {isParent && (
                    <button
                      onClick={() => {
                        setEditingKid(g);
                        setEditTarget(String(g.targetPoints));
                      }}
                      className="text-xs text-text-muted hover:text-text-primary p-1 rounded transition-colors"
                      aria-label={`Edit target for ${g.displayName}`}
                      title="Edit target points"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-black/20 rounded-full h-2.5 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    isDone
                      ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                      : "bg-gradient-to-r from-[var(--color-accent-amber)] to-amber-400"
                  }`}
                  style={{ width: `${Math.max(4, Math.min(100, g.progress))}%` }}
                />
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                {isDone ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    🎉 Goal Reached! (+{g.bonusPoints} bonus pts)
                  </span>
                ) : (
                  <span className="text-text-muted">
                    {g.targetPoints - g.currentPoints} pts to go
                  </span>
                )}
                <span className="text-text-muted font-medium">{g.progress}%</span>
              </div>
            </Surface>
          );
        })}
      </div>

      {/* Parent Target Editor Modal */}
      {editingKid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <Surface variant="material-thick" radius="2xl" padding="lg" className="w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-text-primary">
              Adjust Goal for {editingKid.displayName}
            </h3>
            <p className="text-xs text-text-secondary">
              Set the 2-week target points for {editingKid.displayName} ({cycleRange}).
            </p>
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">
                Target Points
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={editTarget}
                onChange={(e) => setEditTarget(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/10 text-text-primary text-sm focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <SoftButton
                variant="secondary"
                className="flex-1 text-sm py-2"
                onClick={() => setEditingKid(null)}
                disabled={saving}
              >
                Cancel
              </SoftButton>
              <SoftButton
                variant="primary"
                className="flex-1 text-sm py-2"
                onClick={handleSaveGoal}
                disabled={saving || !editTarget}
              >
                {saving ? "Saving..." : "Save Goal"}
              </SoftButton>
            </div>
          </Surface>
        </div>
      )}
    </SectionCard>
  );
}
