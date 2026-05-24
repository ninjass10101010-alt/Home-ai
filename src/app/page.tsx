import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import AnimatedEmoji from "@/components/ui/AnimatedEmoji";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { Icon3D } from "@/components/3d";
import EmergencyButton from "@/components/ui/EmergencyButton";
import ScheduleDisplay from "@/components/ui/ScheduleDisplay";
import { useTheme } from "@/hooks/useTheme";
import { db } from "@/db";

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

  // Meal highlight by actual day
  const dayToMealIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4 };
  const todayShort = today.toLocaleDateString("en-US", { weekday: "short" });
  const todayMealIndex = dayToMealIndex[todayShort] ?? 0;

  // Event color → border color mapping (using CSS variables for theme compliance)
  const eventBorderColor: Record<string, string> = {
    green: "!border-l-[var(--color-accent-mint)]",
    violet: "!border-l-[var(--color-accent-violet)]",
    amber: "!border-l-[var(--color-accent-amber)]",
    cyan: "!border-l-[var(--color-accent-cyan)]",
    rose: "!border-l-[var(--color-accent-rose)]",
    blue: "!border-l-[var(--color-accent-nori)]",
  };

  // Task point → accent mapping (theme-aware)
  const taskPointBorder = (points: number): string => {
    if (points > 15) return "border-l-2 border-l-[var(--color-accent-rose)]/60 bg-[var(--color-accent-rose)]/5";
    if (points > 10) return "border-l-2 border-l-[var(--color-accent-amber)]/60 bg-[var(--color-accent-amber)]/5";
    return "border-l-2 border-l-[var(--color-surface-4)]";
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

      {/* Weather Widget */}
      <div className="px-4 pb-2 relative z-10">
        <WeatherWidget />
      </div>

      {/* Divider */}
      <div className="px-4 mb-2 relative z-10">
        <div className="h-px bg-white/5"></div>
      </div>

      <div className="px-4 space-y-5 relative z-10">
        {/* AI Quick Ask - Enhanced glass card */}
        <Link href="/chat">
          <div className="rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all isometric-card glass-strong">
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

        {/* Quick prompts */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scroll-smooth-x no-scrollbar">
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

        {/* Today's Events */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">Today</h2>
            <Link href="/calendar" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {todayEvents.map((ev) => (
              <Card
                key={ev.id}
                className={`!p-3 isometric-card ${eventBorderColor[ev.color] ?? "!border-l-surface-4"}`}
              >
                <div className="flex items-center gap-3">
                   <div
                     className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                       ev.color === "green" ? "bg-[linear-gradient(135deg,var(--color-accent-mint)/20,var(--color-accent-mint)/10)]" :
                       ev.color === "violet" ? "bg-[linear-gradient(135deg,var(--color-accent-violet)/20,var(--color-accent-violet)/10)]" :
                       ev.color === "amber" ? "bg-[linear-gradient(135deg,var(--color-accent-amber)/20,var(--color-accent-amber)/10)]" :
                       ev.color === "cyan" ? "bg-[linear-gradient(135deg,var(--color-accent-cyan)/20,var(--color-accent-cyan)/10)]" :
                       ev.color === "rose" ? "bg-[linear-gradient(135deg,var(--color-accent-rose)/20,var(--color-accent-rose)/10)]" :
                       "bg-[linear-gradient(135deg,var(--color-accent-nori)/20,var(--color-accent-nori)/10)]"
                     }`}
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
        </section>

        {/* Schedule Display */}
        <ScheduleDisplay
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

        {/* Meal This Week */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">This Week&apos;s Meals</h2>
            <Link href="/meals" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
              Plan →
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scroll-smooth-x no-scrollbar">
            {mealPlan.map((m, i) => {
              const isToday = i === todayMealIndex;
              return (
                <div
                  key={m.day}
                  className={`scroll-snap-child shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-all duration-200 ${
                    isToday
                      ? "border-2 border-[var(--color-accent-selected)]/40 accent-glow glass-subtle"
                      : "glass hover:border-[var(--color-surface-7)]/20 hover:bg-[var(--color-surface-2)]/60"
                  }`}
                >
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      isToday ? "text-[var(--color-accent-selected)]" : "text-text-secondary/80"
                    }`}
                  >
                    {m.day}
                  </span>
                  {isToday && (
                    <span className="bg-[var(--color-accent-selected)]/20 text-[var(--color-accent-selected)] text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                      TODAY
                    </span>
                  )}
                  <AnimatedEmoji emoji={m.emoji} size="sm" />
                  <span className="text-[10px] text-text-muted text-center leading-tight">{m.meal}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Tasks */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">Tasks</h2>
            <Link href="/tasks" className="text-[var(--color-accent-selected)] text-xs font-medium hover:opacity-80">
              View all →
            </Link>
          </div>
          <Card className="isometric-card">
            <div className="space-y-3">
              {pendingTasks.map((task) => {
                const pts = task.points;
                const isHigh = pts > 15;
                return (
                  <div key={task.id} className={`flex items-center gap-3 ${taskPointBorder(pts)} rounded-lg pl-3 pr-2 py-2 -mx-3`}>
                    <div
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                        task.done
                          ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)] ring-2 ring-[var(--color-accent-selected)]/30"
                          : "border-[var(--color-surface-4)]"
                      }`}
                    >
                      {task.done && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm truncate ${
                          task.done ? "line-through text-text-muted" : "text-text-primary"
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-xs text-text-muted">
                        {task.assigned} · {task.due}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isHigh && (
                        <span className="text-[9px] text-[var(--color-accent-rose)] font-bold uppercase tracking-wide">high</span>
                      )}
                      <span className={`text-xs font-medium shrink-0 ${isHigh ? "text-[var(--color-accent-rose)]" : "text-[var(--color-accent-amber)]"}`}>
                        +{task.points}pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>

      </div>
    </PageShell>
  );
}
