/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "@/db";
import type { LeaderboardEntry, WeekData, Task, HallOfFameEntry } from "@/types/tasks";
import { localWeekStartISO } from "@/lib/local-date";
import {
  loadWeekData,
  loadTasks,
  calculateRealStreak,
  getThisWeeksCompletedDates,
  getDaysUntilWeekReset,
  getPreviousWeekRanks,
  loadHallOfFame,
  loadHallOfFameMerged,
  loadPreviousWeekRanksMerged,
  isCompletedInWeek,
} from "@/lib/task-utils";
import { useAllTimeTotals, type AllTimeReadState } from "@/hooks/useAllTimeTotals";
import { earnedBadgeEmojis, resolveAllTimeLevel } from "@/components/leaderboard/level";

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

function sameRanks(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  weekData: WeekData;
  tasks: Task[];
  daysUntilReset: number;
  previousRanks: Record<string, number>;
  hall: HallOfFameEntry[];
  allTime: { state: AllTimeReadState; updatedAt: string | null };
}

export function useLeaderboardData() {
  const allTime = useAllTimeTotals();
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
  const previousRanksRef = useRef<Record<string, number>>({});
  const [previousRanks, setPreviousRanks] = useState<Record<string, number>>({});

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
    previousRanksRef.current = getPreviousWeekRanks();
    setPreviousRanks(previousRanksRef.current);
    setMounted(true);
  }, [refreshVersion]);

  // PB→local downlink for the hall: replace the synchronous local read with
  // the merged list once it resolves (mounted-gated like the rest; never
  // throws — a PB failure leaves the local hall in place).
  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    void Promise.all([
      loadHallOfFameMerged(),
      loadPreviousWeekRanksMerged(weekData?.weekStart || localWeekStartISO()),
    ]).then(([merged, ranks]) => {
      if (!alive) return;
      if (!sameHall(hallRef.current, merged)) {
        hallRef.current = merged;
        setHall(merged);
      }
      if (!sameRanks(previousRanksRef.current, ranks)) {
        previousRanksRef.current = ranks;
        setPreviousRanks(ranks);
      }
    });
    return () => {
      alive = false;
    };
  }, [mounted, refreshVersion, weekData?.weekStart]);

  const daysUntilReset = useMemo(() => {
    if (!mounted) return 7;
    return getDaysUntilWeekReset();
  }, [mounted]);

  const entries = useMemo<LeaderboardEntry[]>(() => {
    if (!mounted || !weekData) return [];
    const members = db.selectMembers();
    // The SAME week the points beside it describe: `weekData.weekStart` is the
    // server's week (localWeekStartISO stays imported for the :110 fallback).
    const currentMonday = weekData.weekStart;
    const roster = members
      .filter((m: any) => m.role !== "pet")
      .map((m: any) => {
        const name = m.fullName;
        const weeklyPoints = weekData.points[name] || 0;
        const allTimeTotal = allTime.totals[name];
        const allTimePoints = allTimeTotal?.points ?? null;
        const allTimeComps = allTimeTotal?.completions ?? null;
        // Streaks are per-member: filter this week's completion dates to THIS
        // member before scoring (calculateRealStreak's documented contract —
        // an aggregate would hand every member the family's combined streak).
        const streak = calculateRealStreak(name, weekData, getThisWeeksCompletedDates(tasks, name));
        const { known, level, title, emoji, progress } = resolveAllTimeLevel(allTimePoints);
        const earnedBadges = earnedBadgeEmojis(allTimePoints, streak, allTimeComps);
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
          levelKnown: known,
          progressToNext: progress,
          badges: earnedBadges,
          allTimePoints,
          allTimeCompletions: allTimeComps,
          completedInWeek: tasks.filter(
            t => t.completed && t.completedBy === name && isCompletedInWeek(t, currentMonday)
          ).length,
        };
      });

    // Standard competition ranking — the SAME convention the Tasks page
    // documents (src/app/tasks/page.tsx: "Tied points share a rank … so equal
    // scores don't read as 1st vs 2nd"): a tie shares the previous rank and the
    // next rank is SKIPPED, so 100/100/60/60/10 ranks 1, 1, 3, 3, 5. This hook
    // feeds Home, the wall and KidHome off the same weekData the Tasks page
    // renders, so an ordinal rank here read "1st / 2nd" on Home and
    // "1st / 1st / 3rd" on Tasks for one and the same week.
    //
    // A new (un-tied) group takes its POSITION + 1, and only a tie repeats the
    // previous rank. The repeated rank is carried in a local instead of read
    // back off the previous row, because the rows still carry the `rank: 0`
    // placeholder here — which is exactly what page.tsx:2121-2124 does today,
    // so its tied rows print "#0". The page owner needs the same carry.
    let lastPoints: number | null = null;
    let lastRank = 0;
    return roster
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .map((e, i) => {
        const rank = lastPoints !== null && e.points === lastPoints ? lastRank : i + 1;
        lastPoints = e.points;
        lastRank = rank;
        return { ...e, rank };
      });
  }, [weekData, tasks, hall, mounted, allTime.totals]);

  return {
    data: {
      entries,
      weekData: weekData || { weekStart: "", points: {}, streak: {}, lastActive: {}, history: [] },
      tasks,
      daysUntilReset,
      previousRanks,
      hall,
      allTime: { state: allTime.state, updatedAt: allTime.updatedAt },
    } as LeaderboardData,
    mounted,
  };
}
