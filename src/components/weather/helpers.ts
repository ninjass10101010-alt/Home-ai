/**
 * Weather helpers — Types, utilities, and theme detection functions.
 * Extracted from WeatherWidget.tsx for modularity.
 */

import type { HolidayOverride } from "@/lib/weather-config";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Condition = "sunny" | "partly-cloudy" | "cloudy" | "rainy" | "snowy";
export type TimeOfDayFlag = "day" | "night";
export type SeasonKey = "spring" | "summer" | "autumn" | "winter";

export interface ForecastDay {
  day: string;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  precipitation: number;
  humidity: number;
  wind: number;
}

export interface Particle {
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

export interface VisualTheme {
  bgGradient: string;
  glowColor: string;
  accentColor: string;
  particleType: string;
  overlayType: string;
}

export interface WeatherAccent {
  selected: string;
  glow: string;
  button: string;
  border: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function detectCondition(text: string): Condition {
  const t = text.toLowerCase();
  if (t.includes("sun") || t.includes("clear")) return "sunny";
  if (t.includes("partly") || t.includes("partial")) return "partly-cloudy";
  if (t.includes("cloud")) return "cloudy";
  if (t.includes("rain") || t.includes("shower") || t.includes("drizzle")) return "rainy";
  if (t.includes("snow") || t.includes("blizzard")) return "snowy";
  return "partly-cloudy";
}

export function toC(f: number) { return Math.round((f - 32) * 5 / 9); }

export function getRealTimeOfDay(): TimeOfDayFlag {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 19 ? "day" : "night";
}

export function getRealSeason(): SeasonKey {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

export function detectAutoHoliday(): HolidayOverride {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();

  if (month === 11 && day >= 15) return "christmas";
  if (month === 0 && day <= 7) return "newyears";
  if (month === 1 && day >= 10 && day <= 16) return "valentines";
  if (month === 2 && day >= 14 && day <= 17) return "stpatricks";
  if (month === 4 && day >= 3 && day <= 6) return "cincodemayo";
  if (month === 8 && day >= 15 && day <= 16) return "mexicanindependence";
  if (month === 9 && day >= 25 && day <= 30) return "halloween";
  if ((month === 9 && day === 31) || (month === 10 && day >= 1 && day <= 2)) return "diadelosmuertos";
  if (month === 6 && day >= 1 && day <= 7) return "july4th";
  if (month === 10 && day >= 22 && day <= 28) return "thanksgiving";
  if (month === 11 && day >= 11 && day <= 13) return "virginguadalupe";

  return "none";
}

// ─── Season & Holiday Visual Systems ────────────────────────────────────────

export function getSeasonTheme(season: SeasonKey, tod: TimeOfDayFlag, condition: Condition): VisualTheme {
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

export function getHolidayTheme(holiday: HolidayOverride): Partial<VisualTheme> | null {
  switch (holiday) {
    case "christmas":
      return { bgGradient: "linear-gradient(160deg, #0a2010 0%, #15350f 40%, #0a1a00 100%)", glowColor: "rgba(255,80,60,0.25)", accentColor: "#ef4444", overlayType: "christmas", particleType: "christmas-snow" };
    case "halloween":
      return { bgGradient: "linear-gradient(160deg, #0d0010 0%, #1a0530 40%, #2d0a00 100%)", glowColor: "rgba(249,115,22,0.30)", accentColor: "#f97316", overlayType: "halloween", particleType: "bat" };
    case "july4th":
      return { bgGradient: "linear-gradient(160deg, #030712 0%, #0c1445 50%, #1e0036 100%)", glowColor: "rgba(239,68,68,0.25)", accentColor: "#ef4444", overlayType: "fireworks", particleType: "spark" };
    case "valentines":
      return { bgGradient: "linear-gradient(160deg, #2d0a1a 0%, #4c0519 40%, #1a0010 100%)", glowColor: "rgba(244,63,94,0.30)", accentColor: "#f43f5e", overlayType: "valentines", particleType: "heart" };
    case "newyears":
      return { bgGradient: "linear-gradient(160deg, #030712 0%, #1e1b4b 50%, #0f172a 100%)", glowColor: "rgba(234,179,8,0.30)", accentColor: "#eab308", overlayType: "newyears", particleType: "spark" };
    case "cincodemayo":
      return { bgGradient: "linear-gradient(160deg, #0a1a00 0%, #1a0a00 25%, #1a0000 50%, #00001a 75%, #001a0a 100%)", glowColor: "rgba(220,38,38,0.30)", accentColor: "#f59e0b", overlayType: "cincodemayo", particleType: "confetti" };
    case "thanksgiving":
      return { bgGradient: "linear-gradient(160deg, #1c0a00 0%, #2d1600 35%, #1a0f00 65%, #0d0a00 100%)", glowColor: "rgba(217,119,6,0.30)", accentColor: "#d97706", overlayType: "thanksgiving", particleType: "harvest" };
    case "stpatricks":
      return { bgGradient: "linear-gradient(160deg, #001a00 0%, #002d00 35%, #001500 65%, #000d00 100%)", glowColor: "rgba(34,197,94,0.30)", accentColor: "#22c55e", overlayType: "stpatricks", particleType: "shamrock" };
    case "diadelosmuertos":
      return { bgGradient: "linear-gradient(160deg, #1b0222 0%, #3a003f 40%, #580c2f 70%, #d97706 100%)", glowColor: "rgba(245,158,11,0.25)", accentColor: "#ec4899", overlayType: "diadelosmuertos", particleType: "marigold" };
    case "mexicanindependence":
      return { bgGradient: "linear-gradient(160deg, #021a0c 0%, #0c351c 30%, #1c2d3a 65%, #3c0c14 100%)", glowColor: "rgba(34,197,94,0.25)", accentColor: "#22c55e", overlayType: "mexicanindependence", particleType: "tricolor-sparks" };
    case "virginguadalupe":
      return { bgGradient: "linear-gradient(160deg, #061f2d 0%, #0d3846 45%, #2c1628 75%, #4c1130 100%)", glowColor: "rgba(45,212,191,0.20)", accentColor: "#0d9488", overlayType: "virginguadalupe", particleType: "holy-roses" };
    default:
      return null;
  }
}
