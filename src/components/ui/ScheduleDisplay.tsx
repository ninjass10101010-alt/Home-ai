"use client";

import { useMemo, useState, useEffect } from "react";

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
  onEdit?: (id: number, time: string, title: string) => void;
}

export default function ScheduleDisplay({ schedule, title = "Today's Schedule", className = "", onEdit }: ScheduleDisplayProps) {
  const [mounted, setMounted] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTime, setEditTime] = useState("");
  const [editTitle, setEditTitle] = useState("");

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

  const upcomingCount = schedule.filter(item => {
    const hour = parseInt(item.time.split(":")[0]);
    return hour >= new Date().getHours();
  }).length;

  const colorBgMap: Record<string, string> = {
    green:  "bg-nori-500/15",
    amber:  "bg-amber-500/15",
    cyan:   "bg-cyan-500/15",
    violet: "bg-accent-violet/15",
    rose:   "bg-accent-rose/15",
  };

  const currentHour = mounted ? new Date().getHours() : 0;

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-text-primary font-semibold text-base">{title}</h2>
        <span className="text-text-muted text-[10px] font-medium">
          {upcomingCount} upcoming
        </span>
      </div>
      <div className="space-y-1.5">
        {sortedSchedule.map((item, idx) => {
          const hour = parseInt(item.time.split(":")[0]);
          const isPast = mounted && hour < currentHour;

          const startEdit = () => {
            if (onEdit) {
              setEditingId(item.id);
              setEditTime(item.time);
              setEditTitle(item.title);
            }
          };

          const saveEdit = () => {
            if (editingId !== null) onEdit?.(editingId, editTime, editTitle);
            setEditingId(null);
          };

          const cancelEdit = () => setEditingId(null);

          return (
            <div
              key={item.id}
              style={{ animationDelay: `${idx * 0.05}s` }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${colorBgMap[item.color ?? "green"] ?? "bg-nori-500/15"} transition-all duration-200 hover:bg-white/[0.06] animate-in ${isPast ? 'opacity-40' : ''}`}
            >
              {editingId === item.id ? (
                <>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-20 text-xs bg-white/10 rounded px-1.5 py-0.5 text-text-primary border border-white/20 focus:outline-none focus:border-white/40"
                    aria-label="Edit time"
                  />
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 text-sm bg-white/10 rounded px-2 py-0.5 text-text-primary border border-white/20 focus:outline-none focus:border-white/40"
                    placeholder="Title"
                    aria-label="Edit title"
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    autoFocus
                  />
                </>
              ) : (
                <>
                  <span
                    className={`text-xs font-mono text-text-muted w-12 shrink-0 tabular-nums ${onEdit ? 'cursor-pointer hover:text-text-primary transition-colors' : ''}`}
                    onClick={startEdit}
                  >
                    {item.time}
                  </span>
                  <span className="text-lg shrink-0">{item.emoji || item.icon || "•"}</span>
                  <span
                    className={`text-sm flex-1 min-w-0 ${isPast ? 'line-through text-text-muted' : 'text-text-primary'} ${onEdit ? 'cursor-pointer hover:text-text-secondary transition-colors' : ''}`}
                    onClick={startEdit}
                  >
                    {item.title}
                  </span>
                </>
              )}
              {item.member && (
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-text-secondary shrink-0`}>
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
