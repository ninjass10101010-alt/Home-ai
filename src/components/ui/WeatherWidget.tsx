/* eslint-disable react-hooks/set-state-in-effect */
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
  // St. Patrick's Day: Mar 14-17
  if (month === 2 && day >= 14 && day <= 17) return "stpatricks";
  // Cinco de Mayo: May 3-6
  if (month === 4 && day >= 3 && day <= 6) return "cincodemayo";
  // Mexican Independence: Sep 15-16
  if (month === 8 && day >= 15 && day <= 16) return "mexicanindependence";
  // Halloween season: Oct 25 - Oct 30 (Día de los Muertos starts 31st)
  if (month === 9 && day >= 25 && day <= 30) return "halloween";
  // Día de los Muertos: Oct 31 - Nov 2
  if ((month === 9 && day === 31) || (month === 10 && day >= 1 && day <= 2)) return "diadelosmuertos";
  // 4th of July: July 1-7
  if (month === 6 && day >= 1 && day <= 7) return "july4th";
  // Thanksgiving: approx Nov 22-28
  if (month === 10 && day >= 22 && day <= 28) return "thanksgiving";
  // Virgin of Guadalupe: Dec 11 - Dec 13
  if (month === 11 && day >= 11 && day <= 13) return "virginguadalupe";

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

