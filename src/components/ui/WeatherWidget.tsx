"use client";

import { useState, useEffect, useRef } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import { HolidayOverride } from "@/lib/weather-config";

// ─── Types ─────────────────────────────────────────────────────────────────

type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rainy" | "snowy";
type TimeOfDayFlag = "day" | "night";
type SeasonKey = "spring" | "summer" | "autumn" | "winter";

interface ForecastDay {
  day: string;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  precipitation: number;
  humidity: number;
  wind: number;
}

interface Particle {
  id: number;
  x: number;
  y?: number;
  delay: string;
  duration: string;
  size: number;
  color?: string;
  rotate?: number;
  opacity?: number;
  amplitude?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectCondition(text: string): Condition {
  const t = text.toLowerCase();
  if (t.includes("sun") || t.includes("clear")) return "sunny";
  if (t.includes("partly") || t.includes("partial")) return "partly-cloudy";
  if (t.includes("cloud")) return "cloudy";
  if (t.includes("rain") || t.includes("shower") || t.includes("drizzle")) return "rainy";
  if (t.includes("snow") || t.includes("blizzard")) return "snowy";
  return "partly-cloudy";
}

function toC(f: number) { return Math.round((f - 32) * 5 / 9); }

function getRealTimeOfDay(): TimeOfDayFlag {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "day" : "night";
}

function getRealSeason(): SeasonKey {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

// Auto-detect holiday based on current date
function detectAutoHoliday(): HolidayOverride {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();

  // Christmas season: Dec 15 - Dec 31
  if (month === 11 && day >= 15) return "christmas";
  // New Year's: Jan 1-7
  if (month === 0 && day <= 7) return "newyears";
  // Valentine's: Feb 10-16
  if (month === 1 && day >= 10 && day <= 16) return "valentines";
  // 4th of July: July 1-7
  if (month === 6 && day >= 1 && day <= 7) return "july4th";
  // Halloween season: Oct 25 - Oct 31
  if (month === 9 && day >= 25) return "halloween";

  return "none";
}

// ─── Season & Holiday Visual Systems ────────────────────────────────────────

interface VisualTheme {
  bgGradient: string;
  glowColor: string;
  accentColor: string;
  particleType: string;
  overlayType: string;
}

function getSeasonTheme(season: SeasonKey, tod: TimeOfDayFlag, condition: Condition): VisualTheme {
  const isNight = tod === "night";

  switch (season) {
    case "spring":
      return {
        bgGradient: isNight
          ? "linear-gradient(160deg, #1a0d2e 0%, #0d1f2d 40%, #0a2d1a 100%)"
          : "linear-gradient(160deg, #ffd6e8 0%, #ffe8f5 30%, #e8f5e9 60%, #f0fff4 100%)",
        glowColor: isNight ? "rgba(255,182,218,0.20)" : "rgba(255,182,218,0.35)",
        accentColor: isNight ? "#f9a8d4" : "#ec4899",
        particleType: "blossom",
        overlayType: "spring-mist",
      };
    case "summer":
      return {
        bgGradient: isNight
          ? "linear-gradient(160deg, #0f172a 0%, #1e1b4b 40%, #0c4a6e 100%)"
          : "linear-gradient(160deg, #fed7aa 0%, #fef08a 25%, #bbf7d0 60%, #7dd3fc 100%)",
        glowColor: isNight ? "rgba(251,191,36,0.15)" : "rgba(251,191,36,0.40)",
        accentColor: isNight ? "#fbbf24" : "#d97706",
        particleType: "firefly",
        overlayType: "heat-haze",
      };
    case "autumn":
      return {
        bgGradient: isNight
          ? "linear-gradient(160deg, #1c0a00 0%, #2d1200 40%, #1a150a 100%)"
          : "linear-gradient(160deg, #fde68a 0%, #fca5a5 25%, #f97316 50%, #92400e 100%)",
        glowColor: isNight ? "rgba(249,115,22,0.20)" : "rgba(249,115,22,0.35)",
        accentColor: isNight ? "#fb923c" : "#c2410c",
        particleType: "leaf",
        overlayType: "autumn-fog",
      };
    case "winter":
      return {
        bgGradient: isNight
          ? "linear-gradient(160deg, #020617 0%, #0c1445 40%, #0f2744 100%)"
          : "linear-gradient(160deg, #dbeafe 0%, #e0f2fe 35%, #f0f9ff 65%, #f8faff 100%)",
        glowColor: isNight ? "rgba(147,197,253,0.20)" : "rgba(186,230,253,0.50)",
        accentColor: isNight ? "#93c5fd" : "#2563eb",
        particleType: "snowflake",
        overlayType: "aurora",
      };
  }
}

function getHolidayTheme(holiday: HolidayOverride): Partial<VisualTheme> | null {
  switch (holiday) {
    case "christmas":
      return {
        bgGradient: "linear-gradient(160deg, #0a2010 0%, #15350f 40%, #0a1a00 100%)",
        glowColor: "rgba(255,80,60,0.25)",
        accentColor: "#ef4444",
        overlayType: "christmas",
        particleType: "christmas-snow",
      };
    case "halloween":
      return {
        bgGradient: "linear-gradient(160deg, #0d0010 0%, #1a0530 40%, #2d0a00 100%)",
        glowColor: "rgba(249,115,22,0.30)",
        accentColor: "#f97316",
        overlayType: "halloween",
        particleType: "bat",
      };
    case "july4th":
      return {
        bgGradient: "linear-gradient(160deg, #030712 0%, #0c1445 50%, #1e0036 100%)",
        glowColor: "rgba(239,68,68,0.25)",
        accentColor: "#ef4444",
        overlayType: "fireworks",
        particleType: "spark",
      };
    case "valentines":
      return {
        bgGradient: "linear-gradient(160deg, #2d0a1a 0%, #4c0519 40%, #1a0010 100%)",
        glowColor: "rgba(244,63,94,0.30)",
        accentColor: "#f43f5e",
        overlayType: "valentines",
        particleType: "heart",
      };
    case "newyears":
      return {
        bgGradient: "linear-gradient(160deg, #030712 0%, #1e1b4b 50%, #0f172a 100%)",
        glowColor: "rgba(234,179,8,0.30)",
        accentColor: "#eab308",
        overlayType: "newyears",
        particleType: "spark",
      };
    default:
      return null;
  }
}

// ─── Animated SVG Weather Icons ─────────────────────────────────────────────

function AnimatedSunIcon({ tod }: { tod: TimeOfDayFlag }) {
  const SIZE = 72;
  const CX = SIZE / 2;
  const CY = SIZE / 2;

  if (tod === "night") {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" aria-hidden="true">
        <circle cx={CX} cy={CY} r="32" fill="rgba(167,139,250,0.07)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }} />
        <path d="M40 20 A14 14 0 1 0 52 32 A18 18 0 0 1 40 20 Z" fill="#c4b5fd" />
        <path d="M38 22 A12 12 0 1 0 48 32 A16 16 0 0 1 38 22 Z" fill="#8b5cf6" />
        <g style={{ animation: "weatherSpin 20s linear infinite", transformOrigin: `${CX}px ${CY}px` }}>
          <circle cx={CX - 20} cy={CY - 15} r="1.5" fill="#fde047" style={{ animation: "weatherGlowPulse 2s ease-in-out infinite" }} />
          <circle cx={CX + 15} cy={CY + 20} r="2" fill="#fde047" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
          <circle cx={CX - 10} cy={CY + 25} r="1" fill="#fde047" style={{ animation: "weatherGlowPulse 2.5s ease-in-out infinite" }} />
        </g>
      </svg>
    );
  }

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" aria-hidden="true">
      <circle cx={CX} cy={CY} r="32" fill="rgba(251,191,36,0.07)" style={{ animation: "weatherGlowPulse 3.5s ease-in-out infinite" }} />
      <g style={{ animation: "weatherSpin 14s linear infinite", transformOrigin: `${CX}px ${CY}px` }}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (<circle key={i} cx={CX + Math.cos(a) * 30} cy={CY + Math.sin(a) * 30} r="2.5" fill="rgba(251,191,36,0.5)" />);
        })}
      </g>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <line key={i} x1={CX + Math.cos(a) * 15} y1={CY + Math.sin(a) * 15} x2={CX + Math.cos(a) * 23} y2={CY + Math.sin(a) * 23}
            stroke="#fbbf24" strokeWidth="3" strokeLinecap="round"
            style={{ animation: `weatherRayPulse 2.2s ease-in-out ${i * 0.28}s infinite`, transformOrigin: `${CX}px ${CY}px` }} />
        );
      })}
      <circle cx={CX} cy={CY} r="14" fill="rgba(251,191,36,0.18)" style={{ animation: "weatherGlowPulse 2.2s ease-in-out 0.6s infinite" }} />
      <circle cx={CX} cy={CY} r="12" fill="#fbbf24" />
      <circle cx={CX} cy={CY} r="10" fill="#f59e0b" />
      <circle cx={CX - 3.5} cy={CY - 3.5} r="3.5" fill="rgba(254,243,199,0.45)" />
    </svg>
  );
}

