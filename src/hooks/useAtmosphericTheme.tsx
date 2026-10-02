"use client";

/**
 * AtmosphericContext — shared seasonal atmosphere for the home screen.
 * Provides theme + particle coordinates so Weather, Consuela, and Meal
 * widgets all render as if submerged in the same seasonal environment.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";
import { type HolidayOverride } from "@/lib/weather-config";
import { detectAutoHoliday, HOLIDAY_PALETTE } from "@/lib/holiday";

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

// Accents are single-sourced from HOLIDAY_PALETTE (pinned by
// atmospheric-holiday.test.tsx); all 11 were already byte-equal, so deriving
// them is a zero-visual-change dedupe. glowColor/bgGradient/bridgeGradient/
// bridgeGlow stay surface-specific — they are tuned against each holiday's
// dark wash and are intentionally not palette-equal.
export const HOLIDAY_ATMOSPHERE: Partial<Record<HolidayOverride, Omit<AtmosphericTheme, "season" | "holiday" | "isNight">>> = {
  christmas: {
    accentColor: HOLIDAY_PALETTE.christmas.accent,
    glowColor: "rgba(255,80,60,0.25)",
    bgGradient: "linear-gradient(180deg, #0a2010 0%, #15350f 30%, #0a1a00 60%, #111827 100%)",
    particleEmoji: "🎄",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(239,68,68,0.22) 0%, rgba(21,53,15,0.20) 50%, rgba(10,26,0,0.14) 100%)",
    bridgeGlow: "rgba(239,68,68,0.07)",
  },
  halloween: {
    accentColor: HOLIDAY_PALETTE.halloween.accent,
    glowColor: "rgba(249,115,22,0.28)",
    bgGradient: "linear-gradient(180deg, #0d0010 0%, #1a0530 30%, #2d0a00 60%, #111827 100%)",
    particleEmoji: "🦇",
    atmosphereOpacity: 0.14,
    bridgeGradient: "linear-gradient(180deg, rgba(249,115,22,0.22) 0%, rgba(26,5,48,0.24) 50%, rgba(45,10,0,0.16) 100%)",
    bridgeGlow: "rgba(249,115,22,0.08)",
  },
  july4th: {
    accentColor: HOLIDAY_PALETTE.july4th.accent,
    glowColor: "rgba(239,68,68,0.25)",
    bgGradient: "linear-gradient(180deg, #030712 0%, #0c1445 30%, #1e0036 60%, #111827 100%)",
    particleEmoji: "🎆",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(239,68,68,0.20) 0%, rgba(12,20,69,0.22) 50%, rgba(30,0,54,0.14) 100%)",
    bridgeGlow: "rgba(59,130,246,0.06)",
  },
  valentines: {
    accentColor: HOLIDAY_PALETTE.valentines.accent,
    glowColor: "rgba(244,63,94,0.28)",
    bgGradient: "linear-gradient(180deg, #2d0a1a 0%, #4c0519 30%, #1a0010 60%, #111827 100%)",
    particleEmoji: "💕",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(244,63,94,0.22) 0%, rgba(76,5,25,0.20) 50%, rgba(26,0,16,0.14) 100%)",
    bridgeGlow: "rgba(244,63,94,0.07)",
  },
  newyears: {
    accentColor: HOLIDAY_PALETTE.newyears.accent,
    glowColor: "rgba(234,179,8,0.28)",
    bgGradient: "linear-gradient(180deg, #030712 0%, #1e1b4b 30%, #0f172a 60%, #111827 100%)",
    particleEmoji: "🥂",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(234,179,8,0.20) 0%, rgba(30,27,75,0.22) 50%, rgba(15,23,42,0.12) 100%)",
    bridgeGlow: "rgba(234,179,8,0.06)",
  },
  stpatricks: {
    accentColor: HOLIDAY_PALETTE.stpatricks.accent,
    glowColor: "rgba(34,197,94,0.28)",
    bgGradient: "linear-gradient(180deg, #04140a 0%, #0a2f14 30%, #061a0d 60%, #111827 100%)",
    particleEmoji: "🍀",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(34,197,94,0.22) 0%, rgba(10,47,20,0.20) 50%, rgba(6,26,13,0.14) 100%)",
    bridgeGlow: "rgba(34,197,94,0.07)",
  },
  cincodemayo: {
    accentColor: HOLIDAY_PALETTE.cincodemayo.accent,
    glowColor: "rgba(245,158,11,0.28)",
    bgGradient: "linear-gradient(180deg, #1c0a00 0%, #3f1c05 30%, #241000 60%, #111827 100%)",
    particleEmoji: "🪅",
    atmosphereOpacity: 0.11,
    bridgeGradient: "linear-gradient(180deg, rgba(245,158,11,0.20) 0%, rgba(63,28,5,0.20) 50%, rgba(36,16,0,0.14) 100%)",
    bridgeGlow: "rgba(245,158,11,0.07)",
  },
  thanksgiving: {
    accentColor: HOLIDAY_PALETTE.thanksgiving.accent,
    glowColor: "rgba(217,119,6,0.28)",
    bgGradient: "linear-gradient(180deg, #1a0e00 0%, #38200a 30%, #241305 60%, #111827 100%)",
    particleEmoji: "🦃",
    atmosphereOpacity: 0.13,
    bridgeGradient: "linear-gradient(180deg, rgba(217,119,6,0.22) 0%, rgba(56,32,10,0.20) 50%, rgba(36,19,5,0.14) 100%)",
    bridgeGlow: "rgba(217,119,6,0.07)",
  },
  diadelosmuertos: {
    accentColor: HOLIDAY_PALETTE.diadelosmuertos.accent,
    glowColor: "rgba(236,72,153,0.28)",
    bgGradient: "linear-gradient(180deg, #2d0a24 0%, #4a0f3d 30%, #1a0530 60%, #111827 100%)",
    particleEmoji: "💀",
    atmosphereOpacity: 0.12,
    bridgeGradient: "linear-gradient(180deg, rgba(236,72,153,0.22) 0%, rgba(74,15,61,0.20) 50%, rgba(26,5,48,0.14) 100%)",
    bridgeGlow: "rgba(236,72,153,0.07)",
  },
  mexicanindependence: {
    accentColor: HOLIDAY_PALETTE.mexicanindependence.accent,
    glowColor: "rgba(34,197,94,0.25)",
    bgGradient: "linear-gradient(180deg, #051405 0%, #14350a 30%, #3d0a0a 60%, #111827 100%)",
    particleEmoji: "🔔",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(34,197,94,0.20) 0%, rgba(20,53,10,0.22) 50%, rgba(61,10,10,0.14) 100%)",
    bridgeGlow: "rgba(34,197,94,0.06)",
  },
  virginguadalupe: {
    accentColor: HOLIDAY_PALETTE.virginguadalupe.accent,
    glowColor: "rgba(13,148,136,0.25)",
    bgGradient: "linear-gradient(180deg, #03110f 0%, #06302b 30%, #041a18 60%, #111827 100%)",
    particleEmoji: "🌹",
    atmosphereOpacity: 0.10,
    bridgeGradient: "linear-gradient(180deg, rgba(13,148,136,0.20) 0%, rgba(6,48,43,0.20) 50%, rgba(4,26,24,0.14) 100%)",
    bridgeGlow: "rgba(13,148,136,0.06)",
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
