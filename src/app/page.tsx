import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";

const familyMembers = [
  { name: "Mom", color: "green", emoji: "👩" },
  { name: "Dad", color: "cyan", emoji: "👨" },
  { name: "Jake", color: "violet", emoji: "🧒" },
  { name: "Lily", color: "amber", emoji: "👧" },
];

const todayEvents = [
  {
    id: 1,
    title: "Soccer Practice",
    time: "4:00 PM",
    member: "Jake",
    color: "violet",
    icon: "⚽",
  },
  {
    id: 2,
    title: "Dentist — Lily",
    time: "5:30 PM",
    member: "Lily",
    color: "amber",
    icon: "🦷",
  },
  {
    id: 3,
    title: "Team dinner",
    time: "7:00 PM",
    member: "Dad",
    color: "cyan",
    icon: "🍽️",
  },
];

const pendingTasks = [
  { id: 1, title: "Take out trash", assigned: "Jake", due: "Today", points: 10, done: false },
  { id: 2, title: "Grocery run", assigned: "Mom", due: "Today", points: 20, done: false },
  { id: 3, title: "Clean bathroom", assigned: "Lily", due: "Tomorrow", points: 15, done: true },
];

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
  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <PageShell>
      {/* Background Gradient Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-orb w-72 h-72 -top-20 -right-20" style={{ background: "radial-gradient(circle, var(--color-accent-lavender), transparent)" }} />
        <div className="gradient-orb w-80 h-80 -bottom-20 -left-20" style={{ background: "radial-gradient(circle, var(--color-accent-coral), transparent)" }} />
        <div className="gradient-orb w-64 h-64 top-1/2 left-1/4" style={{ background: "radial-gradient(circle, var(--color-accent-mint), transparent)" }} />
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
              <Avatar key={m.name} name={m.name} color={m.color} emoji={m.emoji} size="md" />
            ))}
          </div>
          <Link
            href="/settings"
            className="w-9 h-9 flex items-center justify-center rounded-full glass text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
              <circle cx="12" cy="8" r="4" strokeLinecap="round" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
            </svg>
          </Link>
        </div>

        {/* Greeting with gradient text */}
        <div className="mb-4">
          <p className="text-text-secondary text-sm">
            {dayName}, {dateStr}
          </p>
          <h1 className="text-2xl font-bold text-text-primary mt-0.5">
            Good afternoon, <span className="gradient-text">Johnson family</span> 👋
          </h1>
        </div>

        {/* Quick summary pills with glass effect */}
        <div className="flex gap-2 flex-wrap mt-3">
          <Badge variant="green" glass>3 events today</Badge>
          <Badge variant="amber" glass>2 tasks pending</Badge>
          <Badge variant="violet" glass>Taco night 🌮</Badge>
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
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-nori-500/30 to-accent-cyan/20 flex items-center justify-center text-2xl shrink-0 floating">
              ✨
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm font-medium">Ask Nori anything…</p>
              <p className="text-text-muted text-xs mt-0.5 truncate">
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
          </div>
        </Link>

        {/* Quick prompts */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {quickPrompts.map((p) => (
            <Link
              key={p}
              href={`/chat?q=${encodeURIComponent(p)}`}
              className="shrink-0 px-3 py-1.5 rounded-full glass text-text-secondary text-xs border border-white/10 hover:border-nori-500/30 hover:text-nori-400 transition-all"
            >
              {p}
            </Link>
          ))}
        </div>

        {/* Today's Events */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">Today</h2>
            <Link href="/calendar" className="text-nori-400 text-xs font-medium hover:text-nori-300">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {todayEvents.map((ev) => (
              <Card key={ev.id} className="!p-3 isometric-card">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br from-${ev.color}-500/20 to-${ev.color}-600/10 flex items-center justify-center text-lg shrink-0`}>
                    {ev.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate">{ev.title}</p>
                    <p className="text-text-muted text-xs mt-0.5">{ev.time}</p>
                  </div>
                  <Avatar name={ev.member} color={ev.color} size="sm" />
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Meal This Week - Enhanced with gradient backgrounds */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">This Week&apos;s Meals</h2>
            <Link href="/meals" className="text-nori-400 text-xs font-medium hover:text-nori-300">
              Plan →
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            {mealPlan.map((m, i) => {
              const isToday = i === 1;
              return (
                <div
                  key={m.day}
                  className={`shrink-0 flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3 min-w-[72px] transition-all ${
                    isToday
                      ? "bg-gradient-to-br from-nori-500/20 to-accent-cyan/15 border border-nori-500/30"
                      : "glass"
                  }`}
                >
                  <span className="text-xs font-medium text-text-secondary">{m.day}</span>
                  <span className="text-2xl">{m.emoji}</span>
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
            <Link href="/tasks" className="text-nori-400 text-xs font-medium hover:text-nori-300">
              View all →
            </Link>
          </div>
          <Card className="isometric-card">
            <div className="space-y-3">
              {pendingTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                      task.done
                        ? "border-nori-500 bg-nori-500"
                        : "border-surface-4"
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
                  <span className="text-xs text-amber-400 font-medium shrink-0">
                    +{task.points}pts
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* Grocery Snapshot */}
        <section className="pb-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary font-semibold text-base">Grocery List</h2>
            <Link href="/grocery" className="text-nori-400 text-xs font-medium hover:text-nori-300">
              Open →
            </Link>
          </div>
          <Card className="!p-3 isometric-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-accent-rose/10 flex items-center justify-center text-xl shrink-0">
                🛒
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm font-medium">12 items needed</p>
                <p className="text-text-muted text-xs mt-0.5">
                  Chicken, pasta, tomatoes, +9 more
                </p>
              </div>
              <Badge variant="amber" glass>3 urgent</Badge>
            </div>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}