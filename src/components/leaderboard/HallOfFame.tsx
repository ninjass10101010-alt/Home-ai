/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Avatar from "@/components/ui/Avatar";
import { loadHallOfFame } from "@/lib/task-utils";
import { useState, useEffect } from "react";

export default function HallOfFame() {
  const [hall, setHall] = useState<any[]>([]);
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

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary mb-2">Hall of Fame</p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {uniqueWinners.map((winner: any) => (
          <div key={winner.member + winner.weekStart} className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative">
              <span className="absolute -top-1 -right-1 text-[10px] bg-amber-400 text-black rounded-full w-4 h-4 flex items-center justify-center font-bold">{winner.wins}</span>
              <Avatar name={winner.member} color="green" emoji={winner.emoji} size="sm" variant="emoji" />
            </div>
            <span className="text-[10px] text-text-muted truncate max-w-[60px]">{winner.member.split(" ")[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}