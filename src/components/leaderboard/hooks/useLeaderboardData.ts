/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useMemo } from "react";
import { db } from "@/db";
import type { LeaderboardEntry, WeekData, Task } from "@/types/tasks";
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
  todayMondayISO,
} from "@/lib/task-utils";

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  weekData: WeekData;
  tasks: Task[];
  daysUntilReset: number;
  previousRanks: Record<string, number>;
}

export function useLeaderboardData() {
  const [mounted, setMounted] = useState(false);
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    setWeekData(loadWeekData());
    setTasks(loadTasks());
    setMounted(true);
  }, []);

  const completedDates = useMemo(() => {
    if (!mounted || tasks.length === 0) return [];
    return getThisWeeksCompletedDates(tasks);
  }, [tasks, mounted]);

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
        const streak = calculateRealStreak(name, weekData, completedDates);
        const { level, title, emoji, progress } = getLevel(allTimePoints);
        const earnedBadges = BADGES.filter(b => b.condition(allTimePoints, streak, allTimeComps)).map(b => b.emoji);
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
  }, [weekData, tasks, completedDates, mounted]);

  return {
    data: {
      entries,
      weekData: weekData || { weekStart: "", points: {}, streak: {}, lastActive: {}, history: [] },
      tasks,
      daysUntilReset,
      previousRanks,
    } as LeaderboardData,
    mounted,
  };
}
