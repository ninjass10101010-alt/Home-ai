"use client";

// The arrow glyph alone said nothing: a screen reader heard "Caspian … ↑" with
// no rank change, because the numbers it was drawn FROM never reached the
// accessibility tree. `role="img"` + a name carrying both ranks makes the same
// fact available to everyone — and the dash/arrow pair stays visually identical.
interface RankArrowProps {
  currentRank: number;
  previousRank: number | undefined;
}

function places(n: number): string {
  return `${n} ${n === 1 ? "place" : "places"}`;
}

export default function RankArrow({ currentRank, previousRank }: RankArrowProps) {
  if (!previousRank || previousRank === currentRank) {
    return (
      <span
        role="img"
        aria-label={previousRank ? "Rank unchanged since last week" : "No rank last week"}
        className="text-text-muted text-xs"
      >
        —
      </span>
    );
  }
  if (previousRank > currentRank) {
    return (
      <span
        role="img"
        aria-label={`Up ${places(previousRank - currentRank)} since last week`}
        /* The `-ink-` accent tokens (accent mixed 55% into the primary text ink)
           are the readable form of an accent: the raw `--color-accent-mint`
           measured 3.49:1 and `--color-accent-rose` 3.54:1 at 12px on this card,
           both under AA. */
        className="inline-flex items-center text-[var(--color-accent-ink-mint)] text-xs font-bold animate-rank-arrow-bounce"
      >
        ↑
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`Down ${places(currentRank - previousRank)} since last week`}
      className="inline-flex items-center text-[var(--color-accent-ink-rose)] text-xs font-bold"
    >
      ↓
    </span>
  );
}
