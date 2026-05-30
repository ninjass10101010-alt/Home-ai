"use client";

/**
 * AtmosphericContext — shared seasonal atmosphere for the home screen.
 * Provides theme + particle coordinates so Weather, Consuela, and Meal
 * widgets all render as if submerged in the same seasonal environment.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";
import { type HolidayOverride } from "@/lib/weather-config";

// ─── Types ─────────────────────────────────────────────────────────────────

export type SeasonKey = "spring" | "summer" | "autumn" | "winter";

export interface AtmosphericTheme {
  season: SeasonKey;
  holiday: HolidayOverride;
  isNight: boolean;

  // Colors
  accentColor: string;
  glowColor: string;
  bgGradient: string;

  // Atmosphere
  particleEmoji: string;
  atmosphereOpacity: number;

  // Connecting bridge gradient (flows from widget to widget)
  bridgeGradient: string;
  bridgeGlow: string;
}

interface AtmosphericContextValue {
  theme: AtmosphericTheme;
  /** SVG filter ID for shared gooey/blur effects */
  filterId: string;
}

// ─── Season / Holiday theme tables ─────────────────────────────────────────

const SEASON_ATMOSPHERE: Record<SeasonKey, { day: Omit<AtmosphericTheme, "season" | "holiday" | "isNight">; night: Omit<AtmosphericTheme, "season" | "holiday" | "isNight"> }> = {
  spring: {
    day: {
      accentColor: "#ec4899",
      glowColor: "rgba(255,182,218,0.30)",
      bgGradient: "linear-gradient(180deg, #ffd6e8 0%, #ffe8f5 20%, #e8f5e9 50%, #f0fff4 80%, #fff 100%)",
      particleEmoji: "🌸",
      atmosphereOpacity: 0.12,
      bridgeGradient: "linear-gradient(180deg, rgba(255,182,218,0.25) 0%, rgba(232,245,233,0.20) 50%, rgba(255,241,248,0.15) 100%)",
      bridgeGlow: "rgba(255,182,218,0.08)",
    },
    night: {
      accentColor: "#f9a8d4",
      glowColor: "rgba(255,182,218,0.18)",
      bgGradient: "linear-gradient(180deg, #1a0d2e 0%, #0d1f2d 20%, #0a2d1a 50%, #0d1f2d 80%, #111827 100%)",
      particleEmoji: "🌸",
      atmosphereOpacity: 0.08,
      bridgeGradient: "linear-gradient(180deg, rgba(249,168,212,0.20) 0%, rgba(13,31,45,0.25) 50%, rgba(16,33,20,0.15) 100%)",
      bridgeGlow: "rgba(249,168,212,0.06)",
    },
  },
  summer: {
    day: {
      accentColor: "#d97706",
      glowColor: "rgba(251,191,36,0.30)",
      bgGradient: "linear-gradient(180deg, #fed7aa 0%, #fef08a 20%, #bbf7d0 50%, #7dd3fc 80%, #fff 100%)",
      particleEmoji: "☀️",
      atmosphereOpacity: 0.10,
      bridgeGradient: "linear-gradient(180deg, rgba(251,191,36,0.22) 0%, rgba(187,247,208,0.18) 50%, rgba(125,211,252,0.14) 100%)",
      bridgeGlow: "rgba(251,191,36,0.07)",
    },
    night: {
      accentColor: "#fbbf24",
      glowColor: "rgba(251,191,36,0.15)",
      bgGradient: "linear-gradient(180deg, #0f172a 0%, #1e1b4b 20%, #0c4a6e 50%, #0f172a 80%, #111827 100%)",
      particleEmoji: "✨",
      atmosphereOpacity: 0.06,
      bridgeGradient: "linear-gradient(180deg, rgba(251,191,36,0.15) 0%, rgba(30,27,75,0.20) 50%, rgba(12,74,110,0.12) 100%)",
      bridgeGlow: "rgba(251,191,36,0.05)",
    },
  },
  autumn: {
    day: {
      accentColor: "#c2410c",
      glowColor: "rgba(249,115,22,0.28)",
      bgGradient: "linear-gradient(180deg, #fde68a 0%, #fca5a5 20%, #f97316 50%, #92400e 80%, #fff 100%)",
      particleEmoji: "🍂",
      atmosphereOpacity: 0.14,
      bridgeGradient: "linear-gradient(180deg, rgba(249,115,22,0.25) 0%, rgba(253,165,165,0.18) 50%, rgba(146,64,14,0.12) 100%)",
      bridgeGlow: "rgba(249,115,22,0.08)",
    },
    night: {
      accentColor: "#fb923c",
      glowColor: "rgba(249,115,22,0.18)",
      bgGradient: "linear-gradient(180deg, #1c0a00 0%, #2d1200 20%, #1a150a 50%, #1c1917 80%, #111827 100%)",
      particleEmoji: "🍁",
      atmosphereOpacity: 0.09,
      bridgeGradient: "linear-gradient(180deg, rgba(251,146,60,0.18) 0%, rgba(45,18,0,0.22) 50%, rgba(26,21,10,0.14) 100%)",
      bridgeGlow: "rgba(251,146,60,0.06)",
    },
  },
  winter: {
    day: {
      accentColor: "#2563eb",
      glowColor: "rgba(186,230,253,0.35)",
      bgGradient: "linear-gradient(180deg, #dbeafe 0%, #e0f2fe 20%, #f0f9ff 50%, #f8faff 80%, #fff 100%)",
      particleEmoji: "❄️",
      atmosphereOpacity: 0.15,
      bridgeGradient: "linear-gradient(180deg, rgba(186,230,253,0.30) 0%, rgba(224,242,254,0.22) 50%, rgba(240,249,255,0.16) 100%)",
      bridgeGlow: "rgba(147,197,253,0.08)",
    },
    night: {
      accentColor: "#93c5fd",
      glowColor: "rgba(147,197,253,0.20)",
      bgGradient: "linear-gradient(180deg, #020617 0%, #0c1445 20%, #0f2744 50%, #1e293b 80%, #111827 100%)",
      particleEmoji: "❄️",
      atmosphereOpacity: 0.10,
      bridgeGradient: "linear-gradient(180deg, rgba(147,197,253,0.20) 0%, rgba(12,20,69,0.25) 50%, rgba(15,39,68,0.14) 100%)",
      bridgeGlow: "rgba(147,197,253,0.06)",
    },
  },
};

