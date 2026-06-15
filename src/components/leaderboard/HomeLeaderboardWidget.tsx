"use client";

import Link from "next/link";
import { useLeaderboardData } from "./hooks/useLeaderboardData";
import { useAuth } from "@/hooks/useAuth";
import SectionCard from "@/components/patterns/SectionCard";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import RankArrow from "./RankArrow";
import { getGapMessage } from "@/lib/task-utils";

function PodiumRow({
  entry,
  rank,
  isYou,
  previousRank,
  memberColor,
}: {
  entry: any;
  rank: number;
  isYou: boolean;
  previousRank: number | undefined;
  memberColor: string;
}) {
  const bgClass =
    rank === 1
      ? "bg-amber-400/15 border-amber-400/25"
      : rank === 2
      ? "bg-slate-300/10 border-slate-300/15"
      : "bg-amber-700/10 border-amber-700/15";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${bgClass} ${
        isYou ? "widget-row-glow" : ""
      }`}
      style={isYou ? { "--row-color": memberColor } as React.CSSProperties : undefined}
    >
      <span className="text-lg shrink-0">
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}
      </span>
      <Avatar name={entry.name} color={memberColor} emoji={entry.emoji} size="sm" variant="emoji" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-text-primary">
            {entry.name.split(" ")[0]}
          </span>
          {isYou && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: `${memberColor}25`,
                color: memberColor,
              }}
            >
              You
            </span>
          )}
          {entry.streak > 0 && (
            <span className="text-xs text-amber-400 font-semibold">
              🔥{entry.streak}d
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold text-text-primary display-numeral">
          {entry.points}
        </span>
        <span className="text-[10px] text-text-muted">pts</span>
        <RankArrow currentRank={rank} previousRank={previousRank} />
      </div>
    </div>
  );
}

function OtherRow({
  entry,
  isYou,
  previousRank,
  memberColor,
}: {
  entry: any;
  isYou: boolean;
  previousRank: number | undefined;
  memberColor: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-white/5 px-3 py-2 ${
        isYou ? "widget-row-glow" : ""
      }`}
      style={isYou ? { "--row-color": memberColor } as React.CSSProperties : undefined}
    >
      <span className="text-xs font-bold text-text-secondary shrink-0 w-5 text-center">
        #{entry.rank}
      </span>
      <Avatar name={entry.name} color={memberColor} emoji={entry.emoji} size="xs" variant="emoji" />
      <span className="truncate text-sm text-text-secondary flex-1">{entry.name.split(" ")[0]}</span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold text-text-secondary display-numeral">{entry.points}</span>
        <span className="text-[10px] text-text-muted">pts</span>
        <RankArrow currentRank={entry.rank} previousRank={previousRank} />
      </div>
    </div>
  );
}

export default function HomeLeaderboardWidget() {
  const { data, mounted } = useLeaderboardData();
  const { currentUser, isLoggedIn } = useAuth();

  if (!mounted) {
    return (
      <SectionCard title="This Week's Leaderboard" icon="🏆">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  const { entries, daysUntilReset, previousRanks } = data;

  if (entries.length === 0 || entries.every(e => e.points === 0)) {
    return (
      <Link href="/tasks" className="block active:scale-[0.99] transition-transform">
        <SectionCard title="This Week's Leaderboard" icon="🏆">
          <EmptyState
            title="Be the first!"
            description="Complete a task to start the race this week."
            icon="👑"
          />
        </SectionCard>
      </Link>
    );
  }

  const top3 = entries.slice(0, 3);
  const others = entries.slice(3, 4);
  const myEntry = isLoggedIn && currentUser
    ? entries.find((e: any) => e.name === currentUser.name || e.name.startsWith(currentUser.name))
    : null;

  return (
    <Link href="/tasks" className="block active:scale-[0.99] transition-transform">
      <SectionCard
        title="This Week's Leaderboard"
        description={`Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? "s" : ""}`}
        icon="🏆"
        action={<span className="text-sm font-medium text-[var(--color-accent-selected)]">See all →</span>}
      >
        {isLoggedIn && myEntry && (
          <div
            className="mb-3 rounded-2xl border px-3 py-2 flex items-center gap-2.5 widget-row-glow"
            style={{
              borderColor: `${myEntry.color || "var(--color-accent-selected)"}40`,
              "--row-color": myEntry.color || "var(--color-accent-selected)",
              background: `${myEntry.color || "var(--color-accent-selected)"}08`,
            } as React.CSSProperties}
          >
            <Avatar name={myEntry.name} color={myEntry.color || "green"} emoji={myEntry.emoji} size="xs" variant="emoji" />
            <div className="text-sm min-w-0 flex-1">
              <span className="font-semibold text-text-primary">You:</span>{" "}
              <span className="text-text-secondary">#{myEntry.rank}</span>{" "}
              <span className="font-bold text-[var(--color-accent-selected)]">{myEntry.points} pts</span>
              {myEntry.rank > 1 && (
                <span className="text-text-muted text-xs ml-1.5">
                  {getGapMessage(myEntry, entries[myEntry.rank - 2])}
                </span>
              )}
              {myEntry.rank === 1 && (
                <span className="text-amber-400 text-xs ml-1.5 font-semibold">👑 Leading!</span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {top3.map((entry: any, i: number) => (
            <PodiumRow
              key={entry.name}
              entry={entry}
              rank={i + 1}
              isYou={isLoggedIn && !!currentUser && (entry.name === currentUser.name || entry.name.startsWith(currentUser.name))}
              previousRank={previousRanks[entry.name]}
              memberColor={entry.color || "green"}
            />
          ))}
          {others.map((entry: any) => (
            <OtherRow
              key={entry.name}
              entry={entry}
              isYou={isLoggedIn && !!currentUser && (entry.name === currentUser.name || entry.name.startsWith(currentUser.name))}
              previousRank={previousRanks[entry.name]}
              memberColor={entry.color || "green"}
            />
          ))}
        </div>

        {entries.length > 4 && (
          <p className="mt-2 text-center text-xs text-text-muted">
            +{entries.length - 4} more · Tap to see full leaderboard
          </p>
        )}
      </SectionCard>
    </Link>
  );
}
