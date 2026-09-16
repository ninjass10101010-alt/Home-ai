"use client";

/**
 * Shared confetti burst — extracted verbatim from src/app/tasks/page.tsx
 * (2026-09-16) so the Tasks completion celebration and the WeeklyWinModal
 * ceremony share ONE implementation. Callers own the reduced-motion guard:
 * skip rendering `active` when `prefers-reduced-motion` matches (mirror the
 * tasks page's `triggerConfetti` check).
 */
export default function ConfettiBurst({ active }: { active: boolean }) {
  if (!active) return null;
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.5}s`,
    size: `${6 + Math.random() * 8}px`,
    color: ["#f59e0b","#ef4444","#22c55e","#3b82f6","#a855f7","#ec4899","#14b8a6"][i % 7],
    x: `${(Math.random() - 0.5) * 120}px`,
    y: `${-80 - Math.random() * 80}px`,
  }));
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute animate-confetti-fall rounded-full"
          style={{
            left: p.left,
            top: "50%",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animationDelay: p.delay,
            "--confetti-x": p.x,
            "--confetti-y": p.y,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
