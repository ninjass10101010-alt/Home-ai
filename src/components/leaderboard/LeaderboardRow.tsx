"use client";

import Surface from "@/components/ui/Surface";
import Avatar from "@/components/ui/Avatar";
import IconButton from "@/components/ui/IconButton";
import RankArrow from "./RankArrow";

interface LeaderboardRowProps {
  entry: any;
  index: number;
  previousRank: number | undefined;
  isYou: boolean;
  getMemberColor: (name: string) => string;
  onAdjust: (name: string) => void;
  onOpenSheet: (name: string) => void;
  isAdmin: boolean;
}

export default function LeaderboardRow({
  entry,
  index,
  previousRank,
  isYou,
  getMemberColor,
  onAdjust,
  onOpenSheet,
  isAdmin,
}: LeaderboardRowProps) {
  const color = getMemberColor(entry.name);

  return (
    <Surface
      variant="glass-subtle"
      radius="xl"
      padding="sm"
      className={`cursor-pointer hover:bg-white/[0.03] transition-colors ${isYou ? "widget-row-glow" : ""}`}
      style={isYou ? { "--row-color": color } as React.CSSProperties : undefined}
      onClick={() => onOpenSheet(entry.name)}
    >
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center">
          <div
            className={`grid h-10 w-10 place-items-center rounded-2xl text-sm font-bold ${
              index === 0
                ? "bg-amber-400/20 text-amber-400 animate-rank-pulse"
                : index === 1
                ? "bg-slate-300/15 text-slate-300"
                : index === 2
                ? "bg-amber-700/15 text-amber-600"
                : "bg-[var(--color-accent-selected)]/10 text-text-secondary"
            }`}
          >
            {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
          </div>
        </div>
        <Avatar name={entry.name} color={color} emoji={entry.emoji} size="sm" variant="emoji" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-primary">{entry.name.split(" ")[0]}</span>
            {isYou && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: `${color}25`, color }}
              >
                You
              </span>
            )}
            <span className="text-xs">{entry.levelEmoji}</span>
            {entry.badges.length > 0 && (
              <span className="flex gap-0.5">
                {entry.badges.slice(0, 3).map((b: string, i: number) => (
                  <span key={i} className="text-xs animate-badge-sparkle" style={{ animationDelay: `${i * 0.3}s` }}>
                    {b}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {entry.streak > 0 && (
              <span className="text-xs text-amber-400 font-semibold">🔥{entry.streak}d streak</span>
            )}
            {entry.streak === 0 && entry.points > 0 && (
              <span className="text-xs text-text-muted">Complete a task today!</span>
            )}
            {entry.points === 0 && <span className="text-xs text-text-muted italic">No tasks yet...</span>}
            <RankArrow currentRank={entry.rank} previousRank={previousRank} />
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)]/60 to-[var(--color-accent-selected)] transition-all duration-700 ease-out animate-progress-fill"
              style={{ width: `${Math.max(2, entry.progressToNext)}%` }}
            />
          </div>
          <div className="mt-0.5 text-[10px] text-text-muted">
            {entry.levelTitle} → {entry.progressToNext >= 100 ? "MAX" : `${entry.progressToNext}%`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-text-primary display-numeral">{entry.points}</div>
          <div className="text-[11px] text-text-muted">pts</div>
        </div>
        {isAdmin && (
          <IconButton size="sm" variant="ghost" aria-label="Adjust points" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onAdjust(entry.name); }}>
            ⚙️
          </IconButton>
        )}
      </div>
    </Surface>
  );
}
