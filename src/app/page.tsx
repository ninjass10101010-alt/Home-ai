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
import AtmosphericBridge from "@/components/ui/AtmosphericBridge";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { WIDGET_SPANS, homeGridClass, widgetSpanClass, tabletSpan, tabletSpanFor, HOME_GRID_FALLBACK } from "@/lib/layout-config";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import PinModal from "@/components/auth/PinModal";
import MemberPickerModal from "@/components/auth/MemberPickerModal";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import DayLine, { parseTimeToMinutes, useDayFraction } from "@/components/patterns/DayLine";
import SectionCard from "@/components/patterns/SectionCard";
import WidgetCard from "@/components/patterns/WidgetCard";
import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";
import HomeSuggestionsWidget from "@/components/suggestions/HomeSuggestionsWidget";
import MorningBriefingWidget from "@/components/briefing/MorningBriefingWidget";
import HomeSecurityWidget from "@/components/ha/HomeSecurityWidget";
import HomeClimateWidget from "@/components/ha/HomeClimateWidget";
import HomeLightsWidget from "@/components/ha/HomeLightsWidget";
import { useMorningBriefing, briefingSectionsEmpty } from "@/components/briefing/hooks/useMorningBriefing";
import ProfileSheet from "@/components/profile/ProfileSheet";
import { useHomeEvents } from "@/hooks/useHomeEvents";

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

const QUICK_PROMPTS = [
  "What's running low?",
  "Any calendar conflicts?",
  "What chores are pending?",
];

/**
 * Morning briefing grid slot. Owns the briefing hook so the widget and the
 * empty-cell decision share one fetch; when there is nothing to show for the
 * day the slot returns null so the bento grid doesn't keep a hollow
 * `lg:col-span-1` cell that pushes every row down.
 */
