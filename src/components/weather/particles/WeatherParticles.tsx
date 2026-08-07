/**
 * WeatherParticles — Animated particle system for weather/holiday effects.
 * Blossoms, leaves, fireflies, snowflakes, hearts, confetti, etc.
 * Extracted from WeatherWidget.tsx for modularity.
 */
"use client";

import { useState, useEffect } from "react";
import type { TimeOfDayFlag, Particle } from "../helpers";

type ParticleKind = "blossom" | "leaf" | "firefly" | "snowflake" | "christmas-snow" | "bat" | "spark" | "heart" | "confetti" | "harvest" | "shamrock" | "marigold" | "tricolor-sparks" | "holy-roses" | "none";


function WeatherParticles({ type, tod }: { type: ParticleKind; tod: TimeOfDayFlag }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (type === "none") return;

    const counts: Record<ParticleKind, number> = {
      blossom: 22,
      leaf: 20,
      firefly: 16,
      snowflake: 26,
      "christmas-snow": 24,
      bat: 6,
      spark: 35,
      heart: 14,
      confetti: 28,
      harvest: 10,
      shamrock: 18,
      marigold: 20,
      "tricolor-sparks": 32,
      "holy-roses": 18,
      none: 0,
    };

    setParticles(
      Array.from({ length: counts[type] || 12 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: `${(Math.random() * 4).toFixed(2)}s`,
        duration: `${(2 + Math.random() * 3.5).toFixed(2)}s`,
        size: type === "snowflake" || type === "christmas-snow" ? 3 + Math.random() * 5
            : type === "blossom" ? 5 + Math.random() * 7
            : type === "leaf" ? 6 + Math.random() * 8
            : type === "heart" ? 6 + Math.random() * 6
            : type === "spark" || type === "tricolor-sparks" ? 2 + Math.random() * 3
            : type === "firefly" ? 3 + Math.random() * 3
            : type === "marigold" || type === "holy-roses" ? 8 + Math.random() * 8
            : 4 + Math.random() * 4,
        rotate: Math.random() * 360,
        opacity: 0.6 + Math.random() * 0.4,
        amplitude: 3 + Math.random() * 12,
      }))
    );
  }, [type]);

  if (type === "none" || particles.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none z-10" aria-hidden="true">
      {particles.map((p) => {
        // ── Blossom petals ──
        if (type === "blossom") {
          const colors = ["#fbcfe8", "#f9a8d4", "#fce7f3", "#fdf2f8", "#fda4af"];
          const color = colors[p.id % colors.length];
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${p.size * 1.3}px`,
                background: color,
                borderRadius: "60% 10% 60% 10%",
                opacity: p.opacity,
                animation: `weatherBlossomFall ${p.duration} ease-in-out ${p.delay} infinite`,
                transform: `rotate(${p.rotate}deg)`,
                boxShadow: `0 0 ${p.size}px ${color}55`,
              }} />
          );
        }

        // ── Autumn leaves ──
        if (type === "leaf") {
          const colors = ["#fbbf24", "#f97316", "#ef4444", "#dc2626", "#b45309", "#d97706", "#92400e"];
          const color = colors[p.id % colors.length];
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: color,
                borderRadius: "50% 0% 50% 0%",
                opacity: p.opacity,
                animation: `weatherLeafFall ${p.duration} ease-in-out ${p.delay} infinite`,
                transform: `rotate(${p.rotate}deg)`,
              }} />
          );
        }

        // ── Fireflies ──
        if (type === "firefly") {
          return (
            <div key={p.id} className="absolute rounded-full"
              style={{
                left: `${p.x}%`,
                top: `${30 + (p.y || 0) * 0.5}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: "radial-gradient(circle, #fef08a, #fbbf24)",
                boxShadow: `0 0 ${p.size * 2}px ${p.size}px rgba(251,191,36,0.4)`,
                animation: `weatherFirefly ${p.duration} ease-in-out ${p.delay} infinite`,
              }} />
          );
        }

        // ── Snowflakes ──
        if (type === "snowflake" || type === "christmas-snow") {
          const color = type === "christmas-snow" ? "rgba(219,234,254,0.90)" : "rgba(186,230,253,0.95)";
          return (
            <div key={p.id} className="absolute top-0 flex items-center justify-center"
              style={{
                left: `${p.x}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animation: `weatherParticleSnow ${p.duration} ease-in-out ${p.delay} infinite`,
              }}>
              <svg viewBox="0 0 20 20" width={p.size} height={p.size}>
                {/* Hexagonal snowflake */}
                {[0, 60, 120, 180, 240, 300].map((a, j) => (
                  <g key={j} transform={`rotate(${a} 10 10)`}>
                    <line x1="10" y1="2" x2="10" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="7" y1="5" x2="13" y2="5" stroke={color} strokeWidth="1" strokeLinecap="round" />
                    <line x1="7" y1="15" x2="13" y2="15" stroke={color} strokeWidth="1" strokeLinecap="round" />
                  </g>
                ))}
              </svg>
            </div>
          );
        }

        // ── Sparks (fireworks/new year) ──
        if (type === "spark") {
          const colors = ["#ef4444", "#3b82f6", "#f8fafc", "#eab308", "#f97316", "#a855f7"];
          const color = colors[p.id % colors.length];
          return (
            <div key={p.id} className="absolute rounded-full"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: color,
                boxShadow: `0 0 ${p.size * 2}px ${p.size}px ${color}66`,
                animation: `weatherSparkle ${p.duration} ease-out ${p.delay} infinite`,
              }} />
          );
        }

        // ── Hearts ──
        if (type === "heart") {
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                animation: `weatherBlossomFall ${p.duration} ease-in-out ${p.delay} infinite`,
                fontSize: `${p.size}px`,
                opacity: p.opacity,
              }}>❤️</div>
          );
        }

        // ── Confetti (Cinco de Mayo / party) ──
        if (type === "confetti") {
          const confettiColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#ffffff"];
          const color = confettiColors[p.id % confettiColors.length];
          const isRect = p.id % 3 !== 0;
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                width: isRect ? `${p.size * 0.5}px` : `${p.size * 0.7}px`,
                height: isRect ? `${p.size * 1.2}px` : `${p.size * 0.7}px`,
                background: color,
                borderRadius: isRect ? "1px" : "50%",
                opacity: p.opacity,
                animation: `weatherConfettiFall ${p.duration} ease-in ${p.delay} infinite`,
                boxShadow: `0 0 ${p.size}px ${color}55`,
              }} />
          );
        }

        // ── Harvest leaves (Thanksgiving) ──
        if (type === "harvest") {
          const harvestEmojis = ["🍂", "🍁", "🌽", "🎃", "🍄"];
          const emoji = harvestEmojis[p.id % harvestEmojis.length];
          return (
            <div key={p.id} className="absolute"
              style={{
                left: `${p.x}%`,
                top: `${20 + (p.y || 0) * 0.6}%`,
                fontSize: `${p.size + 4}px`,
                opacity: p.opacity,
                animation: `weatherHarvestFloat ${p.duration} ease-in-out ${p.delay} infinite`,
              }}>{emoji}</div>
          );
        }

        // ── Shamrocks (St. Patrick's) ──
        if (type === "shamrock") {
          const stEmojis = ["🍀", "☘️", "🌈", "💚"];
          const emoji = stEmojis[p.id % stEmojis.length];
          return (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                fontSize: `${p.size + 2}px`,
                opacity: p.opacity,
                animation: `weatherShamrockFloat ${p.duration} ease-in-out ${p.delay} infinite`,
              }}>{emoji}</div>
          );
        }

        // ── Marigolds, Sugar Skulls & Candles (Día de los Muertos) ──
        if (type === "marigold") {
          const muertosEmojis = ["🌼", "💀", "🕯️", "🏵️", "🍂", "💀"];
          const emoji = muertosEmojis[p.id % muertosEmojis.length];
          return (
            <div key={p.id} className="absolute"
              style={{
                left: `${p.x}%`,
                top: `${(p.y || 0) * 0.9}%`,
                fontSize: `${p.size + 3}px`,
                opacity: p.opacity,
                animation: `weatherHarvestFloat ${p.duration} ease-in-out ${p.delay} infinite`,
                filter: emoji === "🕯️" ? "drop-shadow(0 0 6px rgba(251,191,36,0.8))" : "none",
              }}>{emoji}</div>
          );
        }

        // ── Tricolor Sparks & Independence Bells (Mexican Independence) ──
        if (type === "tricolor-sparks") {
          const flagColors = ["#22c55e", "#ffffff", "#ef4444"];
          const color = flagColors[p.id % flagColors.length];
          const isBell = p.id % 6 === 0;
          return isBell ? (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                fontSize: `${p.size + 4}px`,
                opacity: p.opacity,
                animation: `weatherConfettiFall ${p.duration} ease-in-out ${p.delay} infinite`,
              }}>🔔</div>
          ) : (
            <div key={p.id} className="absolute rounded-full"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: color,
                boxShadow: `0 0 ${p.size * 2}px ${p.size}px ${color}55`,
                animation: `weatherSparkle ${p.duration} ease-out ${p.delay} infinite`,
              }} />
          );
        }

        // ── Castile Roses & Heavenly Stars (Virgin of Guadalupe) ──
        if (type === "holy-roses") {
          const isStar = p.id % 2 === 0;
          return isStar ? (
            <div key={p.id} className="absolute"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                fontSize: `${p.size + 1}px`,
                opacity: p.opacity,
                animation: `weatherSparkle ${p.duration} ease-in-out ${p.delay} infinite`,
                filter: "drop-shadow(0 0 4px rgba(253,224,71,0.8))",
              }}>⭐</div>
          ) : (
            <div key={p.id} className="absolute top-0"
              style={{
                left: `${p.x}%`,
                fontSize: `${p.size + 4}px`,
                opacity: p.opacity,
                animation: `weatherBlossomFall ${p.duration} ease-in-out ${p.delay} infinite`,
              }}>🌹</div>
          );
        }

        return null;
      })}
    </div>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

export { WeatherParticles, type ParticleKind };
