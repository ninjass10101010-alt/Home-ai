"use client";

export default function TrophyCase({ badges }: { badges: string[] }) {
  if (badges.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {badges.slice(0, 6).map((emoji, i) => (
        <span
          key={i}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-sm animate-badge-sparkle"
          style={{ animationDelay: `${i * 0.2}s` }}
        >
          {emoji}
        </span>
      ))}
      {badges.length > 6 && (
        <span className="text-xs text-text-muted">+{badges.length - 6}</span>
      )}
    </div>
  );
}