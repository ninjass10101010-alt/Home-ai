"use client";

interface RankArrowProps {
  currentRank: number;
  previousRank: number | undefined;
}

export default function RankArrow({ currentRank, previousRank }: RankArrowProps) {
  if (!previousRank || previousRank === currentRank) {
    return <span className="text-text-muted text-xs">—</span>;
  }
  if (previousRank > currentRank) {
    return (
      <span className="inline-flex items-center text-emerald-400 text-xs font-bold animate-rank-arrow-bounce">
        ↑
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-rose-400 text-xs font-bold">
      ↓
    </span>
  );
}
