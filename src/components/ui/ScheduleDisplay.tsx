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

/** Parse "8:00 AM" | "2:30 PM" → minutes since midnight for accurate sort + comparison */
function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export default function ScheduleDisplay({ schedule, title = "Today's Schedule", className = "" }: ScheduleDisplayProps) {
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const { sortedSchedule, upcomingCount } = useMemo(() => {
    // Filter out past items, then sort by time
    const upcoming = schedule.filter(item => parseTimeToMinutes(item.time) >= nowMinutes);
    const sorted = [...upcoming].sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    return { sortedSchedule: sorted, upcomingCount: sorted.length };
  }, [schedule, nowMinutes]);

  if (schedule.length === 0) {
    return (
      <section className={className}>
        <h2 className="text-text-primary font-semibold text-base mb-3">{title}</h2>
        <div className="flex flex-col items-center gap-2 py-6 text-text-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-surface-5">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round" />
          </svg>
          <p className="text-xs">No items scheduled</p>
        </div>
      </section>
    );
  }

  const colorBgMap: Record<string, string> = {
    green:  "bg-nori-500/15",
    amber:  "bg-amber-500/15",
    cyan:   "bg-cyan-500/15",
    violet: "bg-accent-violet/15",
    rose:   "bg-accent-rose/15",
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-text-primary font-semibold text-base">{title}</h2>
        <span className="text-text-muted text-[10px] font-medium">
          {upcomingCount} upcoming
        </span>
      </div>
      {sortedSchedule.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-text-muted">
          <p className="text-xs">All done for today 🎉</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sortedSchedule.map((item, idx) => (
            <div
              key={item.id}
              style={{ animationDelay: `${idx * 0.05}s` }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${colorBgMap[item.color ?? "green"] ?? "bg-nori-500/15"} transition-all duration-200 hover:bg-white/[0.06] animate-in`}
            >
              <span className="text-xs font-mono text-text-muted w-12 shrink-0 tabular-nums">{item.time}</span>
              <span className="text-lg shrink-0">{item.emoji || item.icon || "•"}</span>
              <span className="text-sm flex-1 min-w-0 text-text-primary">{item.title}</span>
              {item.member && (
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${item.memberColor || "surface"}-500/20 text-text-secondary`}>
                  {item.member.split(" ")[0]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
