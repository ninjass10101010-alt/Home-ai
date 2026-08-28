"use client";

import { useState, useEffect } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";
import DayLine from "@/components/patterns/DayLine";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

const SCHEDULES_STORAGE_KEY = "consuela-schedules";
const MEALS_KEY = "consuela-meals";

function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const raw = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (raw) return parseInt(raw[1]) * 60 + parseInt(raw[2]);
  const ampm = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  return 0;
}

function formatTime(t: string): string {
  const mins = parseTimeToMinutes(t);
  if (!mins && (t.includes("AM") || t.includes("PM"))) return t;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatDuration(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// 0 while >90m away, ramps to 1 at the scheduled time, holds 1 for up to
// 60m after start, then back to 0.
function proximityFactor(minutesUntil: number): number {
  if (minutesUntil > 90) return 0;
  if (minutesUntil > 0) return 1 - minutesUntil / 90;
  if (minutesUntil >= -60) return 1;
  return 0;
}

function alphaHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
}

const MEAL_THEMES: Record<string, { icon: string; label: string }> = {
  breakfast: { icon: "🌅", label: "Breakfast" },
  lunch:     { icon: "☀️", label: "Lunch" },
  dinner:    { icon: "🌙", label: "Dinner" },
  snack:     { icon: "🍎", label: "Snack" },
};

export default function CurrentMealWidget({ className = "" }: { className?: string }) {
  const atm = useAtmosphericTheme();
  const [currentMealType, setCurrentMealType] = useState<string>("dinner");
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [activeMealData, setActiveMealData] = useState<any>(null);
  const [mealMarkers, setMealMarkers] = useState<number[]>([]);
  const [activeMinutes, setActiveMinutes] = useState<number | null>(null);
  const [minutesUntil, setMinutesUntil] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      let schedules: any[] = [];
      try {
        const raw = localStorage.getItem(SCHEDULES_STORAGE_KEY);
        schedules = raw ? JSON.parse(raw) : [];
      } catch { schedules = []; }

      const mealSchedules = schedules
        .filter((s: any) => s.mealType && s.mealType !== "none")
        .map((s: any) => ({ ...s, minutes: parseTimeToMinutes(s.time) }))
        .sort((a: any, b: any) => a.minutes - b.minutes);

      const activeMealSchedules = mealSchedules.length > 0 ? mealSchedules : schedules
        .map((s: any) => {
          const t = s.title?.toLowerCase() ?? "";
          let mealType = null;
          if (t.includes("breakfast")) mealType = "breakfast";
          else if (t.includes("lunch")) mealType = "lunch";
          else if (t.includes("dinner")) mealType = "dinner";
          else if (t.includes("snack")) mealType = "snack";
          return mealType ? { ...s, mealType, minutes: parseTimeToMinutes(s.time) } : null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.minutes - b.minutes);

      setMealMarkers(activeMealSchedules.map((m: any) => m.minutes).filter((m: number) => m > 0));

      let current = activeMealSchedules[0];
      for (const meal of activeMealSchedules) {
        if (meal.minutes <= nowMinutes) current = meal;
      }

      if (current) {
        setCurrentMealType(current.mealType);
        setScheduledTime(formatTime(current.time));
        if (current.minutes > 0) {
          setActiveMinutes(current.minutes);
          setMinutesUntil(current.minutes - nowMinutes);
        } else {
          setActiveMinutes(null);
          setMinutesUntil(null);
        }
      } else {
        setActiveMinutes(null);
        setMinutesUntil(null);
      }

      const todayShort = now.toLocaleDateString("en-US", { weekday: "short" });
      try {
        const mealsRaw = localStorage.getItem(MEALS_KEY);
        const meals: any[] = mealsRaw ? JSON.parse(mealsRaw) : [];
        const meal = meals.find(
          (m: any) => m.time === todayShort && m.mealType === (current?.mealType || "dinner")
        ) || meals.find((m: any) => m.time === todayShort);
        setActiveMealData(meal || null);
      } catch { setActiveMealData(null); }
    };

    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);

  const mealInfo = MEAL_THEMES[currentMealType] ?? MEAL_THEMES.dinner;

  const proximity = minutesUntil === null ? 0 : proximityFactor(minutesUntil);
  const isNear = minutesUntil !== null && minutesUntil > 0 && minutesUntil <= 15;

  const subtitle = !scheduledTime
    ? "Set a meal schedule to see times"
    : minutesUntil === null || minutesUntil > 90
      ? `Scheduled at ${scheduledTime}`
      : minutesUntil > 0
        ? isNear
          ? `Almost time · in ${formatDuration(minutesUntil)}`
          : `In ${formatDuration(minutesUntil)} · at ${scheduledTime}`
        : `Started at ${scheduledTime}`;

  const cardBorderAlpha = alphaHex(0x15 + (0x45 - 0x15) * proximity);
  const cardBgAlpha = alphaHex(0x0a + (0x14 - 0x0a) * proximity);
  const cardGlowRadius = Math.round((8 + 20 * proximity) * proximity);
  const emojiGlowRadius = Math.round(16 + 12 * proximity);
  const emojiBorderAlpha = alphaHex(0x20 + 0x18 * proximity + (isNear ? 0x15 : 0));

  return (
    <WidgetCard tone="#10b981" icon="🍽️" className={className}>
      {/* Floating seasonal emoji in corner */}
      <div
        className="absolute top-2 right-2 text-4xl pointer-events-none select-none meal-float-gentle"
        style={{
          opacity: atm.atmosphereOpacity * 1.8,
          filter: `drop-shadow(0 0 8px ${atm.glowColor})`,
        }}
      >
        {atm.particleEmoji}
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center p-5">
        {/* Header row */}
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-text-primary font-bold text-base flex items-center gap-2 whitespace-nowrap">
            <span className="meal-icon-pulse">{mealInfo.icon}</span>
            {mealInfo.label} Time
          </h2>
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-lg meal-time-badge shrink-0"
            style={{
              color: `var(--widget-accent-strong, ${atm.accentColor})`,
              background: `${atm.accentColor}18`,
              border: `1px solid ${atm.accentColor}30`,
              transition: "color 0.4s ease, background 0.4s ease",
            }}
          >
            {currentTimeStr}
          </span>
        </div>

        <p className="text-text-secondary text-xs mb-4 text-center">
          {subtitle}
        </p>

        {/* The day's meal times on the household clock */}
        {mealMarkers.length > 0 && (
          <div className="mb-4">
            <DayLine
              tone={atm.accentColor}
              markers={mealMarkers.map((m) => ({
                at: m,
                color: m === activeMinutes ? atm.accentColor : undefined,
              }))}
            />
          </div>
        )}

        {/* Meal card */}
        <div
          className="meal-card-glow rounded-2xl p-3.5 flex items-center gap-3"
          style={{
            background: `${atm.accentColor}${cardBgAlpha}`,
            border: `1px solid ${atm.accentColor}${cardBorderAlpha}`,
            boxShadow: `0 0 ${cardGlowRadius}px ${atm.glowColor}`,
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            className="meal-emoji-glow w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 meal-emoji-bob"
            style={{
              background: `${atm.accentColor}12`,
              border: `1px solid ${atm.accentColor}${emojiBorderAlpha}`,
              boxShadow: `0 0 ${emojiGlowRadius}px ${atm.glowColor}`,
            }}
          >
            {activeMealData?.emoji || "🍽️"}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-bold text-lg leading-snug line-clamp-2">
              {activeMealData ? activeMealData.name : "No meal planned yet"}
            </h3>
            {activeMealData ? (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {(activeMealData.tags ?? []).slice(0, 3).map((t: string) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md text-[11px] font-medium"
                    style={{
                      color: `var(--widget-accent-strong, ${atm.accentColor})`,
                      background: `${atm.accentColor}15`,
                      transition: "color 0.4s ease, background 0.4s ease",
                    }}
                  >
                    {t}
                  </span>
                ))}
                {(activeMealData.tags?.length ?? 0) > 3 && (
                  <span
                    className="px-2 py-0.5 rounded-md text-[11px] font-medium"
                    style={{
                      color: `var(--widget-accent-strong, ${atm.accentColor})`,
                      background: `${atm.accentColor}15`,
                      transition: "color 0.4s ease, background 0.4s ease",
                    }}
                  >
                    +{activeMealData.tags.length - 3}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-text-muted text-xs mt-1">
                Plan {mealInfo.label.toLowerCase()} in the Kitchen tab
              </p>
            )}
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}
