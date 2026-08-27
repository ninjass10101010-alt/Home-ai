"use client";

import { useState, useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import WidgetCard from "@/components/patterns/WidgetCard";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import { mapGoogleEvent, eventInMonth } from "@/lib/calendar/google-mapping";
import { db } from "@/db";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
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

function formatTo12Hour(timeStr: string): { hour: string; minute: string; ampm: "AM" | "PM" } {
  const trimmed = (timeStr || "").trim();
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    return {
      hour: String(parseInt(ampmMatch[1], 10) || 12),
      minute: ampmMatch[2].padStart(2, "0"),
      ampm: (ampmMatch[3].toUpperCase() as "AM" | "PM"),
    };
  }
  const time24Match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) {
    const h24 = parseInt(time24Match[1], 10);
    const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return {
      hour: String(h12),
      minute: time24Match[2].padStart(2, "0"),
      ampm,
    };
  }
  return { hour: "8", minute: "00", ampm: "AM" };
}

function build12HourString(hour: string, minute: string, ampm: "AM" | "PM"): string {
  const h = Math.max(1, Math.min(12, parseInt(hour, 10) || 12));
  const m = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

interface CalEvent {
  id: number | string;
  title: string;
  time: string;
  member: string;
  color: "green" | "violet" | "amber" | "cyan" | "rose";
  emoji: string;
  day: number;
  month?: number;
  year?: number;
}

type ScheduleColor =
  | "green" | "amber" | "cyan" | "violet" | "rose"
  | "blue" | "indigo" | "pink" | "teal";

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

const eventColorValues: Record<CalEvent["color"], string> = {
  green: "var(--color-accent-selected)",
  violet: "var(--color-accent-violet)",
  amber: "var(--color-accent-amber)",
  cyan: "var(--color-accent-cyan)",
  rose: "var(--color-accent-rose)",
};

const scheduleColorValues: Record<ScheduleColor, string> = {
  green: "var(--color-accent-selected)",
  amber: "var(--color-accent-amber)",
  cyan: "var(--color-accent-cyan)",
  violet: "var(--color-accent-violet)",
  rose: "var(--color-accent-rose)",
  blue: "var(--color-accent-nori)",
  indigo: "var(--color-accent-violet)",
  pink: "var(--color-accent-rose)",
  teal: "var(--color-accent-cyan)",
};

const badgeVariants: Record<string, "green" | "violet" | "amber" | "cyan" | "rose"> = {
  green: "green", violet: "violet", amber: "amber", cyan: "cyan", rose: "rose",
};

const memberColorValues: Record<string, string> = {
  green: "var(--color-accent-selected)",
  violet: "var(--color-accent-violet)",
  amber: "var(--color-accent-amber)",
  cyan: "var(--color-accent-cyan)",
  rose: "var(--color-accent-rose)",
  blue: "var(--color-accent-nori)",
};

function getMemberColor(member: { color?: string }): string {
  return memberColorValues[member.color ?? "green"] ?? "var(--color-accent-selected)";
}

interface ScheduleItem {
  id: number;
  title: string;
  time: string;
  days: string;
  type: "routine" | "reminder";
  icon: string;
  color: ScheduleColor;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack" | "none";
}

const getInitialSchedules = (): ScheduleItem[] => db.selectTodaysSchedulesRaw().map((s: any) => ({
  ...s,
  days: "all" as string,
  icon: s.emoji || s.icon || "⏰",
  color: (s.color as ScheduleColor) || "green",
}));

const dayLabels: Record<string, string> = {
  all: "Every day", weekdays: "Weekdays", weekends: "Weekends", friday: "Fridays",
};

const scheduleCategories = {
  morning: { label: "Morning", gradient: "from-amber-500/80 to-orange-500/80", hexFrom: "#f59e0b", hexTo: "#f97316", emoji: "\uD83C\uDF05", range: "00:00 \u2013 11:59" },
  afternoon: { label: "Afternoon", gradient: "from-sky-500/80 to-blue-500/80", hexFrom: "#0ea5e9", hexTo: "#3b82f6", emoji: "\u2600\uFE0F", range: "12:00 \u2013 16:59" },
  evening: { label: "Evening", gradient: "from-orange-500/80 to-rose-500/80", hexFrom: "#f97316", hexTo: "#f43f5e", emoji: "\uD83C\uDF06", range: "17:00 \u2013 19:59" },
  night: { label: "Night", gradient: "from-indigo-500/80 to-violet-500/80", hexFrom: "#6366f1", hexTo: "#8b5cf6", emoji: "\uD83C\uDF19", range: "20:00+" },
} as const;

type ScheduleCategory = keyof typeof scheduleCategories;

function getScheduleCategory(timeStr: string): ScheduleCategory {
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes < 720) return "morning";
  if (minutes < 1020) return "afternoon";
  if (minutes < 1200) return "evening";
  return "night";
}

