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

            const startEdit = () => {
              setEditingId(item.id);
              setEditTime(item.time);
              setEditTitle(item.title);
            };
            const saveEdit = () => {
              if (editingId !== null) onEdit?.(editingId, editTime, editTitle);
              setEditingId(null);
            };
            const cancelEdit = () => setEditingId(null);
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${colorClass} ${
                  isPast ? "opacity-40" : ""
                }`}
              >
                {editingId === item.id ? (
                  <>
                    <input type="time" value={editTime} onChange={e=>setEditTime(e.target.value)} className="w-16 text-xs bg-surface-2 rounded" aria-label="Edit time" />
                    <input value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="flex-1 text-sm bg-surface-2 rounded px-1" placeholder="Title" aria-label="Edit title" onBlur={saveEdit} onKeyDown={e=>{if(e.key==='Enter')saveEdit(); if(e.key==='Escape')cancelEdit();}} autoFocus />
                  </>
                ) : (
                  <>
                    <span className="text-xs font-bold text-text-primary w-12 cursor-pointer" onClick={startEdit}>{item.time}</span>
                    <span className="text-xl">{item.emoji || item.icon || "•"}</span>
                    <span className="text-sm font-medium text-text-primary flex-1 cursor-pointer" onClick={startEdit}>{item.title}</span>
                  </>
                )}
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