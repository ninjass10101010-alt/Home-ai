"use client";

/**
 * AtmosphericContext — shared seasonal atmosphere for the home screen.
 * Provides theme + particle coordinates so Weather, Consuela, and Meal
 * widgets all render as if submerged in the same seasonal environment.
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";
import { type HolidayOverride, type TimeOfDay } from "@/lib/weather-config";
import { detectAutoHoliday, HOLIDAY_PALETTE } from "@/lib/holiday";

// ─── Types ─────────────────────────────────────────────────────────────────

export type SeasonKey = "spring" | "summer" | "autumn" | "winter";

/**
 * Which theme's canvas the atmosphere is painting, read from
 * `<html data-theme>`. The atmosphere is an ATMOSPHERE over the app's own
 * palette, so the palette family it wears is the theme's — never the clock's.
 */
export type AtmosphereLeg = "light" | "dark";

export interface AtmosphericTheme {
  season: SeasonKey;
  holiday: HolidayOverride;
  /** The CLOCK. Kept semantic: it modulates the veil, it never picks a palette. */
  isNight: boolean;
  /** The resolved THEME's palette family. */
  leg: AtmosphereLeg;

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

type SeasonRow = Omit<AtmosphericTheme, "season" | "holiday" | "isNight" | "leg">;

// Each season carries ONE palette per theme, not one per clock. The `light`
// rows hold dark inks for a white canvas and the `dark` rows hold light inks
// for a near-black one — which is why the rows were originally split by
// `day`/`night` and why keying them off the clock inverted the whole layer.
export const SEASON_ATMOSPHERE: Record<SeasonKey, { light: SeasonRow; dark: SeasonRow }> = {
  spring: {
    light: {
      accentColor: "#ec4899",
      glowColor: "rgba(255,182,218,0.30)",
      bgGradient: "linear-gradient(180deg, #ffd6e8 0%, #ffe8f5 20%, #e8f5e9 50%, #f0fff4 80%, #fff 100%)",
      particleEmoji: "🌸",
      atmosphereOpacity: 0.12,
      bridgeGradient: "linear-gradient(180deg, rgba(255,182,218,0.25) 0%, rgba(232,245,233,0.20) 50%, rgba(255,241,248,0.15) 100%)",
      bridgeGlow: "rgba(255,182,218,0.08)",
    },
    dark: {
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
    light: {
      accentColor: "#d97706",
      glowColor: "rgba(251,191,36,0.30)",
      bgGradient: "linear-gradient(180deg, #fed7aa 0%, #fef08a 20%, #bbf7d0 50%, #7dd3fc 80%, #fff 100%)",
      particleEmoji: "☀️",
      atmosphereOpacity: 0.10,
      bridgeGradient: "linear-gradient(180deg, rgba(251,191,36,0.22) 0%, rgba(187,247,208,0.18) 50%, rgba(125,211,252,0.14) 100%)",
      bridgeGlow: "rgba(251,191,36,0.07)",
    },
    dark: {
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
    light: {
      accentColor: "#c2410c",
      glowColor: "rgba(249,115,22,0.28)",
      bgGradient: "linear-gradient(180deg, #fde68a 0%, #fca5a5 20%, #f97316 50%, #92400e 80%, #fff 100%)",
      particleEmoji: "🍂",
      atmosphereOpacity: 0.14,
      bridgeGradient: "linear-gradient(180deg, rgba(249,115,22,0.25) 0%, rgba(253,165,165,0.18) 50%, rgba(146,64,14,0.12) 100%)",
      bridgeGlow: "rgba(249,115,22,0.08)",
    },
    dark: {
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
    light: {
      accentColor: "#2563eb",
      glowColor: "rgba(186,230,253,0.35)",
      bgGradient: "linear-gradient(180deg, #dbeafe 0%, #e0f2fe 20%, #f0f9ff 50%, #f8faff 80%, #fff 100%)",
      particleEmoji: "❄️",
      atmosphereOpacity: 0.15,
      bridgeGradient: "linear-gradient(180deg, rgba(186,230,253,0.30) 0%, rgba(224,242,254,0.22) 50%, rgba(240,249,255,0.16) 100%)",
      bridgeGlow: "rgba(147,197,253,0.08)",
    },
    dark: {
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
export const HOLIDAY_ATMOSPHERE: Partial<Record<HolidayOverride, SeasonRow>> = {
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

// ─── The clock seam ─────────────────────────────────────────────────────────
//
// "Is it night outside?" has one answer per document, published on <html> as
// `data-timeofday`. ThemeProvider owns the write (it already resolves the same
// clock for Display Mode); this hook is the reader. Three fallbacks, in order,
// so a bare <AtmosphericProvider> in a unit test still resolves:
//
//   1. `data-timeofday` — an explicit pin. Highest precedence on purpose: the
//      visual-review harness sets it to force a clock state for review, and the
//      pin has to survive ThemeProvider's own publish.
//   2. `weather.timeOfDay` — the family's Settings → Appearance choice.
//   3. The real local clock (06:00–18:59 = day — the same bounds useWeather and
//      useTheme use, so nothing drifts to a private sunrise table).
export const TIME_OF_DAY_ATTR = "data-timeofday";
export const THEME_ATTR = "data-theme";

export function resolveIsNight(pinned: string | null | undefined, configured: TimeOfDay, now: Date): boolean {
  if (pinned === "night") return true;
  if (pinned === "day") return false;
  if (configured === "night") return true;
  if (configured === "day") return false;
  const h = now.getHours();
  return h < 6 || h >= 19;
}

/**
 * The resolved theme, read from the attribute the stylesheet itself keys on.
 * Falling back to the OS preference matters only for the window between the
 * first paint and ThemeProvider's own publish — and for a bare
 * `<AtmosphericProvider>` in a unit test.
 */
export function resolveLeg(published: string | null | undefined, prefersDark: boolean): AtmosphereLeg {
  if (published === "dark") return "dark";
  if (published === "light") return "light";
  return prefersDark ? "dark" : "light";
}

function subscribeToHtmlAttributes(onChange: () => void): () => void {
  if (typeof document === "undefined" || !document.documentElement) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [TIME_OF_DAY_ATTR, THEME_ATTR],
  });
  return () => observer.disconnect();
}

function readHtmlAttribute(name: string): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement?.getAttribute(name) ?? null;
}

/** Reactive `isNight`, so a page open across 19:00 re-reads instead of freezing. */
function useIsNight(configured: TimeOfDay): boolean {
  const pinned = useSyncExternalStore(
    subscribeToHtmlAttributes,
    () => readHtmlAttribute(TIME_OF_DAY_ATTR),
    () => null,
  );
  return useMemo(() => resolveIsNight(pinned, configured, new Date()), [pinned, configured]);
}

/** Reactive palette leg — follows the theme the family is actually looking at. */
function useLeg(): AtmosphereLeg {
  const published = useSyncExternalStore(
    subscribeToHtmlAttributes,
    () => readHtmlAttribute(THEME_ATTR),
    () => null,
  );
  const prefersDark = useSyncExternalStore(
    subscribeToColorScheme,
    getPrefersDark,
    getServerPrefersDark,
  );
  return useMemo(() => resolveLeg(published, prefersDark), [published, prefersDark]);
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COLOR_SCHEME_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COLOR_SCHEME_QUERY).matches
    : false;
}

/** SSR has no window; the client's first publish corrects it before paint. */
function getServerPrefersDark(): boolean {
  return false;
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
  const isNight = useIsNight(weather.timeOfDay);
  const leg = useLeg();

  const theme = useMemo<AtmosphericTheme>(() => {
    const season = (weather.season === "auto" ? getRealSeason() : weather.season) as SeasonKey;
    const rawHol = weather.holidayOverride ?? "auto";
    const holiday: HolidayOverride = rawHol === "auto" ? detectAutoHoliday() : rawHol;

    // The palette row is the THEME's, not the clock's. Season and holiday still
    // decide which palette; the leg decides which half of it is legible.
    const seasonData = SEASON_ATMOSPHERE[season];
    const base = seasonData[leg];

    // Holiday overrides take precedence
    if (holiday !== "none" && HOLIDAY_ATMOSPHERE[holiday]) {
      return {
        season,
        holiday,
        isNight,
        leg,
        ...HOLIDAY_ATMOSPHERE[holiday]!,
      };
    }

    return {
      season,
      holiday,
      isNight,
      leg,
      ...base,
    };
  }, [weather, isNight, leg]);

  return (
    <AtmosphericContext.Provider value={{ theme, filterId: "atmospheric-goo" }}>
      {children}
    </AtmosphericContext.Provider>
  );
}