// Used for live UI accent wiring (WeatherWidget visuals).
interface WeatherAccent {
  selected: string;
  glow: string;
  button: string;
  border: string;
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
    case "cincodemayo":
      return {
        bgGradient: "linear-gradient(160deg, #0a1a00 0%, #1a0a00 25%, #1a0000 50%, #00001a 75%, #001a0a 100%)",
        glowColor: "rgba(220,38,38,0.30)",
        accentColor: "#f59e0b",
        overlayType: "cincodemayo",
        particleType: "confetti",
      };
    case "thanksgiving":
      return {
        bgGradient: "linear-gradient(160deg, #1c0a00 0%, #2d1600 35%, #1a0f00 65%, #0d0a00 100%)",
        glowColor: "rgba(217,119,6,0.30)",
        accentColor: "#d97706",
        overlayType: "thanksgiving",
        particleType: "harvest",
      };
    case "stpatricks":
      return {
        bgGradient: "linear-gradient(160deg, #001a00 0%, #002d00 35%, #001500 65%, #000d00 100%)",
        glowColor: "rgba(34,197,94,0.30)",
        accentColor: "#22c55e",
        overlayType: "stpatricks",
        particleType: "shamrock",
      };
    case "diadelosmuertos":
      return {
        bgGradient: "linear-gradient(160deg, #1b0222 0%, #3a003f 40%, #580c2f 70%, #d97706 100%)",
        glowColor: "rgba(245,158,11,0.25)",
        accentColor: "#ec4899",
        overlayType: "diadelosmuertos",
        particleType: "marigold",
      };
    case "mexicanindependence":
      return {
        bgGradient: "linear-gradient(160deg, #021a0c 0%, #0c351c 30%, #1c2d3a 65%, #3c0c14 100%)",
        glowColor: "rgba(34,197,94,0.25)",
        accentColor: "#22c55e",
        overlayType: "mexicanindependence",
        particleType: "tricolor-sparks",
      };
    case "virginguadalupe":
      return {
        bgGradient: "linear-gradient(160deg, #061f2d 0%, #0d3846 45%, #2c1628 75%, #4c1130 100%)",
        glowColor: "rgba(45,212,191,0.20)",
        accentColor: "#0d9488",
        overlayType: "virginguadalupe",
        particleType: "holy-roses",
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
  const branchColor = tod === "night" ? "#f9a8d4" : "#be185d";
  const blossomFill = tod === "night" ? "#fbcfe8" : "#fce7f3";
  const blossomCenter = tod === "night" ? "#f472b6" : "#ec4899";
  const grassColor = tod === "night" ? "#4ade80" : "#16a34a";

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Sky gradient overlay */}
      <defs>
        <linearGradient id="springSkyday" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tod === "night" ? "#1a0d2e" : "#fce7f3"} stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <rect width="320" height="120" fill="url(#springSkyday)" />

      {/* Left branch cluster */}
      <g opacity="0.30">
        <line x1="0" y1="100" x2="35" y2="55" stroke={branchColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="35" y1="55" x2="15" y2="20" stroke={branchColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="35" y1="55" x2="65" y2="30" stroke={branchColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="15" y1="20" x2="5" y2="0" stroke={branchColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="15" y1="20" x2="30" y2="5" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="65" y1="30" x2="80" y2="10" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="65" y1="30" x2="50" y2="10" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Left blossoms */}
        {[[5,0],[18,6],[32,5],[50,10],[65,10],[80,10],[10,20],[25,15],[38,22],[60,30],[70,28]].map(([cx,cy],i) => (
          <g key={i} transform={`translate(${cx},${cy})`} style={{ animation: `weatherGlowPulse ${1.8+i*0.25}s ease-in-out ${i*0.18}s infinite` }}>
            {[0,72,144,216,288].map((angle,j) => (
              <ellipse key={j} cx={Math.cos(angle*Math.PI/180)*4} cy={Math.sin(angle*Math.PI/180)*4} rx="3.8" ry="2.6" transform={`rotate(${angle})`} fill={blossomFill} opacity="0.95"/>
            ))}
            <circle cx="0" cy="0" r="1.6" fill={blossomCenter}/>
          </g>
        ))}
      </g>

      {/* Right branch cluster */}
      <g opacity="0.28">
        <line x1="320" y1="80" x2="285" y2="40" stroke={branchColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="285" y1="40" x2="260" y2="10" stroke={branchColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="285" y1="40" x2="310" y2="15" stroke={branchColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="260" y1="10" x2="245" y2="0" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        {[[260,10],[250,2],[270,5],[295,15],[308,15],[285,40],[272,32],[295,32]].map(([cx,cy],i) => (
          <g key={i} transform={`translate(${cx},${cy})`} style={{ animation: `weatherGlowPulse ${2+i*0.2}s ease-in-out ${i*0.15}s infinite` }}>
            {[0,72,144,216,288].map((angle,j) => (
              <ellipse key={j} cx={Math.cos(angle*Math.PI/180)*3.5} cy={Math.sin(angle*Math.PI/180)*3.5} rx="3.2" ry="2.2" transform={`rotate(${angle})`} fill={blossomFill} opacity="0.9"/>
            ))}
            <circle cx="0" cy="0" r="1.4" fill={blossomCenter}/>
          </g>
        ))}
      </g>

      {/* Rolling meadow hills */}
      <g opacity={tod === "night" ? 0.18 : 0.28}>
        <ellipse cx="60" cy="195" rx="120" ry="30" fill={grassColor} />
        <ellipse cx="260" cy="198" rx="100" ry="25" fill={grassColor} />
      </g>

      {/* Swaying tall grass blades */}
      <g opacity={tod === "night" ? 0.15 : 0.22}>
        {[8,22,38,54,70,86,102,118,134,150,166,182,198,214,230,246,262,278,294,310].map((x,i) => (
          <path key={i} d={`M${x} 200 Q${x+(i%2===0?-6:6)} ${178+(i%3)*4} ${x+(i%2===0?3:-3)} ${160+(i%4)*6}`}
            stroke={grassColor} strokeWidth="1.8" fill="none" strokeLinecap="round"
            style={{ animation: `weatherCloudBob ${2.5+i*0.1}s ease-in-out ${i*0.08}s infinite` }} />
        ))}
      </g>

      {/* Night: moon glow + firefly bokeh */}
      {tod === "night" && (
        <g>
          <circle cx="60" cy="35" r="28" fill="rgba(249,168,212,0.08)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <circle cx="60" cy="35" r="18" fill="rgba(249,168,212,0.15)"/>
          <path d="M58 22 A14 14 0 1 0 72 36 A18 18 0 0 1 58 22 Z" fill="rgba(253,164,175,0.7)"/>
          {/* Bokeh dots */}
          {[[40,90],[80,70],[140,110],[200,80],[250,95],[170,60],[110,85],[280,75]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r={1.5+i%2} fill="rgba(249,168,212,0.5)"
              style={{ animation: `weatherGlowPulse ${1.5+i*0.3}s ease-in-out ${i*0.2}s infinite` }}/>
          ))}
        </g>
      )}

      {/* Day: sun rays peaking from top-left */}
      {tod === "day" && (
        <g opacity="0.18">
          <circle cx="30" cy="25" r="45" fill="rgba(251,207,232,0.3)" style={{ animation: "weatherSunHalo 4s ease-in-out infinite" }}/>
          {[0,30,60,90,120,150,180].map((a,i) => {
            const rad = a * Math.PI / 180;
            return <line key={i} x1={30+Math.cos(rad)*22} y1={25+Math.sin(rad)*22} x2={30+Math.cos(rad)*38} y2={25+Math.sin(rad)*38}
              stroke="#fce7f3" strokeWidth="2" strokeLinecap="round"
              style={{ animation: `weatherRayPulse 2.5s ease-in-out ${i*0.3}s infinite` }}/>;
          })}
          <circle cx="30" cy="25" r="18" fill="rgba(252,231,243,0.5)"/>
        </g>
      )}

      {/* Ground mist */}
      <ellipse cx="160" cy="202" rx="200" ry="35" fill={tod === "night" ? "rgba(217,70,239,0.07)" : "rgba(249,168,212,0.18)"} />
    </svg>
  );
}

function SummerBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="summerSunGlow" cx="85%" cy="15%" r="50%">
          <stop offset="0%" stopColor="rgba(251,191,36,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="summerMoonGlow" cx="15%" cy="15%" r="40%">
          <stop offset="0%" stopColor="rgba(167,139,250,0.12)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {tod === "night" ? (
        /* Night: rich galaxy scene */
        <g>
          <rect width="320" height="200" fill="url(#summerMoonGlow)" />
          {/* Milky way arch */}
          <ellipse cx="160" cy="80" rx="210" ry="55" fill="none" stroke="rgba(167,139,250,0.08)" strokeWidth="32" />
          <ellipse cx="160" cy="80" rx="210" ry="55" fill="none" stroke="rgba(196,181,253,0.04)" strokeWidth="10" />
          {/* Stars — varied brightness */}
          {Array.from({ length: 55 }, (_, i) => (
            <circle key={i}
              cx={(i * 83 + 17) % 320} cy={(i * 53 + 11) % 200}
              r={i%7===0 ? 2 : i%3===0 ? 1.2 : 0.6}
              fill="white" opacity={0.3 + (i % 5) * 0.12}
              style={{ animation: `weatherGlowPulse ${1.2+(i%5)*0.4}s ease-in-out ${i*0.12}s infinite` }} />
          ))}
          {/* Shooting star 1 */}
          <line x1="260" y1="20" x2="190" y2="65" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2"
            strokeLinecap="round" style={{ animation: "weatherParticleSun 5s ease-out 0.5s infinite" }} />
          {/* Shooting star 2 */}
          <line x1="100" y1="15" x2="40" y2="50" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"
            strokeLinecap="round" style={{ animation: "weatherParticleSun 5s ease-out 2.8s infinite" }} />
          {/* Crescent moon */}
          <circle cx="275" cy="35" r="22" fill="rgba(254,240,138,0.14)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <path d="M272 20 A16 16 0 1 0 290 36 A20 20 0 0 1 272 20 Z" fill="rgba(253,224,71,0.65)"/>
          {/* Warm sea glow at bottom */}
          <ellipse cx="160" cy="200" rx="200" ry="30" fill="rgba(56,189,248,0.06)" style={{ animation: "weatherCloudBob 6s ease-in-out infinite" }}/>
        </g>
      ) : (
        /* Day: blazing tropical scene */
        <g>
          <rect width="320" height="200" fill="url(#summerSunGlow)" />
          {/* Sun halo rings */}
          <circle cx="285" cy="28" r="70" fill="rgba(251,191,36,0.05)" style={{ animation: "weatherSunHalo 3s ease-in-out infinite" }}/>
          <circle cx="285" cy="28" r="50" fill="rgba(251,191,36,0.08)" style={{ animation: "weatherSunHalo 2.5s ease-in-out 0.5s infinite" }}/>
          <circle cx="285" cy="28" r="30" fill="rgba(251,191,36,0.12)" style={{ animation: "weatherSunHalo 2s ease-in-out 1s infinite" }}/>
          {/* Sun rays */}
          {Array.from({length:12},(_, i) => {
            const a = (i/12)*Math.PI*2;
            return <line key={i} x1={285+Math.cos(a)*32} y1={28+Math.sin(a)*32} x2={285+Math.cos(a)*52} y2={28+Math.sin(a)*52}
              stroke="rgba(251,191,36,0.25)" strokeWidth="2" strokeLinecap="round"
              style={{ animation: `weatherRayPulse 2s ease-in-out ${i*0.17}s infinite` }}/>;
          })}
          <circle cx="285" cy="28" r="18" fill="rgba(251,191,36,0.9)"/>
          <circle cx="285" cy="28" r="14" fill="#f59e0b"/>
          {/* Tall palm tree — left side */}
          <g opacity="0.22">
            <path d="M55 200 Q52 160 50 120 Q48 90 58 70" stroke="#15803d" strokeWidth="6" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q30 48 10 62" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q85 42 105 55" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q40 50 35 30" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q80 52 88 35" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q60 48 55 25" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="40" cy="65" r="5" fill="#78350f" opacity="0.6"/>
            <circle cx="74" cy="60" r="4" fill="#78350f" opacity="0.6"/>
          </g>
          {/* Distant palm — right */}
          <g opacity="0.14">
            <path d="M290 200 Q288 170 287 145 Q286 125 292 110" stroke="#166534" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q272 95 258 104" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q312 92 320 102" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q280 96 277 82" stroke="#166534" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          </g>
          {/* Ocean horizon glow */}
          <ellipse cx="160" cy="200" rx="220" ry="28" fill="rgba(56,189,248,0.18)" />
          {/* Heat shimmer waves */}
          {[0,1,2,3].map(i => (
            <path key={i} d={`M0 ${155+i*12} Q80 ${150+i*12} 160 ${157+i*12} Q240 ${164+i*12} 320 ${155+i*12}`}
              stroke="rgba(251,191,36,0.07)" strokeWidth="3" fill="none"
              style={{ animation: `weatherCloudBob ${2.5+i*0.8}s ease-in-out ${i*0.6}s infinite` }}/>
          ))}
        </g>
      )}
    </svg>
  );
}

function AutumnBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  const trunkColor = tod === "night" ? "#92400e" : "#6b2d0a";
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="autumnMoon" cx="85%" cy="18%" r="20%">
          <stop offset="0%" stopColor="rgba(251,191,36,0.22)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Sky wash */}
      {tod === "night" && <rect width="320" height="200" fill="url(#autumnMoon)" />}

      {/* Large oak tree — left, with full foliage crown */}
      <g opacity={tod === "night" ? 0.28 : 0.32}>
        {/* Trunk + main branches */}
        <line x1="60" y1="200" x2="62" y2="140" stroke={trunkColor} strokeWidth="8" strokeLinecap="round"/>
        <line x1="62" y1="140" x2="45" y2="90" stroke={trunkColor} strokeWidth="5.5" strokeLinecap="round"/>
        <line x1="62" y1="140" x2="85" y2="100" stroke={trunkColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="45" y1="90" x2="28" y2="55" stroke={trunkColor} strokeWidth="4" strokeLinecap="round"/>
        <line x1="45" y1="90" x2="62" y2="58" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="85" y1="100" x2="105" y2="68" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="85" y1="100" x2="72" y2="72" stroke={trunkColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="28" y1="55" x2="15" y2="28" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="28" y1="55" x2="38" y2="30" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="62" y1="58" x2="52" y2="35" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="62" y1="58" x2="75" y2="35" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="105" y1="68" x2="118" y2="42" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="105" y1="68" x2="96" y2="42" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Foliage cloud clusters — warm autumn colors */}
        {[
          [20, 22, 35, tod === "night" ? "rgba(154,52,18,0.55)" : "rgba(234,88,12,0.60)"],
          [40, 28, 30, tod === "night" ? "rgba(180,83,9,0.50)" : "rgba(245,158,11,0.58)"],
          [62, 30, 28, tod === "night" ? "rgba(161,47,0,0.55)" : "rgba(220,38,38,0.55)"],
          [80, 38, 32, tod === "night" ? "rgba(154,52,18,0.45)" : "rgba(234,88,12,0.50)"],
          [105, 45, 30, tod === "night" ? "rgba(120,53,15,0.50)" : "rgba(202,138,4,0.55)"],
          [48, 55, 25, tod === "night" ? "rgba(180,83,9,0.40)" : "rgba(249,115,22,0.50)"],
          [72, 55, 22, tod === "night" ? "rgba(161,47,0,0.40)" : "rgba(239,68,68,0.48)"],
          [28, 50, 20, tod === "night" ? "rgba(120,53,15,0.35)" : "rgba(202,138,4,0.45)"],
          [95, 60, 20, tod === "night" ? "rgba(154,52,18,0.35)" : "rgba(234,88,12,0.42)"],
        ].map(([cx, cy, r, fill], i) => (
          <ellipse key={i} cx={cx as number} cy={cy as number} rx={(r as number) * 1.4} ry={r as number}
            fill={fill as string}
            style={{ animation: `weatherCloudBob ${3.5+i*0.4}s ease-in-out ${i*0.25}s infinite` }}/>
        ))}
      </g>

      {/* Smaller bare tree — right */}
      <g opacity={tod === "night" ? 0.20 : 0.22}>
        <line x1="280" y1="200" x2="278" y2="155" stroke={trunkColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="278" y1="155" x2="265" y2="115" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="278" y1="155" x2="295" y2="125" stroke={trunkColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="265" y1="115" x2="252" y2="88" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="265" y1="115" x2="274" y2="88" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="295" y1="125" x2="308" y2="100" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="295" y1="125" x2="285" y2="100" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Small foliage clumps */}
        {[
          [252, 82, 18, tod === "night" ? "rgba(180,83,9,0.40)" : "rgba(234,88,12,0.45)"],
          [278, 82, 16, tod === "night" ? "rgba(154,52,18,0.35)" : "rgba(245,158,11,0.40)"],
          [308, 94, 15, tod === "night" ? "rgba(120,53,15,0.35)" : "rgba(220,38,38,0.40)"],
        ].map(([cx, cy, r, fill], i) => (
          <ellipse key={i} cx={cx as number} cy={cy as number} rx={(r as number)*1.3} ry={r as number}
            fill={fill as string}
            style={{ animation: `weatherCloudBob ${4+i*0.5}s ease-in-out ${i*0.3}s infinite` }}/>
        ))}
      </g>

      {/* Harvest moon (night) or warm sun (day) */}
      {tod === "night" ? (
        <g>
          <circle cx="240" cy="30" r="36" fill="rgba(251,191,36,0.10)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <circle cx="240" cy="30" r="24" fill="rgba(251,191,36,0.18)"/>
          <circle cx="240" cy="30" r="18" fill="rgba(253,224,71,0.55)"/>
          <circle cx="233" cy="24" r="5" fill="rgba(245,158,11,0.3)"/>
          <circle cx="245" cy="32" r="3" fill="rgba(245,158,11,0.25)"/>
        </g>
      ) : (
        <g>
          <circle cx="260" cy="25" r="45" fill="rgba(251,191,36,0.10)" style={{ animation: "weatherSunHalo 3.5s ease-in-out infinite" }}/>
          <circle cx="260" cy="25" r="28" fill="rgba(251,191,36,0.18)"/>
        </g>
      )}

      {/* Rolling ground */}
      <path d="M0 185 Q55 175 110 182 Q165 189 220 178 Q270 167 320 178 L320 200 L0 200 Z"
        fill={tod === "night" ? "rgba(120,53,15,0.18)" : "rgba(146,64,14,0.28)"} />

      {/* Fog banks */}
      {[0,1,2].map(i => (
        <ellipse key={i} cx={70+i*90} cy={190+i*6} rx={85+i*15} ry={22+i*4}
          fill={tod === "night" ? `rgba(180,140,100,0.06)` : `rgba(253,186,116,0.10)`}
          style={{ animation: `weatherCloudBob ${5+i*2}s ease-in-out ${i}s infinite` }} />
      ))}
    </svg>
  );
}

function WinterBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  const iceColor = tod === "night" ? "rgba(147,197,253,0.30)" : "rgba(219,234,254,0.55)";
  const snowColor = tod === "night" ? "rgba(186,230,253,0.14)" : "rgba(219,234,254,0.50)";
  const treeColor = tod === "night" ? "#1e3a5f" : "#1d4ed8";

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="auroraGrad1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(52,211,153,0)" />
          <stop offset="30%" stopColor="rgba(52,211,153,0.22)" />
          <stop offset="70%" stopColor="rgba(99,102,241,0.18)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0)" />
        </linearGradient>
        <linearGradient id="auroraGrad2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(167,139,250,0)" />
          <stop offset="40%" stopColor="rgba(167,139,250,0.16)" />
          <stop offset="60%" stopColor="rgba(52,211,153,0.12)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0)" />
        </linearGradient>
        <linearGradient id="auroraGrad3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(236,72,153,0)" />
          <stop offset="50%" stopColor="rgba(236,72,153,0.10)" />
          <stop offset="100%" stopColor="rgba(147,197,253,0)" />
        </linearGradient>
      </defs>

      {/* Aurora borealis bands (night) */}
      {tod === "night" && (
        <g>
          <path d="M-20 55 Q80 15 160 45 Q240 75 340 35" stroke="url(#auroraGrad1)" strokeWidth="30" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 7s ease-in-out infinite" }} />
          <path d="M-20 75 Q90 35 175 60 Q260 85 340 50" stroke="url(#auroraGrad2)" strokeWidth="22" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 9s ease-in-out 1.5s infinite" }} />
          <path d="M-20 95 Q100 50 185 75 Q265 100 340 65" stroke="url(#auroraGrad3)" strokeWidth="15" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 8s ease-in-out 3s infinite" }} />
          <path d="M-20 115 Q110 65 195 90 Q270 115 340 80" stroke="url(#auroraGrad1)" strokeWidth="10" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 6s ease-in-out 4.5s infinite" }} />
          {/* Stars */}
          {Array.from({ length: 30 }, (_, i) => (
            <circle key={i} cx={(i * 97 + 23) % 320} cy={(i * 41 + 8) % 130} r={0.5 + (i % 3) * 0.6}
              fill="white" opacity={0.35 + (i % 4) * 0.12}
              style={{ animation: `weatherGlowPulse ${1.8+(i%4)*0.4}s ease-in-out ${i*0.1}s infinite` }}/>
          ))}
          {/* Moon */}
          <circle cx="265" cy="28" r="30" fill="rgba(147,197,253,0.10)" style={{ animation: "weatherSunHalo 6s ease-in-out infinite" }}/>
          <circle cx="265" cy="28" r="18" fill="rgba(186,230,253,0.22)"/>
          <path d="M263 14 A16 16 0 1 0 281 30 A20 20 0 0 1 263 14 Z" fill="rgba(219,234,254,0.65)"/>
        </g>
      )}

      {/* Day: bright overcast glow */}
      {tod === "day" && (
        <g>
          <circle cx="160" cy="-10" r="80" fill="rgba(219,234,254,0.30)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
        </g>
      )}

      {/* Dense pine forest — left */}
      {[0, 30, 58].map((ox, j) => (
        <g key={j} opacity={0.22 - j*0.04}>
          <polygon points={`${ox+10} 200,${ox+36} 200,${ox+23} 145`} fill={treeColor} />
          <polygon points={`${ox+5} 168,${ox+41} 168,${ox+23} 120`} fill={treeColor} />
          <polygon points={`${ox+10} 143,${ox+36} 143,${ox+23} 100`} fill={treeColor} />
          <polygon points={`${ox+14} 120,${ox+32} 120,${ox+23} 82`} fill={treeColor} />
          {/* Snow caps on each tier */}
          <ellipse cx={ox+23} cy={145} rx="14" ry="4" fill={iceColor}/>
          <ellipse cx={ox+23} cy={120} rx="12" ry="3.5" fill={iceColor}/>
          <ellipse cx={ox+23} cy={100} rx="10" ry="3" fill={iceColor}/>
          <ellipse cx={ox+23} cy={82} rx="7" ry="2.5" fill={iceColor}/>
        </g>
      ))}

      {/* Dense pine forest — right */}
      {[250, 278, 305].map((ox, j) => (
        <g key={j} opacity={0.20 - j*0.03}>
          <polygon points={`${ox+10} 200,${ox+36} 200,${ox+23} 150`} fill={treeColor} />
          <polygon points={`${ox+4} 172,${ox+42} 172,${ox+23} 125`} fill={treeColor} />
          <polygon points={`${ox+10} 148,${ox+36} 148,${ox+23} 108`} fill={treeColor} />
          <ellipse cx={ox+23} cy={150} rx="14" ry="4" fill={iceColor}/>
          <ellipse cx={ox+23} cy={125} rx="12" ry="3.5" fill={iceColor}/>
          <ellipse cx={ox+23} cy={108} rx="9" ry="3" fill={iceColor}/>
        </g>
      ))}

      {/* Icicles row — varied lengths */}
      {Array.from({length: 14}, (_, i) => {
        const x = 8 + i * 22;
        const h = 8 + (i % 4) * 7;
        return (
          <g key={i}>
            <path d={`M${x-4} 0 L${x} ${h} L${x+4} 0`} fill={iceColor}/>
            <ellipse cx={x} cy={0} rx="4" ry="2" fill={iceColor}/>
          </g>
        );
      })}

      {/* Snow ground — layered bumps */}
      <path d="M0 182 Q28 172 58 178 Q88 184 118 176 Q148 168 178 175 Q208 182 238 174 Q268 166 298 173 Q312 177 320 175 L320 200 L0 200 Z"
        fill={snowColor} />
      <path d="M0 192 Q50 188 100 191 Q150 194 200 189 Q250 184 320 190 L320 200 L0 200 Z"
        fill={tod === "night" ? "rgba(186,230,253,0.20)" : "rgba(219,234,254,0.65)"} />
      {/* Footprints in snow */}
      {[[80,188],[90,185],[100,188],[110,185]].map(([x,y],i) => (
        <ellipse key={i} cx={x} cy={y} rx="4" ry="2.5" fill={tod === "night" ? "rgba(147,197,253,0.15)" : "rgba(186,230,253,0.35)"}/>
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

function CincoDeMayoOverlay() {
  // Papel picado banner string + colorful triangle cut-outs
  const bannerColors = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899","#ffffff"];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Fiesta string 1 — main banner */}
      <path d="M0 6 Q40 2 80 8 Q120 14 160 6 Q200 -2 240 6 Q280 14 320 6" stroke="rgba(80,40,0,0.6)" strokeWidth="1.5" fill="none"/>
      {/* Papel picado flags */}
      {bannerColors.map((color, i) => {
        const x = 15 + i * 42;
        const ys = 6 + Math.sin((x/320)*Math.PI*2)*4;
        return (
          <g key={i} style={{ animation: `weatherCloudBob ${2+i*0.3}s ease-in-out ${i*0.2}s infinite` }}>
            <polygon points={`${x-10} ${ys+2},${x+10} ${ys+2},${x} ${ys+22}`} fill={color} opacity="0.88"/>
            {/* Cut-out diamond */}
            <polygon points={`${x-5} ${ys+10},${x} ${ys+6},${x+5} ${ys+10},${x} ${ys+14}`} fill="rgba(0,0,0,0.25)"/>
            {/* Glow */}
            <circle cx={x} cy={ys+12} r="8" fill={color} opacity="0.10" style={{ filter: `drop-shadow(0 0 6px ${color})` }}/>
          </g>
        );
      })}

      {/* Fiesta string 2 — lower */}
      <path d="M0 30 Q50 26 100 32 Q150 38 200 30 Q260 22 320 30" stroke="rgba(80,40,0,0.4)" strokeWidth="1" fill="none"/>
      {["#fbbf24","#ef4444","#22c55e","#60a5fa","#d946ef"].map((color, i) => {
        const x = 30 + i * 60;
        const ys = 30 + Math.sin((x/320)*Math.PI*2)*3;
        return (
          <g key={i} style={{ animation: `weatherCloudBob ${2.5+i*0.25}s ease-in-out ${i*0.35}s infinite` }}>
            <polygon points={`${x-8} ${ys+2},${x+8} ${ys+2},${x} ${ys+18}`} fill={color} opacity="0.82"/>
            <polygon points={`${x-4} ${ys+9},${x} ${ys+5},${x+4} ${ys+9},${x} ${ys+13}`} fill="rgba(0,0,0,0.2)"/>
          </g>
        );
      })}

      {/* Warm golden glow at bottom */}
      <ellipse cx="160" cy="210" rx="180" ry="45" fill="rgba(245,158,11,0.08)"/>
      {/* Mexico flag color bands at base */}
      <rect x="0" y="188" width="107" height="4" fill="rgba(34,197,94,0.25)" rx="2"/>
      <rect x="107" y="188" width="106" height="4" fill="rgba(255,255,255,0.20)" rx="2"/>
      <rect x="213" y="188" width="107" height="4" fill="rgba(220,38,38,0.25)" rx="2"/>
      {/* Starburst lantern decorations */}
      {[[50,50],[270,45],[160,35]].map(([cx,cy],i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${2+i*0.6}s ease-in-out ${i*0.4}s infinite` }}>
          {Array.from({length:8},(_,j) => {
            const a=(j/8)*Math.PI*2;
            return <line key={j} x1={cx} y1={cy} x2={cx+Math.cos(a)*12} y2={cy+Math.sin(a)*12}
              stroke={bannerColors[(i+j)%bannerColors.length]} strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>;
          })}
          <circle cx={cx} cy={cy} r="5" fill={bannerColors[i*2%bannerColors.length]} opacity="0.8"/>
        </g>
      ))}
    </svg>
  );
}

function ThanksgivingOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Harvest moon backdrop */}
      <circle cx="260" cy="38" r="50" fill="rgba(217,119,6,0.08)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
      <circle cx="260" cy="38" r="32" fill="rgba(245,158,11,0.15)"/>
      <circle cx="260" cy="38" r="22" fill="rgba(251,191,36,0.35)"/>

      {/* Cornucopia horn silhouette — right side */}
      <g opacity="0.28">
        <path d="M180 120 Q220 100 265 90 Q295 85 310 95 Q295 105 280 110 Q260 115 240 120 Q210 128 180 145 Z"
          fill="rgba(146,64,14,0.7)" />
        <path d="M180 120 Q170 130 175 140 Q178 143 180 145 Z" fill="rgba(120,53,15,0.8)"/>
        {/* Horn spiral */}
        <path d="M195 130 Q205 120 215 122 Q210 127 200 128 Q195 130 195 130" stroke="rgba(253,186,116,0.5)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      </g>

      {/* Autumn leaf crown — scattered leaves */}
      {[
        {x:15,y:22,r:0,color:"rgba(239,68,68,0.50)",size:14},
        {x:40,y:15,r:20,color:"rgba(249,115,22,0.55)",size:12},
        {x:70,y:18,r:-15,color:"rgba(202,138,4,0.50)",size:16},
        {x:100,y:12,r:10,color:"rgba(234,88,12,0.50)",size:13},
        {x:130,y:20,r:-10,color:"rgba(245,158,11,0.55)",size:11},
        {x:25,y:32,r:30,color:"rgba(220,38,38,0.45)",size:10},
        {x:55,y:28,r:-20,color:"rgba(251,191,36,0.45)",size:14},
        {x:85,y:30,r:15,color:"rgba(239,68,68,0.40)",size:12},
      ].map(({x,y,r,color,size},i) => (
        <g key={i} transform={`translate(${x},${y}) rotate(${r})`}
          style={{ animation: `weatherHarvestFloat ${3+i*0.4}s ease-in-out ${i*0.3}s infinite` }}>
          {/* Leaf shape */}
          <path d={`M0 0 Q${size*0.5} ${-size*0.7} ${size} 0 Q${size*0.5} ${size*0.7} 0 0`} fill={color}/>
          <line x1="0" y1="0" x2={size} y2="0" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
        </g>
      ))}

      {/* Ground fog + warm harvest glow */}
      {[0,1,2].map(i => (
        <ellipse key={i} cx={80+i*80} cy={195+i*4} rx={75+i*12} ry={18+i*3}
          fill={`rgba(217,119,6,0.0${5+i*2})`}
          style={{ animation: `weatherCloudBob ${5+i*1.5}s ease-in-out ${i}s infinite` }}/>
      ))}
      <ellipse cx="160" cy="210" rx="190" ry="40" fill="rgba(180,83,9,0.07)"/>
    </svg>
  );
}

function StPatricksOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Rainbow arc */}
      <g opacity="0.20">
        <path d="M-10 200 Q80 50 160 40 Q240 50 330 200" stroke="rgba(239,68,68,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 62 160 52 Q240 62 330 200" stroke="rgba(249,115,22,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 74 160 64 Q240 74 330 200" stroke="rgba(234,179,8,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 86 160 76 Q240 86 330 200" stroke="rgba(34,197,94,0.9)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 98 160 88 Q240 98 330 200" stroke="rgba(59,130,246,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 110 160 100 Q240 110 330 200" stroke="rgba(139,92,246,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
      </g>

      {/* Pot of gold — bottom right */}
      <g transform="translate(250,155)" opacity="0.40">
        <ellipse cx="0" cy="-5" rx="25" ry="8" fill="rgba(234,179,8,0.8)"/>
        <path d="M-22 0 Q-24 25 0 28 Q24 25 22 0 Z" fill="rgba(120,53,15,0.7)"/>
        <path d="M-20 2 Q-22 22 0 25 Q22 22 20 2 Z" fill="rgba(146,64,14,0.8)"/>
        {/* Gold coins peeking */}
        {[-10,0,10].map((x,i) => (
          <ellipse key={i} cx={x} cy={-3+i*2} rx="6" ry="4" fill="rgba(251,191,36,0.9)" style={{ animation: `weatherGlowPulse ${1.5+i*0.3}s ease-in-out ${i*0.2}s infinite` }}/>
        ))}
      </g>

      {/* Clover field at base */}
      {[15,40,65,90,115,140,165,190,215,240,265,290].map((x,i) => (
        <g key={i} transform={`translate(${x},${182+(i%3)*5})`} opacity={0.35+i%3*0.08}
          style={{ animation: `weatherCloudBob ${3+i*0.2}s ease-in-out ${i*0.15}s infinite` }}>
          {/* 3-leaf clover */}
          <circle cx="0" cy="-6" r="4.5" fill="rgba(34,197,94,0.8)"/>
          <circle cx="-5" cy="0" r="4.5" fill="rgba(22,163,74,0.8)"/>
          <circle cx="5" cy="0" r="4.5" fill="rgba(21,128,61,0.8)"/>
          {i%4===0 && <circle cx="0" cy="6" r="4.5" fill="rgba(34,197,94,0.75)"/>}
          <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(21,128,61,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
        </g>
      ))}

      {/* Emerald green glow */}
      <ellipse cx="160" cy="210" rx="200" ry="45" fill="rgba(34,197,94,0.07)"/>
      <circle cx="160" cy="100" r="120" fill="rgba(34,197,94,0.03)" style={{ animation: "weatherSunHalo 6s ease-in-out infinite" }}/>
    </svg>
  );
}

function DiaDeLosMuertosOverlay() {
  const flags = [
    { color: "#d946ef", label: "💀" },
    { color: "#ea580c", label: "🌼" },
    { color: "#8b5cf6", label: "💀" },
    { color: "#ec4899", label: "🌼" },
    { color: "#fbbf24", label: "💀" },
    { color: "#a855f7", label: "🌼" },
    { color: "#f97316", label: "💀" }
  ];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Papel Picado string */}
      <path d="M-10 10 Q40 2 80 12 Q120 22 160 12 Q200 2 240 12 Q280 22 330 10" stroke="rgba(255,255,255,0.25)" strokeWidth="1" fill="none"/>
      
      {/* Hanging papel picado flags */}
      {flags.map((f, i) => {
        const x = 20 + i * 40;
        const y = 10 + Math.sin((x / 320) * Math.PI * 2) * 5;
        return (
          <g key={i} transform={`translate(${x}, ${y})`} style={{ animation: `weatherCloudBob ${2.5 + i * 0.3}s ease-in-out ${i * 0.1}s infinite` }}>
            <path d="M-15 0 L15 0 L15 22 L5 22 L0 16 L-5 22 L-15 22 Z" fill={f.color} opacity="0.82" />
            {/* Traditional cut-out detail */}
            <circle cx="0" cy="8" r="4.5" fill="rgba(0,0,0,0.3)" />
            <text x="0" y="11" fontSize="8" textAnchor="middle" fill="rgba(255,255,255,0.85)" style={{ userSelect: "none" }}>{f.label}</text>
            {/* Tiny glow */}
            <circle cx="0" cy="8" r="10" fill={f.color} opacity="0.08" style={{ filter: `drop-shadow(0 0 4px ${f.color})` }} />
          </g>
        );
      })}

      {/* Ofrenda Altar Arch - Silhouette in gold/marigold */}
      <g opacity="0.25">
        {/* Arch */}
        <path d="M40 200 Q40 100 160 100 Q280 100 280 200" stroke="#f59e0b" strokeWidth="8" fill="none" strokeLinecap="round"/>
        {/* Flower circles along the arch */}
        {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const cx = 160 + Math.cos(rad) * 120;
          const cy = 200 - Math.sin(rad) * 100;
          return <circle key={i} cx={cx} cy={cy} r="4.5" fill="#f97316" />;
        })}
      </g>

      {/* Altar steps at base */}
      <path d="M20 200 L300 200 L280 188 L40 188 Z" fill="rgba(88,12,47,0.4)" opacity="0.7"/>
      <path d="M50 188 L270 188 L255 178 L65 178 Z" fill="rgba(58,0,63,0.5)" opacity="0.8"/>

      {/* Altar decorations: candles + cempasúchil flower heads */}
      {[[75, 184], [105, 174], [135, 174], [160, 172], [185, 174], [215, 174], [245, 184]].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx}, ${cy})`}>
          {/* Candle body */}
          <rect x="-2" y="2" width="4" height="12" fill="#fff" rx="1"/>
          {/* Flame with pulse animation */}
          <path d="M-1.5 2 Q0 -6 1.5 2 Z" fill="#f59e0b" style={{ animation: `weatherGlowPulse ${1 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}/>
          <circle cx="0" cy="-2" r="5" fill="#f97316" opacity="0.3" style={{ animation: `weatherGlowPulse ${1 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}/>
        </g>
      ))}

      {/* Marigold flowers piled at base */}
      {[25, 45, 60, 90, 120, 150, 170, 200, 230, 260, 280, 295].map((x, i) => (
        <g key={i} transform={`translate(${x}, ${192 + (i % 3) * 3})`} opacity="0.75" style={{ animation: `weatherCloudBob ${3.5 + i * 0.15}s ease-in-out ${i * 0.2}s infinite` }}>
          <circle cx="0" cy="0" r="5.5" fill="#f97316"/>
          <circle cx="0" cy="0" r="3.5" fill="#fbbf24"/>
          <circle cx="0" cy="0" r="1.5" fill="#ef4444"/>
        </g>
      ))}

      {/* Warm golden light projection */}
      <ellipse cx="160" cy="195" rx="150" ry="35" fill="rgba(245,158,11,0.06)" />
      <circle cx="160" cy="150" r="80" fill="rgba(236,72,153,0.02)" style={{ animation: "weatherSunHalo 8s ease-in-out infinite" }} />
    </svg>
  );
}

function MexicanIndependenceOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Independence Bell (Campana de Dolores) at top center */}
      <g transform="translate(160, 32)" opacity="0.75">
        {/* Support beam */}
        <rect x="-24" y="-12" width="48" height="4" fill="rgba(120,53,15,0.8)" rx="1"/>
        <rect x="-18" y="-8" width="36" height="2" fill="rgba(78,53,15,0.9)" />
        {/* Hanger */}
        <path d="M-4 -8 L-4 -2 L4 -2 L4 -8 Z" fill="rgba(156,163,175,0.9)" />
        {/* Bell curve */}
        <path d="M-12 12 Q-14 -2 0 -2 Q14 -2 12 12 Q16 16 16 19 L-16 19 Q-16 16 -12 12 Z" fill="rgba(217,119,6,0.9)" />
        <path d="M-10 12 Q-12 0 0 0 Q12 0 10 12 Q13 14 13 17 L-13 17 Q-13 14 -10 12 Z" fill="rgba(251,191,36,0.95)" />
        {/* Clapper (bell tongue) */}
        <circle cx="0" cy="22" r="3" fill="rgba(120,53,15,0.9)" style={{ animation: "weatherCloudBob 1.5s ease-in-out infinite", transformOrigin: "0px 10px" }}/>
        {/* Sound waves glowing */}
        <circle cx="0" cy="14" r="28" fill="rgba(251,191,36,0.05)" style={{ animation: "weatherSunHalo 3s ease-in-out infinite" }}/>
      </g>

      {/* Elegant tricolor flag-drape banners at top corners */}
      <g opacity="0.35">
        {/* Left corner banner */}
        <path d="M0 0 L60 0 C45 20 25 35 0 40 Z" fill="rgba(22,163,74,0.7)" />
        <path d="M0 0 L45 0 C32 15 18 25 0 30 Z" fill="rgba(255,255,255,0.6)" />
        <path d="M0 0 L30 0 C20 10 10 18 0 20 Z" fill="rgba(220,38,38,0.7)" />
        
        {/* Right corner banner */}
        <path d="M320 0 L260 0 C275 20 295 35 320 40 Z" fill="rgba(220,38,38,0.7)" />
        <path d="M320 0 L275 0 C288 15 302 25 320 30 Z" fill="rgba(255,255,255,0.6)" />
        <path d="M320 0 L290 0 C300 10 310 18 320 20 Z" fill="rgba(22,163,74,0.7)" />
      </g>

      {/* Angel of Independence Silhouette — Bottom center rising elegantly */}
      <g transform="translate(160, 200)" opacity="0.22">
        {/* Column pedestal */}
        <rect x="-8" y="-45" width="16" height="45" fill="rgba(255,255,255,0.6)" rx="1"/>
        <path d="-14 -45 L14 -45 L8 -55 L-8 -55 Z" fill="rgba(255,255,255,0.5)"/>
        <rect x="-16" y="-3" width="32" height="3" fill="rgba(255,255,255,0.7)" rx="1"/>
        
        {/* Winged Angel Statue Silhouette */}
        <g transform="translate(0, -66)">
          {/* Body */}
          <ellipse cx="0" cy="3" rx="3.5" ry="7" fill="rgba(251,191,36,0.8)"/>
          <circle cx="0" cy="-6" r="2.8" fill="rgba(251,191,36,0.8)"/>
          {/* Wings */}
          <path d="M0 0 Q-15 -18 -18 -8 Q-12 -2 0 4 Z" fill="rgba(251,191,36,0.7)"/>
          <path d="M0 0 Q15 -18 18 -8 Q12 -2 0 4 Z" fill="rgba(251,191,36,0.7)"/>
          {/* Raised arms with wreath */}
          <path d="M0 -3 Q-6 -10 -9 -8" stroke="rgba(251,191,36,0.8)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
          <path d="M0 -3 Q6 -10 9 -8" stroke="rgba(251,191,36,0.8)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
          <circle cx="-10" cy="-9" r="2" fill="none" stroke="rgba(34,197,94,0.8)" strokeWidth="1"/>
        </g>
      </g>

      {/* Tricolor flag base line highlight */}
      <rect x="0" y="194" width="107" height="6" fill="rgba(34,197,94,0.3)" rx="2"/>
      <rect x="107" y="194" width="106" height="6" fill="rgba(255,255,255,0.22)" rx="2"/>
      <rect x="213" y="194" width="107" height="6" fill="rgba(220,38,38,0.3)" rx="2"/>

      {/* Festive sparkles glow */}
      <circle cx="160" cy="35" r="50" fill="rgba(34,197,94,0.04)" style={{ animation: "weatherSunHalo 4s ease-in-out infinite" }}/>
      <circle cx="160" cy="130" r="90" fill="rgba(220,38,38,0.03)" style={{ animation: "weatherSunHalo 6s ease-in-out 1s infinite" }}/>
    </svg>
  );
}

function VirginGuadalupeOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Holy Ray Sunburst (Resplandor) in center background */}
      <g transform="translate(160, 95)" opacity="0.18">
        <circle cx="0" cy="0" r="50" fill="rgba(253,224,71,0.25)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const isLong = i % 2 === 0;
          const r1 = 15;
          const r2 = isLong ? 68 : 45;
          return (
            <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2}
              stroke="rgba(253,224,71,0.7)" strokeWidth={isLong ? 2.5 : 1.5} strokeLinecap="round"
              style={{ animation: `weatherRayPulse ${2.8 + (i % 3) * 0.4}s ease-in-out ${(i * 0.15).toFixed(2)}s infinite` }} />
          );
        })}
      </g>

      {/* Starry Constellation Backdrop (Mantle design stars) */}
      <g opacity="0.30">
        {[
          [80, 50], [95, 38], [115, 42], [105, 65],
          [240, 50], [225, 38], [205, 42], [215, 65],
          [60, 90], [75, 110], [100, 100], [90, 125],
          [260, 90], [245, 110], [220, 100], [230, 125],
          [130, 70], [190, 70], [125, 120], [195, 120]
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx}, ${cy})`} style={{ animation: `weatherGlowPulse ${2 + i * 0.25}s ease-in-out ${i * 0.1}s infinite` }}>
            {/* 8-pointed gold stars */}
            <path d="M-3 0 L3 0 M0 -3 L0 3 M-2 -2 L2 2 M-2 2 L2 -2" stroke="#fde047" strokeWidth="1" />
            <circle cx="0" cy="0" r="1" fill="#fff" />
          </g>
        ))}
      </g>

      {/* Castile roses blooming at base */}
      {[
        { x: 35, y: 188, size: 8, color: "#ef4444" },
        { x: 65, y: 184, size: 9, color: "#ec4899" },
        { x: 95, y: 188, size: 7.5, color: "#ef4444" },
        { x: 130, y: 182, size: 10, color: "#f43f5e" },
        { x: 160, y: 185, size: 11, color: "#ef4444" },
        { x: 190, y: 182, size: 10, color: "#f43f5e" },
        { x: 225, y: 188, size: 7.5, color: "#ef4444" },
        { x: 255, y: 184, size: 9, color: "#ec4899" },
        { x: 285, y: 188, size: 8, color: "#ef4444" },
        // Front layer
        { x: 50, y: 192, size: 7, color: "#ec4899" },
        { x: 110, y: 191, size: 8.5, color: "#f43f5e" },
        { x: 145, y: 190, size: 9.5, color: "#ef4444" },
        { x: 175, y: 190, size: 9.5, color: "#ef4444" },
        { x: 210, y: 191, size: 8.5, color: "#f43f5e" },
        { x: 270, y: 192, size: 7, color: "#ec4899" }
      ].map((rose, i) => (
        <g key={i} transform={`translate(${rose.x}, ${rose.y})`} opacity="0.8" style={{ animation: `weatherCloudBob ${3 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}>
          {/* Castile Rose Vector */}
          <circle cx="0" cy="0" r={rose.size} fill={rose.color}/>
          <circle cx="-3" cy="-1" r={rose.size * 0.7} fill="#f43f5e" opacity="0.9"/>
          <circle cx="3" cy="-1" r={rose.size * 0.7} fill="#ec4899" opacity="0.9"/>
          <circle cx="0" cy="3" r={rose.size * 0.7} fill="#ef4444" opacity="0.9"/>
          <circle cx="0" cy="0" r={rose.size * 0.35} fill="#fb7185"/>
          {/* Leaves */}
          <path d={`M${-rose.size} 2 Q${-rose.size - 4} 6 ${-rose.size} 8 Q${-rose.size + 4} 6 ${-rose.size} 2`} fill="rgba(13,148,136,0.6)" />
          <path d={`M${rose.size} 2 Q${rose.size + 4} 6 ${rose.size} 8 Q${rose.size - 4} 6 ${rose.size} 2`} fill="rgba(13,148,136,0.6)" />
        </g>
      ))}

      {/* Subtle crescent moon silhouette at bottom center */}
      <g transform="translate(160, 168)" opacity="0.22">
        <circle cx="0" cy="0" r="14" fill="rgba(255,255,255,0.06)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }} />
        <path d="M-10 -4 A10 10 0 1 0 10 4 A12 12 0 0 1 -10 -4 Z" fill="rgba(156,163,175,0.95)" />
      </g>

      {/* Heavenly turquoise and gold base glow */}
      <ellipse cx="160" cy="205" rx="160" ry="32" fill="rgba(45,212,191,0.08)"/>
      <ellipse cx="160" cy="210" rx="100" ry="20" fill="rgba(253,224,71,0.05)"/>
    </svg>
  );
}