function AnimatedPartlyCloudyIcon({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {tod === "night" ? (
        <g style={{ animation: "weatherGlowPulse 5s ease-in-out infinite" }}>
          <path d="M35 15 A10 10 0 1 0 45 25 A12 12 0 0 1 35 15 Z" fill="#a78bfa" />
        </g>
      ) : (
        <g style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <line key={i} x1={24 + Math.cos(a) * 11} y1={24 + Math.sin(a) * 11} x2={24 + Math.cos(a) * 16} y2={24 + Math.sin(a) * 16}
                stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
            );
          })}
          <circle cx="24" cy="24" r="9" fill="#fbbf24" />
          <circle cx="24" cy="24" r="7" fill="#f59e0b" />
          <circle cx="21" cy="21" r="2.5" fill="rgba(254,243,199,0.4)" />
        </g>
      )}
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path d="M12 54 Q11 44 21 44 Q23 37 33 39 Q41 36 43 42 Q51 42 51 51 Q51 56 46 56 L18 56 Q12 56 12 54 Z"
          fill="rgba(203,213,225,0.9)" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        <path d="M19 48 Q27 44 35 46" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function AnimatedCloudyIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 7s ease-in-out 1.8s infinite" }}>
        <path d="M28 46 Q27 38 36 38 Q38 31 47 33 Q54 31 56 37 Q63 37 63 45 Q63 49 58 49 L34 49 Q28 49 28 46 Z" fill="rgba(148,163,184,0.7)" />
      </g>
      <g style={{ animation: "weatherCloudBob 5.5s ease-in-out infinite" }}>
        <path d="M6 52 Q5 42 15 42 Q17 35 27 37 Q35 34 38 40 Q46 40 46 49 Q46 54 41 54 L12 54 Q6 54 6 52 Z"
          fill="rgba(203,213,225,0.9)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <path d="M13 46 Q21 42 29 44" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function AnimatedRainyIcon() {
  const drops = [{ x: 11, delay: "0s" }, { x: 21, delay: "0.32s" }, { x: 31, delay: "0.64s" }, { x: 41, delay: "0.16s" }, { x: 16, delay: "0.80s" }, { x: 26, delay: "0.48s" }, { x: 36, delay: "0.96s" }];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 4.5s ease-in-out infinite" }}>
        <path d="M8 38 Q7 28 17 28 Q19 21 29 23 Q37 20 40 26 Q48 26 48 35 Q48 40 42 40 L14 40 Q8 40 8 38 Z" fill="rgba(100,116,139,0.88)" />
        <path d="M15 32 Q24 28 32 30" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {drops.map((d, i) => (
        <line key={i} x1={d.x + 2} y1="44" x2={d.x} y2="58" stroke="rgba(96,165,250,0.8)" strokeWidth="2.5" strokeLinecap="round"
          style={{ animation: `weatherRainDrop 1.35s linear ${d.delay} infinite` }} />
      ))}
    </svg>
  );
}

