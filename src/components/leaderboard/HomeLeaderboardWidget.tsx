"use client";

import Link from "next/link";
import { useLeaderboardData } from "./hooks/useLeaderboardData";
import { useWeeklyPrizes } from "./hooks/useWeeklyPrizes";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { computeWallBoard } from "@/lib/layout-config";
import { db } from "@/db";
import SectionCard from "@/components/patterns/SectionCard";
import HomeWidgetIcon from "@/components/ui/HomeWidgetIcon";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import RankArrow from "./RankArrow";
import { getGapMessage, raceGap, resolveMemberName, prizeForRank } from "@/lib/task-utils";
import { useAmbientAnimation } from "@/components/providers/AnimationBudgetProvider";
import type { LeaderboardEntry, WeeklyPrize } from "@/types/tasks";

// Prize copy is one compact line — long prize text from Settings gets a hard
// ~30-char clip, and the line wrapper itself carries line-clamp-1 (never an
// inline child: a clamped inline span forces display:-webkit-box, which would
// split the line in a real browser).
const PRIZE_TEXT_MAX = 30;
function clipPrizeText(text: string): string {
  return text.length > PRIZE_TEXT_MAX ? `${text.slice(0, PRIZE_TEXT_MAX)}…` : text;
}

/**
 * The one sentence that says what this week is worth to the signed-in member.
 * Kept as a STRING, not JSX, because the wall board renders it in the card's
 * `description` slot: `SectionCard`'s description prop is typed `string`, and
 * that slot is the only full-width line the 210px board cell has room for.
 *
 * Copy contract: POSITIVE-ONLY. It never says who is ahead or who is behind —
 * it either names what you are holding, or the distance to the prize you could
 * still take.
 */
function prizeRaceSentence(
  prizes: WeeklyPrize[],
  entries: LeaderboardEntry[],
  myName: string | null
): string | null {
  if (prizes.length === 0) return null;
  const ordered = [...prizes].sort((a, b) => a.rank - b.rank);
  if (!myName) return `${ordered.map((p) => p.emoji).join(" ")} prizes this week`;
  const gap = raceGap(
    myName,
    Object.fromEntries(entries.map((e) => [e.name, e.points])),
    ordered.length
  );
  if (gap.onPodium && gap.rank) {
    const prize = prizeForRank(ordered, gap.rank);
    if (prize) return `${prize.emoji} ${clipPrizeText(prize.text)} — you're holding it!`;
  }
  const chase = ordered[ordered.length - 1];
  if (gap.gapToPodium !== null && gap.gapToPodium > 0) {
    return `${gap.gapToPodium} pts to ${chase.emoji} \u2014 ${clipPrizeText(chase.text)}`;
  }
  return null;
}

function PrizeRaceLine({
  prizes,
  entries,
  myName,
}: {
  prizes: WeeklyPrize[];
  entries: LeaderboardEntry[];
  myName: string | null;
}) {
  const sentence = prizeRaceSentence(prizes, entries, myName);
  if (!sentence) return null;
  return (
    <p data-testid="prize-race-line" className="mt-2.5 shrink-0 text-xs text-text-secondary line-clamp-1">
      {sentence}
    </p>
  );
}

