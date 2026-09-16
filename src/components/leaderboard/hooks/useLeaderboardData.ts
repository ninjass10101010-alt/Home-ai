/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useMemo } from "react";
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
  todayMondayISO,
} from "@/lib/task-utils";

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
    setMounted(true);
  }, [refreshVersion]);

  const daysUntilReset = useMemo(() => {
    if (!mounted) return 7;
    return getDaysUntilWeekReset();
  }, [mounted]);

  const previousRanks = useMemo(() => {
    if (!mounted) return {};
    return getPreviousWeekRanks();
  }, [mounted]);

  const hall = useMemo(() => {
    if (!mounted) return [] as HallOfFameEntry[];
    return loadHallOfFame();
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
