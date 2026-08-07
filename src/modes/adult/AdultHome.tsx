/**
 * AdultHome — The "Command Center"
 *
 * Clean, information-dense, efficient. Built for parents who need to
 * see everything at a glance and act fast.
 *
 * Key differences from Family/Kid mode:
 *   - No greeting — just date + status
 *   - Overview bar always visible at top
 *   - 2-column grid layout for dense information
 *   - No decorative animations
 *   - Swipe-to-complete on tasks, events, and schedule items
 *   - Tabular-nums for data alignment
 *   - Meal plan shown as week grid
 *   - Weekend mode: "Weekend Projects" replaces routines
 *   - Bedtime mode: tomorrow preview + quick notes
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import EmergencyButton from "@/components/ui/EmergencyButton";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import SwipeableRow from "./SwipeableRow";
import InstacartButton from "@/components/ui/InstacartButton";
import SidebarNav from "./SidebarNav";
import SpotifyWidget from "@/components/integrations/SpotifyWidget";
import HomeAssistantWidget from "@/components/integrations/HomeAssistantWidget";
import GmailImportWidget from "@/components/integrations/GmailImportWidget";
import FoodDeliveryWidget from "@/components/integrations/FoodDeliveryWidget";
import ProductSearchWidget from "@/components/integrations/ProductSearchWidget";
import TravelTimeCard from "@/components/integrations/TravelTimeCard";
import LearningWidget from "@/components/integrations/LearningWidget";
import Link from "next/link";
import { db } from "@/db";
import { useRouter } from "next/navigation";

const avatarSizes = new Set<AvatarSize>(["xs", "sm", "md", "base", "lg"]);
function normalizeAvatarSize(size?: string) {
  return avatarSizes.has(size as AvatarSize) ? (size as AvatarSize) : "md";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ═══════════════════════════════════════════════════════════════════════════
// Overview Bar — Sticky stats strip
// ═══════════════════════════════════════════════════════════════════════════

function OverviewBar({
  eventCount, taskCount, completedTasks, mealName, streak, groceryCount, timeStr,
}: {
  eventCount: number; taskCount: number; completedTasks: number;
  mealName: string; streak: number; groceryCount: number; timeStr: string;
}) {
  return (
    <div
      className="sticky top-0 z-30 border-b border-white/[0.06] px-4 py-2.5"
      style={{
        background: "var(--color-surface-0)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)",
      }}
    >
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
        <Stat label="events" value={eventCount} icon="📅" />
        <Dot />
        <Stat label="tasks" value={`${completedTasks}/${taskCount}`} icon="✅" />
        <Dot />
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs">🍽️</span>
          <span className="text-xs font-semibold text-text-primary truncate max-w-[80px]">{mealName || "—"}</span>
        </div>
        {streak > 0 && <><Dot /><Stat label="streak" value={`${streak}d`} icon="🔥" accent="text-amber-400" /></>}
        {groceryCount > 0 && <><Dot /><Stat label="grocery" value={groceryCount} icon="🛒" /></>}
        <div className="ml-auto shrink-0">
          <span className="text-xs font-semibold text-text-secondary tabular-nums">{timeStr}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: string | number; icon: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-xs">{icon}</span>
      <span className={`text-xs font-semibold tabular-nums ${accent || "text-text-primary"}`}>{value}</span>
      <span className="text-[10px] text-text-muted">{label}</span>
    </div>
  );
}

function Dot() {
  return <span className="text-text-dim shrink-0">·</span>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Compact Weather — Data only, no art
// ═══════════════════════════════════════════════════════════════════════════

function CompactWeather() {
  const [temp, setTemp] = useState<number | null>(null);
  const [condition, setCondition] = useState("Loading...");
  const [emoji, setEmoji] = useState("⛅");
  const [forecast, setForecast] = useState<{ day: string; high: number; emoji: string }[]>([]);

  useEffect(() => {
    fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=42.7875&longitude=-86.1089&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=5"
    )
      .then((r) => r.json())
      .then((data) => {
        const code = data.current?.weather_code;
        setTemp(Math.round(data.current?.temperature_2m));
        const wmo = (c: number) => {
          if (c === 0) return { cond: "Clear", e: "☀️" };
          if (c <= 3) return { cond: "Partly Cloudy", e: "⛅" };
          if (c <= 48) return { cond: "Foggy", e: "🌫️" };
          if (c <= 57) return { cond: "Drizzle", e: "🌦️" };
          if (c <= 67) return { cond: "Rainy", e: "🌧️" };
          if (c <= 77) return { cond: "Snowy", e: "❄️" };
          return { cond: "Stormy", e: "⛈️" };
        };
        const cur = wmo(code);
        setCondition(cur.cond);
        setEmoji(cur.e);

        if (data.daily?.time) {
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          setForecast(data.daily.time.slice(1, 5).map((d: string, i: number) => ({
            day: days[new Date(d).getDay()],
            high: Math.round(data.daily.temperature_2m_max[i + 1]),
            emoji: wmo(data.daily.weather_code[i + 1]).e,
          })));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <Surface variant="glass-subtle" radius="xl" padding="sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            {temp !== null && <span className="text-xl font-bold text-text-primary tabular-nums">{temp}°F</span>}
            <p className="text-xs text-text-secondary">{condition}</p>
          </div>
        </div>
        <Link href="/more" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">Details →</Link>
      </div>
      {forecast.length > 0 && (
        <div className="flex gap-1 pt-2 border-t border-white/[0.06]">
          {forecast.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5 py-1">
              <span className="text-[9px] font-semibold text-text-muted">{d.day}</span>
              <span className="text-sm">{d.emoji}</span>
              <span className="text-[10px] font-bold text-text-secondary tabular-nums">{d.high}°</span>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Meal Plan Week Grid
// ═══════════════════════════════════════════════════════════════════════════

function MealPlanGrid({ meals }: { meals: any[] }) {
  const today = new Date();
  const todayDay = WEEKDAYS[today.getDay() === 0 ? 6 : today.getDay() - 1]; // Mon=0

  // Group meals by day
  const mealsByDay: Record<string, any[]> = {};
  WEEKDAYS.forEach((d) => { mealsByDay[d] = []; });
  meals.forEach((meal) => {
    const day = meal.time || "Mon";
    if (mealsByDay[day]) mealsByDay[day].push(meal);
  });

  return (
    <Surface variant="glass-subtle" radius="xl" padding="none">
      <div className="flex items-center justify-between p-4 pb-2">
        <h3 className="text-sm font-bold text-text-primary">This Week</h3>
        <Link href="/meals" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">
          Plan →
        </Link>
      </div>
      <div className="px-4 pb-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => {
            const isToday = day === todayDay;
            const dayMeals = mealsByDay[day] || [];
            return (
              <div
                key={day}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors"
                style={{
                  background: isToday ? "rgba(var(--color-accent-selected-rgb, 59,130,246), 0.12)" : "transparent",
                  border: isToday ? "1px solid rgba(var(--color-accent-selected-rgb, 59,130,246), 0.2)" : "1px solid transparent",
                }}
              >
                <span className={`text-[9px] font-bold ${isToday ? "text-[var(--color-accent-selected)]" : "text-text-muted"}`}>
                  {day}
                </span>
                {dayMeals.length > 0 ? (
                  <span className="text-sm" title={dayMeals.map((m: any) => m.name).join(", ")}>
                    {dayMeals[0].emoji || "🍽️"}
                  </span>
                ) : (
                  <span className="text-[10px] text-text-dim">—</span>
                )}
                {dayMeals.length > 0 && (
                  <span className="text-[8px] text-text-muted truncate max-w-full px-0.5 text-center leading-tight">
                    {dayMeals[0].name?.split(" ")[0] || ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Today's meal detail */}
        {mealsByDay[todayDay]?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Today</p>
            {mealsByDay[todayDay].map((meal: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5">
                <span className="text-sm">{meal.emoji || "🍽️"}</span>
                <span className="text-xs text-text-primary flex-1 truncate">{meal.name}</span>
                {meal.mealType && (
                  <span className="text-[9px] font-semibold text-text-muted uppercase">{meal.mealType}</span>
                )}
                {meal.ingredients && meal.ingredients.length > 0 && (
                  <InstacartButton
                    title={meal.name}
                    ingredients={meal.ingredients}
                    variant="icon"
                  />
                )}
              </div>
            ))}
            {/* Order all tonight's groceries */}
            {mealsByDay[todayDay].some((m: any) => m.ingredients?.length > 0) && (
              <div className="mt-2 pt-2 border-t border-white/[0.04]">
                <InstacartButton
                  title={`Tonight's Dinner Groceries`}
                  ingredients={mealsByDay[todayDay].flatMap((m: any) => m.ingredients || [])}
                  className="w-full justify-center text-xs"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Surface>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export default function AdultHome() {
  const [mounted, setMounted] = useState(false);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [completedTasks, setCompletedTasks] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [meals, setMeals] = useState<any[]>([]);
  const [groceryCount, setGroceryCount] = useState(0);
  const [now, setNow] = useState(new Date());
  const [quickNote, setQuickNote] = useState("");

  const { currentUser } = useAuth();
  const { isBedtime, isWeekend } = useDashboardMode();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    try {
      setTodayEvents(db.selectTodaysEvents());
      const allTasks = db.selectPendingTasks();
      setPendingTasks(allTasks.filter((t: any) => !t.completed));
      setCompletedTasks(allTasks.filter((t: any) => t.completed));
      setMeals(db.selectMeals());

      const stored = typeof window !== "undefined" ? localStorage.getItem("consuela-schedules") : null;
      if (stored) {
        try { setSchedules(JSON.parse(stored)); } catch {}
      } else {
        setSchedules(db.selectTodaysSchedules());
      }

      const grocery = typeof window !== "undefined" ? localStorage.getItem("consuela-grocery") : null;
      if (grocery) {
        try {
          const items = JSON.parse(grocery);
          setGroceryCount(Array.isArray(items) ? items.filter((i: any) => i.needed).length : 0);
        } catch {}
      }

      // Restore quick note
      const note = typeof window !== "undefined" ? localStorage.getItem("consuela-adult-note") : null;
      if (note) setQuickNote(note);
    } catch {}
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const completeTask = useCallback((task: any) => {
    const TASKS_KEY = "consuela-tasks";
    try {
      const stored = JSON.parse(localStorage.getItem(TASKS_KEY) || "[]");
      const updated = stored.map((t: any) =>
        t.id === task.id ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
      );
      localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
    } catch {}
    setPendingTasks((prev) => prev.filter((t) => t.id !== task.id));
    setCompletedTasks((prev) => [...prev, { ...task, completed: true }]);
  }, []);

  const user = currentUser;
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const tonightMeal = meals.find((m: any) => {
    const todayIdx = new Date().getDay();
    const dayName = WEEKDAYS[todayIdx === 0 ? 6 : todayIdx - 1];
    return m.time === dayName || m.mealType === "dinner";
  }) || meals[0];
  const mealName = tonightMeal?.name || (isWeekend ? "Weekend special" : "");
  const streak = typeof window !== "undefined" ? parseInt(localStorage.getItem("consuela-family-streak") || "0") : 0;

  const saveNote = useCallback((text: string) => {
    setQuickNote(text);
    try { localStorage.setItem("consuela-adult-note", text); } catch {}
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // BEDTIME MODE
  // ═══════════════════════════════════════════════════════════════════════

  if (isBedtime) {
    return (
      <PageShell>
        <SidebarNav />
        <EmergencyButton />
        <div className="px-4 pt-6 pb-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-text-primary">{dateStr}</h1>
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">🌙 Evening</span>
            </div>
            {user && (
              <Avatar name={user.name} color={user.color || "green"} emoji={user.emoji || "😊"} size="sm" variant="emoji" />
            )}
          </div>

          <Surface variant="glass-subtle" radius="xl" padding="none">
            <div className="p-4">
              <h3 className="text-sm font-bold text-text-primary mb-3">Tomorrow</h3>
              {todayEvents.length > 0 ? (
                <div className="space-y-2">
                  {todayEvents.slice(0, 4).map((event) => (
                    <div key={event.id} className="flex items-center gap-2.5 py-1">
                      <span className="text-sm">{event.icon || "📅"}</span>
                      <span className="text-sm text-text-primary flex-1 truncate">{event.title}</span>
                      <span className="text-[10px] font-mono text-text-muted tabular-nums">{event.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted">Clear schedule tomorrow</p>
              )}
            </div>
          </Surface>

          {pendingTasks.length > 0 && (
            <Surface variant="glass-subtle" radius="xl" padding="none">
              <div className="p-4">
                <h3 className="text-sm font-bold text-text-primary mb-3">Pending ({pendingTasks.length})</h3>
                <div className="space-y-1.5">
                  {pendingTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="flex items-center gap-2.5 py-1">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-accent-amber)" }} />
                      <span className="text-xs text-text-secondary flex-1 truncate">{task.title}</span>
                      <span className="text-[10px] text-text-muted">{task.assignee?.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>
          )}

          <Surface variant="glass-subtle" radius="xl" padding="none">
            <div className="p-4">
              <h3 className="text-sm font-bold text-text-primary mb-2">📝 Quick Note</h3>
              <textarea
                value={quickNote}
                onChange={(e) => saveNote(e.target.value)}
                placeholder="Anything to remember tomorrow?"
                className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-dim outline-none resize-none min-h-[60px]"
              />
            </div>
          </Surface>

          <p className="text-center text-sm text-text-muted pt-4">
            🌙 Everything&apos;s handled. Good night.
          </p>
        </div>
      </PageShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NORMAL / WEEKEND MODE
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <PageShell>
      <SidebarNav />
      <EmergencyButton />

      <OverviewBar
        eventCount={todayEvents.length}
        taskCount={pendingTasks.length + completedTasks.length}
        completedTasks={completedTasks.length}
        mealName={mealName}
        streak={streak}
        groceryCount={groceryCount}
        timeStr={timeStr}
      />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary tracking-tight">{dateStr}</h1>
          {isWeekend && (
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider weekend-badge">
              🏖️ Weekend
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <Avatar name={user.name} color={user.color || "green"} emoji={user.emoji || "😊"} size="sm" variant="emoji" />
          )}
          <IconButton size="sm" variant="ghost" aria-label="Settings" onClick={() => router.push("/settings")}>
            <span className="text-sm">⚙️</span>
          </IconButton>
        </div>
      </div>

      {/* ── 2-Column Grid ── */}
      <div className="px-4 space-y-3 pb-8">

        {/* Row 1: Schedule + Tasks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Schedule with swipe */}
          <Surface variant="glass-subtle" radius="xl" padding="none">
            <div className="flex items-center justify-between p-4 pb-2">
              <h3 className="text-sm font-bold text-text-primary">
                {isWeekend ? "Weekend Plans" : "Schedule"}
              </h3>
              <Link href="/calendar" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">Full →</Link>
            </div>
            <div className="px-4 pb-4 space-y-1.5">
              {schedules.length === 0 ? (
                <p className="text-xs text-text-muted py-2">
                  {isWeekend ? "No plans yet — enjoy the weekend!" : "Nothing scheduled"}
                </p>
              ) : (
                schedules.slice(0, 5).map((item: any, i: number) => (
                  <SwipeableRow
                    key={i}
                    rightActions={[
                      {
                        label: "Done",
                        icon: "✅",
                        color: "var(--color-accent-mint)",
                        onClick: () => {
                          setSchedules((prev) => prev.filter((_, idx) => idx !== i));
                        },
                      },
                      {
                        label: "Snooze",
                        icon: "⏰",
                        color: "var(--color-accent-amber)",
                        onClick: () => {},
                      },
                    ]}
                  >
                    <div className="flex items-center gap-2.5 py-2 px-1 bg-[var(--color-surface-1)] rounded-2xl">
                      <span className="text-[10px] font-mono text-text-muted w-12 text-right tabular-nums">
                        {item.time || "—"}
                      </span>
                      <span className="text-sm text-text-primary truncate flex-1">{item.title}</span>
                      <span className="text-xs">{item.icon || item.emoji || "📌"}</span>
                    </div>
                  </SwipeableRow>
                ))
              )}
            </div>
          </Surface>

          {/* Tasks with swipe */}
          <Surface variant="glass-subtle" radius="xl" padding="none">
            <div className="flex items-center justify-between p-4 pb-2">
              <h3 className="text-sm font-bold text-text-primary">
                {isWeekend ? "Weekend Projects" : "Tasks"}
                <span className="text-text-muted font-normal ml-1.5">({completedTasks.length}/{pendingTasks.length + completedTasks.length})</span>
              </h3>
              <Link href="/tasks" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">All →</Link>
            </div>
            <div className="px-4 pb-4 space-y-1.5">
              {pendingTasks.length === 0 ? (
                <p className="text-xs text-text-muted py-2">All caught up ✨</p>
              ) : (
                pendingTasks.slice(0, 5).map((task: any) => (
                  <SwipeableRow
                    key={task.id}
                    rightActions={[
                      {
                        label: "Done",
                        icon: "✅",
                        color: "var(--color-accent-mint)",
                        onClick: () => completeTask(task),
                      },
                      {
                        label: "Skip",
                        icon: "⏭️",
                        color: "var(--color-accent-amber)",
                        onClick: () => {},
                      },
                    ]}
                  >
                    <div className="flex items-center gap-2.5 py-2 px-1 bg-[var(--color-surface-1)] rounded-2xl">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          background: task.points > 15
                            ? "var(--color-accent-rose)"
                            : task.points > 10
                              ? "var(--color-accent-amber)"
                              : "var(--color-accent-mint)",
                        }}
                      />
                      <span className="text-sm text-text-primary truncate flex-1">{task.title}</span>
                      <span className="text-[10px] font-semibold text-text-muted tabular-nums">+{task.points}</span>
                      <span className="text-[10px] text-text-muted">{task.assignee?.split(" ")[0]}</span>
                    </div>
                  </SwipeableRow>
                ))
              )}
            </div>
          </Surface>
        </div>

        {/* Row 2: Meal Plan Grid + Weather */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MealPlanGrid meals={meals} />

          <div className="space-y-3">
            <CompactWeather />

            <Surface variant="glass-subtle" radius="xl" padding="sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📅</span>
                  <div>
                    <p className="text-xs font-semibold text-text-primary tabular-nums">{todayEvents.length}</p>
                    <p className="text-[10px] text-text-muted">Events today</p>
                  </div>
                </div>
                <Link href="/meals?tab=grocery" className="flex items-center gap-2">
                  <span className="text-lg">🛒</span>
                  <div>
                    <p className="text-xs font-semibold text-text-primary tabular-nums">{groceryCount}</p>
                    <p className="text-[10px] text-text-muted">Grocery items</p>
                  </div>
                </Link>
              </div>
            </Surface>
          </div>
        </div>

        {/* Row 3: Today's Events with swipe */}
        {todayEvents.length > 0 && (
          <Surface variant="glass-subtle" radius="xl" padding="none">
            <div className="flex items-center justify-between p-4 pb-2">
              <h3 className="text-sm font-bold text-text-primary">Today&apos;s Events</h3>
              <Link href="/calendar" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">Calendar →</Link>
            </div>
            <div className="px-4 pb-4 space-y-1.5">
              {todayEvents.map((event) => (
                <SwipeableRow
                  key={event.id}
                  rightActions={[
                    {
                      label: "Done",
                      icon: "✅",
                      color: "var(--color-accent-mint)",
                      onClick: () => {
                        setTodayEvents((prev) => prev.filter((e) => e.id !== event.id));
                      },
                    },
                    {
                      label: "Edit",
                      icon: "✏️",
                      color: "var(--color-accent-nori)",
                      onClick: () => router.push("/calendar"),
                    },
                  ]}
                >
                  <div className="flex items-center gap-2.5 py-2 px-1 bg-[var(--color-surface-1)] rounded-2xl">
                    <div
                      className="w-1 h-6 rounded-full shrink-0"
                      style={{ background: event.color === "green" ? "var(--color-accent-mint)" : "var(--color-accent-nori)" }}
                    />
                    <span className="text-[10px] font-mono text-text-muted w-14 text-right tabular-nums">{event.time}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary truncate block">{event.title}</span>
                      {/* Travel time for events with locations */}
                      {event.location && (
                        <TravelTimeCard
                          eventTitle={event.title}
                          eventTime={event.time}
                          eventLocation={event.location}
                        />
                      )}
                    </div>
                    <span className="text-xs">{event.icon}</span>
                    <span className="text-[10px] text-text-muted">{event.member?.split(" ")[0]}</span>
                  </div>
                </SwipeableRow>
              ))}
            </div>
          </Surface>
        )}

        {/* ── Integration Widgets (shown when services are connected) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Spotify Music Player */}
          <SpotifyWidget />
          {/* Home Assistant Smart Home */}
          <HomeAssistantWidget />
        </div>

        {/* Gmail Smart Inbox */}
        <GmailImportWidget />

        {/* Food Delivery — shows when no dinner planned */}
        {meals.length === 0 && <FoodDeliveryWidget />}

        {/* Product Search — Amazon/Walmart price comparison */}
        <ProductSearchWidget items={["Paper towels", "Diapers", "Dish soap"]} />

        {/* Learning Progress — kids' education tracking */}
        <LearningWidget />

        {/* Row 4: Quick Actions */}
        <div className="flex gap-2">
          <Link href="/chat" className="flex-1">
            <SoftButton variant="secondary" className="w-full">💬 Ask Consuela</SoftButton>
          </Link>
          <Link href="/meals" className="flex-1">
            <SoftButton variant="secondary" className="w-full">🍽️ Meals</SoftButton>
          </Link>
          <Link href="/tasks" className="flex-1">
            <SoftButton variant="secondary" className="w-full">✅ Tasks</SoftButton>
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
