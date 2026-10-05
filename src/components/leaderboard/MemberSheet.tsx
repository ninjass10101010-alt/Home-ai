"use client";

import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import Avatar from "@/components/ui/Avatar";
import Surface from "@/components/ui/Surface";
import Chip from "@/components/ui/Chip";
import {
  PROGRESS_UNAVAILABLE_LABEL,
  allTimeCaption,
  allTimeCompletionsCaption,
  allTimeLevelLabel,
  resolveAllTimeLevel,
  splitBadgesWithWeeklyChamp,
} from "./level";
import type { AllTimeReadProp } from "./Podium";

interface MemberSheetProps {
  open: boolean;
  entry: any;
  allTimePoints: number | null;
  allTimeComps: number | null;
  weeklyPoints: number;
  pendingTasks: any[];
  affordableRewards: any[];
  weekGraph: { day: string; points: number }[];
  onClose: () => void;
  getMemberColor: (name: string) => string;
  // The caller computes this from the Hall of Fame (a rank-1 entry earns the
  // Weekly Champ 🥇) — the BADGES.week_champ condition itself is a
  // deliberately dead placeholder.
  hasWeeklyChamp?: boolean;
  allTimeRead: AllTimeReadProp;
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
  hasWeeklyChamp = false,
  allTimeRead,
}: MemberSheetProps) {
  if (!entry) return null;
  const color = getMemberColor(entry.name);
  const { earned: earnedBadgeObjects, locked: lockedBadges } = splitBadgesWithWeeklyChamp(
    allTimePoints,
    entry.streak,
    allTimeComps,
    hasWeeklyChamp
  );
  const levelInfo = resolveAllTimeLevel(allTimePoints);
  const maxGraphPoints = Math.max(1, ...weekGraph.map(d => d.points));
  // Rank 1 on zero points means the whole family is at zero, so the champion
  // glow is earned on points — same rule as the podium's plinth.
  const leadsOnPoints = entry.rank === 1 && (entry.points ?? 0) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry.name.split(" ")[0]}
      description={`${allTimeLevelLabel(levelInfo)} · Rank #${entry.rank}`}
      footer={<SoftButton variant="secondary" onClick={onClose} className="w-full">Close</SoftButton>}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={entry.name} color={color} emoji={entry.emoji} size="lg" variant="emoji" glow={leadsOnPoints} />
          <div>
            <div className="text-2xl font-bold text-text-primary display-numeral">{weeklyPoints} <span className="text-sm text-text-muted font-normal">pts this week</span></div>
            <div className="text-sm text-text-secondary">
              {allTimeCaption(allTimePoints, allTimeRead.state, allTimeRead.updatedAt)} · {allTimeCompletionsCaption(allTimeComps, allTimeRead.state)}
            </div>
            {entry.streak > 0 && <div className="mt-1 text-[var(--color-accent-ink-amber)] text-sm font-semibold">🔥 {entry.streak}-day streak</div>}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">This Week</p>
          {/* The bar height was the ONLY carrier of the points — no role, no
              name, no textual value — so the graph was unreadable to a screen
              reader. The container is one labelled image that enumerates the
              day/point pairs it draws. */}
          <div
            role="img"
            aria-label={`Points by day: ${weekGraph.map((d) => `${d.day} ${d.points} points`).join(", ")}`}
            /* The 1px baseline under the bars is what turns seven floating
               columns into a chart — without it the shapes read as unrelated
               pills. */
            className="flex h-16 items-end gap-1 border-b border-[var(--color-border)] pb-px"
          >
            {weekGraph.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                {/* A day with a KNOWN zero draws no bar: `Math.max(2, …)`
                    overstated it as a stub of progress. A zero day is not
                    unknown — the day simply has no points. */}
                {d.points > 0 ? (
                  <div
                    data-week-bar="true"
                    data-week-day={d.day}
                    className="w-full rounded-t-md bg-gradient-to-t from-[var(--color-accent-selected)]/40 to-[var(--color-accent-selected)] transition-all duration-500"
                    style={{ height: `${(d.points / maxGraphPoints) * 56}px` }}
                  />
                ) : null}
                <span className="text-xs text-text-muted">{d.day}</span>
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
                  <span className="text-xs text-text-secondary text-center leading-tight">{b.name}</span>
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
                  <span className="text-xs text-text-muted text-center leading-tight">{b.name}</span>
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
                <Chip key={r.id} as="span" size="sm" tone="accent">{r.emoji} {r.name} ({r.cost}pts)</Chip>
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
                    {/* Roster-first (2026-09-23 review): these rows belong to
                        the sheet's own member, and the stored assigneeEmoji
                        may be the sanitized "👤" fallback — resolve the real
                        photo from the sheet entry (live-roster emoji). */}
                    <Avatar name={t.assignee} color={getMemberColor(t.assignee)} emoji={t.assignee === entry.name ? entry.emoji : t.assigneeEmoji} size="xs" variant="emoji" />
                    <span className="flex-1 truncate text-text-primary">{t.title}</span>
                    <Chip as="span" size="sm" tone="success">+{t.points}pts</Chip>
                  </div>
                </Surface>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Level Progress</p>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/5">
            {/* A KNOWN 0% (a brand-new member, or one exactly on a threshold)
                draws no fill — the same rule the row's progress bar and the
                week graph use. An UNKNOWN all-time total still shows the
                unavailable label below, never a 0. */}
            {levelInfo.known && levelInfo.progress > 0 && (
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)]/50 to-[var(--color-accent-selected)] animate-progress-fill"
                style={{ width: `${levelInfo.progress}%` }}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between text-xs text-text-muted">
            {levelInfo.known ? (
              <>
                <span>{levelInfo.title}</span>
                {/* `next === null` is the top level. "100% to next" there is a
                    lie: there is no next. The bar above is already full at
                    100%, so the right-hand label says what that means. */}
                <span>{levelInfo.next === null ? "Top level" : `${levelInfo.progress}% to next`}</span>
              </>
            ) : (
              <span>{PROGRESS_UNAVAILABLE_LABEL}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
