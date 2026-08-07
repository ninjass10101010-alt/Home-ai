/**
 * KidHome — The "Personal Adventure"
 *
 * Fun, colorful, gamified dashboard for kids.
 *
 * Features:
 *   - Hero avatar (large, animated, center-stage)
 *   - Level bar with XP progress + level-up celebrations
 *   - Tasks as "Quests" with tap-to-complete + confetti
 *   - Positive leaderboard framing ("YOU'RE #1!")
 *   - Bedtime mode (no quests, sweet dreams)
 *   - Weekend mode (bonus quests)
 *   - Spring-bounce easing on all interactions
 */
"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import EmergencyButton from "@/components/ui/EmergencyButton";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Link from "next/link";
import { db } from "@/db";
import { useRouter } from "next/navigation";
import QuestCard from "./QuestCard";
import LevelBar from "./LevelBar";
import CelebrationBurst from "./CelebrationBurst";
import SpotifyWidget from "@/components/integrations/SpotifyWidget";
import AllowanceWidget from "@/components/integrations/AllowanceWidget";
import LearningWidget from "@/components/integrations/LearningWidget";

const FogBackground = dynamic(() => import("@/components/ui/FogBackground"), { ssr: false });

const avatarSizes = new Set<AvatarSize>(["xs", "sm", "md", "base", "lg"]);
function normalizeAvatarSize(size?: string) {
  return avatarSizes.has(size as AvatarSize) ? (size as AvatarSize) : "md";
}

// ─── Kid Leaderboard (positive framing) ─────────────────────────────────────

function KidLeaderboard({ members }: { members: any[] }) {
  const { currentUser } = useAuth();
  const myFirstName = currentUser?.name?.split(" ")[0] || "";

  const sorted = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
  const myRank = sorted.findIndex((m) => m.name?.split(" ")[0] === myFirstName) + 1;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Surface variant="warm" radius="2xl" padding="none" aria-live="polite" aria-label="Family leaderboard">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h3 className="text-base font-bold text-text-primary">🏆 Leaderboard</h3>
        <span className="text-[10px] font-semibold text-text-muted">This week</span>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {sorted.slice(0, 5).map((member, i) => {
          const isMe = member.name?.split(" ")[0] === myFirstName;
          return (
            <div
              key={member.name}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all"
              style={{
                background: isMe
                  ? "linear-gradient(135deg, rgba(var(--color-accent-selected-rgb, 59,130,246), 0.18), rgba(255,255,255,0.06))"
                  : "rgba(255,255,255,0.04)",
                border: isMe
                  ? "2px solid var(--color-accent-selected)"
                  : "1px solid rgba(255,255,255,0.06)",
                boxShadow: isMe ? "0 0 20px rgba(var(--color-accent-selected-rgb, 59,130,246), 0.12)" : "none",
              }}
            >
              <span className="text-lg shrink-0 w-7 text-center">
                {i < 3 ? medals[i] : `${i + 1}`}
              </span>
              <Avatar
                name={member.name}
                color={member.color || "green"}
                emoji={member.emoji || "😊"}
                size="sm"
                variant="emoji"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-text-primary truncate">
                  {member.name?.split(" ")[0]}
                </span>
                {isMe && (
                  <span
                    className="ml-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md inline-block align-middle"
                    style={{ background: "var(--color-accent-selected)", color: "white" }}
                  >
                    You!
                  </span>
                )}
                {member.streak > 0 && (
                  <span className="ml-1 text-xs text-amber-400">🔥{member.streak}d</span>
                )}
              </div>
              <span className="text-sm font-bold text-text-primary tabular-nums">
                {member.points || 0}
              </span>
              <span className="text-[10px] text-text-muted">pts</span>
            </div>
          );
        })}

        {/* Positive reinforcement */}
        <div className="pt-2 text-center">
          {myRank === 1 ? (
            <p className="text-sm font-bold text-amber-400">🎉 You&apos;re in the lead! Keep it up!</p>
          ) : myRank === 2 ? (
            <p className="text-xs text-text-secondary">
              So close! <span className="text-[var(--color-accent-selected)] font-semibold">You can take #1!</span>
            </p>
          ) : myRank > 0 ? (
            <p className="text-xs text-text-secondary">
              You&apos;re #{myRank} — <span className="text-[var(--color-accent-selected)] font-semibold">you can do it!</span>
            </p>
          ) : (
            <p className="text-xs text-text-muted">Complete quests to climb the ranks!</p>
          )}
        </div>
      </div>
    </Surface>
  );
}

