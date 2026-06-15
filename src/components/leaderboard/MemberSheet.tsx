"use client";

import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Avatar from "@/components/ui/Avatar";
import Surface from "@/components/ui/Surface";
import Chip from "@/components/ui/Chip";
import { BADGES } from "@/types/tasks";
import { getLevel } from "@/types/tasks";

interface MemberSheetProps {
  open: boolean;
  entry: any;
  allTimePoints: number;
  allTimeComps: number;
  weeklyPoints: number;
  pendingTasks: any[];
  affordableRewards: any[];
  weekGraph: { day: string; points: number }[];
  onClose: () => void;
  getMemberColor: (name: string) => string;
}

export default function MemberSheet({
  open,
  entry,
  allTimePoints,
  allTimeComps,
  weeklyPoints,
  pendingTasks,
  affordableRewards,
  weekGraph,
  onClose,
  getMemberColor,
}: MemberSheetProps) {
  if (!entry) return null;
  const color = getMemberColor(entry.name);
  const earnedBadgeObjects = BADGES.filter(b => b.condition(allTimePoints, entry.streak, allTimeComps));
  const lockedBadges = BADGES.filter(b => !b.condition(allTimePoints, entry.streak, allTimeComps));
  const levelInfo = getLevel(allTimePoints);
  const maxGraphPoints = Math.max(1, ...weekGraph.map(d => d.points));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry.name.split(" ")[0]}
      description={`${entry.levelEmoji} ${entry.levelTitle} · Rank #${entry.rank}`}
      footer={<SoftButton variant="secondary" onClick={onClose} className="w-full">Close</SoftButton>}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={entry.name} color={color} emoji={entry.emoji} size="lg" variant="emoji" glow={entry.rank === 1} />
          <div>
            <div className="text-2xl font-bold text-text-primary display-numeral">{weeklyPoints} <span className="text-sm text-text-muted font-normal">pts this week</span></div>
            <div className="text-sm text-text-secondary">{allTimePoints} all-time · {allTimeComps} tasks completed</div>
            {entry.streak > 0 && <div className="mt-1 text-amber-400 text-sm font-semibold">🔥 {entry.streak}-day streak</div>}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">This Week</p>
          <div className="flex items-end gap-1 h-16">
            {weekGraph.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-[var(--color-accent-selected)]/40 to-[var(--color-accent-selected)] transition-all duration-500"
                  style={{ height: `${Math.max(2, (d.points / maxGraphPoints) * 56)}px` }}
                />
                <span className="text-[9px] text-text-muted">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {earnedBadgeObjects.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Badges ({earnedBadgeObjects.length})</p>
            <div className="grid grid-cols-4 gap-2">
              {earnedBadgeObjects.map((b) => (
                <div key={b.id} className="flex flex-col items-center gap-0.5 rounded-xl bg-white/5 p-2">
                  <span className="text-lg animate-badge-sparkle">{b.emoji}</span>
                  <span className="text-[9px] text-text-secondary text-center leading-tight">{b.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lockedBadges.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Locked ({lockedBadges.length})</p>
            <div className="grid grid-cols-4 gap-2">
              {lockedBadges.slice(0, 8).map((b) => (
                <div key={b.id} className="flex flex-col items-center gap-0.5 rounded-xl bg-white/3 p-2 opacity-40">
                  <span className="text-lg">❓</span>
                  <span className="text-[9px] text-text-muted text-center leading-tight">{b.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {affordableRewards.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Can Redeem Now</p>
            <div className="flex flex-wrap gap-2">
              {affordableRewards.map((r: any) => (
                <Chip key={r.id} size="sm" tone="accent">{r.emoji} {r.name} ({r.cost}pts)</Chip>
              ))}
            </div>
          </div>
        )}

        {pendingTasks.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Pending Tasks</p>
            <div className="space-y-1.5">
              {pendingTasks.slice(0, 5).map((t: any) => (
                <Surface key={t.id} variant="glass-subtle" radius="xl" padding="sm">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-base">{t.assigneeEmoji}</span>
                    <span className="flex-1 truncate text-text-primary">{t.title}</span>
                    <Chip size="sm" tone="success">+{t.points}pts</Chip>
                  </div>
                </Surface>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Level Progress</p>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)]/50 to-[var(--color-accent-selected)] animate-progress-fill"
              style={{ width: `${Math.max(2, levelInfo.progress)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>{levelInfo.title}</span>
            <span>{levelInfo.progress}% to next</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