const DAY_PILL_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function getActiveDayIndices(daysKey: string): number[] {
  switch (daysKey) {
    case "weekdays": return [1, 2, 3, 4, 5];
    case "weekends": return [0, 6];
    case "friday": return [5];
    case "all": return [0, 1, 2, 3, 4, 5, 6];
    default: return [];
  }
}

const DEFAULT_CALENDAR_MEMBERS = [
  { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
  { name: "Rebecca", color: "green", emoji: "🐱" },
  { name: "Jeffery", color: "cyan", emoji: "👨" },
  { name: "Emily", color: "violet", emoji: "👧" },
  { name: "Bailey", color: "amber", emoji: "👧" },
  { name: "Jasmine", color: "rose", emoji: "👧" },
  { name: "Aurora", color: "blue", emoji: "👧" },
  { name: "Caspian", color: "cyan", emoji: "🧒" },
];

let cachedMembersSnapshot = DEFAULT_CALENDAR_MEMBERS;

function getServerMembersSnapshot() {
  return DEFAULT_CALENDAR_MEMBERS;
}

function getClientMembersSnapshot() {
  return cachedMembersSnapshot;
}

function subscribeMembersSnapshot(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === "consuela-members") {
      cachedMembersSnapshot = db.selectMembersForCalendar();
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

const emptySchedule = (): ScheduleItem => ({
  id: Date.now(),
  title: "",
  time: "8:00 AM",
  days: "all",
  type: "routine",
  icon: "⏰",
  color: "green",
  mealType: "none",
});

const EVENTS_STORAGE_KEY = "consuela-events";
const SCHEDULES_STORAGE_KEY = "consuela-schedules";
const SCHEDULES_VERSION_KEY = "consuela-schedules-v";
const SCHEDULES_VERSION = 3;

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

const subscribeNoop = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning \u2600\uFE0F";
  if (hour < 17) return "Good Afternoon \uD83C\uDF24";
  return "Good Evening \uD83C\uDF19";
}

function getWeekdayName(year: number, month: number, day: number) {
  return new Date(year, month, day).toLocaleDateString("en-US", { weekday: "long" });
}

function getShortWeekday(year: number, month: number, day: number) {
  return new Date(year, month, day).toLocaleDateString("en-US", { weekday: "short" });
}

export default function CalendarPage() {
  const today = new Date();
  const members = useSyncExternalStore(
    subscribeMembersSnapshot,
    getServerMembersSnapshot,
    getClientMembersSnapshot
  );
  const { accentRgb } = useAtmosphericTheme();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [filterMember, setFilterMember] = useState("All");
  const [activeTab, setActiveTab] = useState<"calendar" | "schedule">("calendar");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "morning" | "afternoon" | "evening" | "night">("all");
  const [toast, setToast] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const [calEvents, setCalEvents] = useState<CalEvent[]>(() => loadFromStorage(EVENTS_STORAGE_KEY, events));
  const [editingEventId, setEditingEventId] = useState<number | string | null>(null);
  const [eventForm, setEventForm] = useState<CalEvent>({ id: 0, title: "", time: "", member: "All", color: "green", emoji: "📅", day: selectedDay });
  const [isAddingEvent, setIsAddingEvent] = useState(false);

  const [schedules, setSchedules] = useState<ScheduleItem[]>(() => {
    if (typeof window !== "undefined") {
      const storedVersion = localStorage.getItem(SCHEDULES_VERSION_KEY);
      if (storedVersion === String(SCHEDULES_VERSION)) {
        return loadFromStorage(SCHEDULES_STORAGE_KEY, getInitialSchedules());
      }
      localStorage.removeItem(SCHEDULES_STORAGE_KEY);
      localStorage.setItem(SCHEDULES_VERSION_KEY, String(SCHEDULES_VERSION));
    }
    return getInitialSchedules();
  });
  const [editingSchedId, setEditingSchedId] = useState<number | null>(null);
  const [schedForm, setSchedForm] = useState<ScheduleItem>(emptySchedule());
  const [isAddingSched, setIsAddingSched] = useState(false);
  const [schedFormSession, setSchedFormSession] = useState(0);

  const mounted = useSyncExternalStore(subscribeNoop, clientTrue, serverFalse);

  const renderEvents = useMemo(() => (mounted ? calEvents : events), [mounted, calEvents]);
  const renderSchedules = useMemo(
    () => (mounted ? schedules : getInitialSchedules()),
    [mounted, schedules]
  );

  useEffect(() => {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(calEvents));
  }, [calEvents]);

  useEffect(() => {
    localStorage.setItem(SCHEDULES_STORAGE_KEY, JSON.stringify(schedules));
  }, [schedules]);

  const sortedSchedules = useMemo(() => {
    return [...renderSchedules].sort((a, b) => {
      const getMinutes = (t: string) => parseTimeToMinutes(t) || parseInt(t.replace(":", ""), 10);
      return getMinutes(a.time) - getMinutes(b.time);
    });
  }, [renderSchedules]);

  const filteredSchedules = useMemo(() => {
    if (scheduleFilter === "all") return sortedSchedules;
    return sortedSchedules.filter((s) => getScheduleCategory(s.time) === scheduleFilter);
  }, [sortedSchedules, scheduleFilter]);

  const groupedSchedules = useMemo(() => {
    const groups: Record<ScheduleCategory, ScheduleItem[]> = {
      morning: [],
      afternoon: [],
      evening: [],
      night: [],
    };
    filteredSchedules.forEach((s) => {
      groups[getScheduleCategory(s.time)].push(s);
    });
    return groups;
  }, [filteredSchedules]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const dayEventMap = useMemo(() => {
    const map = new Map<number, CalEvent[]>();
    renderEvents.forEach((e) => {
      if (!eventInMonth(e, month, year)) return;
      if (!map.has(e.day)) map.set(e.day, []);
      map.get(e.day)!.push(e);
    });
    return map;
  }, [renderEvents, month, year]);

  const selectedEvents = useMemo(() => {
    return renderEvents.filter(
      (e) =>
        e.day === selectedDay &&
        eventInMonth(e, month, year) &&
        (filterMember === "All" || e.member === filterMember || e.member === "All")
    );
  }, [renderEvents, selectedDay, filterMember, month, year]);

  const upcomingByDay = useMemo(() => {
    const map: Record<number, CalEvent[]> = {};
    renderEvents.forEach((e) => {
      if (!eventInMonth(e, month, year)) return;
      if (e.day > selectedDay && e.day <= daysInMonth) {
        if (!map[e.day]) map[e.day] = [];
        map[e.day].push(e);
      }
    });
    Object.values(map).forEach((evts) => evts.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)));
    return map;
  }, [renderEvents, selectedDay, daysInMonth, month, year]);

  const upcomingCards = useMemo(() => {
    const cards: { day: number; events: CalEvent[] }[] = [];
    const endDay = Math.min(selectedDay + 7, daysInMonth);
    for (let d = selectedDay + 1; d <= endDay; d++) {
      cards.push({ day: d, events: upcomingByDay[d] ?? [] });
    }
    return cards;
  }, [upcomingByDay, selectedDay, daysInMonth]);

  const selectViewMonth = (m: number, y: number) => {
    setMonth(m);
    setYear(y);
    setSelectedDay(y === today.getFullYear() && m === today.getMonth() ? today.getDate() : 1);
  };
  const prevMonth = () => {
    if (month === 0) selectViewMonth(11, year - 1);
    else selectViewMonth(month - 1, year);
  };
  const nextMonth = () => {
    if (month === 11) selectViewMonth(0, year + 1);
    else selectViewMonth(month + 1, year);
  };
  const goToToday = () => {
    setMonth(today.getMonth());
    setYear(today.getFullYear());
    setSelectedDay(today.getDate());
  };

  const startAddEvent = () => {
    setEventForm({ id: 0, title: "", time: "12:00 PM", member: "All", color: "green", emoji: "📅", day: selectedDay });
    setIsAddingEvent(true);
    setEditingEventId(null);
  };
  const startEditEvent = (ev: CalEvent) => {
    if (ev.member === "Google") {
      if (ev.id && typeof ev.id === "string" && ev.id.startsWith("g_")) {
        const googleId = ev.id.split("_")[1];
        if (googleId) {
          window.open(`https://calendar.google.com/calendar/event?eid=${googleId}`, "_blank", "noopener,noreferrer");
        }
      }
      return;
    }
    setEventForm({ ...ev });
    setEditingEventId(ev.id);
    setIsAddingEvent(false);
  };
  const cancelEventEdit = () => { setEditingEventId(null); setIsAddingEvent(false); };
  const saveEvent = () => {
    if (!eventForm.title.trim()) return;
    if (isAddingEvent) {
      const newEvent = { ...eventForm, id: Date.now() };
      setCalEvents((prev) => [...prev, newEvent]);
      db.insertEvent({
        title: newEvent.title,
        date: `${year}-${String(month + 1).padStart(2, "0")}-${String(newEvent.day).padStart(2, "0")}`,
        time: newEvent.time,
        icon: newEvent.emoji,
        color: newEvent.color,
        member: newEvent.member,
      }).catch(() => {});
    } else {
      setCalEvents((prev) => prev.map((e) => e.id === editingEventId ? { ...eventForm } : e));
      if (typeof editingEventId === "number") {
        db.updateEvent(editingEventId, {
          title: eventForm.title,
          time: eventForm.time,
          icon: eventForm.emoji,
          color: eventForm.color,
          member: eventForm.member,
        }).catch(() => {});
      }
    }
    cancelEventEdit();
  };
  const deleteEvent = (id: number | string) => {
    setCalEvents((prev) => prev.filter((e) => e.id !== id));
    db.deleteEvent(id).catch(() => {});
    cancelEventEdit();
  };

  const startAddSched = () => {
    setSchedForm(emptySchedule());
    setIsAddingSched(true);
    setEditingSchedId(null);
    setSchedFormSession((s) => s + 1);
  };
  const startEditSched = (s: ScheduleItem) => {
    setSchedForm({ ...s });
    setEditingSchedId(s.id);
    setIsAddingSched(false);
    setSchedFormSession((v) => v + 1);
  };
  const cancelSchedEdit = () => { setEditingSchedId(null); setIsAddingSched(false); };
  const saveSched = () => {
    if (!schedForm.title.trim()) return;
    if (isAddingSched) {
      const newSched = { ...schedForm, id: Date.now() };
      setSchedules((prev) => [...prev, newSched]);
      db.insertSchedule({
        title: newSched.title,
        time: newSched.time,
        icon: newSched.icon,
        type: newSched.type,
        color: newSched.color,
        days: newSched.days,
        member: (newSched as any).member || "",
      }).catch(() => {});
    } else {
      setSchedules((prev) => prev.map((s) => s.id === editingSchedId ? { ...schedForm } : s));
      if (editingSchedId) {
        db.updateSchedule(editingSchedId, {
          title: schedForm.title,
          time: schedForm.time,
          icon: schedForm.icon,
          type: schedForm.type,
          color: schedForm.color,
          days: schedForm.days,
        }).catch(() => {});
      }
    }
    cancelSchedEdit();
  };
  const deleteSched = (id: number) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    db.deleteSchedule(id).catch(() => {});
    cancelSchedEdit();
  };

  const syncGoogleEvents = async (silent = false) => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/google-calendar?sync=now");
      const data = await res.json();
      if (!data.connected) {
        if (!silent) showToast("Connect Google in Settings → Integrations");
        return;
      }
      if (data.events?.length) {
        setCalEvents((prev) => {
          const filtered = prev.filter((e: any) => e.member !== "Google");
          for (const ge of data.events) {
            const mapped = mapGoogleEvent(ge);
            if (!mapped) continue;
            if (
              !filtered.find(
                (e: any) =>
                  e.title === mapped.title &&
                  e.day === mapped.day &&
                  e.month === mapped.month &&
                  e.year === mapped.year &&
                  e.time === mapped.time
              )
            ) {
              filtered.push(mapped);
            }
          }
          return filtered;
        });
        if (!silent) showToast(`\u2705 Synced ${data.events.length} Google events`);
      } else {
        if (!silent) showToast("No Google Calendar events found");
      }
    } catch {
      if (!silent) showToast("\u274C Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-load Google Calendar events on mount so the calendar shows real
  // school/holiday events without requiring a manual Sync tap.
  useEffect(() => {
    syncGoogleEvents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSelectedToday = selectedDay === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  const selectedDateLabel = isSelectedToday ? "Today" : `${MONTHS[month].slice(0, 3)} ${selectedDay}`;
  const weekdayName = getWeekdayName(year, month, selectedDay);

  return (
    <PageShell
      className="calendar-page-shell"
      style={{ "--calendar-accent-rgb": accentRgb } as CSSProperties}
    >
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`calendar-toast border ${
            toast.includes("\u274C")
              ? "border-[rgba(244,63,94,.35)] bg-[rgba(244,63,94,.16)] text-[var(--color-accent-rose)]"
              : "border-[rgba(74,222,128,.32)] bg-[rgba(74,222,128,.14)] text-[var(--color-accent-mint)]"
          }`}
        >
          {toast}
        </div>
      )}

      <TopBar
        title="Calendar"
        subtitle="Garcia Family"
        right={
          <button
            onClick={activeTab === "calendar" ? startAddEvent : startAddSched}
            className="calendar-icon-btn"
            aria-label={activeTab === "calendar" ? "Add event" : "Add routine"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        }
      />

      <div className="px-4 mt-4 space-y-4">
        <section className="calendar-hero-card widget-card">
          <div className="calendar-hero-content">
            <div>
              <p className="calendar-hero-kicker">{weekdayName} &middot; {selectedEvents.length} event{selectedEvents.length !== 1 ? "s" : ""}</p>
              <h1 className="calendar-hero-title" suppressHydrationWarning>{getGreeting()}</h1>
              <p className="calendar-hero-copy">
                {isSelectedToday ? "Here\u2019s your day at a glance" : `What\u2019s on for ${weekdayName} ${MONTHS[month].slice(0, 3)} ${selectedDay}`}
              </p>
            </div>
            <button
              onClick={() => syncGoogleEvents(false)}
              disabled={isSyncing}
              className="calendar-sync-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={isSyncing ? "animate-spin" : ""}>
                <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
                <path d="M21 3v4h-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 3l-7 7" strokeLinecap="round" />
              </svg>
              Sync
            </button>
          </div>
        </section>

        <div className="calendar-member-strip scrollbar-hide">
          <button
            onClick={() => setFilterMember("All")}
            className={`calendar-member-chip ${filterMember === "All" ? "is-active" : ""}`}
            style={{ "--chip-color": "var(--color-accent-selected)" } as CSSProperties}
          >
            <Avatar name="All" color="green" emoji={`\uD83D\uDC65`} size="xs" variant="emoji" />
            <span>All</span>
          </button>
          {members.filter((m: any) => m.name !== "All").map((m: any) => {
            const active = filterMember === m.name;
            const chipColor = getMemberColor(m);
            return (
              <button
                key={m.name}
                onClick={() => setFilterMember(m.name)}
                className={`calendar-member-chip ${active ? "is-active" : ""}`}
                style={{ "--chip-color": chipColor } as CSSProperties}
              >
                <Avatar name={m.name} color={m.color} emoji={m.emoji} size="xs" variant="emoji" />
                <span>{m.name}</span>
              </button>
            );
          })}
        </div>

        <div className="calendar-tabs">
          {(["calendar", "schedule"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`calendar-tab ${activeTab === tab ? "is-active" : ""}`}
            >
              {tab === "calendar" ? "\uD83D\uDCC5 Calendar" : "\u23F0 Schedule"}
            </button>
          ))}
        </div>

        {activeTab === "calendar" && (
          <div key="calendar" className="panel-swap space-y-4">
            <WidgetCard tone="#3b82f6" className="calendar-grid-card">
              <div className="calendar-panel-header calendar-grid-header">
                <h2 className="calendar-month-title">
                  {MONTHS[month]} <span className="calendar-month-year">{year}</span>
                </h2>
                <div className="calendar-month-nav">
                  <button onClick={prevMonth} className="calendar-icon-btn" aria-label="Previous month">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button onClick={goToToday} className="calendar-today-btn">Today</button>
                  <button onClick={nextMonth} className="calendar-icon-btn" aria-label="Next month">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              </div>
              <div className="calendar-weekday-row">
                {DAYS.map((d) => (
                  <div key={d} className="calendar-weekday">{d}</div>
                ))}
              </div>
              <div className="calendar-day-grid">
                {cells.map((day, i) => {
                  if (!day) return <div key={i} className="calendar-day-btn is-empty" />;
                  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                  const isSelected = day === selectedDay;
                  const dayEvents = dayEventMap.get(day) ?? [];
                  const visibleDots = dayEvents.slice(0, 3);
                  const firstColor = dayEvents[0]?.color;
                  return (
                    <button
                      key={`${year}-${month}-${day}`}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`calendar-day-btn${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                    >
                      <span className={`calendar-day-number${isToday ? " is-today-number" : ""}`}>{day}</span>
                      {visibleDots.length > 0 && (
                        <div className="calendar-day-dots">
                          {visibleDots.map((ev, di) => (
                            <span
                              key={di}
                              className="calendar-day-dot"
                              style={{ background: isSelected ? "rgba(255,255,255,0.85)" : eventColorValues[ev.color] }}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </WidgetCard>

            <section className="calendar-panel widget-card" style={{ "--widget-tone": "#22d3ee" } as CSSProperties}>
              <div className="calendar-panel-header">
                <div className="calendar-panel-heading">
                  <div className="calendar-panel-icon">{`\uD83D\uDCC5`}</div>
                  <div>
                    <h3 className="calendar-panel-title">{selectedDateLabel}</h3>
                    <p className="calendar-panel-subtitle">{selectedEvents.length} event{selectedEvents.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <button onClick={startAddEvent} className="calendar-add-link">+ Add</button>
              </div>

              {selectedEvents.length === 0 ? (
                <div className="calendar-empty mt-3">
                  <div className="calendar-empty-icon">{`\u2728`}</div>
                  <p className="calendar-empty-title">Nothing scheduled</p>
                  <p className="calendar-empty-subtitle">Enjoy your free time</p>
                  <button onClick={startAddEvent} className="calendar-add-link mt-2 block">+ Add an event</button>
                </div>
              ) : (
                <div className="calendar-event-list mt-3">
                  {[...selectedEvents].sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)).map((ev, idx) => (
                    <div key={ev.id} className="flex items-center gap-1">
                      <div
                        className="calendar-event-card flex-1 calendar-fade-in-up"
                        style={{
                          "--event-color": eventColorValues[ev.color],
                          animationDelay: `${idx * 60}ms`,
                        } as CSSProperties}
                      >
                        <div className="calendar-event-time-col">
                          <span className="calendar-event-dot" style={{ background: eventColorValues[ev.color] }} />
                          <span className="calendar-event-time">{ev.time}</span>
                          <span className="calendar-event-divider" />
                        </div>
                        <div className="calendar-event-content">
                          <p className="calendar-event-title break-words">{ev.title}</p>
                          <div className="calendar-event-meta">
                            <Badge variant={badgeVariants[ev.color] ?? "gray"} size="sm">{ev.member}</Badge>
                            {ev.member === "Google" && (
                              <Badge variant="cyan" size="sm">GCal</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => startEditEvent(ev)}
                        className="calendar-edit-btn"
                        aria-label="Edit event"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {(isAddingEvent || editingEventId !== null) && (
              <WidgetCard tone="#8b5cf6" className="calendar-form-card">
                <h4 className="calendar-form-heading">{isAddingEvent ? "Add Event" : "Edit Event"}</h4>
                <div className="space-y-2.5">
                  <input
                    type="text" placeholder="Event title"
                    value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                    className="calendar-input" autoFocus
                  />
                  <div className="calendar-form-grid">
                    <input type="text" placeholder="Time (e.g. 4:00 PM)" value={eventForm.time} onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })} className="calendar-input" />
                    <input type="text" placeholder="Emoji" value={eventForm.emoji} onChange={(e) => setEventForm({ ...eventForm, emoji: e.target.value })} className="calendar-input" />
                    <input type="text" placeholder="Member" value={eventForm.member} onChange={(e) => setEventForm({ ...eventForm, member: e.target.value })} className="calendar-input" />
                    <input type="number" min={1} max={daysInMonth} placeholder="Day" value={eventForm.day} onChange={(e) => { const parsed = parseInt(e.target.value, 10); setEventForm({ ...eventForm, day: Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 1), daysInMonth) }); }} className="calendar-input" />
                  </div>
                  <div className="calendar-color-swatches">
                    {(["green", "violet", "amber", "cyan", "rose"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEventForm({ ...eventForm, color: c })}
                        className={`calendar-color-swatch ${eventForm.color === c ? "is-selected" : ""}`}
                        style={{ "--swatch-color": eventColorValues[c] } as CSSProperties}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <div className="calendar-form-actions">
                    <button onClick={saveEvent} disabled={!eventForm.title.trim()} className="calendar-primary-btn">
                      {isAddingEvent ? "Add Event" : "Save"}
                    </button>
                    <button onClick={cancelEventEdit} className="calendar-secondary-btn">Cancel</button>
                    {!isAddingEvent && (
                      <button onClick={() => deleteEvent(eventForm.id)} className="calendar-delete-btn" aria-label="Delete event">{`\uD83D\uDDD1\uFE0F`}</button>
                    )}
                  </div>
                </div>
              </WidgetCard>
            )}

            {upcomingCards.length > 0 && (
              <section className="calendar-panel widget-card" style={{ "--widget-tone": "#10b981" } as CSSProperties}>
                <div className="calendar-upcoming-header">
                  <div className="calendar-upcoming-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} className="w-3.5 h-3.5">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="calendar-panel-title">Upcoming</h3>
                    <p className="calendar-panel-subtitle">Next {upcomingCards.length} days</p>
                  </div>
                </div>
                <div className="calendar-upcoming-scroll scrollbar-hide mt-2">
                  {upcomingCards.map((card) => (
                    <button
                      key={card.day}
                      type="button"
                      onClick={() => setSelectedDay(card.day)}
                      className="calendar-upcoming-card widget-card"
                    >
                      <p className="calendar-upcoming-day-label">{getShortWeekday(year, month, card.day)}</p>
                      <p className="calendar-upcoming-day-num">{card.day}</p>
                      {card.events.length > 0 ? (
                        <div className="calendar-upcoming-events">
                          {card.events.slice(0, 3).map((ev) => (
                            <div key={ev.id} className="calendar-upcoming-event">
                              <span className="calendar-upcoming-dot" style={{ background: eventColorValues[ev.color] }} />
                              <span className="calendar-upcoming-event-title">{ev.title}</span>
                            </div>
                          ))}
                          {card.events.length > 3 && (
                            <p className="calendar-upcoming-more">+{card.events.length - 3} more</p>
                          )}
                        </div>
                      ) : (
                        <p className="calendar-upcoming-empty">Free day</p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "schedule" && (
          <div key="schedule" className="panel-swap space-y-4">
            {(isAddingSched || editingSchedId !== null) && (
              <WidgetCard tone="#8b5cf6" className="calendar-form-card">
                <h4 className="calendar-form-heading">{isAddingSched ? "Add Schedule Item" : "Edit Schedule Item"}</h4>
                <div className="space-y-2.5">
                  <input
                    type="text" placeholder="Title"
                    value={schedForm.title} onChange={(e) => setSchedForm({ ...schedForm, title: e.target.value })}
                    className="calendar-input" autoFocus
                  />
                  <div className="calendar-form-grid">
                     <div className="calendar-time-picker">
                       <input
                         type="number" min={1} max={12} inputMode="numeric"
                         key={`sched-hour-${schedFormSession}`}
                         defaultValue={(() => { const t = formatTo12Hour(schedForm.time); return t.hour; })()}
                         onChange={(e) => {
                           const t = formatTo12Hour(schedForm.time);
                           let v = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                           if (!v) v = t.hour;
                           setSchedForm({ ...schedForm, time: build12HourString(v, t.minute, t.ampm) });
                         }}
                         className="calendar-input calendar-time-hour"
                         aria-label="Hour"
                       />
                       <span className="calendar-time-sep">:</span>
                        <input
                          type="number" min={0} max={59} inputMode="numeric"
                          key={`sched-min-${schedFormSession}`}
                          defaultValue={(() => { const t = formatTo12Hour(schedForm.time); return t.minute; })()}
                         onChange={(e) => {
                           const t = formatTo12Hour(schedForm.time);
                           let v = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                           if (!v) v = t.minute;
                           setSchedForm({ ...schedForm, time: build12HourString(t.hour, v.padStart(2, "0"), t.ampm) });
                         }}
                         className="calendar-input calendar-time-minute"
                         aria-label="Minute"
                       />
                      <div className="calendar-time-ampm">
                        <button
                          type="button"
                          onClick={() => {
                            const t = formatTo12Hour(schedForm.time);
                            setSchedForm({ ...schedForm, time: build12HourString(t.hour, t.minute, "AM") });
                          }}
                          className={`calendar-time-ampm-btn ${(() => { const t = formatTo12Hour(schedForm.time); return t.ampm === "AM"; })() ? "is-active" : ""}`}
                          aria-label="AM"
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const t = formatTo12Hour(schedForm.time);
                            setSchedForm({ ...schedForm, time: build12HourString(t.hour, t.minute, "PM") });
                          }}
                          className={`calendar-time-ampm-btn ${(() => { const t = formatTo12Hour(schedForm.time); return t.ampm === "PM"; })() ? "is-active" : ""}`}
                          aria-label="PM"
                        >
                          PM
                        </button>
                      </div>
                    </div>
                    <input type="text" placeholder="Icon emoji" value={schedForm.icon} onChange={(e) => setSchedForm({ ...schedForm, icon: e.target.value })} className="calendar-input" />
                    <select value={schedForm.days} onChange={(e) => setSchedForm({ ...schedForm, days: e.target.value })} className="calendar-input">
                      {Object.entries(dayLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select value={schedForm.type} onChange={(e) => setSchedForm({ ...schedForm, type: e.target.value as "routine" | "reminder" })} className="calendar-input">
                      <option value="routine">{`\uD83D\uDD04 Routine`}</option>
                      <option value="reminder">{`\uD83D\uDD14 Reminder`}</option>
                    </select>
                    <select value={schedForm.mealType ?? "none"} onChange={(e) => setSchedForm({ ...schedForm, mealType: e.target.value as any })} className="calendar-input col-span-2">
                      <option value="none">{`\u2014 Not a meal \u2014`}</option>
                      <option value="breakfast">{`\uD83C\uDF05 Breakfast`}</option>
                      <option value="lunch">{`\u2600\uFE0F Lunch`}</option>
                      <option value="dinner">{`\uD83C\uDF19 Dinner`}</option>
                      <option value="snack">{`\uD83C\uDF4E Snack`}</option>
                    </select>
                  </div>
                  <div className="calendar-color-swatches">
                    {(["green", "amber", "cyan", "violet", "rose", "blue", "indigo", "pink", "teal"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSchedForm({ ...schedForm, color: c })}
                        className={`calendar-color-swatch ${schedForm.color === c ? "is-selected" : ""}`}
                        style={{ "--swatch-color": scheduleColorValues[c] } as CSSProperties}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <div className="calendar-form-actions">
                    <button onClick={saveSched} disabled={!schedForm.title.trim()} className="calendar-primary-btn">
                      {isAddingSched ? "Add" : "Save"}
                    </button>
                    <button onClick={cancelSchedEdit} className="calendar-secondary-btn">Cancel</button>
                    {!isAddingSched && (
                      <button onClick={() => deleteSched(schedForm.id)} className="calendar-delete-btn" aria-label="Delete routine">{`\uD83D\uDDD1\uFE0F`}</button>
                    )}
                </div>
              </div>
              </WidgetCard>
            )}

            <section className="calendar-panel widget-card" style={{ "--widget-tone": "#22d3ee" } as CSSProperties}>
              <div className="calendar-panel-header">
                <div className="calendar-panel-heading">
                  <div className="calendar-panel-icon">{`\uD83D\uDD04`}</div>
                  <div>
                    <h3 className="calendar-panel-title">Family Routines</h3>
                    <p className="calendar-panel-subtitle">{renderSchedules.length} routine{renderSchedules.length !== 1 ? "s" : ""} &middot; {filteredSchedules.length} shown</p>
                  </div>
                </div>
                <button onClick={startAddSched} className="calendar-add-link">+ Add</button>
              </div>

              <div className="calendar-filter-tabs mt-3 scrollbar-hide">
                <button
                  onClick={() => setScheduleFilter("all")}
                  className={`calendar-filter-pill ${scheduleFilter === "all" ? "is-active" : ""}`}
                >
                  All
                </button>
                {(Object.entries(scheduleCategories) as [ScheduleCategory, typeof scheduleCategories[ScheduleCategory]][]).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setScheduleFilter(key)}
                    className={`calendar-filter-pill ${scheduleFilter === key ? "is-active" : ""}`}
                  >
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                  </button>
                ))}
              </div>

              {filteredSchedules.length === 0 ? (
                <div className="calendar-empty mt-3">
                  <div className="calendar-empty-icon">{`\u23F0`}</div>
                  <p className="calendar-empty-title">{renderSchedules.length === 0 ? "No routine items yet" : "Nothing at this time of day"}</p>
                  <p className="calendar-empty-subtitle">{renderSchedules.length === 0 ? "Build your family\u2019s daily rhythm" : "Try another filter above"}</p>
                  <button onClick={startAddSched} className="calendar-add-link mt-2 block">{renderSchedules.length === 0 ? "+ Add your first" : "+ Add a routine"}</button>
                </div>
              ) : (
                <div className="mt-3 space-y-0">
                  {(Object.entries(groupedSchedules) as [ScheduleCategory, ScheduleItem[]][]).map(([category, items]) => {
                    if (items.length === 0) return null;
                    const meta = scheduleCategories[category];
                    return (
                      <div key={category} className="calendar-category-group">
                        <div className="calendar-category-header">
                          <div
                            className="calendar-category-icon"
                            style={{ background: `linear-gradient(135deg, ${meta.hexFrom}, ${meta.hexTo})` }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              {category === "morning" && <><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></>}
                              {category === "afternoon" && <><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" /></>}
                              {category === "evening" && <><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></>}
                              {category === "night" && <><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></>}
                            </svg>
                          </div>
                          <div>
                            <h4 className="calendar-category-title">{meta.label}</h4>
                            <p className="calendar-category-count">{items.length} item{items.length !== 1 ? "s" : ""} &middot; {meta.range}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {items.map((item) => {
                            const itemColor = item.color ?? "green";
                            const dayIndices = getActiveDayIndices(item.days);
                            return (
                              <div key={item.id} className="calendar-routine-card" style={{ "--routine-color": scheduleColorValues[itemColor] } as CSSProperties}>
                                <div
                                  className="calendar-routine-icon-circle"
                                  style={{
                                    background: `linear-gradient(135deg, ${scheduleColorValues[itemColor]}, color-mix(in srgb, ${scheduleColorValues[itemColor]}, #000 25%))`,
                                  }}
                                >
                                  <span>{item.icon}</span>
                                </div>

                                <div className="calendar-routine-body">
                                  <p className="calendar-routine-title break-words">{item.title}</p>
                                  <div className="calendar-routine-meta">
                                    <span className="calendar-routine-time" style={{ color: `color-mix(in srgb, ${scheduleColorValues[itemColor]} 55%, var(--color-text-primary))` }}>
                                      {item.time}
                                    </span>
                                    <Badge variant={item.type === "routine" ? "amber" : "rose"} size="sm">{item.type}</Badge>
                                    {item.mealType && item.mealType !== "none" && (
                                      <Badge variant={item.mealType === "breakfast" ? "amber" : item.mealType === "lunch" ? "cyan" : item.mealType === "dinner" ? "violet" : "green"} size="sm">
                                        {item.mealType === "breakfast" ? "\uD83C\uDF05" : item.mealType === "lunch" ? "\u2600\uFE0F" : item.mealType === "dinner" ? "\uD83C\uDF19" : "\uD83C\uDF4E"} {item.mealType}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="calendar-routine-days">
                                    {DAY_PILL_LABELS.map((label, idx) => {
                                      const isActive = dayIndices.includes(idx);
                                      return (
                                        <span
                                          key={idx}
                                          className={`calendar-routine-day-pill ${isActive ? "is-active" : ""}`}
                                          style={isActive ? { background: `linear-gradient(135deg, ${scheduleColorValues[itemColor]}, color-mix(in srgb, ${scheduleColorValues[itemColor]}, #000 20%))` } : undefined}
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="calendar-routine-actions">
                                  <button
                                    onClick={() => startEditSched(item)}
                                    className="calendar-routine-toggle"
                                    aria-label="Edit routine"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </PageShell>
  );
}
