"use client";

import { useState, useEffect } from "react";

const SCHEDULES_STORAGE_KEY = "consuela-schedules";
const MEALS_KEY = "consuela-meals";

// Parse "HH:MM" or "7:30 AM" → minutes since midnight
function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  // HH:MM 24h format
  const raw = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (raw) return parseInt(raw[1]) * 60 + parseInt(raw[2]);
  // 12h format "7:30 AM"
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

// Format "HH:MM" → "7:30 AM"
function formatTime(t: string): string {
  const mins = parseTimeToMinutes(t);
  if (!mins && t.includes("AM") || t.includes("PM")) return t;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
}

const MEAL_THEMES: Record<string, { bg: string; border: string; text: string; icon: string; label: string }> = {
  breakfast: { bg: "from-amber-400/20 to-orange-500/20", border: "border-amber-400/30", text: "text-amber-400", icon: "🌅", label: "Breakfast" },
  lunch:     { bg: "from-sky-400/20 to-blue-500/20",    border: "border-sky-400/30",    text: "text-sky-400",   icon: "☀️",  label: "Lunch" },
  dinner:    { bg: "from-indigo-500/20 to-purple-600/20", border: "border-indigo-400/30", text: "text-indigo-400", icon: "🌙", label: "Dinner" },
  snack:     { bg: "from-green-400/20 to-emerald-500/20", border: "border-green-400/30", text: "text-green-400", icon: "🍎", label: "Snack" },
};

export default function CurrentMealWidget() {
  const [currentMealType, setCurrentMealType] = useState<string>("dinner");
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [activeMealData, setActiveMealData] = useState<any>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      // 1. Load schedules from localStorage (written by calendar/page.tsx)
      let schedules: any[] = [];
      try {
        const raw = localStorage.getItem(SCHEDULES_STORAGE_KEY);
        schedules = raw ? JSON.parse(raw) : [];
      } catch { schedules = []; }

      // 2. Filter to meal-type schedule items only
      const mealSchedules = schedules
        .filter((s: any) => s.mealType && s.mealType !== "none")
        .map((s: any) => ({ ...s, minutes: parseTimeToMinutes(s.time) }))
        .sort((a: any, b: any) => a.minutes - b.minutes);

      // 3. If no meal-tagged items yet, fallback to detecting by title keywords
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

      // 4. Determine which meal is currently active:
      //    Last scheduled meal whose time has already passed
      let current = activeMealSchedules[0]; // default to first (e.g., breakfast)
      for (const meal of activeMealSchedules) {
        if (meal.minutes <= nowMinutes) current = meal;
      }

      if (current) {
        setCurrentMealType(current.mealType);
        setScheduledTime(formatTime(current.time));
      }

      // 5. Find the actual meal plan entry for today + this meal type
      const todayShort = now.toLocaleDateString("en-US", { weekday: "short" });
      try {
        const mealsRaw = localStorage.getItem(MEALS_KEY);
        const meals: any[] = mealsRaw ? JSON.parse(mealsRaw) : [];
        const meal = meals.find(
          (m: any) => m.time === todayShort && m.mealType === (current?.mealType || "dinner")
        ) || meals.find((m: any) => m.time === todayShort); // fallback
        setActiveMealData(meal || null);
      } catch { setActiveMealData(null); }
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  const theme = MEAL_THEMES[currentMealType] ?? MEAL_THEMES.dinner;

  return (
    <div
      className={`relative overflow-hidden rounded-3xl p-5 border bg-gradient-to-br ${theme.bg} ${theme.border} shadow-xl`}
      style={{ backdropFilter: "blur(16px)" }}
    >
      {/* Decorative bg emoji */}
      <div
        className="absolute top-[-15%] right-[-8%] text-9xl opacity-10 pointer-events-none select-none"
        style={{ filter: "blur(4px)", animation: "pulse 4s ease-in-out infinite" }}
      >
        {theme.icon}
      </div>

      <div className="flex items-center justify-between mb-2 relative z-10">
        <h2 className="text-text-primary font-bold text-base flex items-center gap-2">
          <span>{theme.icon}</span>
          {theme.label} Time
        </h2>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg bg-black/20 backdrop-blur-sm ${theme.text}`}>
          {currentTimeStr}
        </span>
      </div>

      <p className="text-text-secondary text-xs mb-4 relative z-10">
        {scheduledTime ? `Scheduled at ${scheduledTime}` : "Set a meal schedule to see times"}
      </p>

      {/* Meal display card */}
      <div className="bg-black/20 border border-white/10 rounded-2xl p-3.5 flex items-center gap-3 relative z-10 backdrop-blur-md">
        <div
          className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl shrink-0 shadow-lg border border-white/10"
          style={{ animation: "float 3s ease-in-out infinite" }}
        >
          {activeMealData?.emoji || "🍽️"}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-text-primary font-bold text-lg leading-tight truncate">
            {activeMealData ? activeMealData.name : "No meal planned yet"}
          </h3>
          {activeMealData ? (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {activeMealData.tags?.map((t: string) => (
                <span key={t} className="px-2 py-0.5 rounded-md bg-white/10 text-text-primary text-[10px] font-medium">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-xs mt-1">
              Plan {theme.label.toLowerCase()} in the Kitchen tab
            </p>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
