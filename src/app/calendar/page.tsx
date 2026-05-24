"use client";

import { useState, useEffect, useMemo } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import AnimatedEmoji from "@/components/ui/AnimatedEmoji";
import Link from "next/link";
import { db } from "@/db";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse "4:00 PM" | "10:00 AM" → minutes since midnight for accurate sort */
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

const members = db.selectMembersForCalendar();

interface CalEvent {
  id: number;
  title: string;
  time: string;
  member: string;
  color: "green" | "violet" | "amber" | "cyan" | "rose";
  emoji: string;
  day: number;
}

const events: CalEvent[] = [
  { id: 1, title: "Soccer Practice", time: "4:00 PM", member: "Caspian", color: "violet", emoji: "⚽", day: 18 },
  { id: 2, title: "Piano Lesson", time: "3:00 PM", member: "Emily", color: "amber", emoji: "🎹", day: 19 },
  { id: 3, title: "Team Dinner", time: "7:00 PM", member: "Jeffery (Dad)", color: "cyan", emoji: "🍽️", day: 19 },
  { id: 4, title: "Dentist — Emily", time: "2:00 PM", member: "Emily", color: "amber", emoji: "🦷", day: 21 },
  { id: 5, title: "Car Service", time: "10:00 AM", member: "Jeffery (Dad)", color: "cyan", emoji: "🚗", day: 21 },
  { id: 6, title: "Movie Night", time: "8:00 PM", member: "All", color: "green", emoji: "🎬", day: 22 },
  { id: 7, title: "Park Picnic", time: "11:00 AM", member: "All", color: "green", emoji: "🌳", day: 23 },
  { id: 8, title: "Grocery Run", time: "10:00 AM", member: "Rebecca (Mom)", color: "green", emoji: "🛒", day: 20 },
  { id: 9, title: "Swim Class", time: "9:00 AM", member: "Caspian", color: "violet", emoji: "🏊", day: 25 },
  { id: 10, title: "Book Club", time: "6:30 PM", member: "Rebecca (Mom)", color: "green", emoji: "📚", day: 26 },
];

const dotColors: Record<string, string> = {
  green: "bg-[var(--color-accent-selected)]/400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
  cyan: "bg-cyan-400",
  rose: "bg-rose-400",
};

const badgeVariants: Record<string, "green" | "violet" | "amber" | "cyan" | "rose"> = {
  green: "green", violet: "violet", amber: "amber", cyan: "cyan", rose: "rose",
};

interface ScheduleItem {
  id: number;
  title: string;
  time: string;
  days: string;
  type: "routine" | "reminder";
  icon: string;
  color: string;
}

const initialSchedules: ScheduleItem[] = db.selectTodaysSchedulesRaw().map((s: any) => ({
  ...s,
  days: "all" as string,
  icon: s.emoji || s.icon || "⏰",
}));

const dayLabels: Record<string, string> = {
  all: "Every day", weekdays: "Weekdays", weekends: "Weekends", friday: "Fridays",
};
const colorLabels: Record<string, string> = {
  green: "Green", amber: "Amber", cyan: "Cyan", violet: "Violet", rose: "Rose",
};
const colorBG: Record<string, string> = {
  green: "bg-nori-500/15", amber: "bg-amber-500/15", cyan: "bg-cyan-500/15", violet: "bg-accent-violet/15", rose: "bg-accent-rose/15",
};

const emptySchedule = (): ScheduleItem => ({
  id: Date.now(), title: "", time: "08:00", days: "all", type: "routine", icon: "⏰", color: "green",
});