const HOLIDAY_ATMOSPHERE: Partial<Record<HolidayOverride, Omit<AtmosphericTheme, "season" | "holiday" | "isNight">>> = {
  christmas: {
    accentColor: "#ef4444",
    glowColor: "rgba(255,80,60,0.25)",
    bgGradient: "linear-gradient(180deg, #0a2010 0%, #15350f 30%, #0a1a00 60%, #111827 100%)",
    particleEmoji: "🎄",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(239,68,68,0.22) 0%, rgba(21,53,15,0.20) 50%, rgba(10,26,0,0.14) 100%)",
    bridgeGlow: "rgba(239,68,68,0.07)",
  },
  halloween: {
    accentColor: "#f97316",
    glowColor: "rgba(249,115,22,0.28)",
    bgGradient: "linear-gradient(180deg, #0d0010 0%, #1a0530 30%, #2d0a00 60%, #111827 100%)",
    particleEmoji: "🦇",
    atmosphereOpacity: 0.14,
    bridgeGradient: "linear-gradient(180deg, rgba(249,115,22,0.22) 0%, rgba(26,5,48,0.24) 50%, rgba(45,10,0,0.16) 100%)",
    bridgeGlow: "rgba(249,115,22,0.08)",
  },
  july4th: {
    accentColor: "#ef4444",
    glowColor: "rgba(239,68,68,0.25)",
    bgGradient: "linear-gradient(180deg, #030712 0%, #0c1445 30%, #1e0036 60%, #111827 100%)",
    particleEmoji: "🎆",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(239,68,68,0.20) 0%, rgba(12,20,69,0.22) 50%, rgba(30,0,54,0.14) 100%)",
    bridgeGlow: "rgba(59,130,246,0.06)",
  },
  valentines: {
    accentColor: "#f43f5e",
    glowColor: "rgba(244,63,94,0.28)",
    bgGradient: "linear-gradient(180deg, #2d0a1a 0%, #4c0519 30%, #1a0010 60%, #111827 100%)",
    particleEmoji: "💕",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(244,63,94,0.22) 0%, rgba(76,5,25,0.20) 50%, rgba(26,0,16,0.14) 100%)",
    bridgeGlow: "rgba(244,63,94,0.07)",
  },
  newyears: {
    accentColor: "#eab308",
    glowColor: "rgba(234,179,8,0.28)",
    bgGradient: "linear-gradient(180deg, #030712 0%, #1e1b4b 30%, #0f172a 60%, #111827 100%)",
    particleEmoji: "🥂",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(234,179,8,0.20) 0%, rgba(30,27,75,0.22) 50%, rgba(15,23,42,0.12) 100%)",
    bridgeGlow: "rgba(234,179,8,0.06)",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRealSeason(): SeasonKey {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
}

