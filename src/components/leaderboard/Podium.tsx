"use client";

import Avatar from "@/components/ui/Avatar";
import { prizeForRank } from "@/lib/task-utils";
import IconButton from "@/components/ui/IconButton";
import RankArrow from "./RankArrow";
import AllTimeValue from "./AllTimeValue";
import type { AllTimeReadState } from "@/hooks/useAllTimeTotals";
import type { WeeklyPrize } from "@/types/tasks";

export interface AllTimeReadProp {
  state: AllTimeReadState;
  updatedAt: string | null;
}

interface PodiumSlotProps {
  entry: any;
  rank: number;
  /**
   * A MINIMUM height on the card itself. It used to be a fixed height on the
   * outer column, which the content ignored: measured 208/224/208px cards inside
   * 170/200/150px columns, so every plinth overflowed its own silhouette by
   * 24–58px and the three card bottoms landed that far apart. A minimum keeps
   * the 1st/2nd/3rd step visible AND lets a taller card grow instead of spilling.
   * The three values sit ABOVE the tallest measured content (214px) so the
   * staircase is real rather than three cards of identical height.
   */
  minHeightClass: string;
  medalEmoji: string;
  /** Champion/bronze plinth tint — a card background utility (the card carries
   *  no `.material-*` tier of its own; that is the child below, because the
   *  tier's unlayered `.material-* > * { position: relative }` would otherwise
   *  drop the medal and the admin control back into flow). */
  bgClass: string;
  /** A champion treatment (plinth tint, pulse, avatar glow, gold medal) is
   *  only earned on a week somebody actually scored on. */
  champion: boolean;
  isYou: boolean;
  color: string;
  previousRank: number | undefined;
  onClick: () => void;
  onAdjust: () => void;
  isAdmin: boolean;
  prizes: WeeklyPrize[];
  allTimeRead: AllTimeReadProp;
}

