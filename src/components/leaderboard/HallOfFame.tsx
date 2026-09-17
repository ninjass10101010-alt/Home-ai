/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Avatar from "@/components/ui/Avatar";
import { loadHallOfFame } from "@/lib/task-utils";
import type { HallOfFameEntry } from "@/types/tasks";
import { useState, useEffect } from "react";

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

// "2026-09-07" → "Sep 7" (noon parse keeps the date stable across timezones).
function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HallOfFame() {
  const [hall, setHall] = useState<HallOfFameEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHall(loadHallOfFame());
    setMounted(true);
  }, []);

  if (!mounted || hall.length === 0) return null;

  const uniqueWinners = hall.reduce((acc: any[], entry: any) => {
    const existing = acc.find(w => w.member === entry.member);
    if (existing) {
      existing.wins += 1;
    } else {
      acc.push({ ...entry, wins: 1 });
    }
    return acc;
  }, []).sort((a: any, b: any) => b.wins - a.wins || b.points - a.points);

  // Recent week entries, latest week first — each row keeps the prize text
  // frozen at rollover (spec §4.3), so a later prize edit never rewrites it.
  const weekEntries = [...hall].sort(
    (a, b) => b.weekStart.localeCompare(a.weekStart) || a.rank - b.rank
  );

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Hall of Fame</p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {uniqueWinners.map((winner: any) => (
          <div key={winner.member + winner.weekStart} className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative">
              <span className="absolute -top-1 -right-1 text-[10px] bg-[var(--color-accent-amber)] text-black rounded-full w-4 h-4 flex items-center justify-center font-bold">{winner.wins}</span>
              <Avatar name={winner.member} color="green" emoji={winner.emoji} size="sm" variant="emoji" />
            </div>
            <span className="text-[10px] text-text-muted truncate max-w-[60px]">{winner.member.split(" ")[0]}</span>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {weekEntries.map((entry) => (
          <li
            key={`${entry.member}-${entry.weekStart}-${entry.rank}`}
            className="flex items-center gap-2 text-xs"
          >
            <span className="shrink-0 text-text-muted">Week of {weekLabel(entry.weekStart)}</span>
            <span aria-hidden="true">{MEDALS[entry.rank] ?? "🏅"}</span>
            <span className="font-medium text-text-primary">{entry.member.split(" ")[0]}</span>
            <span className="text-text-muted">{entry.points} pts</span>
            {typeof entry.prize === "string" && entry.prize.length > 0 && (
              <span className="ml-auto truncate text-text-secondary">🎁 {entry.prize}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}