function PodiumRow({
  entry,
  rank,
  isYou,
  previousRank,
  memberColor,
  compact = false,
}: {
  entry: any;
  rank: number;
  isYou: boolean;
  previousRank: number | undefined;
  memberColor: string;
  /** Wall-board build: a 24px avatar and 4px padding, because the board's cell
   *  measures 210px and the default row is 40px. */
  compact?: boolean;
}) {
  // Audit 4.5: "your" row glow is ambient — claim a slot from Home's budget.
  const motion = useAmbientAnimation();
  // `border-border` (a token derived from --color-text-primary) instead of
  // `border-white/15` / `border-white/10`: 15% white is invisible against the
  // light theme's near-white card, and the champion tint dropped from /15 to
  // /10 because a 15% amber wash is light enough to push --color-text-muted
  // under AA at 12px.
  const bgClass =
    rank === 1
      ? "bg-[var(--color-accent-amber)]/10 border-[var(--color-accent-amber)]/30"
      : rank === 2
      ? "border-border"
      : "bg-[var(--color-accent-amber)]/[0.06] border-[var(--color-accent-amber)]/20";

  return (
    <div
      className={`flex shrink-0 items-center ${compact ? "gap-2 px-2.5 py-0.5" : "gap-3 px-3 py-1.5"} rounded-2xl border ${bgClass} ${
        isYou && motion ? "widget-row-glow" : ""
      }`}
      style={isYou ? { "--row-color": memberColor } as React.CSSProperties : undefined}
    >
      <span className="text-lg shrink-0">
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}
      </span>
      <Avatar name={entry.name} color={memberColor} emoji={entry.emoji} size={compact ? "xs" : "sm"} variant="emoji" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-text-primary">
            {entry.name.split(" ")[0]}
          </span>
          {isYou && (
            /* The roster colour is a CSS keyword ("green", "cyan", …). Using it
               as the TEXT colour measured 1.87:1 in dark and 3.48:1 in light —
               both under AA — and `${memberColor}25` is not even a valid colour,
               so the chip had no fill at all. Identity rides the tint + the row
               glow; the glyph uses the primary ink. */
            <span
              className="rounded-md px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-text-primary"
              style={{ background: `color-mix(in srgb, ${memberColor} 22%, transparent)` }}
            >
              You
            </span>
          )}
          {entry.streak > 0 && (
            <span className="shrink-0 text-xs text-[var(--color-accent-ink-amber)] font-semibold">
              🔥 {entry.streak}d
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold text-text-primary display-numeral">
          {entry.points}
        </span>
        <span className="text-xs text-text-muted">pts</span>
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
  const motion = useAmbientAnimation();
  return (
    <div
      className={`flex shrink-0 items-center gap-3 rounded-2xl border border-border px-3 py-1.5 ${
        isYou && motion ? "widget-row-glow" : ""
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
        <span className="text-xs text-text-muted">pts</span>
        <RankArrow currentRank={entry.rank} previousRank={previousRank} />
      </div>
    </div>
  );
}

export default function HomeLeaderboardWidget({ className = "" }: { className?: string }) {
  const motion = useAmbientAnimation();
  const { data, mounted } = useLeaderboardData();
  const { currentUser, isLoggedIn } = useAuth();
  const prizes = useWeeklyPrizes();
  // The kitchen wall BOARD gives this cell ~210px (measured: card 210 vs
  // content 347), so the glance build drops to exactly what fits: the three
  // podium rows and the prize line. The 4th-place row, the "+N more" footer and
  // the "Resets in N days" description are what did not fit, and the overflow
  // had squeezed the prize line to a measured 0px tall — the race's actual
  // stakes were invisible on the surface the family reads from across the room.
  // Everything dropped here is one tap away on the header's "See all →".
  //
  // `useWallMode` is the PORTRAIT wall and is false on the 1920×1080 board, so
  // this reads the board predicate page.tsx gates its own grid on
  // (`computeWallBoard`) rather than guessing from a media query the
  // stylesheet and the JS could disagree about. SSR-safe: false first, then the
  // real value, exactly like every other viewport read in this repo.
  const [board, setBoard] = useState(false);
  useEffect(() => {
    const update = () => setBoard(computeWallBoard(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!mounted) {
    return (
      <SectionCard title="This Week's Leaderboard" icon={<HomeWidgetIcon variant="leaderboard" size="lg" />} tone="var(--color-accent-amber)" centeredHeader className={className}>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-2xl bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  const { entries, daysUntilReset, previousRanks } = data;

  if (entries.length === 0 || entries.every(e => e.points === 0)) {
    const prizeEmojis = [...prizes].sort((a, b) => a.rank - b.rank).map((p) => p.emoji).join("");
    return (
      <Link href="/tasks" className="block h-full active:scale-[0.99] transition-transform">
        <SectionCard title="This Week's Leaderboard" icon={<HomeWidgetIcon variant="leaderboard" size="lg" />} tone="var(--color-accent-amber)" centeredHeader className={className}>
          <EmptyState
            title="Be the first!"
            description="Complete a task to start the race this week."
            icon="👑"
            flat
          />
          {prizes.length > 0 && (
            <p data-testid="prize-race-line" className="mt-2.5 shrink-0 text-xs text-text-secondary line-clamp-1">
              New week — prizes up for grabs {prizeEmojis}
            </p>
          )}
        </SectionCard>
      </Link>
    );
  }

  const top3 = entries.slice(0, 3);
  const others = board ? [] : entries.slice(3, 4);
  // Placement is the rank the hook already computed (standard competition
  // ranking: a tie repeats the previous rank and the next one is SKIPPED, so
  // 100/100/60/60/10 → 1, 1, 3, 3, 5). Re-deriving it here as `i + 1` is what
  // made Home print 1st/2nd for two members the Tasks page calls 1st/1st — two
  // conventions for one week. One hook owns the ranking; this widget only
  // displays it (exactly like `OtherRow`'s `#` already did).
  // The session name is resolved through the ROSTER first, never prefix-matched:
  // the Tasks page documents this exact bug ("Alex Garcia" matching "Alexandra
  // Garcia"), and this widget had it in `myEntry` while `myName` below already
  // did it properly — so the "You:" line could describe another person's points
  // while the race line described yours.
  const myName = isLoggedIn && currentUser
    ? resolveMemberName(db.selectMembers(), currentUser.name)
    : null;
  const myEntry = myName ? entries.find((e: any) => e.name === myName) ?? null : null;
  // The member AHEAD is found by POINTS, not by `entries[rank - 2]`: under
  // standard competition ranking a shared rank makes `rank - 2` the wrong
  // index (100/100/60/60 → the 3rd-placed member's `rank - 2` is the member they
  // are TIED with, not the one ahead). "Strictly more points" IS the rank
  // definition, so this cannot drift from the badge.
  const aheadEntry = myEntry
    ? entries.find((e: any) => e.points > myEntry.points)
    : undefined;

  return (
    <Link href="/tasks" className="block h-full active:scale-[0.99] transition-transform">
      <SectionCard
        title="This Week's Leaderboard"
        description={
          // On the board the single description line carries the prize race
          // instead of the countdown: the countdown is also in the race line's
          // own wording context, the prize is not, and the board cell has room
          // for exactly one of them.
          board
            ? prizeRaceSentence(prizes, entries, myName) ?? undefined
            : `Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? "s" : ""}`
        }
        icon={<HomeWidgetIcon variant="leaderboard" size="lg" />}
        tone="var(--color-accent-amber)"
        centeredHeader
        className={className}
        action={<span className="text-sm font-medium widget-accent-text">See all →</span>}
      >
        {/* The "You:" banner is only for a member who is NOT already in the
            podium rows below — a rank ≤3 member appeared twice in a row ("You:
            #1 62 pts 👑 Leading!" immediately above "🥇 Rebecca YOU 62 pts").
            It is also what overflowed the 350px wall row: the card measured
            scrollHeight 438 against a 350px cell, and the overflow squeezed the
            prize race line to a measured 0px tall, hiding it entirely. */}
        {isLoggedIn && myEntry && myEntry.rank > 3 && (
          <div
            className={`mb-3 shrink-0 rounded-2xl border px-3 py-2 flex items-center gap-2.5 ${motion ? "widget-row-glow" : ""}`}
            style={{
              borderColor: `color-mix(in srgb, ${myEntry.color || "var(--color-accent-selected)"} 25%, transparent)`,
              "--row-color": myEntry.color || "var(--color-accent-selected)",
              background: `color-mix(in srgb, ${myEntry.color || "var(--color-accent-selected)"} 6%, transparent)`,
            } as React.CSSProperties}
          >
            <Avatar name={myEntry.name} color={myEntry.color || "green"} emoji={myEntry.emoji} size="xs" variant="emoji" />
            <div className="text-sm min-w-0 flex-1">
              <span className="font-semibold text-text-primary">You:</span>{" "}
              <span className="text-text-secondary">#{myEntry.rank}</span>{" "}
              <span className="font-bold text-[var(--color-accent-ink-nori)] display-numeral">{myEntry.points} pts</span>
              {myEntry.rank > 1 && aheadEntry && (
                <span className="text-text-muted text-xs ml-1.5">
                  {getGapMessage(myEntry, aheadEntry)}
                </span>
              )}
              {/* No "👑 Leading!" here: this banner only renders at rank > 3,
                  so a rank-1 crown would be unreachable. The crown lives on the
                  rank-1 podium row instead, and a zero-point week is caught by
                  the "Be the first!" empty state below. */}
            </div>
          </div>
        )}

        <div className="space-y-1">
          {top3.map((entry: any) => (
            <PodiumRow
              key={entry.name}
              entry={entry}
              rank={entry.rank}
              isYou={!!myName && entry.name === myName}
              previousRank={previousRanks[entry.name]}
              memberColor={entry.color || "green"}
              compact={board}
            />
          ))}
          {others.map((entry: any) => (
            <OtherRow
              key={entry.name}
              entry={entry}
              isYou={!!myName && entry.name === myName}
              previousRank={previousRanks[entry.name]}
              memberColor={entry.color || "green"}
            />
          ))}
        </div>

        {/* Weekly prize race line — bottom slot, just above the "+N more" footer.
            On the wall board it renders in the header action slot instead (see
            `action` above): the body's 210px cell has no room for the band. */}
        {!board && <PrizeRaceLine prizes={prizes} entries={entries} myName={myName} />}

        {entries.length > 4 && !board && (
          <div className="mt-2 shrink-0 border-t border-border pt-2">
            <p className="text-xs font-semibold widget-accent-text">
              +{entries.length - 4} more · See all →
            </p>
          </div>
        )}
      </SectionCard>
    </Link>
  );
}