// ─── Particle System ─────────────────────────────────────────────────────────

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

function StatPill({ icon, label, value, delay, accentColor }: { icon: string; label: string; value: string; delay: string; accentColor: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-2xl"
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


  useEffect(() => {
    // Avoid setState-in-effect lint rule by deriving mounted state from first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    requestAnimationFrame(() => setMounted(true));
  }, []);


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

  const accentHex: WeatherAccent = {
    // WeatherWidget uses its own seasonal/holiday visual colors; map them into the same shape
    // as the app theme accent hexes for live wiring.
    selected: theme.accentColor,
    glow: theme.glowColor,
    button: theme.accentColor,
    border: `${theme.accentColor}55`,
  };

  // Particle type: holiday wins if active
  const particleType = (holidayTheme?.particleType ?? theme.particleType) as ParticleKind;

  const Icon = ICONS[condition];
  const displayTemp = weather.unit === "C" ? toC(weatherData?.currentTemp ?? 72) : (weatherData?.currentTemp ?? 72);
  const displayFeels = weather.unit === "C" ? toC(weatherData?.feelsLike ?? 74) : (weatherData?.feelsLike ?? 74);

  // Holiday label badge
  const holidayLabels: Record<HolidayOverride, string> = {
    auto: "", none: "",
    christmas: "🎄 Christmas", halloween: "🎃 Halloween",
    july4th: "🎆 4th of July", valentines: "💝 Valentine's",
    newyears: "🥂 New Year's", cincodemayo: "🪅 Cinco de Mayo",
    thanksgiving: "🦃 Thanksgiving", stpatricks: "🍀 St. Patrick's",
    diadelosmuertos: "💀 Día de los Muertos",
    mexicanindependence: "🔔 Independence Day",
    virginguadalupe: "🌹 Virgin of Guadalupe",
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
                {activeHoliday === "cincodemayo" && <CincoDeMayoOverlay />}
                {activeHoliday === "thanksgiving" && <ThanksgivingOverlay />}
                {activeHoliday === "stpatricks" && <StPatricksOverlay />}
                {activeHoliday === "diadelosmuertos" && <DiaDeLosMuertosOverlay />}
                {activeHoliday === "mexicanindependence" && <MexicanIndependenceOverlay />}
                {activeHoliday === "virginguadalupe" && <VirginGuadalupeOverlay />}
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
                className="w-3.5 h-3.5 shrink-0" style={{ color: accentHex.selected }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate text-white/80">{weather.location}</span>
              {activeHoliday !== "none" && holidayLabels[activeHoliday] && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ml-1 flex-shrink-0"
                  style={{ background: `${accentHex.selected}33`, color: accentHex.selected, border: `1px solid ${accentHex.selected}55` }}>
                  {holidayLabels[activeHoliday]}
                </span>
              )}
            </div>
            <span
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ml-2"
              style={{
                background: `${accentHex.selected}25`,
                color: accentHex.selected,
                border: `1px solid ${accentHex.selected}40`,
                transition: "background 0.4s ease",
              }}
            >
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
                  style={{ color: "white", textShadow: `0 0 30px ${accentHex.selected}88, 0 2px 8px rgba(0,0,0,0.3)` }}>
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
                    <div key={day.day} className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl cursor-default"
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