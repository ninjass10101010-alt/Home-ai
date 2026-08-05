"use client";

import Avatar from "@/components/ui/Avatar";
import IconButton from "@/components/ui/IconButton";
import RankArrow from "./RankArrow";

interface PodiumSlotProps {
  entry: any;
  rank: number;
  heightClass: string;
  medalEmoji: string;
  bgClass: string;
  isYou: boolean;
  color: string;
  previousRank: number | undefined;
  onClick: () => void;
  onAdjust: () => void;
  isAdmin: boolean;
}

function PodiumSlot({
  entry, rank, heightClass, medalEmoji, bgClass, isYou, color, previousRank,
  onClick, onAdjust, isAdmin,
}: PodiumSlotProps) {
  return (
    <div className={`flex flex-col items-center ${heightClass}`}>
      <div
        className={`relative rounded-2xl border p-3 min-w-[120px] cursor-pointer ${bgClass} ${isYou ? "widget-row-glow" : ""} transition hover:scale-105 active:scale-95`}
        style={isYou ? ({ "--row-color": color } as React.CSSProperties) : undefined}
        onClick={onClick}
      >
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-2xl animate-crown-glow">{medalEmoji}</div>
        <div className="flex flex-col items-center gap-1.5 mt-1">
          <Avatar name={entry.name} color={color} emoji={entry.emoji} size="md" variant="emoji" glow={rank === 1} />
          <span className="text-sm font-bold text-text-primary truncate max-w-full">
            {entry.name.split(" ")[0]}
          </span>
          {isYou && (
            <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ background: `${color}25`, color }}>
              You
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-text-primary display-numeral">{entry.points}</span>
            <span className="text-[10px] text-text-muted">pts</span>
          </div>
          <div className="flex items-center gap-1.5">
            {entry.streak > 0 && <span className="text-xs text-amber-400 font-semibold">🔥{entry.streak}d</span>}
            <span className="text-xs text-text-muted">{entry.levelEmoji} {entry.levelTitle}</span>
            <RankArrow currentRank={rank} previousRank={previousRank} />
          </div>
        </div>
        {isAdmin && (
          <div className="absolute top-1 right-1">
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={`Adjust points for ${entry.name}`}
              onClick={(e) => { e.stopPropagation(); onAdjust(); }}
            >
              ⚙️
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

interface PodiumProps {
  entries: any[];
  previousRanks: Record<string, number>;
  isYou: (name: string) => boolean;
  getMemberColor: (name: string) => string;
  onOpenSheet: (name: string) => void;
  onAdjust: (name: string) => void;
  isAdmin: boolean;
}

export default function Podium({
  entries, previousRanks, isYou, getMemberColor,
  onOpenSheet, onAdjust, isAdmin,
}: PodiumProps) {
  if (entries.length === 0) return null;

  const first = entries[0];
  const second = entries.length > 1 ? entries[1] : null;
  const third = entries.length > 2 ? entries[2] : null;

  return (
    <div className="flex items-end justify-center gap-2 py-2">
      {second && (
        <PodiumSlot
          entry={second} rank={2} heightClass="h-[170px]" medalEmoji="🥈"
          bgClass="bg-slate-300/10 border-slate-300/15"
          isYou={isYou(second.name)} color={getMemberColor(second.name)}
          previousRank={previousRanks[second.name]}
          onClick={() => onOpenSheet(second.name)}
          onAdjust={() => onAdjust(second.name)}
          isAdmin={isAdmin}
        />
      )}
      <PodiumSlot
        entry={first} rank={1} heightClass="h-[200px]" medalEmoji="🥇"
        bgClass="bg-amber-400/15 border-amber-400/25 animate-rank-pulse min-w-[140px]"
        isYou={isYou(first.name)} color={getMemberColor(first.name)}
        previousRank={previousRanks[first.name]}
        onClick={() => onOpenSheet(first.name)}
        onAdjust={() => onAdjust(first.name)}
        isAdmin={isAdmin}
      />
      {third && (
        <PodiumSlot
          entry={third} rank={3} heightClass="h-[150px]" medalEmoji="🥉"
          bgClass="bg-amber-700/10 border-amber-700/15"
          isYou={isYou(third.name)} color={getMemberColor(third.name)}
          previousRank={previousRanks[third.name]}
          onClick={() => onOpenSheet(third.name)}
          onAdjust={() => onAdjust(third.name)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
