/**
 * FamilyHome — The "Living Room TV"
 *
 * Warm, balanced, shared overview for the whole family.
 * Shown when no one is logged in.
 */
"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";
import { Icon3D } from "@/components/3d";
import EmergencyButton from "@/components/ui/EmergencyButton";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import AtmosphericBridge from "@/components/ui/AtmosphericBridge";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/patterns/StatTile";
import SectionCard from "@/components/patterns/SectionCard";
import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";
import PhotoMemoriesWidget from "@/components/integrations/PhotoMemoriesWidget";
import Link from "next/link";
import { db } from "@/db";

const FogBackground = dynamic(() => import("@/components/ui/FogBackground"), { ssr: false });

const avatarSizes = new Set<AvatarSize>(["xs", "sm", "md", "base", "lg"]);
function normalizeAvatarSize(size?: string) {
  return avatarSizes.has(size as AvatarSize) ? (size as AvatarSize) : "md";
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function FamilyHome() {
  const [mounted, setMounted] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [timeOfDay, setTimeOfDay] = useState("morning");
  const [season, setSeason] = useState({ name: "Spring", emoji: "🌸" });
  const [dateInfo, setDateInfo] = useState({ dayOfWeek: "---", dayMonth: "---" });

  const { currentUser, isLoggedIn, logout } = useAuth();
  const { isWeekend, isBedtime } = useDashboardMode();

  useEffect(() => {
    setMounted(true);
    try {
      const members = db.selectMembersDetailed().map((m: any, i: number) => ({
        name: m.name,
        color: m.color || (i % 4 === 0 ? "green" : i % 4 === 1 ? "cyan" : i % 4 === 2 ? "violet" : "amber"),
        emoji: m.emoji,
        avatarSize: normalizeAvatarSize(m.avatarSize),
        glow: m.glow || false,
        role: m.role || "child",
      }));
      setFamilyMembers(members);
      setTodayEvents(db.selectTodaysEvents());
      setPendingTasks(db.selectPendingTasks());

      const today = new Date();
      const hour = today.getHours();
      setTimeOfDay(hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night");
      const month = today.getMonth();
      setSeason(month >= 2 && month <= 4 ? { name: "Spring", emoji: "🌸" } : month >= 5 && month <= 7 ? { name: "Summer", emoji: "☀️" } : month >= 8 && month <= 10 ? { name: "Autumn", emoji: "🍂" } : { name: "Winter", emoji: "❄️" });
      setDateInfo({
        dayOfWeek: today.toLocaleDateString("en-US", { weekday: "short" }),
        dayMonth: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
    } catch { /* graceful fallback */ }
  }, []);

  const familyName = currentUser ? currentUser.name.split(" ")[0] + "'s family" : "Garcia family";
  const greetingTime = isBedtime ? "night" : timeOfDay;
  const greetingEmoji = isBedtime ? "🌙" : "";

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: "transparent" }}>
        <EmergencyButton />

        {/* ── Greeting ── */}
        <div className="relative z-10 px-4 pt-10 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary break-words"
                style={{ fontSize: "var(--mode-greeting-size, 1.75rem)" }}
              >
                Good {greetingTime},{" "}
                <span className="text-[var(--color-accent-selected)]">{greetingEmoji}{familyName}</span>
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                {season.emoji} {season.name} · {dateInfo.dayOfWeek}, {dateInfo.dayMonth}
              </p>
            </div>

            {/* Sign-in / Sign-out */}
            {!isLoggedIn ? (
              <Link
                href="/settings"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                <span>Sign In</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary active:scale-95"
              >
                <span>Sign Out</span>
              </button>
            )}
          </div>

          {/* Family member avatars */}
          <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
            {familyMembers.map((member) => (
              <Link key={member.name} href="/settings" className="active:scale-90 transition-transform">
                <Avatar
                  name={member.name}
                  color={member.color}
                  emoji={member.emoji}
                  size={normalizeAvatarSize(member.avatarSize)}
                  variant="emoji"
                  glow={member.glow}
                />
              </Link>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="px-4 space-y-6 relative z-10" style={{ gap: "var(--mode-gap, 1.5rem)" }}>
          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Events" value={todayEvents.length} detail="Today" icon="📅" tone={todayEvents.length > 0 ? "warning" : "accent"} />
            <StatTile label="Tasks" value={pendingTasks.length} detail="Pending" icon="✅" tone={pendingTasks.length > 0 ? "danger" : "success"} />
            <StatTile label="Week" value="7" detail="Days planned" icon="🍽️" tone="accent" />
          </div>

          {/* Weather */}
          <div className="relative z-10">
            <WeatherWidget />
            <AtmosphericBridge />
          </div>

          {/* Today's events */}
          <SectionCard title="Today" description={`${todayEvents.length} events on the family calendar`} icon="📅">
            {todayEvents.length === 0 ? (
              <EmptyState title="Quiet day" description="No events are scheduled for today." icon="🌿" />
            ) : (
              <div className="space-y-2">
                {todayEvents.map((event) => (
                  <ListRow
                    key={event.id}
                    title={event.title}
                    subtitle={event.time}
                    leftRailColor={event.color === "green" ? "var(--color-accent-mint)" : "var(--color-accent-nori)"}
                    leading={<span className="text-xl">{event.icon}</span>}
                    trailing={<Chip size="sm" tone="accent">{event.member?.split(" ")[0]}</Chip>}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Quick Ask */}
          <Link href="/chat">
            <Surface variant="warm" radius="2xl" padding="lg" interactive>
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-2xl text-[var(--color-accent-selected)] floating">
                  <Icon3D variant="chat" size="md" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-text-primary">Ask Consuela</h3>
                  <p className="mt-0.5 text-sm text-text-secondary">"What's for dinner tonight?"</p>
                </div>
                <span className="text-[var(--color-accent-selected)]">→</span>
              </div>
            </Surface>
          </Link>

          {/* Weekend Activity Suggestion */}
          {isWeekend && (
            <Surface variant="warm" radius="2xl" padding="none">
              <div className="p-4 flex items-center gap-3">
                <span className="text-3xl">🏖️</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-text-primary">Weekend Vibes</h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    How about a family game night, a nature walk, or baking something together?
                  </p>
                </div>
                <Link href="/chat?q=fun%20family%20weekend%20activity" className="shrink-0">
                  <SoftButton variant="secondary" size="sm">Ideas</SoftButton>
                </Link>
              </div>
            </Surface>
          )}

          {/* Leaderboard (compact for family) */}
          <HomeLeaderboardWidget />

          {/* Action buttons */}
          {/* Photo Memories */}
          <PhotoMemoriesWidget />

          {/* Action buttons */}
          <div className="flex gap-3">
            <Link href="/meals" className="flex-1">
              <SoftButton variant="secondary" className="w-full">Plan Meals</SoftButton>
            </Link>
            <Link href="/tasks" className="flex-1">
              <SoftButton className="w-full">View Tasks</SoftButton>
            </Link>
          </div>
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}
