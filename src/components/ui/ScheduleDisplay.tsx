"use client";

import { useMemo } from "react";

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
  const sortedSchedule = useMemo(() => {
    return [...schedule].sort((a, b) => {
      const timeA = a.time.replace(":", "");
      const timeB = b.time.replace(":", "");
      return timeA.localeCompare(timeB);
    });
  }, [schedule]);

  if (schedule.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="text-text-primary font-semibold text-base mb-3">{title}</h2>
      <div className="space-y-2">
        {sortedSchedule.map((item) => {
          const hour = parseInt(item.time.split(":")[0]);
          const isPast = hour < new Date().getHours();
          const colorClass = item.color === "green" ? "bg-green-500/20" :
                            item.color === "amber" ? "bg-amber-500/20" :
                            item.color === "cyan" ? "bg-cyan-500/20" :
                            item.color === "violet" ? "bg-violet-500/20" :
                            "bg-nori-500/20";

          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl ${colorClass} ${
                isPast ? "opacity-50" : ""
              }`}
            >
              <span className="text-xs font-medium text-text-primary w-14">{item.time}</span>
              <span className="text-lg">{item.emoji || item.icon || "•"}</span>
              <span className="text-sm text-text-primary flex-1">{item.title}</span>
              {item.member && (
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${item.memberColor || "surface"}-500/20 text-text-secondary`}>
                  {item.member.split(" ")[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}