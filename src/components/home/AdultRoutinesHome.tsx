"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import RoutinesTodaySection from "@/components/routines/RoutinesTodaySection";
import {
  RoutineComposerModal,
  RoutineSettingsModal,
} from "@/components/routines/RoutineModals";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";
import { useRoutines } from "@/hooks/useRoutines";
import { resolveMemberName } from "@/lib/task-utils";
import { useLeaderboardData } from "@/components/leaderboard/hooks/useLeaderboardData";
import {
  getMemberCompletionMeta,
  isRoutineScheduledForDate,
  isSingleMemberRoutine,
  memberKey,
  routineAppliesToMember,
  type RoutineRosterMember,
} from "@/lib/routine-rules";
import type { FamilyRoutine } from "@/types/routines";

interface AdultRoutinesHomeProps {
  onSwitchToWall: () => void;
}

function greetingPhrase(): string {
  const hr = new Date().getHours();
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  return "Good evening";
}

export default function AdultRoutinesHome({ onSwitchToWall }: AdultRoutinesHomeProps) {
  const { currentUser, logout } = useAuth();
  const routineHook = useRoutines();
  const { data: leaderboardData } = useLeaderboardData();
  const {
    todayISO,
    routines,
    settings,
    progress,
    accountability,
    upsertRoutine,
    updateSettings,
  } = routineHook;

  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [tonightDinner, setTonightDinner] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<FamilyRoutine | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadExtras = async () => {
      try {
        setTodayEvents(db.selectTodaysEvents());
        const allMeals = await db.selectMeals();
        if (!active) return;
        const dinner = allMeals.find(
          (m: any) =>
            m.date === todayISO &&
            String(m.mealType || "").toLowerCase() === "dinner",
        );
        setTonightDinner(dinner ? `${dinner.emoji || "🍽️"} ${dinner.title}` : null);
      } catch {
        /* non-fatal */
      }
    };
    void loadExtras();
    const bump = () => {
      setDataVersion((v) => v + 1);
      void loadExtras();
    };
    window.addEventListener("consuela-data-refreshed", bump);
    window.addEventListener("consuela-members-updated", bump);
    return () => {
      active = false;
      window.removeEventListener("consuela-data-refreshed", bump);
      window.removeEventListener("consuela-members-updated", bump);
    };
  }, [todayISO]);

  const rosterMembers = useMemo<RoutineRosterMember[]>(() => {
    void dataVersion;
    return db.selectMembersDetailed().map((m: any) => ({
      id: m.pbId,
      name: m.name?.split(" ")[0] || m.name,
      fullName: m.name,
      role: String(m.role || "").toLowerCase(),
      emoji: m.emoji || "😊",
    }));
  }, [dataVersion]);

  const canonicalName = useMemo(() => {
    const raw = currentUser?.name || "Parent";
    const resolved = resolveMemberName(db.selectMembers(), raw);
    return resolved || raw;
  }, [currentUser]);

  const firstName = canonicalName.split(" ")[0] || "Parent";

  const myPoints = useMemo(() => {
    if (!leaderboardData) return 0;
    const match = leaderboardData.entries.find(
      (e) => e.name.toLowerCase() === canonicalName.toLowerCase(),
    );
    return match?.points ?? 0;
  }, [leaderboardData, canonicalName]);

  const memberSummary = useMemo(() => {
    const activeRoster = rosterMembers.filter((m) => m.role !== "pet");
    return activeRoster.map((m) => {
      const fullName = m.fullName || m.name;
      const scheduled = routines.filter(
        (r) =>
          isRoutineScheduledForDate(r, todayISO) &&
          routineAppliesToMember(r, m, rosterMembers),
      );
      const doneCount = scheduled.filter((r) => {
        const meta = getMemberCompletionMeta(
          progress,
          r.id,
          fullName,
          isSingleMemberRoutine(r, rosterMembers),
        );
        return meta?.status === "completed" || meta?.status === "approved";
      }).length;
      const streak = accountability.streaks[memberKey(fullName)]?.current ?? 0;
      return {
        member: m,
        fullName,
        doneCount,
        totalCount: scheduled.length,
        streak,
      };
    });
  }, [rosterMembers, routines, todayISO, progress, accountability.streaks]);

  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      data-testid="adult-home-view"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <Surface variant="material-regular" padding="md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <Avatar
                name={canonicalName}
                color={currentUser?.color || "blue"}
                emoji={currentUser?.emoji || "🧑"}
                size="lg"
              />
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                  Adult Routine Hub
                </div>
                <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
                  {greetingPhrase()}, {firstName}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span>
                    Weekly Score:{" "}
                    <strong className="text-text-primary">{myPoints} pts</strong>
                  </span>
                  <span>·</span>
                  <span>
                    {settings.parentCountsTowardRace
                      ? "Counts in family race"
                      : "Personal mode (excluded from race)"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SoftButton
                variant="secondary"
                size="sm"
                data-testid="switch-to-family-wall-btn"
                onClick={onSwitchToWall}
              >
                🏠 Family Wall
              </SoftButton>
              <Link
                href="/tasks"
                className="hit-44 inline-flex items-center justify-center rounded-full border border-border bg-[var(--color-surface-2)] px-4 py-2 text-xs font-semibold text-text-primary hover:bg-[var(--color-surface-1)]"
              >
                Tasks &amp; Routines →
              </Link>
              <SoftButton variant="ghost" size="sm" onClick={() => void logout()}>
                Sign Out
              </SoftButton>
            </div>
          </div>
        </Surface>

        <RoutinesTodaySection
          title="My Routines Today"
          memberName={canonicalName}
          memberRole="parent"
          rosterMembers={rosterMembers}
          showAllMissedForParent={true}
          routineHook={routineHook}
          onOpenComposer={(rt) => {
            setComposerError(null);
            setEditingRoutine(rt);
            setComposerOpen(true);
          }}
          onOpenSettings={() => {
            setSettingsError(null);
            setSettingsOpen(true);
          }}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Surface variant="glass-subtle" padding="md">
            <h2 className="mb-3 text-base font-semibold text-text-primary">
              Family Routine Progress Today
            </h2>
            {memberSummary.length === 0 ? (
              <p className="text-sm text-text-secondary">No family members loaded.</p>
            ) : (
              <div className="space-y-2.5">
                {memberSummary.map((row) => {
                  const pct =
                    row.totalCount > 0
                      ? Math.round((row.doneCount / row.totalCount) * 100)
                      : 100;
                  return (
                    <div key={row.fullName} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-text-primary">
                          {row.member.emoji} {row.member.name}
                        </span>
                        <span className="text-text-secondary">
                          {row.doneCount}/{row.totalCount} done
                          {row.streak > 0 ? ` · 🔥 ${row.streak}d` : ""}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${pct}%`,
                            background:
                              pct >= 100
                                ? "var(--color-accent-mint)"
                                : "var(--color-accent-selected)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Surface>

          <Surface variant="glass-subtle" padding="md">
            <h2 className="mb-3 text-base font-semibold text-text-primary">
              Today at a Glance
            </h2>
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border/60 bg-[var(--color-surface-2)] px-3.5 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Tonight&apos;s Dinner
                </div>
                <div className="mt-0.5 font-medium text-text-primary">
                  {tonightDinner || "No dinner planned yet"}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-[var(--color-surface-2)] px-3.5 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Upcoming Events ({todayEvents.length})
                </div>
                {todayEvents.length === 0 ? (
                  <div className="mt-0.5 text-text-secondary">Calendar is clear today.</div>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {todayEvents.slice(0, 3).map((ev: any, i: number) => (
                      <li key={ev.id || i} className="flex justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-text-primary">
                          {ev.title}
                        </span>
                        <span className="shrink-0 text-text-secondary">
                          {ev.time || "All day"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Surface>
        </div>
      </div>

      <RoutineComposerModal
        open={composerOpen}
        onClose={() => {
          setComposerOpen(false);
          setEditingRoutine(null);
        }}
        editingRoutine={editingRoutine}
        rosterMembers={rosterMembers}
        settings={settings}
        error={composerError}
        onSave={async (routine) => {
          const res = await upsertRoutine(routine);
          if (!res.ok) {
            setComposerError(res.error || "Could not save routine");
            return;
          }
          setComposerOpen(false);
          setEditingRoutine(null);
        }}
      />

      <RoutineSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        error={settingsError}
        onSave={async (next) => {
          const res = await updateSettings(next);
          if (!res.ok) {
            setSettingsError(res.error || "Could not save point rules");
            return;
          }
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
