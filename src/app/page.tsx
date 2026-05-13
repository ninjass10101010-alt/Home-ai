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

import { getHomeData } from "@/actions/home";

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

    getHomeData().then(setData);
  }, []);

  if (!data) return null; // Or a loading skeleton

  const { members: familyMembers, events: todayEvents, tasks: pendingTasks, schedules: scheduleItems } = data;

  const mealPlan = [
    { day: "Mon", meal: "Pasta Primavera", emoji: "🍝" },
    { day: "Tue", meal: "Taco Night", emoji: "🌮" },
    { day: "Wed", meal: "Grilled Chicken", emoji: "🍗" },
    { day: "Thu", meal: "Stir Fry", emoji: "🥢" },
    { day: "Fri", meal: "Pizza Night", emoji: "🍕" },
  ];

  const quickPrompts = [
    "What's for dinner?",
    "Add event",
    "Plan this week",
    "Grocery list",
  ];

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

          {/* Greeting with gradient text */}
          <motion.div variants={item} className="mb-4">
            <p className="text-text-secondary text-sm">
              {dateInfo.dayName}, {dateInfo.dateStr}
            </p>
            <h1 className="text-2xl font-bold text-text-primary mt-0.5">
              {greeting}, <span className="gradient-text">Garcia family</span> 👋
            </h1>
          </motion.div>

          {/* Quick summary pills with glass effect */}
          <motion.div variants={item} className="flex gap-2 flex-wrap mt-3">
            <Badge variant="green" glass>3 events today</Badge>
            <Badge variant="amber" glass>2 tasks pending</Badge>
            <Badge variant="violet" glass>Taco night 🌮</Badge>
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
              <Card 
                glow 
                className="flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-2xl shrink-0 border border-white/10 shadow-inner">
                  <Icon3D variant="chat" size="md" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium">Ask Consuela anything…</p>
                  <p className="text-text-secondary text-xs mt-0.5 truncate">
                    &ldquo;Add Jake&apos;s dentist on Thursday at 2pm&rdquo;
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
              </Card>
            </Link>
          </motion.div>

          {/* Quick prompts */}
          <motion.div variants={item} className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {quickPrompts.map((p) => (
              <Link
                key={p}
                href={`/chat?q=${encodeURIComponent(p)}`}
                className="shrink-0 px-3 py-1.5 rounded-full glass text-text-secondary text-xs border border-white/10 hover:border-nori-500/30 hover:text-nori-400 transition-all active:scale-95"
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
                <Card key={ev.id} className="!p-3 hover:border-white/20 transition-all cursor-pointer">
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
            </div>
          </motion.section>

          {/* Schedule Display */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-text-primary font-semibold text-base">Daily Schedule</h2>
              <Link href="/schedules" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                Edit →
              </Link>
            </div>
            <ScheduleDisplay schedule={scheduleItems} title="" />
          </motion.div>

          {/* Meal This Week - Unified premium card */}
          <motion.section variants={item}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-text-primary font-semibold text-base">This Week&apos;s Meals</h2>
              <Link href="/meals" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                Plan →
              </Link>
            </div>
            <Card className="!p-4 overflow-hidden">
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {mealPlan.map((m, i) => {
                  const isToday = i === 1;
                  const bgStyle = isToday
                    ? "linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(167, 139, 250, 0.1))"
                    : "";
                  return (
                    <div
                      key={m.day}
                      className={`shrink-0 flex flex-col items-center gap-2 rounded-2xl px-4 py-3 min-w-[90px] border transition-all ${
                        isToday 
                          ? "border-nori-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]" 
                          : "border-white/5 bg-white/5"
                      }`}
                      style={isToday ? { background: bgStyle } : undefined}
                    >
                      <span className={`text-xs font-bold ${isToday ? "text-nori-400" : "text-text-secondary"}`}>
                        {m.day}
                      </span>
                      <span className="text-3xl">{m.emoji}</span>
                      <span className="text-[10px] text-text-primary text-center leading-tight font-bold">
                        {m.meal}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.section>

          {/* Tasks */}
          <motion.section variants={item}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-text-primary font-semibold text-base">Tasks</h2>
              <Link href="/tasks" className="text-nori-400 text-xs font-medium hover:text-nori-300">
                View all →
              </Link>
            </div>
            <Card>
              <div className="space-y-4">
                {pendingTasks.map((task: any) => (
                  <div key={task.id} className="flex items-center gap-3 group">
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
              </div>
            </Card>
          </motion.section>
        </div>
      </motion.div>
    </PageShell>
  );
}
