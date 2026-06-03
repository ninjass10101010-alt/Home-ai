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

  const { colors, accentRgb } = useAtmosphericTheme();

  const { sortedSchedule, upcomingCount } = useMemo(() => {
    // Filter out past items, then sort by time
    const upcoming = schedule.filter(item => parseTimeToMinutes(item.time) >= nowMinutes);
    const sorted = [...upcoming].sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    return { sortedSchedule: sorted, upcomingCount: sorted.length };
  }, [schedule, nowMinutes]);

  if (schedule.length === 0) {
    return (
        <section className={`${className} glass isometric-card`} style={{ boxShadow: `0 0 24px ${colors.glow}` }}>
        <h2 className={`font-semibold text-base mb-3`} style={{ color: colors.accentColor }}>{title}</h2>
        <div className="flex flex-col items-center gap-2 py-6 text-text-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-surface-5">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round" />
          </svg>
          <p className="text-xs">No items scheduled</p>
        </div>
      </section>
    );
  }

  const getAccentBg = (colorName: string): string => {
    if (colorName === "green") return `rgba(${accentRgb},0.15)`;
    if (colorName === "amber") return `rgba(251,191,36,0.15)`;
    if (colorName === "cyan") return `rgba(6,182,212,0.15)`;
    if (colorName === "violet") return `rgba(139,92,246,0.15)`;
    if (colorName === "rose") return `rgba(244,63,94,0.15)`;
    if (colorName === "blue") return `rgba(59,130,246,0.15)`;
    if (colorName === "indigo") return `rgba(99,102,241,0.15)`;
    if (colorName === "pink") return `rgba(236,72,153,0.15)`;
    if (colorName === "teal") return `rgba(20,184,166,0.15)`;
    return `rgba(${accentRgb},0.15)`;
  };

  const getItemAccentTextColor = (colorName: string): string => {
    // Color-tint the title text to match Calendar schedule color chips.
    // We only have accentRgb from atmospheric theme, so use fixed Tailwind-compatible
    // rgba values via inline styles.
    if (!colorName) return colors.accentColor;

    const map: Record<string, { r: number; g: number; b: number }> = {
      green: { r: 34, g: 197, b: 94 }, // emerald-ish
      amber: { r: 245, g: 158, b: 11 }, // amber-ish
      cyan: { r: 6, g: 182, b: 212 }, // cyan-ish
      violet: { r: 139, g: 92, b: 246 }, // violet-ish
      rose: { r: 244, g: 63, b: 94 }, // rose-ish
      blue: { r: 59, g: 130, b: 246 },
      indigo: { r: 99, g: 102, b: 241 },
      pink: { r: 236, g: 72, b: 153 },
      teal: { r: 20, g: 184, b: 166 },
    };

    const rgb = map[colorName];
    if (!rgb) return colors.accentColor;

    return `rgba(${rgb.r},${rgb.g},${rgb.b},1)`;
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
              style={{
                animationDelay: `${idx * 0.05}s`,
                boxShadow: `0 0 24px ${colors.glow}`,
                background: getAccentBg(item.color || "green"),
              }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 animate-in`}
            >
              <span className="text-xs font-mono text-text-muted w-12 shrink-0 tabular-nums">{item.time}</span>
              <span className="text-lg shrink-0">{item.emoji || item.icon || "•"}</span>

              <span
                className="text-sm flex-1 min-w-0"
                style={{ color: "#000000" }}
              >
                {item.title}
              </span>

              {item.member && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full transition-all duration-200"
                  style={{
                    background: getAccentBg(item.color || "green"),
                    color: "#000000",
                  }}
                >
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
