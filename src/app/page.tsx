"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { Icon3D } from "@/components/3d";
import EmergencyButton from "@/components/ui/EmergencyButton";
import ScheduleDisplay from "@/components/ui/ScheduleDisplay";
import { db } from "@/db";
import CurrentMealWidget from "@/components/meals/CurrentMealWidget";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import AtmosphericBridge from "@/components/ui/AtmosphericBridge";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import type { WidgetId } from "@/lib/layout-config";


const quickPrompts = [
  "What's for dinner?",
  "Add event",
  "Plan this week",
  "Grocery list",
];

export default function HomePage() {
  const familyMembers = db.selectMembers().map((member) => ({
    name: member.name,
    color: member.id === 1 ? "green" : member.id === 2 ? "cyan" : member.id === 3 ? "violet" : "amber",
    emoji: member.emoji,
  }));

  const todayEvents = db.selectTodaysEvents();
  const pendingTasks = db.selectPendingTasks();
  const scheduleItems = db.selectTodaysSchedules();

  const today = new Date();
  const hour = today.getHours();
  const timeOfDay = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

  const getSeason = () => {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return { name: "Spring", emoji: "🌸" };
    if (month >= 5 && month <= 7) return { name: "Summer", emoji: "☀️" };
    if (month >= 8 && month <= 10) return { name: "Autumn", emoji: "🍂" };
    return { name: "Winter", emoji: "❄️" };
  };
  const season = getSeason();

  // Date pill
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "short" });
  const dayMonth = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });



  // Live clock
  const [now, setNow] = useState(new Date());
  const { isVisible, widgets } = useHomeLayout();
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <PageShell>
      <EmergencyButton />
      {/* Background Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-orb w-72 h-72 -top-20 -right-20" style={{ background: "radial-gradient(circle, var(--color-accent-lavender), transparent)", animationDelay: "0s" }} />
        <div className="gradient-orb w-80 h-80 -bottom-20 -left-20" style={{ background: "radial-gradient(circle, var(--color-accent-coral), transparent)", animationDelay: "2s" }} />
        <div className="gradient-orb w-64 h-64 top-1/2 left-1/4" style={{ background: "radial-gradient(circle, var(--color-accent-mint), transparent)", animationDelay: "4s" }} />
        <div className="gradient-orb w-48 h-48 bottom-1/4 right-1/4" style={{ background: "radial-gradient(circle, var(--color-accent-amber), transparent)", animationDelay: "6s" }} />
      </div>

      {/* Header */}
      <div
        className="px-4 pt-12 pb-4 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        {/* Family row */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {familyMembers.map((m) => (
              <Avatar key={m.name} name={m.name} color={m.color} emoji={m.emoji} size="md" variant="emoji" />
            ))}
          </div>
        </div>

        {/* Date pill */}
        <div className="flex items-center gap-2 mb-4 animate-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-subtle border border-[var(--color-surface-7)]/20">
            <span className="text-xs text-text-secondary font-medium">{dayOfWeek}</span>
            <span className="text-xs text-[var(--color-accent-selected)] font-semibold">{dayMonth}</span>
            <span className="w-px h-3 bg-[var(--color-surface-7)]/30" />
            <span className="text-xs text-[var(--color-accent-cyan)] font-medium tabular-nums tracking-tight">{timeStr}</span>
          </div>
        </div>

        {/* Greeting with gradient text */}
        <div className="mb-4 animate-in animate-in-delay-100">
          <h1 className="text-2xl font-bold text-text-primary mt-0.5">
            Good {timeOfDay}, <span className="bg-[linear-gradient(135deg,var(--color-accent-selected),var(--color-accent-cyan))] bg-clip-text text-transparent">Garcia family</span> 👋
          </h1>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs text-text-muted">{season.emoji} {season.name}</span>
          </div>
        </div>

        {/* Quick stat links */}
        <div className="flex gap-2 flex-wrap mt-3 animate-in animate-in-delay-300">
          <Link
            href="/calendar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle border border-[var(--color-surface-7)]/20 text-text-secondary text-[11px] font-medium shrink-0 transition-all duration-200 cursor-pointer hover:text-text-primary hover:border-[var(--color-accent-selected)]/30 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
            </svg>
            <span>3 events</span>
          </Link>
          <Link
            href="/tasks"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle border border-[var(--color-surface-7)]/20 text-text-secondary text-[11px] font-medium shrink-0 transition-all duration-200 cursor-pointer hover:text-text-primary hover:border-[var(--color-accent-selected)]/30 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" />
              <path d="M9.53 16.15a1.5 1.5 0 0 0 2.11 2.09l3.28-3.28a1.5 1.5 0 0 0 0-2.1l-3.28-3.28a1.5 1.5 0 0 0-2.1 0L7.9 11.17" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>2 tasks</span>
          </Link>
          <Link
            href="/chat?q=taco%20night"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle border border-[var(--color-surface-7)]/20 text-text-secondary text-[11px] font-medium shrink-0 transition-all duration-200 cursor-pointer hover:text-text-primary hover:border-[var(--color-accent-selected)]/30 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Taco night 🌮</span>
          </Link>
        </div>
      </div>

      {/* Weather Widget - always renders first with its special wrapper */}
      {isVisible("weather") && (
        <div className="px-4 pb-2 relative z-10">
          <AtmosphericProvider>
            <WeatherWidget />
            <AtmosphericBridge />
          </AtmosphericProvider>
        </div>
      )}

      {/* Divider - only show if weather is visible AND at least one other widget is visible */}
      {isVisible("weather") && widgets.filter((id) => id !== "weather").some((id) => isVisible(id)) && (
        <div className="px-4 mb-2 relative z-10">
          <div className="h-px bg-white/5"></div>
        </div>
      )}

      <div className="px-4 space-y-5 relative z-10">
        {widgets.filter((id) => id !== "weather").map((id) => {
          if (!isVisible(id)) return null;

          switch (id as WidgetId) {
            case "aiQuickAsk":
              return (
                <AtmosphericProvider key="aiQuickAsk">
                  <Link href="/chat">
                  <div className="atmospheric-card rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--color-accent-selected)]/30 to-[var(--color-accent-cyan)]/20 flex items-center justify-center text-2xl shrink-0 floating">
                      <Icon3D variant="chat" size="md" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-medium">Ask Consuela anything…</p>
                      <p className="text-text-secondary/60 text-xs mt-0.5 truncate">
                        &ldquo;Plan dinner, add an event, or check on the kids…&rdquo;
                      </p>
                    </div>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-5 h-5 text-[var(--color-accent-selected)] shrink-0"
                    >
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </Link>
              </AtmosphericProvider>
              );

            case "quickPrompts":
              return (
                <div key="quickPrompts" className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scroll-smooth-x no-scrollbar">
                  {quickPrompts.map((p, idx) => (
                    <Link
                      key={p}
                      href={`/chat?q=${encodeURIComponent(p)}`}
                      style={{ animationDelay: `${0.24 + idx * 0.08}s` }}
                      className="scroll-snap-child shrink-0 px-3 py-1.5 rounded-full glass text-text-secondary text-xs border border-[var(--color-surface-7)]/20 hover:border-[var(--color-accent-selected)]/40 hover:text-[var(--color-accent-selected)] transition-all duration-200 animate-in"
                    >
                      {p}
                    </Link>
                  ))}
                </div>
              );

            case "todayEvents":
              return (
                <section key="todayEvents">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-text-primary font-semibold text-base">Today</h2>
                    <Link href="/calendar" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
                      {todayEvents.length} events →
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {todayEvents.map((ev, idx) => {
                      const colorBgMap: Record<string, string> = {
                        green:  "bg-[var(--color-accent-mint)]/10",
                        violet: "bg-[var(--color-accent-violet)]/10",
                        amber:  "bg-[var(--color-accent-amber)]/10",
                        cyan:   "bg-[var(--color-accent-cyan)]/10",
                        rose:   "bg-[var(--color-accent-rose)]/10",
                        blue:   "bg-[var(--color-accent-nori)]/10",
                      };
                      const colorBarMap: Record<string, string> = {
                        green:  "bg-[var(--color-accent-mint)]",
                        violet: "bg-[var(--color-accent-violet)]",
                        amber:  "bg-[var(--color-accent-amber)]",
                        cyan:   "bg-[var(--color-accent-cyan)]",
                        rose:   "bg-[var(--color-accent-rose)]",
                        blue:   "bg-[var(--color-accent-nori)]",
                      };
                      return (
                        <div
                          key={ev.id}
                          style={{ animationDelay: `${idx * 0.06}s` }}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl animate-in transition-all duration-200 hover:bg-white/[0.06] ${
                            colorBgMap[ev.color] ?? "bg-[var(--color-accent-nori)]/10"
                          }`}
                        >
                          {/* Accent bar */}
                          <div className={`w-1 h-8 rounded-full shrink-0 ${colorBarMap[ev.color] ?? "bg-[var(--color-accent-nori)]"}`} />
                          {/* Icon */}
                          <span className="text-lg shrink-0">{ev.icon}</span>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary font-medium truncate">{ev.title}</p>
                            <p className="text-xs text-text-muted tabular-nums">{ev.time}</p>
                          </div>
                          {/* Member badge */}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] text-text-secondary shrink-0">
                            {ev.member.split(" ")[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );

            case "schedule":
              return (
                <ScheduleDisplay
                  key="schedule"
                  schedule={scheduleItems.map((item) => ({
                    id: item.id,
                    title: item.title,
                    time: item.time,
                    emoji: item.emoji,
                    type: item.type as "routine" | "reminder",
                    color: item.color,
                    member: item.member,
                    memberColor: item.memberColor,
                  }))}
                  title="Daily Schedule"
                />
              );

            case "currentMeal":
              return (
                <AtmosphericProvider key="currentMeal">
                  <section className="atmospheric-meal-section">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-text-primary font-semibold text-base">Current Meal</h2>
                      <Link href="/meals" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
                        Plan →
                      </Link>
                    </div>
                    <CurrentMealWidget />
                  </section>
                </AtmosphericProvider>
              );

            case "tasks":
              return (
                <section key="tasks">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-text-primary font-semibold text-base">Tasks</h2>
                    <Link href="/tasks" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
                      {pendingTasks.length} pending →
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {pendingTasks.map((task, idx) => {
                      const pts = task.points;
                      const isHigh = pts > 15;
                      const isMed = pts > 10 && !isHigh;
                      const accentBg = isHigh
                        ? "bg-[var(--color-accent-rose)]/10"
                        : isMed
                        ? "bg-[var(--color-accent-amber)]/10"
                        : "bg-[var(--color-accent-mint)]/10";
                      const accentBar = isHigh
                        ? "bg-[var(--color-accent-rose)]"
                        : isMed
                        ? "bg-[var(--color-accent-amber)]"
                        : "bg-[var(--color-accent-mint)]";
                      const ptColor = isHigh
                        ? "text-[var(--color-accent-rose)]"
                        : "text-[var(--color-accent-amber)]";
                      return (
                        <div
                          key={task.id}
                          style={{ animationDelay: `${idx * 0.06}s` }}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl animate-in transition-all duration-200 hover:bg-white/[0.06] ${accentBg}`}
                        >
                          {/* Priority bar */}
                          <div className={`w-1 h-8 rounded-full shrink-0 ${accentBar}`} />
                          {/* Checkbox */}
                          <div
                            className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                              task.done
                                ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]"
                                : "border-[var(--color-surface-4)]"
                            }`}
                          >
                            {task.done && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${task.done ? "line-through text-text-muted" : "text-text-primary"}`}>
                              {task.title}
                            </p>
                            <p className="text-xs text-text-muted">
                              {task.assigned} · {task.due}
                            </p>
                          </div>
                          {/* Points badge */}
                          <span className={`text-xs font-semibold shrink-0 px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] ${ptColor}`}>
                            +{pts}pts
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );

            default:
              return null;
          }
        })}

      </div>
    </PageShell>
  );
}