function AnimatedSnowyIcon() {
  const flakes = [{ x: 13, delay: "0s" }, { x: 23, delay: "0.55s" }, { x: 33, delay: "0.28s" }, { x: 43, delay: "0.80s" }, { x: 18, delay: "1.05s" }, { x: 38, delay: "0.12s" }];
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g style={{ animation: "weatherCloudBob 5s ease-in-out infinite" }}>
        <path d="M8 35 Q7 25 17 25 Q19 18 29 20 Q37 17 40 23 Q48 23 48 32 Q48 37 42 37 L14 37 Q8 37 8 35 Z" fill="rgba(186,230,253,0.88)" />
        <path d="M15 29 Q24 25 32 27" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {flakes.map((f, i) => (
        <g key={i} style={{ animation: `weatherSnowDrift 2.4s ease-in-out ${f.delay} infinite` }}>
          <circle cx={f.x} cy="52" r="3" fill="rgba(224,242,254,0.95)" />
          <line x1={f.x - 4} y1="52" x2={f.x + 4} y2="52" stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={f.x} y1="48" x2={f.x} y2="56" stroke="rgba(186,230,253,0.8)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

const ICONS: Record<Condition, (props: { tod: TimeOfDayFlag }) => React.ReactElement> = {
  sunny: AnimatedSunIcon,
  "partly-cloudy": AnimatedPartlyCloudyIcon,
  cloudy: AnimatedCloudyIcon,
  rainy: AnimatedRainyIcon,
  snowy: AnimatedSnowyIcon,
};

// ─── Season Background Art ────────────────────────────────────────────────────

function SpringBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Cherry blossom branches - top right */}
      <g opacity="0.22">
        <line x1="260" y1="0" x2="220" y2="60" stroke={tod === "night" ? "#f9a8d4" : "#db2777"} strokeWidth="3" strokeLinecap="round"/>
        <line x1="220" y1="60" x2="190" y2="100" stroke={tod === "night" ? "#f9a8d4" : "#db2777"} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="220" y1="60" x2="260" y2="90" stroke={tod === "night" ? "#f9a8d4" : "#db2777"} strokeWidth="2" strokeLinecap="round"/>
        <line x1="190" y1="100" x2="160" y2="130" stroke={tod === "night" ? "#f9a8d4" : "#db2777"} strokeWidth="2" strokeLinecap="round"/>
        <line x1="190" y1="100" x2="215" y2="125" stroke={tod === "night" ? "#f9a8d4" : "#db2777"} strokeWidth="1.5" strokeLinecap="round"/>
        {/* Blossoms */}
        {[
          [230, 55], [240, 68], [215, 48], [255, 80], [265, 58],
          [196, 97], [208, 88], [183, 105], [170, 115], [158, 128],
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx},${cy})`} style={{ animation: `weatherGlowPulse ${2 + i * 0.3}s ease-in-out ${i * 0.2}s infinite` }}>
            {[0, 72, 144, 216, 288].map((angle, j) => (
              <ellipse key={j} cx={Math.cos(angle * Math.PI / 180) * 4} cy={Math.sin(angle * Math.PI / 180) * 4}
                rx="3.5" ry="2.5" transform={`rotate(${angle})`}
                fill={tod === "night" ? "#fbcfe8" : "#fce7f3"} opacity="0.9" />
            ))}
            <circle cx="0" cy="0" r="1.5" fill={tod === "night" ? "#f472b6" : "#ec4899"} />
          </g>
        ))}
      </g>
      {/* Grass at bottom */}
      <g opacity="0.15">
        {[10, 30, 50, 70, 90, 110, 130, 150, 170, 190, 210, 230, 250, 270, 290, 310].map((x, i) => (
          <path key={i} d={`M${x} 200 Q${x - 5} ${175 + (i % 3) * 5} ${x + 3} ${160 + (i % 4) * 8}`}
            stroke={tod === "night" ? "#4ade80" : "#22c55e"} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        ))}
      </g>
      {/* Spring mist at bottom */}
      <ellipse cx="160" cy="200" rx="180" ry="40" fill={tod === "night" ? "rgba(217,70,239,0.06)" : "rgba(249,168,212,0.15)"} />
    </svg>
  );
}

function SummerBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {tod === "night" ? (
        /* Night: galaxy & stars */
        <g>
          {/* Milky way swirl */}
          <ellipse cx="160" cy="100" rx="200" ry="60" fill="none" stroke="rgba(167,139,250,0.07)" strokeWidth="30" />
          {/* Stars */}
          {Array.from({ length: 40 }, (_, i) => (
            <circle key={i} cx={(i * 73 + 11) % 320} cy={(i * 47 + 17) % 200} r={0.5 + (i % 3) * 0.5}
              fill="white" opacity={0.4 + (i % 5) * 0.1}
              style={{ animation: `weatherGlowPulse ${1.5 + (i % 4)}s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
          {/* Shooting star */}
          <line x1="280" y1="30" x2="220" y2="70" stroke="rgba(255,255,255,0.6)" strokeWidth="1"
            strokeLinecap="round" style={{ animation: "weatherParticleSun 4s ease-out 2s infinite" }} />
        </g>
      ) : (
        /* Day: tropical vibes */
        <g>
          {/* Sun aura rings */}
          <circle cx="280" cy="30" r="55" fill="rgba(251,191,36,0.06)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
          <circle cx="280" cy="30" r="38" fill="rgba(251,191,36,0.08)" style={{ animation: "weatherGlowPulse 2.5s ease-in-out 0.5s infinite" }} />
          {/* Stylized palm silhouette */}
          <g opacity="0.18">
            <line x1="280" y1="200" x2="268" y2="110" stroke="#15803d" strokeWidth="5" strokeLinecap="round"/>
            {/* Palm leaves */}
            <path d="M268 115 Q240 90 220 105" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M268 120 Q295 85 315 95" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M268 125 Q250 100 245 80" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d="M268 115 Q285 100 300 110" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="265" cy="78" r="6" fill="#854d0e" opacity="0.5"/>
          </g>
          {/* Heat shimmer waves */}
          {[0, 1, 2].map(i => (
            <path key={i} d={`M0 ${160 + i * 15} Q80 ${155 + i * 15} 160 ${162 + i * 15} Q240 ${169 + i * 15} 320 ${160 + i * 15}`}
              stroke="rgba(251,191,36,0.08)" strokeWidth="2" fill="none"
              style={{ animation: `weatherCloudBob ${3 + i}s ease-in-out ${i * 0.7}s infinite` }} />
          ))}
        </g>
      )}
    </svg>
  );
}

function AutumnBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Bare oak tree silhouette */}
      <g opacity="0.20">
        <line x1="30" y1="200" x2="35" y2="130" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="6" strokeLinecap="round"/>
        <line x1="35" y1="130" x2="25" y2="80" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="4" strokeLinecap="round"/>
        <line x1="35" y1="130" x2="55" y2="100" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="25" y1="80" x2="15" y2="50" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="3" strokeLinecap="round"/>
        <line x1="25" y1="80" x2="40" y2="55" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="55" y1="100" x2="70" y2="75" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="55" y1="100" x2="45" y2="70" stroke={tod === "night" ? "#92400e" : "#78350f"} strokeWidth="2" strokeLinecap="round"/>
      </g>
      {/* Fog layers */}
      {[0, 1, 2].map(i => (
        <ellipse key={i} cx={80 + i * 70} cy={180 + i * 10} rx={100 + i * 20} ry={30 + i * 5}
          fill={tod === "night" ? `rgba(180,140,100,0.0${4 + i})` : `rgba(253,186,116,0.0${8 + i * 2})`}
          style={{ animation: `weatherCloudBob ${5 + i * 2}s ease-in-out ${i}s infinite` }} />
      ))}
      {/* Moon or sun through haze */}
      {tod === "night" ? (
        <circle cx="280" cy="35" r="22" fill="rgba(251,191,36,0.12)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }}>
          <animate attributeName="r" values="22;25;22" dur="4s" repeatCount="indefinite" />
        </circle>
      ) : (
        <circle cx="280" cy="35" r="35" fill="rgba(251,191,36,0.15)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
      )}
    </svg>
  );
}

function WinterBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Aurora borealis (night) */}
      {tod === "night" && (
        <g>
          <path d="M0 60 Q80 20 160 50 Q240 80 320 40" stroke="rgba(52,211,153,0.18)" strokeWidth="25" fill="none" strokeLinecap="round"
            style={{ animation: "weatherCloudBob 6s ease-in-out infinite" }} />
          <path d="M0 80 Q90 40 170 65 Q250 90 320 55" stroke="rgba(99,102,241,0.14)" strokeWidth="20" fill="none" strokeLinecap="round"
            style={{ animation: "weatherCloudBob 8s ease-in-out 1s infinite" }} />
          <path d="M0 100 Q100 55 180 80 Q260 105 320 70" stroke="rgba(167,139,250,0.10)" strokeWidth="15" fill="none" strokeLinecap="round"
            style={{ animation: "weatherCloudBob 7s ease-in-out 2s infinite" }} />
        </g>
      )}
      {/* Snow ground */}
      <path d="M0 175 Q40 168 80 172 Q120 176 160 170 Q200 164 240 171 Q280 178 320 172 L320 200 L0 200 Z"
        fill={tod === "night" ? "rgba(186,230,253,0.12)" : "rgba(219,234,254,0.40)"} />
      {/* Icicles from top */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => {
        const x = 10 + i * 32;
        const h = 8 + (i % 3) * 6;
        return (
          <path key={i} d={`M${x - 3} 0 L${x} ${h} L${x + 3} 0`}
            fill={tod === "night" ? "rgba(186,230,253,0.25)" : "rgba(219,234,254,0.50)"} />
        );
      })}
      {/* Pine tree silhouettes */}
      {[5, 290].map((bx, j) => (
        <g key={j} opacity="0.15">
          <polygon points={`${bx} 200, ${bx + 20} 200, ${bx + 10} 130`} fill={tod === "night" ? "#1e3a5f" : "#1e3a8a"} />
          <polygon points={`${bx - 5} 165, ${bx + 25} 165, ${bx + 10} 110`} fill={tod === "night" ? "#1e3a5f" : "#1e3a8a"} />
          <polygon points={`${bx} 145, ${bx + 20} 145, ${bx + 10} 95`} fill={tod === "night" ? "#1e3a5f" : "#1e3a8a"} />
        </g>
      ))}
    </svg>
  );
}

// ─── Holiday Overlay Art ─────────────────────────────────────────────────────

function ChristmasOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Fairy lights string */}
      <path d="M0 8 Q40 3 80 10 Q120 17 160 8 Q200 -1 240 8 Q280 17 320 8" stroke="rgba(120,80,40,0.5)" strokeWidth="1.5" fill="none"/>
      {/* Light bulbs */}
      {[15, 55, 95, 135, 175, 215, 255, 295].map((x, i) => {
        const y = 8 + Math.sin((x / 320) * Math.PI * 2) * 5;
        const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#f97316", "#a855f7", "#ec4899", "#06b6d4"];
        return (
          <g key={i}>
            <circle cx={x} cy={y + 4} r="5" fill={colors[i % colors.length]} opacity="0.85"
              style={{ animation: `weatherGlowPulse ${1.5 + i * 0.3}s ease-in-out ${i * 0.2}s infinite`, filter: `drop-shadow(0 0 4px ${colors[i % colors.length]})` }} />
          </g>
        );
      })}
      {/* Snow on edges */}
      {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((x, i) => (
        <ellipse key={i} cx={x} cy={200} rx="25" ry="10" fill="rgba(219,234,254,0.20)" />
      ))}
      {/* Cozy warm glow */}
      <circle cx="160" cy="220" r="120" fill="rgba(251,146,60,0.04)" />
    </svg>
  );
}

function HalloweenOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Moon */}
      <circle cx="270" cy="35" r="28" fill="rgba(253,224,71,0.12)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }}>
        <animate attributeName="r" values="28;31;28" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="270" cy="35" r="20" fill="rgba(253,224,71,0.20)" />
      {/* Silhouetted bats */}
      {[
        { x: 80, y: 40, s: 1.0, delay: "0s" },
        { x: 180, y: 20, s: 0.7, delay: "0.8s" },
        { x: 130, y: 60, s: 0.85, delay: "0.4s" },
      ].map((bat, i) => (
        <g key={i} style={{ animation: `weatherCloudBob ${3 + i}s ease-in-out ${bat.delay} infinite` }}
          transform={`translate(${bat.x},${bat.y}) scale(${bat.s})`}>
          <path d="M0 0 Q-12 -8 -18 -2 Q-12 2 0 0" fill="rgba(30,0,60,0.8)" />
          <path d="M0 0 Q12 -8 18 -2 Q12 2 0 0" fill="rgba(30,0,60,0.8)" />
          <ellipse cx="0" cy="1" rx="3" ry="4" fill="rgba(30,0,60,0.9)" />
        </g>
      ))}
      {/* Ground fog / mist */}
      {[0, 1, 2].map(i => (
        <ellipse key={i} cx={60 + i * 100} cy="195" rx={90 + i * 10} ry="20"
          fill={`rgba(120,0,180,0.0${5 + i})`}
          style={{ animation: `weatherCloudBob ${4 + i}s ease-in-out ${i * 1.5}s infinite` }} />
      ))}
      {/* Eerie glow at bottom */}
      <ellipse cx="160" cy="210" rx="150" ry="40" fill="rgba(249,115,22,0.05)" />
    </svg>
  );
}

