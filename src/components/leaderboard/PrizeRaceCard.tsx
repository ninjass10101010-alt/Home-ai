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
    } else if (gap.gapToPodium !== null) {
      // A member who HOLDS a prize rank but has scored nothing is chasing real
      // points, so they get the real distance. `raceGap` now reports their true
      // competition rank (it used to short-circuit to `rank: null` for anyone on
      // zero, which is what made this arm unreachable and handed them "join the
      // race" while the list above already gave them rank 3).
      personalLine = `You're ${gap.gapToPodium} pts from a prize — keep going!`;
    } else {
      // Nothing measurable to chase: an empty week-to-date, or a rank whose
      // threshold nobody currently holds. Holding no prize IS the honest state
      // (this card's holder rows require points > 0, exactly like raceGap's
      // onPodium), so invite them in rather than inventing a distance.
      personalLine = "Earn points to join this week's race!";
    }
  }

  return (
    <SectionCard
      title="Weekly prizes"
      icon="🏆"
      // Token, not a fixed hex: the amber accent has a dark-theme and a
      // light-theme value, and this card is the one surface on the tab that
      // used to keep the dark tint in both themes.
      tone="var(--color-accent-amber)"
      action={
        // `daysUntilReset` is getDaysUntilWeekReset()'s 1..7 by construction
        // (Monday maps to 7, not 0 — see the helper), so there is no
        // "tonight" state to render: the week never ends at midnight.
        <span className="text-xs font-semibold text-text-secondary whitespace-nowrap">
          {daysUntilReset === 1
            ? "⏳ Resets tomorrow"
            : `⏳ Resets in ${daysUntilReset} days`}
        </span>
      }
    >
      <ul className="space-y-2">
        {prizes.map((prize) => {
          const holders = holdersForRank(prize.rank);
          return (
            <li
              key={prize.id}
              /* `material-thin` instead of `border-white/10 bg-white/[0.04]`: a 4%
                 white wash is invisible against the light theme's near-white
                 card, so the rows had no material identity in one theme and a
                 washed one in the other. The tier is dark glass in dark mode
                 and frosted white in light mode from a single class. */
              className="material-thin flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2"
            >
              <span aria-hidden="true" className="text-base leading-none">{prize.emoji}</span>
              <span className="min-w-0 flex-1 basis-32 text-sm text-text-primary">{prize.text}</span>
              {holders.length > 0 ? (
                /* A rank can have SEVERAL holders (a tie shares it), and three
                   holders plus a long prize used to overrun the row at 390 —
                   `flex-wrap` lets the holders drop to their own line instead. */
                <span className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold text-[var(--color-accent-ink-amber)]">
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
