"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { Icon3D } from "@/components/3d";
import EmergencyButton from "@/components/ui/EmergencyButton";
import ScheduleDisplay from "@/components/ui/ScheduleDisplay";
import pb from "@/lib/pocketbase";

export default function HomePage() {
  const [greeting, setGreeting] = useState("Good afternoon");
  const [data, setData] = useState<any>(null);
  const [dateInfo, setDateInfo] = useState({ dayName: "", dateStr: "" });

  useEffect(() => {
    const today = new Date();
    const hour = today.getHours();
    
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");

    setDateInfo({
      dayName: today.toLocaleDateString("en-US", { weekday: "long" }),
      dateStr: today.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
    });

    const fetchData = async () => {
      try {
        const [members, events, tasks, schedules, meals] = await Promise.all([
          pb.collection("members").getFullList(),
          pb.collection("events").getFullList({ sort: 'date,time' }),
          pb.collection("tasks").getFullList({ filter: "status = 'pending'", sort: '-points' }),
          pb.collection("schedules").getFullList({ sort: 'time' }),
          pb.collection("meals").getFullList({ 
            filter: `date >= "${new Date().toISOString().split('T')[0]}"`,
            sort: 'date' 
          })
        ]);
        
        const getMemberColor = (role: string) => {
          const r = role.toLowerCase();
          if (r === "mom" || r === "parent") return "green";
          if (r === "dad") return "cyan";
          if (r === "son" || r === "child") return "violet";
          if (r === "daughter") return "amber";
          return "slate";
        };

        setData({
          members: members.map((m: any) => ({
            id: m.id,
            name: m.name,
            emoji: m.emoji || "👤",
            color: getMemberColor(m.role),
            role: m.role
          })),
          events: events.slice(0, 3).map((e: any) => {
            const member = members.find((m: any) => m.id === e.memberId);
            return {
              id: e.id,
              title: e.title,
              time: e.time || "All Day",
              member: member?.name || "Family",
              emoji: member?.emoji || "👤",
              color: member ? getMemberColor(member.role) : "blue",
              icon: e.icon || "📅"
            };
          }),
          tasks: tasks.slice(0, 3).map((t: any) => {
            const member = members.find((m: any) => m.id === t.assignedTo);
            return {
              id: t.id,
              title: t.title,
              emoji: t.emoji || "📝",
              done: t.status === "completed",
              assigned: member?.name || "Anyone",
              assigneeEmoji: member?.emoji || "👤",
              assigneeColor: member ? getMemberColor(member.role) : "slate",
              due: t.dueDate || "No date",
              points: t.points || 10
            };
          }),
          schedules: schedules.slice(0, 5),
          meals: meals.slice(0, 7),
          stats: {
            eventsCount: events.filter(e => e.date === new Date().toISOString().split('T')[0]).length,
            tasksCount: tasks.length
          }
        });
      } catch(e) {
        console.error("Failed to fetch home data:", e);
        setData({
          members: [],
          events: [],
          tasks: [],
          schedules: [],
          meals: [],
          stats: { eventsCount: 0, tasksCount: 0 }
        });
      }
    };

    fetchData();

    // Realtime subscriptions
    const collections = ['members', 'events', 'tasks', 'schedules', 'meals'];
    collections.forEach(col => {
      pb.collection(col).subscribe('*', () => {
        fetchData();
      });
    });

    return () => {
      collections.forEach(col => pb.collection(col).unsubscribe('*'));
    };
  }, []);

  if (!data) {
    return (
      <PageShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-nori-500/30 border-t-nori-500 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-400 animate-pulse">Syncing with Consuela...</p>
          </div>
        </div>
      </PageShell>
    );
  }

  const { 
    members: familyMembers, 
    events: todayEvents, 
    tasks: pendingTasks, 
    schedules: scheduleItems, 
    meals: mealPlanItems,
    stats 
  } = data;

  const mealPlan = mealPlanItems.map((m: any) => ({
    day: new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    meal: m.name,
    emoji: m.emoji || "🍽️"
  }));

  const quickPrompts = [
    "What's for dinner?",
    "Add event",
    "Plan this week",
    "Grocery list",
  ];

  const today = new Date();
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "short" });
  const dayMonth = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const todayShort = today.toLocaleDateString("en-US", { weekday: "short" });
  const todayMealIndex = mealPlan.findIndex((m: any) => m.day === todayShort);

  const eventBorderColor: Record<string, string> = {
    green: "!border-l-nori-500",
    violet: "!border-l-accent-violet",
    amber: "!border-l-amber-500",
    cyan: "!border-l-cyan-500",
    rose: "!border-l-accent-rose",
    blue: "!border-l-blue-500",
  };

  const taskPointBorder = (points: number): string => {
    if (points > 15) return "border-l-2 border-l-accent-rose/60 bg-accent-rose/5";
    if (points > 10) return "border-l-2 border-l-accent-amber/60 bg-accent-amber/5";
    return "border-l-2 border-l-surface-4";
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

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

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10"
      >
        {/* Header */}
        <div
          className="px-4 pt-12 pb-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
        >
          {/* Family row */}
          <motion.div variants={item} className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              {familyMembers.map((m: any) => (
                <motion.div
                  key={m.name}
                  whileHover={{ y: -5, scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Avatar name={m.name} color={m.color} emoji={m.emoji} size="md" variant="emoji" />
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Date pill */}
          <motion.div variants={item} className="flex items-center gap-2 mb-4 animate-in">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-subtle border border-white/5">
              <span className="text-xs text-text-secondary font-medium">{dayOfWeek}</span>
              <span className="text-xs text-accent-lavender font-semibold">{dayMonth}</span>
            </div>
          </motion.div>

          {/* Greeting with gradient text */}
          <motion.div variants={item} className="mb-4">
            <h1 className="text-2xl font-bold text-text-primary mt-0.5">
              {greeting}, <span className="gradient-text">Garcia family</span> 👋
            </h1>
          </motion.div>

          {/* Quick summary pills with glass effect */}
          <motion.div variants={item} className="flex gap-2 flex-wrap mt-3">
            <Link href="/calendar">
              <Badge variant="green" glass>{stats.eventsCount} events today</Badge>
            </Link>
            <Link href="/tasks">
              <Badge variant="amber" glass>{stats.tasksCount} tasks pending</Badge>
            </Link>
            {mealPlan[todayMealIndex] && (
              <Link href="/meals">
                <Badge variant="violet" glass>{mealPlan[todayMealIndex].meal} {mealPlan[todayMealIndex].emoji}</Badge>
              </Link>
            )}
          </motion.div>
        </div>

        {/* Weather Widget */}
        <motion.div variants={item} className="px-4 pb-2">
          <WeatherWidget />
        </motion.div>

        {/* Divider */}
        <motion.div variants={item} className="px-4 mb-2">
           <div className="h-px bg-white/5"></div>
        </motion.div>

        <div className="px-4 space-y-5 relative z-10">
          {/* AI Quick Ask - Enhanced glass card */}
          <motion.div variants={item}>
            <Link href="/chat">
              <div className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all isometric-card glass-subtle border border-white/10">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-nori-500/30 to-accent-cyan/20 flex items-center justify-center text-2xl shrink-0 floating">
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
                  className="w-5 h-5 text-nori-400 shrink-0"
                >
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </Link>
          </motion.div>

          {/* Quick prompts */}
          <motion.div variants={item} className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar scroll-smooth-x">
            {quickPrompts.map((p, idx) => (
              <Link
                key={p}
                href={`/chat?q=${encodeURIComponent(p)}`}
                className="scroll-snap-child shrink-0 px-3 py-1.5 rounded-full glass text-text-secondary text-xs border border-white/10 hover:border-nori-500/30 hover:text-nori-400 transition-all duration-200"
              >
                {p}
              </Link>
            ))}
          </motion.div>

          {/* Today's Events */}
          <motion.section variants={item}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-text-primary font-semibold text-base">Today</h2>
              <Link href="/calendar" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                View all →
              </Link>
            </div>
            <div className="space-y-2">
              {todayEvents.map((ev: any) => (
                <Card
                  key={ev.id}
                  className={`!p-3 isometric-card ${eventBorderColor[ev.color] ?? "!border-l-surface-4"}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{
                        background:
                          ev.color === "green"
                            ? "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(187,247,208,0.1))"
                            : ev.color === "violet"
                            ? "linear-gradient(135deg, rgba(124,111,247,0.2), rgba(221,214,254,0.1))"
                            : ev.color === "amber"
                            ? "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(253,230,138,0.1))"
                            : ev.color === "cyan"
                            ? "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(207,250,254,0.1))"
                            : ev.color === "rose"
                            ? "linear-gradient(135deg, rgba(244,63,94,0.2), rgba(255,228,230,0.1))"
                            : "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(219,234,254,0.1))",
                      }}
                    >
                      {ev.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">{ev.title}</p>
                      <p className="text-text-muted text-xs mt-0.5">{ev.time}</p>
                    </div>
                    <Avatar name={ev.member} color={ev.color} size="sm" emoji={ev.emoji} variant="emoji" />
                  </div>
                </Card>
              ))}
              {todayEvents.length === 0 && (
                <p className="text-center text-text-muted text-xs py-4 glass-subtle rounded-2xl border border-white/5">
                  No events for today. Enjoy your day!
                </p>
              )}
            </div>
          </motion.section>

          {/* Schedule Display */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-text-primary font-semibold text-base">Daily Schedule</h2>
              <Link href="/calendar" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                Edit →
              </Link>
            </div>
            <ScheduleDisplay 
              schedule={scheduleItems.map((item: any) => ({
                id: item.id,
                title: item.title,
                time: item.time,
                emoji: item.emoji,
                type: item.type as "routine" | "reminder",
                color: item.color,
                member: item.member,
                memberColor: item.memberColor,
              }))} 
              title="" 
            />
          </motion.div>

          {/* Meal This Week */}
          <motion.section variants={item}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-text-primary font-semibold text-base">This Week&apos;s Meals</h2>
              <Link href="/meals" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                Plan →
              </Link>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scroll-smooth-x no-scrollbar">
              {mealPlan.map((m: any, i: number) => {
                const isToday = i === todayMealIndex;
                return (
                  <div
                    key={m.day}
                    className={`scroll-snap-child shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[80px] transition-all duration-200 ${
                      isToday
                        ? "border-2 border-nori-500/40 accent-glow glass-subtle"
                        : "glass hover:border-white/8 hover:bg-surface-2/60"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide ${
                        isToday ? "text-nori-400" : "text-text-secondary/80"
                      }`}
                    >
                      {m.day}
                    </span>
                    {isToday && (
                      <span className="bg-nori-500/20 text-nori-400 text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                        TODAY
                      </span>
                    )}
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-[10px] text-text-muted text-center leading-tight truncate w-full font-bold">
                      {m.meal}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.section>

          {/* Tasks */}
          <motion.section variants={item}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-text-primary font-semibold text-base">Tasks</h2>
              <Link href="/tasks" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                View all →
              </Link>
            </div>
            <Card className="isometric-card !p-4">
              <div className="space-y-4">
                {pendingTasks.map((task: any) => (
                  <div key={task.id} className={`flex items-center gap-3 ${taskPointBorder(task.points)} rounded-lg pl-3 pr-2 py-2 -mx-3`}>
                    <div className="w-10 h-10 rounded-xl bg-surface-3 border border-white/5 flex items-center justify-center text-xl shrink-0 shadow-inner group-hover:scale-110 transition-transform">
                      {task.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          task.done ? "line-through text-text-muted" : "text-text-primary"
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                        {task.assigned} · {task.due}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-amber-400 font-bold">
                        +{task.points}
                      </span>
                      <Avatar 
                        name={task.assigned} 
                        emoji={task.assigneeEmoji} 
                        color={task.assigneeColor} 
                        size="sm" 
                        variant="emoji" 
                      />
                    </div>
                  </div>
                ))}
                {pendingTasks.length === 0 && (
                  <p className="text-center text-text-muted text-xs py-4">
                    All tasks completed! Great job.
                  </p>
                )}
              </div>
            </Card>
          </motion.section>
        </div>
      </motion.div>
    </PageShell>
  );
}
