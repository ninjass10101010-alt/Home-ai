"use client";

import Avatar from "@/components/ui/Avatar";

interface YourCardProps {
  entry: any;
  aheadEntry: any | undefined;
  getMemberColor: (name: string) => string;
}

export default function YourCard({ entry, aheadEntry, getMemberColor }: YourCardProps) {
  if (!entry) return null;
  const color = getMemberColor(entry.name);
  const gap = aheadEntry ? aheadEntry.points - entry.points : 0;

  return (
    <div
      className="rounded-2xl border px-4 py-3 widget-row-glow"
      style={{
        borderColor: `${color}40`,
        "--row-color": color,
        background: `${color}08`,
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <Avatar name={entry.name} color={color} emoji={entry.emoji} size="sm" variant="emoji" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-text-primary">#{entry.rank}</span>
            <span className="text-sm text-text-secondary">—</span>
            <span className="font-bold text-[var(--color-accent-selected)]">{entry.points} pts</span>
            <span className="text-xs text-text-muted">{entry.levelEmoji} {entry.levelTitle}</span>
          </div>
          <div className="mt-1 text-xs">
            {entry.rank === 1 ? (
              <span className="text-amber-400 font-semibold">👑 You&apos;re in the lead!</span>
            ) : gap > 0 ? (
              <span className="text-text-secondary">
                {gap} pts behind {aheadEntry?.name?.split(" ")[0]} — you can catch up!
              </span>
            ) : (
              <span className="text-text-muted">Complete tasks to climb the board!</span>
            )}
            {entry.streak > 0 && (
              <span className="ml-2 text-amber-400 font-semibold">🔥{entry.streak}d streak</span>
            )}
          </div>
        </div>
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: `${color}15` }}>
          {entry.levelEmoji}
        </div>
      </div>
    </div>
  );
}