function FireworksOverlay() {
  const bursts = [
    { cx: 80, cy: 50, color: "#ef4444", delay: "0s" },
    { cx: 200, cy: 35, color: "#3b82f6", delay: "0.6s" },
    { cx: 280, cy: 65, color: "#f8fafc", delay: "1.2s" },
    { cx: 140, cy: 80, color: "#ef4444", delay: "1.8s" },
  ];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {bursts.map((b, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse 2.4s ease-in-out ${b.delay} infinite` }}>
          {Array.from({ length: 12 }, (_, j) => {
            const angle = (j / 12) * Math.PI * 2;
            const r = 22;
            return (
              <line key={j}
                x1={b.cx} y1={b.cy}
                x2={b.cx + Math.cos(angle) * r} y2={b.cy + Math.sin(angle) * r}
                stroke={b.color} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            );
          })}
          <circle cx={b.cx} cy={b.cy} r="4" fill={b.color} opacity="0.9" />
        </g>
      ))}
      {/* Red white blue glow bands */}
      <rect x="0" y="170" width="320" height="4" fill="rgba(239,68,68,0.20)" rx="2" />
      <rect x="0" y="180" width="320" height="4" fill="rgba(248,250,252,0.15)" rx="2" />
      <rect x="0" y="190" width="320" height="4" fill="rgba(59,130,246,0.20)" rx="2" />
    </svg>
  );
}

function ValentinesOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Large glowing heart in background */}
      <path d="M160 160 C160 160 110 125 105 100 C100 75 120 65 135 80 C142 87 155 98 160 110 C165 98 178 87 185 80 C200 65 220 75 215 100 C210 125 160 160 160 160 Z"
        fill="rgba(244,63,94,0.08)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
      {/* Small floating hearts */}
      {[
        { x: 40, y: 30 }, { x: 270, y: 55 }, { x: 100, y: 75 }, { x: 230, y: 25 },
      ].map((h, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${2 + i * 0.5}s ease-in-out ${i * 0.4}s infinite` }}>
          <path d={`M${h.x} ${h.y + 4} C${h.x} ${h.y + 4} ${h.x - 6} ${h.y} ${h.x - 6} ${h.y - 3} C${h.x - 6} ${h.y - 6} ${h.x - 3} ${h.y - 8} ${h.x} ${h.y - 5} C${h.x + 3} ${h.y - 8} ${h.x + 6} ${h.y - 6} ${h.x + 6} ${h.y - 3} C${h.x + 6} ${h.y} ${h.x} ${h.y + 4} ${h.x} ${h.y + 4}`}
            fill="rgba(244,63,94,0.35)" />
        </g>
      ))}
      {/* Rose glow at corners */}
      <circle cx="0" cy="200" r="80" fill="rgba(244,63,94,0.06)" />
      <circle cx="320" cy="0" r="60" fill="rgba(244,63,94,0.06)" />
    </svg>
  );
}

function NewYearsOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Gold shimmer aura */}
      <circle cx="160" cy="100" r="140" fill="rgba(234,179,8,0.04)" style={{ animation: "weatherGlowPulse 2.5s ease-in-out infinite" }} />
      {/* Gold star bursts */}
      {[{ cx: 50, cy: 40 }, { cx: 270, cy: 30 }, { cx: 160, cy: 20 }, { cx: 100, cy: 80 }, { cx: 230, cy: 70 }].map((s, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${1.5 + i * 0.4}s ease-in-out ${i * 0.3}s infinite` }}>
          {Array.from({ length: 8 }, (_, j) => {
            const a = (j / 8) * Math.PI * 2;
            return (
              <line key={j} x1={s.cx} y1={s.cy}
                x2={s.cx + Math.cos(a) * 12} y2={s.cy + Math.sin(a) * 12}
                stroke="rgba(234,179,8,0.6)" strokeWidth="1.5" strokeLinecap="round" />
            );
          })}
          <circle cx={s.cx} cy={s.cy} r="3" fill="rgba(234,179,8,0.9)" />
        </g>
      ))}
      {/* Champagne fizz at bottom */}
      <path d="M0 185 Q80 178 160 185 Q240 192 320 185 L320 200 L0 200 Z" fill="rgba(234,179,8,0.08)" />
    </svg>
  );
}

// ─── Particle System ─────────────────────────────────────────────────────────

type ParticleKind = "blossom" | "leaf" | "firefly" | "snowflake" | "christmas-snow" | "bat" | "spark" | "heart" | "none";

function WeatherParticles({ type, tod }: { type: ParticleKind; tod: TimeOfDayFlag }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (type === "none") { setParticles([]); return; }

    const counts: Record<ParticleKind, number> = {
      blossom: 18,
      leaf: 16,
      firefly: 14,
      snowflake: 22,
      "christmas-snow": 20,
      bat: 5,
      spark: 30,
      heart: 12,
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
            : type === "spark" ? 2 + Math.random() * 3
            : type === "firefly" ? 3 + Math.random() * 3
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

        return null;
      })}
    </div>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({ icon, label, value, delay, accentColor }: { icon: string; label: string; value: string; delay: string; accentColor: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl"
      style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(8px)", animation: `weatherForecastIn 0.35s ease-out ${delay} both` }}>
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-xs font-bold" style={{ color: accentColor }}>{value}</span>
      <span className="text-text-muted text-[10px]">{label}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeatherWidget() {
  const { weather } = useWeatherConfig();
  const atm = useAtmosphericTheme();
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tempKey, setTempKey] = useState(0);
  const prevUnitRef = useRef(weather.unit);

  const [weatherData, setWeatherData] = useState<{
    currentTemp: number; currentCondition: string; feelsLike: number;
    forecast: ForecastDay[]; humidity: number; wind: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const lat = 42.7875;
    const lon = -86.1089;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`)
      .then(r => r.json())
      .then(data => {
        const current = data.current;
        const daily = data.daily;
        const wmoToCondition = (code: number) => {
          if (code === 0) return { condition: "Clear", emoji: "☀️" };
          if (code <= 3) return { condition: "Partly Cloudy", emoji: "⛅" };
          if (code <= 48) return { condition: "Foggy", emoji: "🌫️" };
          if (code <= 57) return { condition: "Drizzle", emoji: "🌦️" };
          if (code <= 67) return { condition: "Rainy", emoji: "🌧️" };
          if (code <= 77) return { condition: "Snowy", emoji: "❄️" };
          if (code <= 82) return { condition: "Rain Showers", emoji: "🌧️" };
          return { condition: "Thunderstorm", emoji: "⛈️" };
        };
        const currentWMO = wmoToCondition(current.weather_code);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const forecast: ForecastDay[] = daily.time.slice(1, 6).map((date: string, i: number) => {
          const wmo = wmoToCondition(daily.weather_code[i + 1]);
          return {
            day: days[new Date(date).getDay()],
            high: Math.round(daily.temperature_2m_max[i + 1]),
            low: Math.round(daily.temperature_2m_min[i + 1]),
            condition: wmo.condition,
            emoji: wmo.emoji,
            precipitation: daily.precipitation_probability_max[i + 1] || 0,
            humidity: current.relative_humidity_2m,
            wind: Math.round(current.wind_speed_10m),
          };
        });
        setWeatherData({
          currentTemp: Math.round(current.temperature_2m),
          currentCondition: currentWMO.condition,
          feelsLike: Math.round(current.apparent_temperature),
          forecast,
          humidity: current.relative_humidity_2m,
          wind: Math.round(current.wind_speed_10m),
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (prevUnitRef.current !== weather.unit) {
      setTempKey((k) => k + 1);
      prevUnitRef.current = weather.unit;
    }
  }, [weather.unit]);

  const condition = detectCondition(weatherData?.currentCondition ?? "Partly Cloudy");
  const tod = weather.timeOfDay === "auto" ? getRealTimeOfDay() : weather.timeOfDay as TimeOfDayFlag;
  const season = (weather.season === "auto" ? getRealSeason() : weather.season) as SeasonKey;

  // Resolve active holiday
  const rawHoliday = weather.holidayOverride ?? "auto";
  const activeHoliday: HolidayOverride = rawHoliday === "auto" ? detectAutoHoliday() : rawHoliday;

  // Build visual theme: holiday overrides season
  const seasonTheme = getSeasonTheme(season, tod, condition);
  const holidayTheme = activeHoliday !== "none" ? getHolidayTheme(activeHoliday) : null;
  const theme: VisualTheme = { ...seasonTheme, ...(holidayTheme || {}) };

  // Particle type: holiday wins if active
  const particleType = (holidayTheme?.particleType ?? theme.particleType) as ParticleKind;

  const Icon = ICONS[condition];
  const displayTemp = weather.unit === "C" ? toC(weatherData?.currentTemp ?? 72) : (weatherData?.currentTemp ?? 72);
  const displayFeels = weather.unit === "C" ? toC(weatherData?.feelsLike ?? 74) : (weatherData?.feelsLike ?? 74);

  // Holiday label badge
  const holidayLabels: Record<HolidayOverride, string> = {
    auto: "", none: "", christmas: "🎄 Christmas", halloween: "🎃 Halloween",
    july4th: "🎆 4th of July", valentines: "💝 Valentine's", newyears: "🥂 New Year's"
  };

  return (
    <div style={{ animation: mounted ? "weatherCardEnter 0.65s cubic-bezier(0.34,1.56,0.64,1) both" : undefined }}>
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{
          background: theme.bgGradient,
          border: `1px solid ${atm.glowColor}`,
          boxShadow: `0 0 60px ${theme.glowColor}, 0 16px 48px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)`,
          transition: "box-shadow 0.6s ease, background 0.6s ease, border-color 0.6s ease",
          minHeight: "180px",
        }}
      >
        {/* ── Season/Holiday Backdrop Art ── */}
        {mounted && (
          <>
            {activeHoliday === "none" || activeHoliday === "auto" ? (
              <>
                {season === "spring" && <SpringBackdrop tod={tod} />}
                {season === "summer" && <SummerBackdrop tod={tod} />}
                {season === "autumn" && <AutumnBackdrop tod={tod} />}
                {season === "winter" && <WinterBackdrop tod={tod} />}
              </>
            ) : (
              <>
                {activeHoliday === "christmas" && <><WinterBackdrop tod={tod} /><ChristmasOverlay /></>}
                {activeHoliday === "halloween" && <HalloweenOverlay />}
                {activeHoliday === "july4th" && <FireworksOverlay />}
                {activeHoliday === "valentines" && <ValentinesOverlay />}
                {activeHoliday === "newyears" && <NewYearsOverlay />}
              </>
            )}
          </>
        )}

        {/* ── Particle Layer ── */}
        {mounted && <WeatherParticles type={particleType} tod={tod} />}

        {/* ── Glassmorphism content overlay ── */}
        <div className="relative z-20 p-4" style={{ backdropFilter: "blur(0px)" }}>

          {/* Header: location + season badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium min-w-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                className="w-3.5 h-3.5 shrink-0" style={{ color: theme.accentColor }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate text-white/80">{weather.location}</span>
              {activeHoliday !== "none" && holidayLabels[activeHoliday] && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ml-1 flex-shrink-0"
                  style={{ background: `${theme.accentColor}33`, color: theme.accentColor, border: `1px solid ${theme.accentColor}55` }}>
                  {holidayLabels[activeHoliday]}
                </span>
              )}
            </div>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ml-2"
              style={{ background: `${theme.accentColor}25`, color: theme.accentColor, border: `1px solid ${theme.accentColor}40`, transition: "background 0.4s ease" }}>
              °{weather.unit}
            </span>
          </div>

          {/* Main display row */}
          <div className="flex items-center gap-3 mb-4">
            <div className="shrink-0 -ml-1 drop-shadow-lg">
              {mounted ? <Icon tod={tod} /> : (
                <div className="w-[72px] h-[72px] flex items-center justify-center text-5xl leading-none">⛅</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div key={tempKey} className="flex items-start leading-none mb-1"
                style={{ animation: tempKey > 0 ? "weatherTempPop 0.45s cubic-bezier(0.34,1.56,0.64,1)" : undefined }}>
                <span className="text-[52px] font-black tabular-nums leading-none tracking-tight"
                  style={{ color: "white", textShadow: `0 0 30px ${theme.accentColor}88, 0 2px 8px rgba(0,0,0,0.3)` }}>
                  {displayTemp}
                </span>
                <span className="text-2xl font-light mt-2 ml-1 text-white/50">°</span>
              </div>
              <p className="text-white text-sm font-semibold mb-0.5 drop-shadow">{weatherData?.currentCondition ?? "Partly Cloudy"}</p>
              <p className="text-white/55 text-[11px]">Feels like {displayFeels}°{weather.unit} · {season} · {tod}</p>
            </div>
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg transition-all duration-200 active:scale-95"
            style={{ color: theme.accentColor, background: `${theme.accentColor}15`, border: `1px solid ${theme.accentColor}25` }}
          >
            {expanded ? "Hide details" : "More details"}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              className="w-3.5 h-3.5 transition-transform duration-300"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Expandable panel */}
          <div className="overflow-hidden transition-all duration-500"
            style={{ maxHeight: expanded ? "440px" : "0px", opacity: expanded ? 1 : 0 }}>
            <div className="pt-3 space-y-3 mt-2" style={{ borderTop: `1px solid ${theme.accentColor}30` }}>
              <div className="grid grid-cols-3 gap-2">
                <StatPill icon="💧" label="Rain" value={`${weatherData?.forecast?.[0]?.precipitation ?? 10}%`} delay="0s" accentColor={theme.accentColor} />
                <StatPill icon="🌫️" label="Humidity" value={`${weatherData?.humidity ?? 55}%`} delay="0.07s" accentColor={theme.accentColor} />
                <StatPill icon="💨" label="Wind" value={`${weatherData?.wind ?? 8} mph`} delay="0.14s" accentColor={theme.accentColor} />
              </div>
              <div>
                <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest mb-2">5-Day Forecast</p>
                <div className="flex justify-between gap-1.5">
                  {(weatherData?.forecast ?? []).map((day, i) => (
                    <div key={day.day} className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl cursor-default"
                      style={{
                        background: "rgba(255,255,255,0.07)",
                        backdropFilter: "blur(6px)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        animation: expanded ? `weatherForecastIn 0.38s ease-out ${0.18 + i * 0.06}s both` : undefined,
                      }}
                      title={`${day.condition} · High ${weather.unit === "C" ? toC(day.high) : day.high}° / Low ${weather.unit === "C" ? toC(day.low) : day.low}°`}>
                      <span className="text-white/50 text-[10px] font-semibold">{day.day}</span>
                      <span className="text-xl leading-none">{day.emoji}</span>
                      <span className="text-white text-[11px] font-bold">{weather.unit === "C" ? toC(day.high) : day.high}°</span>
                      <span className="text-white/40 text-[10px]">{weather.unit === "C" ? toC(day.low) : day.low}°</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Atmospheric bottom edge — color bleeds downward */}
        <div
          className="absolute bottom-0 left-0 right-0 h-3 pointer-events-none"
          style={{
            background: `linear-gradient(180deg, transparent, ${atm.bridgeGlow})`,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}