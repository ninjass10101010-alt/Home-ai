/**
 * CelebrationBurst — Full-screen celebration overlay for quest completion.
 *
 * Fires when a kid completes a task:
 *   1. Confetti particles burst from the center (8 particles, varied colors)
 *   2. Points fly upward as golden numbers (+10pts!)
 *   3. Screen gets a brief golden flash
 *   4. Everything resolves in < 1.5s
 *
 * Pure CSS animations, respects prefers-reduced-motion.
 */
"use client";

import { useEffect, useState } from "react";

interface CelebrationBurstProps {
  /** Points earned from this quest */
  points: number;
  /** Whether to show level-up celebration */
  leveledUp?: boolean;
  /** New level (if leveled up) */
  newLevel?: number;
  /** Callback when celebration finishes */
  onComplete?: () => void;
}

const CONFETTI_COLORS = [
  "#fbbf24", // amber
  "#f43f5e", // rose
  "#3b82f6", // blue
  "#4ade80", // mint
  "#a855f7", // violet
  "#06b6d4", // cyan
  "#fb923c", // apricot
  "#ec4899", // pink
];

export default function CelebrationBurst({
  points,
  leveledUp = false,
  newLevel,
  onComplete,
}: CelebrationBurstProps) {
  const [phase, setPhase] = useState<"enter" | "peak" | "exit">("enter");

  useEffect(() => {
    // Phase timing
    const t1 = setTimeout(() => setPhase("peak"), 200);
    const t2 = setTimeout(() => setPhase("exit"), 800);
    const t3 = setTimeout(() => onComplete?.(), 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  // Generate confetti particles
  const confetti = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const distance = 40 + Math.random() * 60;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance - 30; // bias upward
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const size = 4 + Math.random() * 6;
    const delay = i * 0.03;
    const isCircle = i % 3 === 0;

    return { x, y, color, size, delay, isCircle, id: i };
  });

  return (
    <div
      className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
      style={{
        animation: "celebFade 1.5s ease-out forwards",
      }}
      aria-live="polite"
      aria-label={`Congratulations! You earned ${points} points!`}
    >
      {/* Golden screen flash */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(251, 191, 36, 0.15), transparent 60%)",
          animation: "celebFlash 0.8s ease-out forwards",
        }}
      />

      {/* Confetti particles */}
      <div className="absolute inset-0 flex items-center justify-center">
        {confetti.map((p) => (
          <span
            key={p.id}
            className="absolute"
            style={{
              width: p.isCircle ? `${p.size}px` : `${p.size * 0.5}px`,
              height: p.isCircle ? `${p.size}px` : `${p.size * 1.2}px`,
              background: p.color,
              borderRadius: p.isCircle ? "50%" : "2px",
              boxShadow: `0 0 ${p.size}px ${p.color}88`,
              animation: `celebConfetti 0.7s ease-out ${p.delay}s forwards`,
              "--celeb-x": `${p.x}px`,
              "--celeb-y": `${p.y}px`,
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              opacity: 0,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Points flying up */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          animation: "celebPointsFly 1.2s ease-out forwards",
        }}
      >
        <span
          className="text-4xl font-black tabular-nums"
          style={{
            color: "#fbbf24",
            textShadow: "0 0 20px rgba(251, 191, 36, 0.6), 0 0 40px rgba(251, 191, 36, 0.3)",
            filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.3))",
          }}
        >
          +{points}
        </span>
        <span
          className="text-sm font-bold text-amber-300 mt-1"
          style={{ textShadow: "0 2px 4px rgba(0,0,0,0.3)" }}
        >
          pts
        </span>
      </div>

      {/* Level up overlay */}
      {leveledUp && newLevel && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20"
          style={{ animation: "celebLevelUp 1.5s ease-out 0.3s both" }}
        >
          <div className="flex flex-col items-center">
            <span className="text-6xl mb-2" style={{ animation: "celebStarPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both" }}>
              ⭐
            </span>
            <span
              className="text-2xl font-black text-text-primary"
              style={{
                textShadow: "0 0 20px rgba(251, 191, 36, 0.5)",
                animation: "celebSlideUp 0.5s ease-out 0.7s both",
              }}
            >
              Level {newLevel}!
            </span>
            <span
              className="text-sm font-bold text-amber-300 mt-1"
              style={{ animation: "celebSlideUp 0.5s ease-out 0.9s both" }}
            >
              You&apos;re amazing! 🎉
            </span>
          </div>
        </div>
      )}

      {/* Celebration CSS keyframes */}
      <style>{`
        @keyframes celebFade {
          0%   { opacity: 0; }
          10%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes celebFlash {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes celebConfetti {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(calc(-50% + var(--celeb-x)), calc(-50% + var(--celeb-y))) scale(0.3) rotate(180deg);
          }
        }

        @keyframes celebPointsFly {
          0% {
            opacity: 0;
            transform: translateY(20px) scale(0.5);
          }
          20% {
            opacity: 1;
            transform: translateY(0) scale(1.2);
          }
          40% {
            transform: translateY(-10px) scale(1);
          }
          80% {
            opacity: 1;
            transform: translateY(-40px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-80px) scale(0.6);
          }
        }

        @keyframes celebLevelUp {
          0%   { opacity: 0; backdrop-filter: blur(0); }
          20%  { opacity: 1; backdrop-filter: blur(4px); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes celebStarPop {
          0%   { transform: scale(0) rotate(-180deg); opacity: 0; }
          60%  { transform: scale(1.3) rotate(10deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes celebSlideUp {
          0%   { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          @keyframes celebConfetti {
            0%   { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes celebPointsFly {
            0%   { opacity: 0; }
            20%  { opacity: 1; }
            100% { opacity: 0; }
          }
        }
      `}</style>
    </div>
  );
}