function getRealTod(): boolean {
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

function detectAutoHoliday(): HolidayOverride {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 11 && day >= 15) return "christmas";
  if (month === 0 && day <= 7) return "newyears";
  if (month === 1 && day >= 10 && day <= 16) return "valentines";
  if (month === 6 && day >= 1 && day <= 7) return "july4th";
  if (month === 9 && day >= 25) return "halloween";
  return "none";
}

// ─── Context ────────────────────────────────────────────────────────────────

const AtmosphericContext = createContext<AtmosphericContextValue | null>(null);

/**
 * Parses an accent color hex string to RGB for use in rgba() backgrounds.
 * Returns a default teal RGB if parsing fails.
 */
function parseAccentRgb(hex: string): string {
  const m = hex.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (m) return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
  return "59,130,246"; // default teal
}

export function useAtmosphericTheme(): AtmosphericTheme & {
  colors: { glow: string; gradientStop: string; accentColor: string };
  accentRgb: string;
} {
  const ctx = useContext(AtmosphericContext);
  if (!ctx) throw new Error("useAtmosphericTheme must be used within AtmosphericProvider");
  
  const theme = ctx.theme;
  const colors = {
    glow: theme.glowColor,
    gradientStop: theme.bgGradient,
    accentColor: theme.accentColor,
  };
  
  return {
    ...theme,
    colors,
    accentRgb: parseAccentRgb(theme.accentColor),
  };
}

export function useAtmosphericContext(): AtmosphericContextValue {
  const ctx = useContext(AtmosphericContext);
  if (!ctx) throw new Error("useAtmosphericContext must be used within AtmosphericProvider");
  return ctx;
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function AtmosphericProvider({ children }: { children: ReactNode }) {
  const { weather } = useWeatherConfig();

  const theme = useMemo<AtmosphericTheme>(() => {
    const season = (weather.season === "auto" ? getRealSeason() : weather.season) as SeasonKey;
    const isNight = weather.timeOfDay === "night" ? true : weather.timeOfDay === "day" ? false : getRealTod();
    const rawHol = weather.holidayOverride ?? "auto";
    const holiday: HolidayOverride = rawHol === "auto" ? detectAutoHoliday() : rawHol;

    const seasonData = SEASON_ATMOSPHERE[season];
    const base = isNight ? seasonData.night : seasonData.day;

    // Holiday overrides take precedence
    if (holiday !== "none" && HOLIDAY_ATMOSPHERE[holiday]) {
      return {
        season,
        holiday,
        isNight,
        ...HOLIDAY_ATMOSPHERE[holiday]!,
      };
    }

    return {
      season,
      holiday,
      isNight,
      ...base,
    };
  }, [weather]);

  return (
    <AtmosphericContext.Provider value={{ theme, filterId: "atmospheric-goo" }}>
      {children}
    </AtmosphericContext.Provider>
  );
}