function MorningBriefingSlot({ span }: { span: string }) {
  const { briefing, loading, ack, ackError } = useMorningBriefing();
  if (loading || !briefing || briefingSectionsEmpty(briefing)) return null;
  return (
    <div className={span}>
      <MorningBriefingWidget briefing={briefing} loading={loading} ack={ack} ackError={ackError} className="h-full" />
    </div>
  );
}

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const router = useRouter();
  const { currentUser, isLoggedIn, logout, sessionRemainingMs, sessionWarning, extendSession } = useAuth();
  const { visibleWidgets, orientation, mounted: layoutMounted } = useHomeLayout();
  const { upcomingImportant } = useHomeEvents();
  const gridClass = layoutMounted ? homeGridClass(orientation) : HOME_GRID_FALLBACK;

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

  const dayFraction = useDayFraction();
  const weekFraction = useMemo(() => {
    if (dayFraction === null) return null;
    const mondayIndex = (new Date().getDay() + 6) % 7;
    return (mondayIndex + dayFraction) / 7;
  }, [dayFraction]);
  const weekDayBoundaries = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({ at: (i + 1) / 7 })),
    []
  );
  const eventLineColor = (event: any): string =>
    event?.color === "green" ? "var(--color-accent-mint)"
    : event?.color === "violet" ? "var(--color-accent-violet)"
    : event?.color === "amber" ? "var(--color-accent-amber)"
    : event?.color === "cyan" ? "var(--color-accent-cyan)"
    : event?.color === "rose" ? "var(--color-accent-rose)"
    : "var(--color-accent-nori)";

  const weekDays = useMemo(() => {
    if (!mounted) {
      return weekdayLabels.map((label) => ({ id: label, label, detail: undefined, active: false }));
    }
    const today = new Date();
    const todayLabel = weekdayLabels[today.getDay()];
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() + index - today.getDay());
      const label = weekdayLabels[day.getDay()];
      const mealsForDay = (db.mealsStore || []).filter((meal: any) => meal.time === label);
      return {
        id: label,
        label,
        detail: String(day.getDate()),
        active: label === todayLabel,
        accent: mealsForDay.length > 0 ? "var(--color-accent-sage)" : undefined,
      };
    });
  }, [mounted]);

  if (homeError) {
    return (
      <PageShell>
        <EmergencyButton />
        <ErrorState title="Dashboard unavailable" description={homeError} retryLabel="Reload" onRetry={() => window.location.reload()} />
      </PageShell>
    );
  }

  return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: "transparent" }}>
          <EmergencyButton />

          <div className="relative z-10 px-4 pt-10 pb-6">
            {/* pr-16 clears the fixed top-right Emergency shield (right-4 + 40px) */}
            <div className="flex items-start justify-between gap-3 pr-16">
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
                  <button type="button" onClick={() => setProfileOpen(true)} className="active:scale-90 transition-transform" aria-label="Open your profile">
                    <Avatar name={dashboardCurrentUser.name} color={dashboardCurrentUser.color} emoji={dashboardCurrentUser.emoji} size={normalizeAvatarSize(dashboardCurrentUser.avatarSize)} variant="emoji" glow={dashboardCurrentUser.glow} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
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
                <button
                  key={member.name}
                  type="button"
                  aria-label={
                    isLoggedIn && dashboardCurrentUser && memberMatchesName(member, dashboardCurrentUser.name)
                      ? "Open your profile"
                      : `Sign in as ${member.name}`
                  }
                  onClick={() => {
                    if (isLoggedIn && dashboardCurrentUser && memberMatchesName(member, dashboardCurrentUser.name)) {
                      setProfileOpen(true);
                    } else {
                      setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
                    }
                  }}
                  className="active:scale-90 transition-transform"
                >
                  <Avatar name={member.name} color={member.color} emoji={member.emoji} size={normalizeAvatarSize(member.avatarSize)} variant="emoji" glow={member.glow} />
                </button>
              ))}
              {!isLoggedIn && <Chip tone="accent" tabIndex={-1} className="h-12 w-12 !px-0 text-lg">＋</Chip>}
            </div>
          </div>

          <div className="px-4 space-y-6 relative z-10">
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Events" value={todayEvents.length} detail="Today" icon="📅" tone={todayEvents.length > 0 ? "warning" : "accent"} compact progress={dayFraction} />
              <StatTile label="Tasks" value={pendingTasks.length} detail="Pending" icon="✅" tone={pendingTasks.length > 0 ? "danger" : "success"} compact />
              <StatTile label="Week" value="7" detail="Days planned" icon="🍽️" tone="accent" compact progress={weekFraction} />
            </div>

            <div className={gridClass}>

            {visibleWidgets.map((w, index) => {
              const id = w.id;
              const span = layoutMounted
                ? orientation === "tablet"
                  ? tabletSpanFor(id, index, visibleWidgets)
                  : widgetSpanClass(id, orientation)
                : (WIDGET_SPANS[id] ?? "lg:col-span-1");
              switch (id) {
                case "morningBriefing":
                  return <MorningBriefingSlot key="morningBriefing" span={span} />;

                case "weather":
                  return (
                    <div key="weather" className={`relative z-10 ${span}`}>
                      <WeatherWidget className="h-full" />
                      <AtmosphericBridge />
                    </div>
                  );

                case "leaderboard":
                  return <div key="leaderboard" className={span}><HomeLeaderboardWidget className="h-full" /></div>;

                case "consuelaSuggestions":
                  return <div key="consuelaSuggestions" className={span}><HomeSuggestionsWidget className="h-full" /></div>;

                case "todayEvents": {
                  const visibleEvents = todayEvents.slice(0, 3);
                  const hiddenEvents = todayEvents.length - visibleEvents.length;
                  const upcoming = Array.isArray(upcomingImportant) ? upcomingImportant.slice(0, 2) : [];
                  return (
                    <div key="todayEvents" className={span}>
                      <SectionCard title="Today" description={`${todayEvents.length} events on the family calendar`} icon="📅" tone="#3b82f6" compact centeredHeader className="h-full"
                        footer={
                          hiddenEvents > 0 ? (
                            <Link href="/calendar" className="tap-sm text-xs font-semibold widget-accent-text">+{hiddenEvents} more · See all →</Link>
                          ) : undefined
                        }>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                        <DayLine
                          className="mb-3"
                          tone="#3b82f6"
                          markers={todayEvents
                            .filter((event: any) => typeof event?.time === "string" && /\d{1,2}:\d{2}/.test(event.time))
                            .map((event: any) => ({ at: parseTimeToMinutes(event.time), color: eventLineColor(event) }))}
                        />
                        {visibleEvents.length === 0 ? (
                          <EmptyState title="Quiet day" description="No events are scheduled for today." icon="🌿" flat />
                        ) : (
                          <div className="space-y-2">
                            {visibleEvents.map((event) => (
                              <ListRow
                                key={event.id}
                                title={event.title}
                                subtitle={event.time}
                                leftRailColor={eventLineColor(event)}
                                leading={<span className="text-xl">{event.icon}</span>}
                                trailing={event.member ? (
                                  <span
                                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                    style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${eventLineColor(event)} 55%, transparent), color-mix(in srgb, ${eventLineColor(event)} 30%, transparent))` }}
                                  >
                                    {String(event.member).split(" ")[0]}
                                  </span>
                                ) : undefined}
                              />
                            ))}
                          </div>
                        )}
                        {upcoming.length > 0 && (
                          <div className="pt-3 border-t border-white/10">
                            <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">Upcoming important</div>
                            <div className="space-y-2">
                              {upcoming.map((event: any) => {
                                const timeStr = event.time
                                  ? (() => {
                                      try {
                                        if (typeof event.time === "string" && event.time.includes("M")) return event.time;
                                        return new Date(`2000-01-01T${event.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                                      } catch {
                                        return String(event.time);
                                      }
                                    })()
                                  : "";
                                const dateLabel = event.date ? String(event.date).slice(0, 10) : (event.start ? String(event.start).slice(0, 10) : "");
                                const subtitle = [dateLabel, timeStr].filter(Boolean).join(" · ");
                                const memberLabel = event.member ? String(event.member).split(" ")[0] : null;
                                return (
                                  <ListRow
                                    key={event.id}
                                    title={event.title}
                                    subtitle={subtitle || undefined}
                                    leftRailColor={eventLineColor(event)}
                                    leading={<span className="text-xl">{event.icon || "📅"}</span>}
                                    trailing={memberLabel ? (
                                      <span
                                        className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${eventLineColor(event)} 55%, transparent), color-mix(in srgb, ${eventLineColor(event)} 30%, transparent))` }}
                                      >
                                        {memberLabel}
                                      </span>
                                    ) : undefined}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                        </div>
                      </SectionCard>
                    </div>
                  );
                }

                case "schedule":
                  return (
                    <div key="schedule" className={span}>
                      <ScheduleDisplay schedule={homeScheduleItems} title="Daily Schedule" className="h-full" />
                    </div>
                  );

                case "currentMeal":
                  return (
                    <div key="currentMeal" className={span}>
                      <AtmosphericProvider>
                        <CurrentMealWidget className="h-full" />
                      </AtmosphericProvider>
                    </div>
                  );

                case "tasks": {
                  const visibleTasks = pendingTasks.slice(0, 3);
                  const hiddenTasks = pendingTasks.length - visibleTasks.length;
                  return (
                    <div key="tasks" className={span}>
                      <SectionCard title="Tasks" description={`${pendingTasks.length} pending for the family`} icon="✅" tone="#f43f5e" compact centeredHeader className="h-full"
                        footer={
                          hiddenTasks > 0 ? (
                            <Link href="/tasks" className="tap-sm text-xs font-semibold widget-accent-text">+{hiddenTasks} more · See all →</Link>
                          ) : undefined
                        }>
                        {visibleTasks.length === 0 ? (
                          <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" flat />
                        ) : (
                          <div className="space-y-2">
                            <DayLine tone="#f43f5e" />
                            {visibleTasks.map((task, idx) => {
                              const pointsColor = task.points > 15 ? "var(--color-accent-rose)" : task.points > 10 ? "var(--color-accent-amber)" : "var(--color-accent-mint)";
                              const subtitle = [task.assigned, task.due].filter(Boolean).join(" · ");
                              return (
                                <div
                                  key={task.id}
                                  className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5 animate-in"
                                  style={{
                                    animationDelay: `${idx * 0.05}s`,
                                    backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${pointsColor} 40%, transparent) 0%, color-mix(in srgb, ${pointsColor} 20%, transparent) 100%)`,
                                  }}
                                >
                                  <div
                                    className="h-8 w-0.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: pointsColor, boxShadow: `0 0 8px ${pointsColor}` }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm text-text-primary">{task.title}</div>
                                    {subtitle && <div className="truncate text-xs text-text-secondary">{subtitle}</div>}
                                  </div>
                                  <span
                                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                    style={{
                                      background: `linear-gradient(135deg, color-mix(in srgb, ${pointsColor} 55%, transparent), color-mix(in srgb, ${pointsColor} 30%, transparent))`,
                                    }}
                                  >
                                    +{task.points}pts
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </SectionCard>
                    </div>
                  );
                }

                case "homeSecurity":
                  return <div key="homeSecurity" className={span}><HomeSecurityWidget className="h-full" /></div>;

                case "homeClimate":
                  return <div key="homeClimate" className={span}><HomeClimateWidget className="h-full" /></div>;

                case "homeLights":
                  return <div key="homeLights" className={span}><HomeLightsWidget className="h-full" /></div>;

                case "aiQuickAsk":
                  return (
                    <div key="aiQuickAsk" className={span}>
                      <WidgetCard tone="#8b5cf6" icon={<Icon3D variant="chat" size="lg" />} className="h-full">
                        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-5 text-center">
                          <Link href="/chat" className="flex items-center gap-2 tap-sm">
                            <h3 className="text-base font-bold text-text-primary">Quick ask</h3>
                            <span className="widget-accent-text">→</span>
                          </Link>
                          <p className="text-sm text-text-secondary">&ldquo;Add soccer practice for Thursday.&rdquo;</p>
                          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                            {QUICK_PROMPTS.map((prompt) => (
                              <Link
                                key={prompt}
                                href={`/chat?q=${encodeURIComponent(prompt)}`}
                                className="tap-sm rounded-full border border-[var(--color-accent-violet)]/25 bg-[var(--color-accent-violet)]/10 px-2.5 py-1 text-[11px] font-semibold widget-accent-text transition-colors hover:bg-[var(--color-accent-violet)]/20"
                              >
                                {prompt}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </WidgetCard>
                    </div>
                  );

                default:
                  return null;
              }
            })}
            </div>

            <div className="mt-6">
              <SectionCard title="This Week" description="Meal and family rhythm at a glance" icon="🗓️" tone="#10b981" compact>
                <DayStrip value="today" onChange={(dayId) => router.push(`/meals?day=${dayId}`)} days={weekDays} compact />
                <DayLine className="mt-3" mode="week" tone="#10b981" progress={weekFraction} markers={weekDayBoundaries} />
              </SectionCard>
            </div>

            <div className="flex gap-3">
              <Link href="/meals" className="flex-1">
                <SoftButton variant="secondary" className="w-full">Plan Meals</SoftButton>
              </Link>
              <Link href="/tasks" className="flex-1">
                <SoftButton className="w-full">Open Tasks</SoftButton>
              </Link>
            </div>
          </div>

          <MemberPickerModal
            open={pickerOpen}
            members={familyMembers}
            onClose={() => setPickerOpen(false)}
            onSelect={(member) => {
              setPickerOpen(false);
              setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
            }}
          />

          {pinningMember && (
            <PinModal
              memberName={pinningMember.name}
              memberEmoji={pinningMember.emoji}
              memberColor={pinningMember.color}
              onClose={() => setPinningMember(null)}
              onSuccess={() => setPinningMember(null)}
            />
          )}

          {isLoggedIn && dashboardCurrentUser && (
            <ProfileSheet
              open={profileOpen}
              onClose={() => setProfileOpen(false)}
              member={dashboardCurrentUser}
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
  );
}