function PodiumSlot({
  entry, rank, minHeightClass, medalEmoji, bgClass, champion, isYou, color, previousRank,
  onClick, onAdjust, isAdmin, prizes, allTimeRead,
}: PodiumSlotProps) {
  // A brand-new member's all-time equals the week — the duplicate reads as clutter.
  const showAllTime = entry.allTimePoints !== entry.points;
  // Weekly-prize ribbon: a zero-point fresh week shows no ribbon (the "crown
  // is up for grabs" zero-state keeps owning that moment).
  const prize = entry.points > 0 ? prizeForRank(prizes, entry.rank) : undefined;
  // The LEVEL NAME cannot live here: "👑 Task Master" is ~90px of a ~86px column
  // and printed "Task M…" / "…". The level is identified by its emoji plus the
  // progress percentage (which is the part a reader acts on); the full title is
  // on the row below and in the member sheet.
  // No LEVEL NAME on the plinth: "👑 Task Master" is ~90px of an ~86px column
  // and printed "Task M…". The level rides the name row as its emoji; the full
  // title and the percentage are on the row below and in the member sheet.
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-end">
      <div
        className={`relative flex w-full flex-col rounded-2xl border cursor-pointer ${minHeightClass} pt-8 pb-3 px-1.5 ${bgClass} ${isYou ? "widget-row-glow" : ""} transition hover:scale-105 active:scale-95`}
        style={isYou ? ({ "--row-color": color } as React.CSSProperties) : undefined}
        role="button"
        tabIndex={0}
        aria-label={`${entry.name}: ${entry.points} points, rank ${rank}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {/* The card's MATERIAL is an absolutely-positioned child, not a class on
            the card itself. `.material-thin` is UNLAYERED CSS and its
            `.material-thin > * { position: relative }` out-ranks Tailwind's
            `absolute`, so putting the tier on the card silently dropped the
            medal, the admin control and the tint overlay back into flow (the
            overlay measured 0px tall and the gear landed at the card's BOTTOM).
            As a child it paints the surface without ever being the card's own
            position context, so it is the same tier the rows use. */}
        <div aria-hidden="true" className="material-thin absolute inset-0 rounded-2xl" />
        {/* The medal used to sit at `-top-3`, which measured a 24×12px overlap
            with the avatar below it (a collision, not a layer). `pt-8` reserves a
            band at the top of the card and the medal lives INSIDE it, so the two
            can never meet. The admin control shares that band, left of the
            centred medal, which is why it no longer lands on the avatar either. */}
        {medalEmoji && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 text-2xl leading-none animate-crown-glow">{medalEmoji}</div>
        )}
        {/* `mt-auto` on a flex-column card collects the staircase headroom
            between the medal band and the member, so the extra plinth height
            reads as a plinth instead of dead space under the content. */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <Avatar name={entry.name} color={color} emoji={entry.emoji} size="md" variant="emoji" glow={champion && rank === 1} />
          {/* No level marker on the plinth. The name is the widest thing in an
              86px column, and the level EMOJI measured 1.5–2.2:1 against the
              light card (a gold star on near-white) — as the only level cue it
              read as a missing glyph. The row directly below carries the level
              by NAME plus its percentage, both in token ink. */}
          <span className="max-w-full truncate text-sm font-bold text-text-primary">
            {entry.name.split(" ")[0]}
          </span>
          {isYou && (
            /* The roster colour is a CSS keyword ("green", "cyan", …) and was
               used as the TEXT colour here: `color: green` measured 1.87:1 in
               dark and 3.48:1 in light, both under AA. Identity now rides the
               tinted chip + the row glow; the glyph uses the primary ink. */
            <span
              className="rounded-md px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-text-primary"
              style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
            >
              You
            </span>
          )}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-base font-bold text-text-primary display-numeral">{entry.points}</span>
            <span className="shrink-0 text-xs text-text-muted">pts</span>
          </div>
          {prize && (
            /* `hidden sm:block`: the pill is real from the tablet fold up, where
               a plinth column is ~220px and the whole prize fits. On a 390 phone
               the column is ~86px and the pill measured "Picks Fr…", "Choose…"
               and "+$2 allo…" — an unreadable prize, which is the exact defect
               the contract names. The full-width row in PrizeRaceCard, directly
               below, always shows the whole prize text. */
            <div className="hidden text-center text-xs text-text-muted line-clamp-2 break-words sm:block" title={prize.text}>
              🎁 {prize.text}
            </div>
          )}
          {showAllTime && (
            <div className="text-xs text-text-muted text-center">
              <AllTimeValue points={entry.allTimePoints} read={allTimeRead.state} updatedAt={allTimeRead.updatedAt} />
            </div>
          )}
          <div className="flex w-full max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap">
            {entry.streak > 0 && (
              <span className="truncate text-xs text-[var(--color-accent-ink-amber)] font-semibold">🔥 {entry.streak}d</span>
            )}
            {entry.streak === 0 && entry.points === 0 && (
              <span className="truncate text-xs text-text-muted italic">No tasks yet…</span>
            )}
            {/* A missing previous rank is an EMPTY value — the old "—" rendered
                alone as dead punctuation on its own line at 390. The arrow (and
                its honest "rank unchanged" dash) only exists for a real
                previous rank. */}
            {previousRank != null && (
              <span className="shrink-0"><RankArrow currentRank={rank} previousRank={previousRank} /></span>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="absolute top-0 right-0.5">
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
  prizes: WeeklyPrize[];
  previousRanks: Record<string, number>;
  isYou: (name: string) => boolean;
  getMemberColor: (name: string) => string;
  onOpenSheet: (name: string) => void;
  onAdjust: (name: string) => void;
  isAdmin: boolean;
  allTimeRead: AllTimeReadProp;
}

export default function Podium({
  entries, prizes, previousRanks, isYou, getMemberColor,
  onOpenSheet, onAdjust, isAdmin, allTimeRead,
}: PodiumProps) {
  if (entries.length === 0) return null;

  const first = entries[0];
  const second = entries.length > 1 ? entries[1] : null;
  const third = entries.length > 2 ? entries[2] : null;

  const rankOf = (points: number) =>
    entries.filter((o) => (o.points ?? 0) > (points ?? 0)).length + 1;

  // A zero-point week crowns nobody. The page already prints the honest empty
  // state ("The crown is up for grabs — Everyone starts at zero"); the podium
  // must not contradict it with a pulsing amber plinth, a gold medal and a
  // glowing avatar on Monday morning. Derived from the entries this card is
  // already given (the top 3, sorted by points — so "all zero" here IS the
  // family at zero), which means no call site has to pass a new prop.
  const weekHasPoints = entries.some((e) => (e.points ?? 0) > 0);
  // The medal belongs to the rank, and a rank is only meaningful once somebody
  // has scored — AND the member has scored. `rankOf(0)` returns
  // `1 + (members with points > 0)`, so a family where exactly one member has
  // scored gives every 0-point member rank 2: measured, that put a SILVER
  // medal on two members who had completed nothing, in plain contradiction of
  // the row badge two inches below it and of the prize card's "Up for grabs".
  // The same `points > 0` rule the prize card's holder list already uses.
  const medalFor = (points: number) => {
    if (!weekHasPoints || (points ?? 0) <= 0) return "";
    const rank = rankOf(points);
    return rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  };
  // The plinth height follows the SHARED RANK, not the array position. Keyed to
  // the index, two members tied at rank 2 were drawn on two different steps —
  // the staircase itself claimed a placing the badge says does not exist. Now a
  // tie shares a step, which is what "a tie shares a rank" has to mean visually.
  const plinthFor = (points: number) => {
    const rank = rankOf(points);
    return rank === 1 ? "min-h-[226px]" : rank === 2 ? "min-h-[206px]" : "min-h-[186px]";
  };
  // The plinth SURFACE is the `material-thin` tier (see PodiumSlot). What sits
  // ON the card is only the champion/bronze tint, and its alpha is deliberately
  // low: the old /15 washed the champion card light enough to drop
  // `--color-text-muted` to 3.5:1 — under AA in both themes. The old
  // `bg-white/10 border-white/15` was worse still: a raw white veil, invisible
  // against the light theme's card.
  const plainBg = "border-border";
  const championBg = "bg-[var(--color-accent-amber)]/[0.09] border-[var(--color-accent-amber)]/30 animate-rank-pulse";
  const bronzeBg = "bg-[var(--color-accent-amber)]/[0.05] border-[var(--color-accent-amber)]/20";

  return (
    <div className="flex w-full items-end justify-center gap-2 py-2">
      {second && (
        <PodiumSlot
          entry={second} rank={rankOf(second.points)} minHeightClass={plinthFor(second.points)} medalEmoji={medalFor(second.points)}
          bgClass={plainBg}
          champion={weekHasPoints}
          isYou={isYou(second.name)} color={getMemberColor(second.name)}
          previousRank={previousRanks[second.name]}
          onClick={() => onOpenSheet(second.name)}
          onAdjust={() => onAdjust(second.name)}
          isAdmin={isAdmin}
          prizes={prizes}
          allTimeRead={allTimeRead}
        />
      )}
      <PodiumSlot
        entry={first} rank={rankOf(first.points)} minHeightClass={plinthFor(first.points)} medalEmoji={medalFor(first.points)}
        bgClass={weekHasPoints ? championBg : plainBg}
        champion={weekHasPoints}
        isYou={isYou(first.name)} color={getMemberColor(first.name)}
        previousRank={previousRanks[first.name]}
        onClick={() => onOpenSheet(first.name)}
        onAdjust={() => onAdjust(first.name)}
        isAdmin={isAdmin}
        prizes={prizes}
        allTimeRead={allTimeRead}
      />
      {third && (
        <PodiumSlot
          entry={third} rank={rankOf(third.points)} minHeightClass={plinthFor(third.points)} medalEmoji={medalFor(third.points)}
          bgClass={weekHasPoints ? bronzeBg : plainBg}
          champion={weekHasPoints}
          isYou={isYou(third.name)} color={getMemberColor(third.name)}
          previousRank={previousRanks[third.name]}
          onClick={() => onOpenSheet(third.name)}
          onAdjust={() => onAdjust(third.name)}
          isAdmin={isAdmin}
          prizes={prizes}
          allTimeRead={allTimeRead}
        />
      )}
    </div>
  );
}
