"use client";

import { useMemo, useState, useEffect } from "react";
import Card from "./Card";

interface ScheduleItem {
  id: number;
  title: string;
  time: string;
  member?: string;
  memberColor?: string;
  emoji?: string;
  type: "routine" | "reminder";
  icon?: string;
  color?: string;
}

interface ScheduleDisplayProps {
  schedule: ScheduleItem[];
  title?: string;
  className?: string;
}

export default function ScheduleDisplay({ schedule, title = "Today's Schedule", className = "" }: ScheduleDisplayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sortedSchedule = useMemo(() => {
    return [...schedule].sort((a, b) => {
      const timeA = a.time.replace(":", "");
      const timeB = b.time.replace(":", "");
      return timeA.localeCompare(timeB);
    });
  }, [schedule]);

  if (schedule.length === 0) return null;

  const currentHour = mounted ? new Date().getHours() : 0;

  return (
    <section className={className}>
      <h2 className="text-text-primary font-semibold text-base mb-3">{title}</h2>
      <Card className="!p-2">
        <div className="space-y-1">
          {sortedSchedule.map((item) => {
            const hour = parseInt(item.time.split(":")[0]);
            const isPast = mounted && hour < currentHour;
            const colorClass = item.color === "green" ? "bg-green-500/10 border-green-500/20" :
                              item.color === "amber" ? "bg-amber-500/10 border-amber-500/20" :
                              item.color === "cyan" ? "bg-cyan-500/10 border-cyan-500/20" :
                              item.color === "violet" ? "bg-violet-500/10 border-violet-500/20" :
                              "bg-nori-500/10 border-nori-500/20";

            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${colorClass} ${
                  isPast ? "opacity-40" : ""
                }`}
              >
                <span className="text-xs font-bold text-text-primary w-12">{item.time}</span>
                <span className="text-xl">{item.emoji || item.icon || "•"}</span>
                <span className="text-sm font-medium text-text-primary flex-1">{item.title}</span>
                {item.member && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-text-secondary">
                    {item.member.split(" ")[0]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}