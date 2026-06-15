/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useState, useEffect, useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { Icon3D } from "@/components/3d";
import EmergencyButton from "@/components/ui/EmergencyButton";
import ScheduleDisplay from "@/components/ui/ScheduleDisplay";
import { db } from "@/db";
import CurrentMealWidget from "@/components/meals/CurrentMealWidget";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { FogProvider } from "@/hooks/useFogConfig";
import AtmosphericBridge from "@/components/ui/AtmosphericBridge";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import type { WidgetId } from "@/lib/layout-config";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import PinModal from "@/components/auth/PinModal";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import SectionCard from "@/components/patterns/SectionCard";
import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";

const FogBackground = dynamic(() => import("@/components/ui/FogBackground"), { ssr: false });

const avatarSizes = new Set<AvatarSize>(["xs", "sm", "md", "base", "lg"]);

function normalizeAvatarSize(size?: string) {
  return avatarSizes.has(size as AvatarSize) ? (size as AvatarSize) : "md";
}

function memberMatchesName(member: any, name: string) {
  const firstName = name.split(" ")[0];
  return (
    member.name === name ||
    member.name.startsWith(`${name} `) ||
    member.name.split(" ")[0] === name ||
    member.name === firstName ||
    firstName.startsWith(member.name)
  );
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [homeScheduleItems, setHomeScheduleItems] = useState<any[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<string>("morning");
  const [season, setSeason] = useState<{ name: string; emoji: string }>({ name: "Spring", emoji: "🌸" });
  const [dateInfo, setDateInfo] = useState<{ dayOfWeek: string; dayMonth: string }>({ dayOfWeek: "---", dayMonth: "---" });
  const [now, setNow] = useState<Date | null>(null);
  const [pinningMember, setPinningMember] = useState<{ name: string; emoji: string; color: string; avatarSize: AvatarSize; glow: boolean } | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const router = useRouter();
  const { currentUser, isLoggedIn, logout, sessionRemainingMs, sessionWarning, extendSession } = useAuth();
  const { widgets } = useHomeLayout();

  const sessionSecondsRemaining = Math.ceil(sessionRemainingMs / 1000);
  const showSessionPill = isLoggedIn && sessionRemainingMs < 30 * 60 * 1000 - 60 * 1000;
  const sessionPillMM = String(Math.floor(sessionSecondsRemaining / 60)).padStart(2, "0");
  const sessionPillSS = String(sessionSecondsRemaining % 60).padStart(2, "0");

  const dashboardCurrentUser = useMemo<AuthUser | null>(() => {
    if (!currentUser) return null;
    const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, currentUser.name));
    if (!member) return currentUser;

    return {
      ...currentUser,
      emoji: member.emoji || currentUser.emoji,
      color: member.color || currentUser.color,
      avatarSize: normalizeAvatarSize(member.avatarSize),
      glow: Boolean(member.glow),
    };
  }, [currentUser]);

  useEffect(() => {
    setMounted(true);
    setNow(new Date());

    try {
      const members = db.selectMembersDetailed().map((member: any, idx: number) => ({
        name: member.name,
        color: member.color || (idx % 4 === 0 ? "green" : idx % 4 === 1 ? "cyan" : idx % 4 === 2 ? "violet" : "amber"),
        emoji: member.emoji,
        avatarSize: normalizeAvatarSize(member.avatarSize),
        glow: member.glow || false,
      }));
      setFamilyMembers(members);
      setTodayEvents(db.selectTodaysEvents());
      const storedTasks = typeof window !== "undefined" ? localStorage.getItem("consuela-tasks") : null;
      if (storedTasks) {
        try {
          const parsed = JSON.parse(storedTasks);
          const pending = Array.isArray(parsed) ? parsed.filter((t: any) => !t.completed).slice(0, 3).map((t: any) => ({
            id: t.id, title: t.title, assigned: t.assignee, due: t.due,
            points: t.points, priority: t.priority, category: t.category,
          })) : [];
          setPendingTasks(pending);
        } catch {
          setPendingTasks(db.selectPendingTasks());
        }
      } else {
        setPendingTasks(db.selectPendingTasks());
      }

      const today = new Date();
      const hour = today.getHours();
      const tod = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
      setTimeOfDay(tod);

      const month = today.getMonth();
      const nextSeason = month >= 2 && month <= 4 ? { name: "Spring", emoji: "🌸" } : month >= 5 && month <= 7 ? { name: "Summer", emoji: "☀️" } : month >= 8 && month <= 10 ? { name: "Autumn", emoji: "🍂" } : { name: "Winter", emoji: "❄️" };
      setSeason(nextSeason);
      setDateInfo({
        dayOfWeek: today.toLocaleDateString("en-US", { weekday: "short" }),
        dayMonth: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });

      const stored = typeof window !== "undefined" ? localStorage.getItem("consuela-schedules") : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHomeScheduleItems(parsed.map((s: any) => ({
            id: s.id,
            title: s.title,
            time: s.time,
            emoji: s.icon,
            type: s.type,
            color: s.color || "green",
            member: s.member,
            memberColor: s.memberColor,
          })));
        }
      } else {
        setHomeScheduleItems(db.selectTodaysSchedules());
      }
    } catch (error) {
      setHomeError("Consuela could not load your family dashboard.");
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [mounted]);

  const timeStr = now ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "--:--";
  const familyName = isLoggedIn && dashboardCurrentUser ? dashboardCurrentUser.name.split(" ")[0] : "Garcia family";

  const weekDays = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() + index - today.getDay());
      const label = weekdayLabels[day.getDay()];
      const mealsForDay = db.selectMeals().filter((meal: any) => meal.time === label);
      return {
        id: label,
        label,
        detail: String(day.getDate()),
        active: index === 0,
        accent: mealsForDay.length > 0 ? "var(--color-accent-sage)" : undefined,
      };
    });
  }, []);

  if (homeError) {
    return (
      <PageShell>
        <EmergencyButton />
        <ErrorState title="Dashboard unavailable" description={homeError} retryLabel="Reload" onRetry={() => window.location.reload()} />
      </PageShell>
    );
  }

  return (
    <FogProvider>
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: "transparent" }}>
          <EmergencyButton />

          <div className="relative z-10 px-4 pt-10 pb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary break-words">
                  Good {timeOfDay}, <span className="text-[var(--color-accent-selected)]">{familyName}</span>
                </h1>
                <p className="mt-1 text-sm text-text-secondary">{season.emoji} {season.name} · {dateInfo.dayOfWeek}, {dateInfo.dayMonth} · {timeStr}</p>
              </div>
              {isLoggedIn && dashboardCurrentUser ? (
                <div className="flex shrink-0 items-center gap-2">
                  {showSessionPill && (
                    <span
                      className={`rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-text-secondary backdrop-blur-xl ${
                        sessionWarning ? "session-pill-warning border-amber-300/30 bg-amber-500/10 text-amber-200" : ""
                      }`}
                      aria-label={`Auto sign-out in ${sessionPillMM}:${sessionPillSS}`}
                      title="Time until auto sign-out"
                    >
                      ⏳ {sessionPillMM}:{sessionPillSS}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmingLogout(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary active:scale-95"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                  <button type="button" onClick={() => setPinningMember({ name: dashboardCurrentUser.name, emoji: dashboardCurrentUser.emoji || "😊", color: dashboardCurrentUser.color || "green", avatarSize: normalizeAvatarSize(dashboardCurrentUser.avatarSize), glow: dashboardCurrentUser.glow || false })} className="active:scale-90 transition-transform" aria-label="Switch profile">
                    <Avatar name={dashboardCurrentUser.name} color={dashboardCurrentUser.color} emoji={dashboardCurrentUser.emoji} size={normalizeAvatarSize(dashboardCurrentUser.avatarSize)} variant="emoji" glow={dashboardCurrentUser.glow} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPinningMember({ name: familyMembers[0]?.name || "Family", emoji: familyMembers[0]?.emoji || "😊", color: familyMembers[0]?.color || "green", avatarSize: normalizeAvatarSize(familyMembers[0]?.avatarSize), glow: familyMembers[0]?.glow || false })}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary active:scale-95"
                  aria-label="Sign in"
                  title="Sign in"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  <span>Sign in</span>
                </button>
              )}
            </div>

            <div className="mt-6 flex gap-3 overflow-x-auto pb-1">
              {familyMembers.map((member) => (
                <button key={member.name} type="button" onClick={() => setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false })} className="active:scale-90 transition-transform">
                  <Avatar name={member.name} color={member.color} emoji={member.emoji} size={normalizeAvatarSize(member.avatarSize)} variant="emoji" glow={member.glow} />
                </button>
              ))}
              {!isLoggedIn && <Chip tone="accent" className="h-12 w-12 !px-0 text-lg">＋</Chip>}
            </div>
          </div>

          <div className="px-4 space-y-6 relative z-10">
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Events" value={todayEvents.length} detail="Today" icon="📅" tone={todayEvents.length > 0 ? "warning" : "accent"} />
              <StatTile label="Tasks" value={pendingTasks.length} detail="Pending" icon="✅" tone={pendingTasks.length > 0 ? "danger" : "success"} />
              <StatTile label="Week" value="7" detail="Days planned" icon="🍽️" tone="accent" />
            </div>

            {widgets.map((id) => {
              switch (id as WidgetId) {
                case "weather":
                  return (
                    <div key="weather" className="relative z-10">
                      <WeatherWidget />
                      <AtmosphericBridge />
                    </div>
                  );

                case "leaderboard":
                  return <div key="leaderboard" className="mt-3"><HomeLeaderboardWidget /></div>;

                case "todayEvents":
                  return (
                    <SectionCard key="todayEvents" title="Today" description={`${todayEvents.length} events on the family calendar`} icon="📅" className="mt-4">
                      {todayEvents.length === 0 ? (
                        <EmptyState title="Quiet day" description="No events are scheduled for today." icon="🌿" />
                      ) : (
                        <div className="space-y-2">
                          {todayEvents.map((event) => (
                            <ListRow
                              key={event.id}
                              title={event.title}
                              subtitle={event.time}
                              leftRailColor={event.color === "green" ? "var(--color-accent-mint)" : event.color === "violet" ? "var(--color-accent-violet)" : event.color === "amber" ? "var(--color-accent-amber)" : event.color === "cyan" ? "var(--color-accent-cyan)" : event.color === "rose" ? "var(--color-accent-rose)" : event.color === "blue" ? "var(--color-accent-nori)" : "var(--color-accent-nori)"}
                              leading={<span className="text-xl">{event.icon}</span>}
                              trailing={<Chip size="sm" tone="accent">{event.member.split(" ")[0]}</Chip>}
                            />
                          ))}
                        </div>
                      )}
                    </SectionCard>
                  );

                case "schedule":
                  return <ScheduleDisplay key="schedule" schedule={homeScheduleItems} title="Daily Schedule" />;

                case "currentMeal":
                  return (
                    <AtmosphericProvider key="currentMeal">
                      <CurrentMealWidget />
                    </AtmosphericProvider>
                  );

                case "tasks":
                  return (
                    <SectionCard key="tasks" title="Tasks" description={`${pendingTasks.length} pending for the family`} icon="✅">
                      {pendingTasks.length === 0 ? (
                        <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" />
                      ) : (
                        <div className="space-y-2">
                          {pendingTasks.map((task) => (
                            <ListRow
                              key={task.id}
                              title={task.title}
                              subtitle={`${task.assigned} · ${task.due}`}
                              leftRailColor={task.points > 15 ? "var(--color-accent-rose)" : task.points > 10 ? "var(--color-accent-amber)" : "var(--color-accent-mint)"}
                              trailing={<Chip size="sm" tone={task.points > 15 ? "danger" : task.points > 10 ? "warning" : "success"}>+{task.points}pts</Chip>}
                            />
                          ))}
                        </div>
                      )}
                    </SectionCard>
                  );

                case "aiQuickAsk":
                  return (
                    <Link href="/chat" key="aiQuickAsk">
                      <Surface variant="warm" radius="2xl" padding="lg" interactive>
                        <div className="flex items-center gap-4">
                          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-2xl text-[var(--color-accent-selected)] floating">
                            <Icon3D variant="chat" size="md" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-base font-bold text-text-primary">Quick ask</h3>
                            <p className="mt-0.5 text-sm text-text-secondary">“Add soccer practice for Thursday.”</p>
                          </div>
                          <span className="text-[var(--color-accent-selected)]">→</span>
                        </div>
                      </Surface>
                    </Link>
                  );

                default:
                  return null;
              }
            })}

            <SectionCard title="This Week" description="Meal and family rhythm at a glance" icon="🗓️">
              <DayStrip value="today" onChange={(dayId) => router.push(`/meals?day=${dayId}`)} days={weekDays} />
            </SectionCard>

            <div className="flex gap-3">
              <Link href="/meals" className="flex-1">
                <SoftButton variant="secondary" className="w-full">Plan Meals</SoftButton>
              </Link>
              <Link href="/tasks" className="flex-1">
                <SoftButton className="w-full">Open Tasks</SoftButton>
              </Link>
              <IconButton variant="accent" aria-label="Add quick note"><span>＋</span></IconButton>
            </div>
          </div>

          {pinningMember && (
            <PinModal
              memberName={pinningMember.name}
              memberEmoji={pinningMember.emoji}
              memberColor={pinningMember.color}
              onClose={() => setPinningMember(null)}
              onSuccess={() => setPinningMember(null)}
            />
          )}

          {isLoggedIn && (
            <Modal
              open={confirmingLogout}
              onClose={() => setConfirmingLogout(false)}
              title={`Sign out of ${dashboardCurrentUser?.name.split(" ")[0] || "your account"}?`}
              description="You can sign back in any time by tapping your avatar."
              footer={
                <>
                  <SoftButton variant="secondary" className="flex-1" onClick={() => setConfirmingLogout(false)}>
                    Cancel
                  </SoftButton>
                  <SoftButton
                    className="flex-1"
                    onClick={() => {
                      setConfirmingLogout(false);
                      logout();
                    }}
                  >
                    Sign out
                  </SoftButton>
                </>
              }
            >
              {dashboardCurrentUser && (
                <div className="flex items-center gap-3">
                  <Avatar
                    name={dashboardCurrentUser.name}
                    color={dashboardCurrentUser.color}
                    emoji={dashboardCurrentUser.emoji}
                    size="md"
                    variant="emoji"
                    glow={dashboardCurrentUser.glow}
                  />
                  <span className="text-sm text-text-secondary">
                    Signed in as <span className="font-semibold text-text-primary">{dashboardCurrentUser.name}</span>
                  </span>
                </div>
              )}
            </Modal>
          )}

          <Toast
            open={isLoggedIn && sessionWarning}
            tone="neutral"
          >
            <button
              type="button"
              onClick={extendSession}
              className="flex w-full items-center justify-center gap-2 text-left"
              aria-label="Stay signed in"
            >
              <span>You’ll be signed out in {sessionSecondsRemaining}s — tap to stay</span>
            </button>
          </Toast>
        </PageShell>
      </AtmosphericProvider>
    </FogProvider>
  );
}
