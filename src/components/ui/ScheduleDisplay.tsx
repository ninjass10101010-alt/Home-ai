"use client";

import { useMemo } from "react";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

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
  // Supports:
  // - "8:00 AM" / "2:30 PM"
  // - "07:00" / "18:30" (24h from calendar schedule editor)
  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const ampm = ampmMatch[3].toUpperCase();
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const time24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) {
    const hours = parseInt(time24Match[1], 10);
    const minutes = parseInt(time24Match[2], 10);
    return hours * 60 + minutes;
  }

  return 0;
}

export default function ScheduleDisplay({ schedule, title = "Today's Schedule", className = "" }: ScheduleDisplayProps) {
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const { accentRgb } = useAtmosphericTheme();

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
        <div className="liquid-glass flex flex-col items-center gap-2 py-6 text-text-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-text-muted">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83" strokeLinecap="round" />
          </svg>
          <p className="text-xs">No items scheduled</p>
        </div>
      </section>
    );
  }

  const colorRgbMap: Record<string, [number, number, number]> = {
    green: [74, 222, 128],
    amber: [245, 158, 11],
    cyan: [6, 182, 212],
    violet: [124, 111, 247],
    rose: [244, 63, 94],
    blue: [59, 130, 246],
    indigo: [99, 102, 241],
    pink: [236, 72, 153],
    teal: [20, 184, 166],
  };

  const getAccentRgb = (colorName: string): [number, number, number] => {
    if (colorRgbMap[colorName]) return colorRgbMap[colorName];
    // Fallback: parse from accentRgb string "r,g,b"
    const parts = accentRgb.split(",").map((n) => parseInt(n.trim(), 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2]];
    }
    return [59, 130, 246];
  };

  // Glass frosting: brighter at top, fading to bottom (creates 3D depth)
  const getLiquidGlassBg = (colorName: string): string => {
    const [r, g, b] = getAccentRgb(colorName);
    return `linear-gradient(135deg, rgba(${r},${g},${b},0.40) 0%, rgba(${r},${g},${b},0.20) 100%)`;
  };

  // Member pill uses the same color but a bit more saturated for contrast
  const getMemberPillBg = (colorName: string): string => {
    const [r, g, b] = getAccentRgb(colorName);
    return `linear-gradient(135deg, rgba(${r},${g},${b},0.55) 0%, rgba(${r},${g},${b},0.30) 100%)`;
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
        <div className="space-y-2">
          {sortedSchedule.map((item, idx) => {
            const [r, g, b] = getAccentRgb(item.color || "green");
            return (
            <div
              key={item.id}
              style={{
                animationDelay: `${idx * 0.05}s`,
                background: getLiquidGlassBg(item.color || "green"),
              }}
              className="liquid-glass flex items-center gap-3 px-3 py-2.5 animate-in"
            >
              {/* Glowing accent bar */}
              <div
                className="w-0.5 h-8 rounded-full shrink-0"
                style={{
                  backgroundColor: `rgb(${r},${g},${b})`,
                  boxShadow: `0 0 8px rgb(${r},${g},${b})`,
                }}
              />
              <span className="text-xs font-mono text-text-secondary w-12 shrink-0 tabular-nums">{item.time}</span>
              <span className="text-lg shrink-0 drop-shadow-sm">{item.emoji || item.icon || "•"}</span>

              <span className="text-sm text-text-primary flex-1 min-w-0">
                {item.title}
              </span>

              {item.member && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full text-text-primary shrink-0 glass-subtle"
                  style={{
                    background: getMemberPillBg(item.color || "green"),
                  }}
                >
                  {item.member.split(" ")[0]}
                </span>
              )}
            </div>
            );
          })}
        </div>
      )}

    </section>
  );
}
