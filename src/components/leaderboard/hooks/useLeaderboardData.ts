/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "@/db";
import type { LeaderboardEntry, WeekData, Task, HallOfFameEntry } from "@/types/tasks";
import { getLevel, BADGES } from "@/types/tasks";
import {
  loadWeekData,
  loadTasks,
  calculateRealStreak,
  getThisWeeksCompletedDates,
  getDaysUntilWeekReset,
  getPreviousWeekRanks,
  getMemberAllTimePoints,
  getMemberAllTimeCompletions,
  loadHallOfFame,
  loadHallOfFameMerged,
  todayMondayISO,
} from "@/lib/task-utils";

// Same list, same content → keep the previous reference (no re-render when
// the async downlink confirms what the synchronous local read already showed).
function sameHall(a: HallOfFameEntry[], b: HallOfFameEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i];
    return (
      e.member === o.member &&
      e.weekStart === o.weekStart &&
      e.rank === o.rank &&
      e.points === o.points &&
      e.emoji === o.emoji &&
      e.prize === o.prize &&
      e.celebrated === o.celebrated
    );
  });
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  weekData: WeekData;
  tasks: Task[];
  daysUntilReset: number;
  previousRanks: Record<string, number>;
  hall: HallOfFameEntry[];
}

export function useLeaderboardData() {
  const [mounted, setMounted] = useState(false);
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  // The hall is async-aware: the local copy renders synchronously for the
  // first frame, then the PB-merged list (loadHallOfFameMerged — celebrated
  // is server-truth, PB-only rows adopt) replaces it when the downlink
  // resolves, so a win claimed on another device never re-fires here and a
  // champ enshrined on another device still earns the 🥇 badge.
  const [hall, setHall] = useState<HallOfFameEntry[]>([]);
  // Mirror of what was last applied so the async downlink can skip scheduling
  // a state update entirely when the merged hall matches (the common case).
  const hallRef = useRef<HallOfFameEntry[]>([]);

  // The Home leaderboard stays mounted on the always-on kitchen display while
  // tasks get completed elsewhere. The 60s CacheRefresher merges another
  // device's snapshot into these stores (applyTasksSnapshotToStores) and
  // dispatches `consuela-data-refreshed`; a roster edit dispatches
  // `consuela-members-updated`. Re-read on both — the same contract every
  // other Home data source follows (useWeeklyPrizes/useMeals/usePantry,
  // KidHome, the Tasks page). Without this the widget froze at its mount-time
  // points and members' earned points never appeared without a reload.
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    const bump = () => setRefreshVersion((v) => v + 1);
    window.addEventListener("consuela-data-refreshed", bump);
    window.addEventListener("consuela-members-updated", bump);
    return () => {
      window.removeEventListener("consuela-data-refreshed", bump);
      window.removeEventListener("consuela-members-updated", bump);
    };
  }, []);

  useEffect(() => {
    setWeekData(loadWeekData());
    setTasks(loadTasks());
    hallRef.current = loadHallOfFame();
    setHall(hallRef.current);
    setMounted(true);
  }, [refreshVersion]);

  // PB→local downlink for the hall: replace the synchronous local read with
  // the merged list once it resolves (mounted-gated like the rest; never
  // throws — a PB failure leaves the local hall in place).
  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    loadHallOfFameMerged()
      .then((merged) => {
        if (!alive || sameHall(hallRef.current, merged)) return;
        hallRef.current = merged;
        setHall(merged);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mounted, refreshVersion]);

  const daysUntilReset = useMemo(() => {
    if (!mounted) return 7;
    return getDaysUntilWeekReset();
  }, [mounted]);

  const previousRanks = useMemo(() => {
    if (!mounted) return {};
    return getPreviousWeekRanks();
  }, [mounted]);

  const entries = useMemo<LeaderboardEntry[]>(() => {
    if (!mounted || !weekData) return [];
    const members = db.selectMembers();
    const currentMonday = todayMondayISO();
    return members
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => {
        const name = m.fullName;
        const weeklyPoints = weekData.points[name] || 0;
        const allTimePoints = getMemberAllTimePoints(name, weekData);
        const allTimeComps = getMemberAllTimeCompletions(name, tasks, weekData);
        // Streaks are per-member: filter this week's completion dates to THIS
        // member before scoring (calculateRealStreak's documented contract —
        // an aggregate would hand every member the family's combined streak).
        const streak = calculateRealStreak(name, weekData, getThisWeeksCompletedDates(tasks, name));
        const { level, title, emoji, progress } = getLevel(allTimePoints);
        const earnedBadges = BADGES.filter(b => b.condition(allTimePoints, streak, allTimeComps)).map(b => b.emoji);
        // Weekly Champ history is out-of-band (BADGES.week_champ condition stays
        // false): a rank-1 Hall of Fame entry earns the 🥇 career badge.
        const hasWeeklyChamp = hall.some(h => h.member === name && h.rank === 1);
        if (hasWeeklyChamp && !earnedBadges.includes("🥇")) earnedBadges.push("🥇");
        return {
          name,
          emoji: m.emoji,
          color: m.color,
          points: weeklyPoints,
          streak,
          rank: 0,
          level,
          levelTitle: title,
          levelEmoji: emoji,
          progressToNext: progress,
          badges: earnedBadges,
          allTimePoints,
          allTimeCompletions: allTimeComps,
          completedInWeek: tasks.filter(
            t => t.completed && t.completedBy === name && (
              t.completedInWeek === currentMonday ||
              (!t.completedInWeek && t.completedAt && t.completedAt >= currentMonday)
            )
          ).length,
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [weekData, tasks, hall, mounted]);

  return {
    data: {
      entries,
      weekData: weekData || { weekStart: "", points: {}, streak: {}, lastActive: {}, history: [] },
      tasks,
      daysUntilReset,
      previousRanks,
      hall,
    } as LeaderboardData,
    mounted,
  };
}
