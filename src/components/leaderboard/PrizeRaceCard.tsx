"use client";

import SectionCard from "@/components/patterns/SectionCard";
import Avatar from "@/components/ui/Avatar";
import { raceGap } from "@/lib/task-utils";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";

interface PrizeRaceCardProps {
  prizes: WeeklyPrize[];
  entries: LeaderboardEntry[];
  daysUntilReset: number;
  myName?: string | null;
}

export default function PrizeRaceCard({ prizes, entries, daysUntilReset, myName }: PrizeRaceCardProps) {
  // No prizes configured → no card at all (an empty shell would be noise).
  if (prizes.length === 0) return null;

  // Holder = the member whose points > 0 whose COMPETITION rank (1 + count of
  // members with strictly more points) equals the prize rank — recomputed here
  // from points (entry.rank is not trusted). Ties share a rank, so a rank can
  // have two holders and the next rank can be empty ("Up for grabs").
  const holdersForRank = (rank: number): LeaderboardEntry[] =>
    entries.filter((e) => e.points > 0 && 1 + entries.filter((o) => o.points > e.points).length === rank);

  const weekHasPoints = entries.some((e) => e.points > 0);

  // Personal gap line: only when someone is signed in AND the week has any
  // points at all (a zero-point week gets the honest "Up for grabs" rows only).
  let personalLine: string | null = null;
  if (myName && weekHasPoints) {
    const pointsMap = Object.fromEntries(entries.map((e) => [e.name, e.points]));
    const gap = raceGap(myName, pointsMap, prizes.length);
    if (gap.onPodium && gap.rank === 1) {
      personalLine = "🏆 You're in the lead — keep it up!";
    } else if (gap.onPodium) {
      personalLine = "👏 You're in a prize spot — keep it up!";
    } else if (gap.rank === null) {
      personalLine = "Earn points to join this week's race!";
    } else if (gap.gapToPodium !== null) {
      personalLine = `You're ${gap.gapToPodium} pts from a prize — keep going!`;
    }
  }

  return (
    <SectionCard
      title="Weekly prizes"
      icon="🏆"
      tone="#f59e0b"
      action={
        <span className="text-xs font-semibold text-text-secondary whitespace-nowrap">
          ⏳ Resets in {daysUntilReset} day{daysUntilReset !== 1 ? "s" : ""}
        </span>
      }
    >
      <ul className="space-y-2">
        {prizes.map((prize) => {
          const holders = holdersForRank(prize.rank);
          return (
            <li
              key={prize.id}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <span aria-hidden="true" className="text-base leading-none">{prize.emoji}</span>
              <span className="min-w-0 flex-1 text-sm text-text-primary">{prize.text}</span>
              {holders.length > 0 ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-accent-amber)]">
                  {holders.map((h) => (
                    <span key={h.name} className="inline-flex items-center gap-1">
                      <Avatar name={h.name} color={h.color} emoji={h.emoji} size="xs" variant="emoji" />
                      {h.name.split(" ")[0]}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-text-muted">Up for grabs</span>
              )}
            </li>
          );
        })}
      </ul>
      {!weekHasPoints ? (
        <p className="mt-3 text-sm text-text-secondary">
          New race started — prizes reset Monday to Monday.
        </p>
      ) : (
        personalLine && (
          <p aria-live="polite" className="mt-3 text-sm text-text-secondary">
            {personalLine}
          </p>
        )
      )}
    </SectionCard>
  );
}