const EVENTS_STORAGE_KEY = "consuela-events";
const SCHEDULES_STORAGE_KEY = "consuela-schedules";
const SCHEDULES_VERSION_KEY = "consuela-schedules-v";
const SCHEDULES_VERSION = 3; // bump to clear stale localStorage

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [filterMember, setFilterMember] = useState("All");
  const [activeTab, setActiveTab] = useState<"calendar" | "schedule">("calendar");
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // Calendar events state
  const [calEvents, setCalEvents] = useState<CalEvent[]>(() => loadFromStorage(EVENTS_STORAGE_KEY, events));
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState<CalEvent>({ id: 0, title: "", time: "", member: "All", color: "green", emoji: "📅", day: selectedDay });
  const [isAddingEvent, setIsAddingEvent] = useState(false);

  // Schedule state
  const [schedules, setSchedules] = useState<ScheduleItem[]>(() => {
    if (typeof window !== "undefined") {
      const storedVersion = localStorage.getItem(SCHEDULES_VERSION_KEY);
      if (storedVersion === String(SCHEDULES_VERSION)) {
        return loadFromStorage(SCHEDULES_STORAGE_KEY, initialSchedules);
      }
      // Version mismatch — clear stale data
      localStorage.removeItem(SCHEDULES_STORAGE_KEY);
      localStorage.setItem(SCHEDULES_VERSION_KEY, String(SCHEDULES_VERSION));
    }
    return initialSchedules;
  });
  const [editingSchedId, setEditingSchedId] = useState<number | null>(null);
  const [schedForm, setSchedForm] = useState<ScheduleItem>(emptySchedule());
  const [isAddingSched, setIsAddingSched] = useState(false);

  useEffect(() => {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(calEvents));
  }, [calEvents]);

  useEffect(() => {
    localStorage.setItem(SCHEDULES_STORAGE_KEY, JSON.stringify(schedules));
  }, [schedules]);

  // Pre-sort schedules for display (handles both raw 24h and formatted AM/PM)
  const sortedSchedules = useMemo(() => {
    return [...schedules].sort((a, b) => {
      const getMinutes = (t: string) => parseTimeToMinutes(t) || parseInt(t.replace(':', ''), 10);
      return getMinutes(a.time) - getMinutes(b.time);
    });
  }, [schedules]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedEvents = calEvents.filter(
    (e) => e.day === selectedDay && (filterMember === "All" || e.member === filterMember || e.member === "All")
  );

  const dayEventMap = new Map<number, CalEvent[]>();
  calEvents.forEach((e) => {
    if (!dayEventMap.has(e.day)) dayEventMap.set(e.day, []);
    dayEventMap.get(e.day)!.push(e);
  });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Event CRUD
  const startAddEvent = () => {
    setEventForm({ id: 0, title: "", time: "12:00 PM", member: "All", color: "green", emoji: "📅", day: selectedDay });
    setIsAddingEvent(true);
    setEditingEventId(null);
  };
  const startEditEvent = (ev: CalEvent) => {
    setEventForm({ ...ev });
    setEditingEventId(ev.id);
    setIsAddingEvent(false);
  };
  const cancelEventEdit = () => { setEditingEventId(null); setIsAddingEvent(false); };
  const saveEvent = () => {
    if (!eventForm.title.trim()) return;
    if (isAddingEvent) {
      setCalEvents(prev => [...prev, { ...eventForm, id: Date.now() }]);
    } else {
      setCalEvents(prev => prev.map(e => e.id === editingEventId ? { ...eventForm } : e));
    }
    cancelEventEdit();
  };
  const deleteEvent = (id: number) => {
    setCalEvents(prev => prev.filter(e => e.id !== id));
    cancelEventEdit();
  };

  // Schedule CRUD
  const startAddSched = () => {
    setSchedForm(emptySchedule());
    setIsAddingSched(true);
    setEditingSchedId(null);
  };
  const startEditSched = (s: ScheduleItem) => {
    setSchedForm({ ...s });
    setEditingSchedId(s.id);
    setIsAddingSched(false);
  };
  const cancelSchedEdit = () => { setEditingSchedId(null); setIsAddingSched(false); };
  const saveSched = () => {
    if (!schedForm.title.trim()) return;
    if (isAddingSched) {
      setSchedules(prev => [...prev, { ...schedForm, id: Date.now() }]);
    } else {
      setSchedules(prev => prev.map(s => s.id === editingSchedId ? { ...schedForm } : s));
    }
    cancelSchedEdit();
  };
  const deleteSched = (id: number) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    cancelSchedEdit();
  };

  return (
    <PageShell>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-2xl border transition-all animate-[slideDown_0.3s_ease] ${
          toast.includes("❌") ? "bg-rose-500/20 border-rose-500/30 text-rose-300" : "bg-nori-500/20 border-nori-500/30 text-nori-300"
        }`} style={{ backdropFilter: "blur(20px)" }}>
          {toast}
        </div>
      )}
      <TopBar
        title="Calendar"
        subtitle="Garcia Family"
        right={
          activeTab === "calendar" ? (
            <button onClick={startAddEvent} className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <button onClick={startAddSched} className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          )
        }
      />

      <div className="px-4 space-y-4">
        {/* Tabs */}
        <div className="flex bg-surface-2 rounded-xl p-1 gap-1">
          {(["calendar", "schedule"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                activeTab === tab ? "bg-surface-0 text-text-primary shadow" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab === "calendar" ? "📅 Calendar" : "⏰ Schedule"}
            </button>
          ))}
        </div>

        {activeTab === "calendar" && (
          <>
            {/* Google Calendar sync button */}
            <div className="flex items-center justify-end mb-1">
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/google-calendar");
                    const data = await res.json();
                    if (data.events?.length) {
                      const merged = [...calEvents];
                      for (const ge of data.events) {
                        if (!merged.find(e => e.title === ge.title && e.day === new Date(ge.date).getDate())) {
                          merged.push({
                            id: Date.now() + Math.random(),
                            title: ge.title,
                            time: ge.time || "12:00 PM",
                            member: "Google",
                            color: "cyan" as const,
                            emoji: "📅",
                            day: new Date(ge.date).getDate(),
                          });
                        }
                      }
                      setCalEvents(merged);
                      showToast(`✅ Synced ${data.events.length} Google events`);
                    } else {
                      showToast("No Google Calendar events found");
                    }
                  } catch {
                    showToast("❌ Sync failed");
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
                  <path d="M21 3v4h-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 3l-7 7" strokeLinecap="round" />
                </svg>
                Sync Google
              </button>
            </div>
            {/* Member filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              <button
                onClick={() => setFilterMember("All")}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filterMember === "All" ? "bg-nori-500/20 text-nori-400 border border-nori-500/30" : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                }`}
              >
                <span>👥 All</span>
              </button>
              {members.map((m: any) => (
                <button
                  key={m.name}
                  onClick={() => setFilterMember(m.name)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterMember === m.name ? "bg-nori-500/20 text-nori-400 border border-nori-500/30" : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
                  }`}
                >
                  <AnimatedEmoji emoji={m.emoji} name={m.name} size="sm" />
                  <span>{m.name}</span>
                </button>
              ))}
            </div>

            {/* Add/Edit Event Form */}
            {(isAddingEvent || editingEventId !== null) && (
              <Card className="!p-4 space-y-3">
                <h4 className="text-text-primary font-semibold text-sm">{isAddingEvent ? "Add Event" : "Edit Event"}</h4>
                <input type="text" placeholder="Event title" value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })}
                  className="w-full bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Time (e.g. 4:00 PM)" value={eventForm.time} onChange={e => setEventForm({ ...eventForm, time: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <input type="text" placeholder="Emoji" value={eventForm.emoji} onChange={e => setEventForm({ ...eventForm, emoji: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <input type="text" placeholder="Member" value={eventForm.member} onChange={e => setEventForm({ ...eventForm, member: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <input type="number" placeholder="Day" value={eventForm.day} onChange={e => setEventForm({ ...eventForm, day: parseInt(e.target.value) || 1 })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                </div>
                <div className="flex gap-2">
                  {(["green","violet","amber","cyan","rose"] as const).map(c => (
                    <button key={c} onClick={() => setEventForm({ ...eventForm, color: c })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${eventForm.color === c ? "border-white scale-110" : "border-transparent"} ${
                        c === "green" ? "bg-nori-500" : c === "violet" ? "bg-violet-500" : c === "amber" ? "bg-amber-500" : c === "cyan" ? "bg-cyan-500" : "bg-rose-500"
                      }`} />
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveEvent} disabled={!eventForm.title.trim()} className="flex-1 py-2 rounded-lg bg-nori-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-nori-400">
                    {isAddingEvent ? "Add Event" : "Save"}
                  </button>
                  <button onClick={cancelEventEdit} className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary">Cancel</button>
                  {!isAddingEvent && (
                    <button onClick={() => deleteEvent(eventForm.id)} className="px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 text-sm font-medium hover:bg-rose-500/25">🗑️</button>
                  )}
                </div>
              </Card>
            )}

            {/* Month navigation */}
            <div className="flex items-center justify-between">
              <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-text-primary transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <h2 className="text-text-primary font-semibold text-base">{MONTHS[month]} {year}</h2>
              <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-text-primary transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>

            {/* Calendar grid */}
            <Card className="!p-3">
              <div className="grid grid-cols-7 mb-2">
                {DAYS.map((d) => (<div key={d} className="text-center text-[11px] font-medium text-text-muted py-1">{d}</div>))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {cells.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                  const isSelected = day === selectedDay;
                  const dayEvents = dayEventMap.get(day) ?? [];
                  const visibleDots = dayEvents.slice(0, 3);
                  return (
                    <button key={i} onClick={() => setSelectedDay(day)}
                      className={`flex flex-col items-center py-1.5 rounded-xl transition-all ${
                        isSelected ? "bg-nori-500 text-white" : isToday ? "bg-nori-500/15 text-nori-400" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                      }`}>
                      <span className="text-xs font-medium leading-none mb-1">{day}</span>
                      <div className="flex gap-0.5">
                        {visibleDots.map((ev, di) => (<div key={di} className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/70" : dotColors[ev.color]}`} />))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Selected day events */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">
                  {selectedDay === today.getDate() && month === today.getMonth() ? "Today" : `${MONTHS[month].slice(0, 3)} ${selectedDay}`}
                  {" "}<span className="text-text-muted font-normal">({selectedEvents.length} events)</span>
                </h3>
                <button onClick={startAddEvent} className="text-nori-400 text-xs hover:text-nori-300">+ Add</button>
              </div>
              {selectedEvents.length === 0 ? (
                <Card className="!p-6 flex flex-col items-center gap-2">
                  <span className="text-3xl">📅</span>
                  <p className="text-text-secondary text-sm text-center">No events this day</p>
                  <button onClick={startAddEvent} className="text-nori-400 text-xs mt-1 hover:text-nori-300">+ Add one manually →</button>
                </Card>
              ) : (
                <div className="space-y-2">
                  {[...selectedEvents].sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)).map((ev) => (
                    <div key={ev.id} className="flex items-center gap-1">
                      <Card className="!p-3 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center text-lg shrink-0">
                            <AnimatedEmoji emoji={ev.emoji} size="sm" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-text-primary text-sm font-medium truncate">{ev.title}</p>
                            <p className="text-text-muted text-xs mt-0.5">{ev.time}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge variant={badgeVariants[ev.color] ?? "gray"}>{ev.member}</Badge>
                          </div>
                        </div>
                      </Card>
                      <button onClick={() => startEditEvent(ev)} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-nori-400 hover:bg-nori-500/10 transition-colors shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming */}
            <section className="pb-2">
              <h3 className="text-text-primary font-semibold text-sm mb-3">Upcoming</h3>
              <div className="space-y-2">
                {calEvents.filter((e) => e.day > selectedDay).sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)).slice(0, 4).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-3 px-1">
                    <div className={`w-1 h-8 rounded-full shrink-0 ${dotColors[ev.color]}`} />
                    <div className="w-10 text-center">
                      <p className="text-[10px] text-text-muted">{MONTHS[month].slice(0, 3)}</p>
                      <p className="text-sm font-semibold text-text-primary leading-tight">{ev.day}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm truncate">{ev.title}</p>
                      <p className="text-text-muted text-xs">{ev.time} · {ev.member}</p>
                    </div>
                    <div className="shrink-0"><AnimatedEmoji emoji={ev.emoji} size="sm" /></div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === "schedule" && (
          <>
            {/* Add/Edit Schedule Form */}
            {(isAddingSched || editingSchedId !== null) && (
              <Card className="!p-4 space-y-3">
                <h4 className="text-text-primary font-semibold text-sm">{isAddingSched ? "Add Schedule Item" : "Edit Schedule Item"}</h4>
                <input type="text" placeholder="Title" value={schedForm.title} onChange={e => setSchedForm({ ...schedForm, title: e.target.value })}
                  className="w-full bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3 focus:border-nori-500/50 placeholder:text-text-muted" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Time (HH:MM)" value={schedForm.time} onChange={e => setSchedForm({ ...schedForm, time: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <input type="text" placeholder="Icon emoji" value={schedForm.icon} onChange={e => setSchedForm({ ...schedForm, icon: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3" />
                  <select value={schedForm.days} onChange={e => setSchedForm({ ...schedForm, days: e.target.value })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    {Object.entries(dayLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={schedForm.type} onChange={e => setSchedForm({ ...schedForm, type: e.target.value as "routine" | "reminder" })}
                    className="bg-surface-2 text-text-primary text-sm rounded-lg px-3 py-2 outline-none border border-surface-3">
                    <option value="routine">🔄 Routine</option>
                    <option value="reminder">🔔 Reminder</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  {(["green","amber","cyan","violet","rose"] as const).map(c => (
                    <button key={c} onClick={() => setSchedForm({ ...schedForm, color: c })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${schedForm.color === c ? "border-white scale-110" : "border-transparent"} ${
                        c === "green" ? "bg-nori-500" : c === "amber" ? "bg-amber-500" : c === "cyan" ? "bg-cyan-500" : c === "violet" ? "bg-violet-500" : "bg-rose-500"
                      }`} />
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveSched} disabled={!schedForm.title.trim()} className="flex-1 py-2 rounded-lg bg-nori-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-nori-400">
                    {isAddingSched ? "Add" : "Save"}
                  </button>
                  <button onClick={cancelSchedEdit} className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm font-medium hover:text-text-primary">Cancel</button>
                  {!isAddingSched && (
                    <button onClick={() => deleteSched(schedForm.id)} className="px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 text-sm font-medium hover:bg-rose-500/25">🗑️</button>
                  )}
                </div>
              </Card>
            )}

            {/* Schedule list */}
            <section className="pb-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text-primary font-semibold text-sm">Daily Schedule</h3>
                <button onClick={startAddSched} className="text-nori-400 text-xs hover:text-nori-300">+ Add</button>
              </div>
              {schedules.length === 0 ? (
                <Card className="!p-6 flex flex-col items-center gap-2">
                  <span className="text-3xl">⏰</span>
                  <p className="text-text-secondary text-sm">No schedule items</p>
                </Card>
              ) : (
                <div className="space-y-1.5">
                  {sortedSchedules.map((item) => (
                    <div key={item.id} className="flex items-center gap-1">
                      <div className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl ${colorBG[item.color] ?? "bg-nori-500/15"}`}>
                        <span className="text-xs font-mono text-text-muted w-12 shrink-0 tabular-nums">{item.time}</span>
                        <span className="text-lg shrink-0">{item.icon}</span>
                        <span className="text-sm text-text-primary flex-1 min-w-0">{item.title}</span>
                        <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-full bg-surface-3">{dayLabels[item.days] ?? item.days}</span>
                        <Badge variant={item.type === "routine" ? "amber" : "rose"}>{item.type}</Badge>
                      </div>
                      <button onClick={() => startEditSched(item)} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-nori-400 hover:bg-nori-500/10 transition-colors shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <style jsx global>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </PageShell>
  );
}
