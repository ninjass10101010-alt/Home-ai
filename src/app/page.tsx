/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
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
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import SectionCard from "@/components/patterns/SectionCard";

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

  const { currentUser, isLoggedIn, logout } = useAuth();
  const { isVisible, widgets } = useHomeLayout();

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
      setPendingTasks(db.selectPendingTasks());

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

          <div className="relative z-10 px-4 pt-10 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-3xl">👋</span>
                  <h1 className="truncate text-3xl font-bold tracking-tight text-text-primary">
                    Good {timeOfDay}, <span className="text-[var(--color-accent-selected)]">{familyName}</span>
                  </h1>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{season.emoji} {season.name} · {dateInfo.dayOfWeek}, {dateInfo.dayMonth} · {timeStr}</p>
              </div>
              {isLoggedIn && dashboardCurrentUser ? (
                <button type="button" onDoubleClick={logout} title="Double-tap to log out" className="shrink-0 active:scale-90 transition-transform">
                  <Avatar name={dashboardCurrentUser.name} color={dashboardCurrentUser.color} emoji={dashboardCurrentUser.emoji} size={normalizeAvatarSize(dashboardCurrentUser.avatarSize)} variant="emoji" glow={dashboardCurrentUser.glow} />
                </button>
              ) : (
                <button type="button" onClick={() => setPinningMember({ name: familyMembers[0]?.name || "Family", emoji: familyMembers[0]?.emoji || "😊", color: familyMembers[0]?.color || "green", avatarSize: normalizeAvatarSize(familyMembers[0]?.avatarSize), glow: familyMembers[0]?.glow || false })} className="shrink-0 active:scale-90 transition-transform">
                  <Avatar name={familyMembers[0]?.name || "Family"} color={familyMembers[0]?.color || "green"} emoji={familyMembers[0]?.emoji || "😊"} size={normalizeAvatarSize(familyMembers[0]?.avatarSize || "md")} variant="emoji" glow={familyMembers[0]?.glow || false} />
                </button>
              )}
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {familyMembers.slice(0, 6).map((member) => (
                <button key={member.name} type="button" onClick={() => setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false })} className="active:scale-90 transition-transform">
                  <Avatar name={member.name} color={member.color} emoji={member.emoji} size={normalizeAvatarSize(member.avatarSize)} variant="emoji" glow={member.glow} />
                </button>
              ))}
              <Chip tone="accent" className="h-12 w-12 !px-0 text-lg">＋</Chip>
            </div>
          </div>

          {isVisible("weather") && (
            <div className="px-4 pb-4 relative z-10">
              <AtmosphericProvider>
                <WeatherWidget />
                <AtmosphericBridge />
              </AtmosphericProvider>
            </div>
          )}

          <div className="px-4 space-y-5 relative z-10">
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Events" value={todayEvents.length} detail="Today" icon="📅" tone={todayEvents.length > 0 ? "warning" : "accent"} />
              <StatTile label="Tasks" value={pendingTasks.length} detail="Pending" icon="✅" tone={pendingTasks.length > 0 ? "danger" : "success"} />
              <StatTile label="Week" value="7" detail="Days planned" icon="🍽️" tone="accent" />
            </div>

            {widgets.filter((id) => id !== "weather").map((id) => {
              if (!isVisible(id)) return null;

              switch (id as WidgetId) {
                case "todayEvents":
                  return (
                    <SectionCard key="todayEvents" title="Today" description={`${todayEvents.length} events on the family calendar`} icon="📅">
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
              <DayStrip value="today" onChange={() => {}} days={weekDays} />
            </SectionCard>

            <div className="flex gap-2">
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
        </PageShell>
      </AtmosphericProvider>
    </FogProvider>
  );
}
