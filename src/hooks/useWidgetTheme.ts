"use client";

/**
 * useSeasonTheme — shared visual theme for all home-screen widgets.
 * Reads from WeatherConfig so Weather, Consuela, and Meal widgets stay
 * visually in sync automatically (season + holiday + time-of-day).
 */

import { useMemo } from "react";
import { useWeatherConfig } from "@/hooks/useWeather";
import { HolidayOverride } from "@/lib/weather-config";

export type SeasonKey = "spring" | "summer" | "autumn" | "winter";
export type TodFlag   = "day" | "night";

export interface WidgetTheme {
  season: SeasonKey;
  tod: TodFlag;
  holiday: HolidayOverride;

  /** Full-bleed card background gradient */
  bgGradient: string;
  /** Outer glow / box-shadow colour */
  glowColor: string;
  /** Primary accent colour for text, borders, icons */
  accentColor: string;
  /** Semi-transparent accent for backgrounds */
  accentBg: string;
  /** Border colour */
  borderColor: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

function getRealTod(): TodFlag {
  const h = new Date().getHours();
  return h >= 6 && h < 19 ? "day" : "night";
}

function getRealSeason(): SeasonKey {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
}

function detectAutoHoliday(): HolidayOverride {
  const { getMonth, getDate } = new Date();
  const month = new Date().getMonth();
  const day   = new Date().getDate();
  if (month === 11 && day >= 15) return "christmas";
  if (month === 0  && day <= 7)  return "newyears";
  if (month === 1  && day >= 10 && day <= 16) return "valentines";
  if (month === 6  && day >= 1  && day <= 7)  return "july4th";
  if (month === 9  && day >= 25) return "halloween";
  return "none";
}

// ── theme tables ───────────────────────────────────────────────────────────

type SeasonTable = Record<SeasonKey, Record<TodFlag, {
  bgGradient: string; glowColor: string; accentColor: string;
}>>;

const SEASON_THEMES: SeasonTable = {
  spring: {
    day:   { bgGradient: "linear-gradient(160deg,#ffd6e8 0%,#ffe8f5 30%,#e8f5e9 60%,#f0fff4 100%)", glowColor: "rgba(255,182,218,0.35)", accentColor: "#ec4899" },
    night: { bgGradient: "linear-gradient(160deg,#1a0d2e 0%,#0d1f2d 40%,#0a2d1a 100%)",             glowColor: "rgba(255,182,218,0.20)", accentColor: "#f9a8d4" },
  },
  summer: {
    day:   { bgGradient: "linear-gradient(160deg,#fed7aa 0%,#fef08a 25%,#bbf7d0 60%,#7dd3fc 100%)", glowColor: "rgba(251,191,36,0.40)",  accentColor: "#d97706" },
    night: { bgGradient: "linear-gradient(160deg,#0f172a 0%,#1e1b4b 40%,#0c4a6e 100%)",             glowColor: "rgba(251,191,36,0.15)",  accentColor: "#fbbf24" },
  },
  autumn: {
    day:   { bgGradient: "linear-gradient(160deg,#fde68a 0%,#fca5a5 25%,#f97316 50%,#92400e 100%)", glowColor: "rgba(249,115,22,0.35)",  accentColor: "#c2410c" },
    night: { bgGradient: "linear-gradient(160deg,#1c0a00 0%,#2d1200 40%,#1a150a 100%)",             glowColor: "rgba(249,115,22,0.20)",  accentColor: "#fb923c" },
  },
  winter: {
    day:   { bgGradient: "linear-gradient(160deg,#dbeafe 0%,#e0f2fe 35%,#f0f9ff 65%,#f8faff 100%)", glowColor: "rgba(186,230,253,0.50)", accentColor: "#2563eb" },
    night: { bgGradient: "linear-gradient(160deg,#020617 0%,#0c1445 40%,#0f2744 100%)",              glowColor: "rgba(147,197,253,0.20)", accentColor: "#93c5fd" },
  },
};

type HolidayOverrides = Partial<Record<HolidayOverride, {
  bgGradient: string; glowColor: string; accentColor: string;
}>>;

const HOLIDAY_OVERRIDES: HolidayOverrides = {
  christmas:  { bgGradient: "linear-gradient(160deg,#0a2010 0%,#15350f 40%,#0a1a00 100%)", glowColor: "rgba(255,80,60,0.25)",   accentColor: "#ef4444" },
  halloween:  { bgGradient: "linear-gradient(160deg,#0d0010 0%,#1a0530 40%,#2d0a00 100%)", glowColor: "rgba(249,115,22,0.30)",  accentColor: "#f97316" },
  july4th:    { bgGradient: "linear-gradient(160deg,#030712 0%,#0c1445 50%,#1e0036 100%)", glowColor: "rgba(239,68,68,0.25)",   accentColor: "#ef4444" },
  valentines: { bgGradient: "linear-gradient(160deg,#2d0a1a 0%,#4c0519 40%,#1a0010 100%)", glowColor: "rgba(244,63,94,0.30)",  accentColor: "#f43f5e" },
  newyears:   { bgGradient: "linear-gradient(160deg,#030712 0%,#1e1b4b 50%,#0f172a 100%)", glowColor: "rgba(234,179,8,0.30)",   accentColor: "#eab308" },
};

// ── hook ───────────────────────────────────────────────────────────────────

export function useWidgetTheme(): WidgetTheme {
  const { weather } = useWeatherConfig();

  return useMemo(() => {
    const season  = (weather.season  === "auto" ? getRealSeason() : weather.season)  as SeasonKey;
    const tod     = (weather.timeOfDay === "auto" ? getRealTod()  : weather.timeOfDay) as TodFlag;
    const rawHol  = weather.holidayOverride ?? "auto";
    const holiday: HolidayOverride = rawHol === "auto" ? detectAutoHoliday() : rawHol;

    const base    = SEASON_THEMES[season][tod];
    const hol     = holiday !== "none" ? HOLIDAY_OVERRIDES[holiday] : undefined;

    const { bgGradient, glowColor, accentColor } = hol
      ? { ...base, ...hol }
      : base;

    return {
      season, tod, holiday,
      bgGradient,
      glowColor,
      accentColor,
      accentBg:    `${accentColor}22`,
      borderColor: `${accentColor}35`,
    };
  }, [weather]);
}