// ─── Bedtime View ───────────────────────────────────────────────────────────

function BedtimeView({ firstName, points, level, tomorrowEvents }: {
  firstName: string;
  points: number;
  level: number;
  tomorrowEvents: any[];
}) {
  return (
    <div className="px-4 space-y-5 relative z-10 pb-8">
      {/* Good night message */}
      <Surface variant="warm" radius="2xl" padding="lg">
        <div className="text-center py-2">
          <span className="text-5xl block mb-3">🌙</span>
          <h2 className="text-xl font-bold text-text-primary">
            Great job today, {firstName}!
          </h2>
          <p className="text-sm text-text-secondary mt-2">
            You earned <span className="font-bold text-amber-400">{points} points</span> today!
          </p>
          <div className="mt-3 max-w-xs mx-auto">
            <LevelBar points={points} />
          </div>
          <p className="text-sm text-text-secondary mt-4">
            Sweet dreams! See you tomorrow 💤
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 text-2xl">
            <span className="floating" style={{ animationDelay: "0s" }}>🌟</span>
            <span className="floating" style={{ animationDelay: "0.5s" }}>⭐</span>
            <span className="floating" style={{ animationDelay: "1s" }}>✨</span>
            <span className="floating" style={{ animationDelay: "1.5s" }}>💤</span>
          </div>
        </div>
      </Surface>

      {/* Bedtime Music — auto-plays lullabies via Spotify */}
      <div className="mt-4">
        <SpotifyWidget />
      </div>

      {/* Tomorrow preview */}
      {tomorrowEvents.length > 0 && (
        <div>
          <h3 className="text-base font-bold text-text-primary mb-3">📋 Tomorrow</h3>
          <Surface variant="warm" radius="2xl" padding="none">
            <div className="p-4 space-y-2">
              {tomorrowEvents.slice(0, 4).map((event) => (
                <div key={event.id} className="flex items-center gap-3 py-1">
                  <span className="text-xl">{event.icon || "📅"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{event.title}</p>
                    <p className="text-[11px] text-text-secondary">{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      )}

      {/* Leaderboard (read-only at bedtime) */}
      <div className="opacity-60">
        <p className="text-xs text-text-muted text-center mb-2">🏆 You&apos;ll still be awesome tomorrow</p>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function KidHome() {
  const [mounted, setMounted] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [completedToday, setCompletedToday] = useState<any[]>([]);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [points, setPoints] = useState(0);
  const [tonightMeal, setTonightMeal] = useState<any>(null);
  const [celebration, setCelebration] = useState<{ points: number; leveledUp: boolean; newLevel: number } | null>(null);

  const { currentUser } = useAuth();
  const { isBedtime, isWeekend } = useDashboardMode();
  const router = useRouter();

  const POINTS_PER_LEVEL = 50;

  useEffect(() => {
    setMounted(true);
    try {
      const allTasks = db.selectPendingTasks();
      setPendingTasks(allTasks.filter((t: any) => !t.completed));
      setCompletedToday(allTasks.filter((t: any) => t.completed));
      setTodayEvents(db.selectTodaysEvents());

      // Load tonight's dinner for the fun widget
      const allMeals = db.selectMeals();
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const todayName = dayNames[new Date().getDay()];
      const dinner = allMeals.find((m: any) => m.time === todayName && m.mealType === "dinner") || allMeals.find((m: any) => m.mealType === "dinner");
      if (dinner) setTonightMeal(dinner);

      const memberList = db.selectMembersDetailed().map((m: any) => ({
        name: m.name,
        color: m.color || "green",
        emoji: m.emoji,
        points: typeof window !== "undefined"
          ? parseInt(localStorage.getItem(`consuela-points-${m.name}`) || "0")
          : 0,
        streak: typeof window !== "undefined"
          ? parseInt(localStorage.getItem(`consuela-streak-${m.name}`) || "0")
          : 0,
      }));
      setMembers(memberList);

      // Load my points
      if (currentUser) {
        const myPoints = typeof window !== "undefined"
          ? parseInt(localStorage.getItem(`consuela-points-${currentUser.name}`) || "0")
          : 0;
        setPoints(myPoints);
      }
    } catch {}
  }, [currentUser]);

  const user = currentUser;
  const firstName = user?.name?.split(" ")[0] || "Buddy";
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1;
  const streak = typeof window !== "undefined"
    ? parseInt(localStorage.getItem(`consuela-streak-${user?.name}`) || "0")
    : 0;

  // Quest completion handler
  const handleQuestComplete = useCallback((task: any) => {
    if (!user) return;

    const key = `consuela-points-${user.name}`;
    const currentPoints = parseInt(localStorage.getItem(key) || "0");
    const earnedPoints = task.points || 10;
    const newTotal = currentPoints + earnedPoints;

    // Save
    localStorage.setItem(key, String(newTotal));
    setPoints(newTotal);

    // Check level up
    const oldLevel = Math.floor(currentPoints / POINTS_PER_LEVEL) + 1;
    const newLevel = Math.floor(newTotal / POINTS_PER_LEVEL) + 1;
    const leveledUp = newLevel > oldLevel;

    // Trigger celebration
    setCelebration({ points: earnedPoints, leveledUp, newLevel: leveledUp ? newLevel : 0 });
    setTimeout(() => setCelebration(null), 1500);

    // Update streak
    const streakKey = `consuela-streak-${user.name}`;
    const currentStreak = parseInt(localStorage.getItem(streakKey) || "0");
    localStorage.setItem(streakKey, String(currentStreak + 1));
  }, [user]);

  // Greeting based on mode
  const greeting = isBedtime
    ? `🌙 Great job today, ${firstName}!`
    : isWeekend
      ? `🏖️ Weekend Adventure, ${firstName}!`
      : `Hey ${firstName}! 👋`;

  const subtitle = isBedtime
    ? "Sweet dreams! See you tomorrow 💤"
    : isWeekend
      ? "Bonus quests available today! 🎉"
      : `You have ${pendingTasks.length} quest${pendingTasks.length !== 1 ? "s" : ""} today!`;

  // ── BEDTIME MODE ──
  if (isBedtime) {
    return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: "transparent" }}>
          {/* Hero (bedtime) */}
          <div className="relative z-10 px-4 pt-8 pb-2 flex flex-col items-center text-center">
            <div className="avatar-hero mb-3">
              <Avatar
                name={user?.name || "Buddy"}
                color={user?.color || "green"}
                emoji={user?.emoji || "😊"}
                size="lg"
                variant="emoji"
                glow
              />
            </div>
            <h1 className="text-xl font-bold text-text-primary">{greeting}</h1>
          </div>

          <BedtimeView
            firstName={firstName}
            points={points}
            level={level}
            tomorrowEvents={todayEvents}
          />
        </PageShell>
      </AtmosphericProvider>
    );
  }

  // ── NORMAL / WEEKEND MODE ──
  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: "transparent" }}>
        <EmergencyButton />

        {/* Celebration overlay */}
        {celebration && (
          <CelebrationBurst
            points={celebration.points}
            leveledUp={celebration.leveledUp}
            newLevel={celebration.newLevel}
            onComplete={() => setCelebration(null)}
          />
        )}

        {/* ── Hero Section ── */}
        <div className="relative z-10 px-4 pt-8 pb-4 flex flex-col items-center text-center">
          {/* Big animated avatar */}
          <div className="avatar-hero mb-3">
            <Avatar
              name={user?.name || "Buddy"}
              color={user?.color || "green"}
              emoji={user?.emoji || "😊"}
              size="lg"
              variant="emoji"
              glow
            />
          </div>

          {/* Greeting */}
          <h1 className="text-xl font-bold text-text-primary">{greeting}</h1>
          <p className="text-sm text-text-secondary mt-1">{subtitle}</p>

          {/* Level bar */}
          <div className="w-full max-w-xs mt-4">
            <LevelBar points={points} pointsPerLevel={POINTS_PER_LEVEL} />
          </div>

          {/* Streak */}
          {streak > 0 && (
            <div className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
              <span className="text-lg">🔥</span>
              <span className="text-sm font-bold text-amber-400 tabular-nums">{streak}-day streak!</span>
            </div>
          )}

          {/* Weekend badge */}
          {isWeekend && (
            <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full weekend-badge" style={{ background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.15)" }}>
              <span className="text-sm">🏖️</span>
              <span className="text-xs font-bold text-amber-400">Weekend Bonus Quests!</span>
            </div>
          )}

          {/* Profile hint */}
          <p className="mt-3 text-[10px] text-text-muted">
            Tap the ⚙️ in settings to switch profiles
          </p>
        </div>

        {/* ── Content ── */}
        <div className="px-4 space-y-5 relative z-10 pb-8">
          {/* Weekend Bonus Quests */}
          {isWeekend && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-text-primary">🏖️ Weekend Bonus!</h2>
                <span className="text-[10px] font-bold text-amber-400">Double points today!</span>
              </div>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0"
                      style={{
                        background: "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.1))",
                        border: "1px solid rgba(251, 191, 36, 0.25)",
                      }}
                    >
                      🌟
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-text-primary">Weekend Challenge</h3>
                      <p className="text-[11px] text-text-secondary">Do something fun with the family!</p>
                    </div>
                    <div
                      className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-2xl"
                      style={{
                        background: "linear-gradient(135deg, rgba(251, 191, 36, 0.15), transparent)",
                        border: "1px solid rgba(251, 191, 36, 0.2)",
                      }}
                    >
                      <span className="text-lg font-black tabular-nums text-amber-400">+25</span>
                      <span className="text-[9px] text-text-muted font-bold -mt-0.5">pts</span>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted text-center">
                    Ask a parent to approve your weekend adventure!
                  </p>
                </div>
              </Surface>
            </div>
          )}

          {/* Quests */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-text-primary">
                🎯 Your Quests
              </h2>
              <Link href="/tasks" className="text-[10px] font-semibold text-[var(--color-accent-selected)]">
                View all →
              </Link>
            </div>

            {pendingTasks.length === 0 ? (
              <Surface variant="warm" radius="2xl" padding="lg">
                <div className="text-center py-4">
                  <span className="text-4xl mb-3 block">🎉</span>
                  <h3 className="text-base font-bold text-text-primary">All quests complete!</h3>
                  <p className="text-sm text-text-secondary mt-1">You&apos;re a superstar! Check back later for new ones.</p>
                </div>
              </Surface>
            ) : (
              <div className="space-y-2.5">
                {pendingTasks.map((task) => (
                  <QuestCard key={task.id} task={task} onComplete={handleQuestComplete} />
                ))}
              </div>
            )}
          </div>

          {/* Completed today */}
          {completedToday.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-text-muted mb-2">
                ✅ Done today ({completedToday.length})
              </h2>
              <div className="space-y-1.5">
                {completedToday.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl opacity-50"
                    style={{
                      background: "rgba(74, 222, 128, 0.05)",
                      border: "1px solid rgba(74, 222, 128, 0.1)",
                    }}
                  >
                    <span className="text-sm">✅</span>
                    <span className="text-xs text-text-muted line-through flex-1">{task.title}</span>
                    <span className="text-[10px] font-bold text-emerald-400">+{task.points}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What's Happening */}
          {todayEvents.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-text-primary mb-3">🎪 What&apos;s Happening</h2>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-4 space-y-2">
                  {todayEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 py-1.5">
                      <span className="text-xl">{event.icon || "📅"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary">{event.title}</p>
                        <p className="text-[11px] text-text-secondary">{event.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Surface>
            </div>
          )}

          {/* Tonight's Dinner */}
          {tonightMeal && (
            <div>
              <h2 className="text-base font-bold text-text-primary mb-3">🍽️ Tonight&apos;s Dinner</h2>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-5 text-center">
                  <span className="text-5xl block mb-2">{tonightMeal.emoji || "🍽️"}</span>
                  <h3 className="text-lg font-bold text-text-primary">{tonightMeal.name}</h3>
                  {tonightMeal.prepTime && (
                    <p className="text-xs text-text-secondary mt-1">Ready in {tonightMeal.prepTime} ⏱️</p>
                  )}
                  {tonightMeal.tags && tonightMeal.tags.length > 0 && (
                    <div className="flex justify-center gap-1.5 mt-2">
                      {tonightMeal.tags.map((tag: string) => (
                        <span key={tag} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-secondary)" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Surface>
            </div>
          )}

          {/* Leaderboard */}
          <KidLeaderboard members={members} />

          {/* Spotify Music Widget */}
          <SpotifyWidget />

          {/* Learning Goals */}
          <LearningWidget />

          {/* Allowance — Convert points to cash */}
          <AllowanceWidget />

          {/* Action buttons */}
          <div className="flex gap-3">
            <Link href="/chat" className="flex-1">
              <SoftButton variant="secondary" className="w-full text-base py-4">
                💬 Ask Consuela
              </SoftButton>
            </Link>
            <Link href="/rewards" className="flex-1">
              <SoftButton variant="secondary" className="w-full text-base py-4">
                🏪 Reward Shop
              </SoftButton>
            </Link>
          </div>
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}
