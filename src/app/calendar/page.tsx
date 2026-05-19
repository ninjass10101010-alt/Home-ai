"use client";

import { useState, useEffect, useCallback } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import Link from "next/link";
import pb from "@/lib/pocketbase";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface CalEvent {
  id: string;
  title: string;
  time: string;
  date: string; // YYYY-MM-DD
  memberId?: string;
  member?: string;
  memberEmoji?: string;
  color: "green" | "violet" | "amber" | "cyan" | "rose";
  emoji: string;
  description?: string;
}

interface Member {
  id: string;
  name: string;
  emoji: string;
  role: string;
}

const dotColors: Record<string, string> = {
  green: "bg-nori-400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
  cyan: "bg-cyan-400",
  rose: "bg-rose-400",
};

const badgeVariants: Record<string, "green" | "violet" | "amber" | "cyan" | "rose"> = {
  green: "green",
  violet: "violet",
  amber: "amber",
  cyan: "cyan",
  rose: "rose",
};

function getMemberColor(role: string): "green" | "violet" | "amber" | "cyan" | "rose" {
  const r = role?.toLowerCase() || "";
  if (r === "mom" || r === "parent") return "green";
  if (r === "dad") return "cyan";
  if (r === "son" || r === "child") return "violet";
  if (r === "daughter") return "amber";
  return "rose";
}

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [filterMember, setFilterMember] = useState("All");
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [lastGoogleSync, setLastGoogleSync] = useState<string | null>(null)];

  const fetchData = useCallback(async () => {
    try {
      const [rawMembers, rawEvents] = await Promise.all([
        pb.collection("members").getFullList<Member>(),
        pb.collection("events").getFullList({ sort: "date,time" }),
      ]);

      setMembers(rawMembers);

      const mapped: CalEvent[] = rawEvents.map((e: any) => {
        const m = rawMembers.find((rm) => rm.id === e.memberId);
        return {
          id: e.id,
          title: e.title,
          time: e.time || "All Day",
          date: e.date || "",
          memberId: e.memberId,
          member: m?.name || e.member || "Family",
          memberEmoji: m?.emoji || "👤",
          color: m ? getMemberColor(m.role) : "violet",
          emoji: e.icon || e.emoji || "📅",
          description: e.description || "",
        };
      });

      setEvents(mapped);
    } catch (err) {
      console.error("Failed to load calendar data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Real-time subscriptions
    pb.collection("events").subscribe("*", fetchData);
    pb.collection("members").subscribe("*", fetchData);

    return () => {
      pb.collection("events").unsubscribe("*");
      pb.collection("members").unsubscribe("*");
    };
  }, [fetchData]);

  const allMembers = [{ id: "All", name: "All", emoji: "👨‍👩‍👧‍👦", role: "" }, ...members];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Filter events by selected month+year+day
  const getDateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const handleGoogleConnect = () => {
    // Mock OAuth placeholder - extend with real Google API /auth flow
    setGoogleConnected(true);
    setLastGoogleSync("Just now");
  };

  const handleGoogleDisconnect = () => {
    setGoogleConnected(false);
    setLastGoogleSync(null);
  };

  const handleGoogleSync = async () => {
    if (!googleConnected) return;
    // Sample events from "Google" - insert into PocketBase events collection
    const sampleEvents = [
      { title: "Team Standup", date: getDateStr(selectedDay), time: "09:00", icon: "💼", description: "Synced from Google Calendar" },
      { title: "Dentist Appointment", date: getDateStr(selectedDay), time: "14:30", icon: "🦷", description: "Synced from Google Calendar" },
    ];
    try {
      for (const ev of sampleEvents) {
        await pb.collection("events").create({
          title: ev.title,
          date: ev.date,
          time: ev.time,
          icon: ev.icon,
          description: ev.description,
          memberId: members[0]?.id || "",
        });
      }
      setLastGoogleSync("Just now");
      await fetchData(); // refresh realtime
    } catch (e) {
      console.error("Google sync insert failed", e);
    }
  };

  const selectedDateStr = getDateStr(selectedDay);

  const selectedEvents = events.filter(
    (e) =>
      e.date === selectedDateStr &&
      (filterMember === "All" || e.member === filterMember || e.member === "Family")
  );

  const dayEventMap = new Map<string, CalEvent[]>();
  events.forEach((e) => {
    if (!dayEventMap.has(e.date)) dayEventMap.set(e.date, []);
    dayEventMap.get(e.date)!.push(e);
  });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  return (
    <PageShell>
      <TopBar
        title="Calendar"
        subtitle="Garcia Family"
        right={
          <Link
            href="/chat?q=Add+new+event"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </Link>
        }
      />

      <div className="px-4 space-y-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="text-text-primary font-semibold text-base">
            {MONTHS[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Google Calendar Integration */}
        <Card className="!p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">📅</span>
              <div>
                <p className="text-sm font-medium text-text-primary">Google Calendar</p>
                <p className="text-[10px] text-text-muted">{googleConnected ? `Connected · Last sync: ${lastGoogleSync}` : "Not connected"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {googleConnected ? (
                <>
                  <button onClick={handleGoogleSync} className="px-3 py-1 text-xs rounded-lg bg-nori-500/20 text-nori-400 hover:bg-nori-500/30">Sync Now</button>
                  <button onClick={handleGoogleDisconnect} className="px-3 py-1 text-xs rounded-lg text-rose-400 hover:bg-rose-500/10">Disconnect</button>
                </>
              ) : (
                <button onClick={handleGoogleConnect} className="px-3 py-1 text-xs rounded-lg bg-nori-500 text-white">Connect</button>
              )}
            </div>
          </div>
        </Card>

        {/* Member filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {allMembers.map((m) => (
            <button
              key={m.name}
              onClick={() => setFilterMember(m.name)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterMember === m.name
                  ? "bg-nori-500/20 text-nori-400 border border-nori-500/30"
                  : "glass text-text-secondary border border-surface-3 hover:text-text-primary"
              }`}
            >
              <span>{m.emoji}</span>
              <span>{m.name}</span>
            </button>
          ))}
        </div>

        {/* Calendar grid */}
        <Card className="!p-3">
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-text-muted py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = getDateStr(day);
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const isSelected = day === selectedDay;
              const dayEvents = dayEventMap.get(dateStr) ?? [];
              const visibleDots = dayEvents.slice(0, 3);

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(day)}
                  className={`flex flex-col items-center py-1.5 rounded-xl transition-all ${
                    isSelected
                      ? "bg-nori-500 text-white"
                      : isToday
                      ? "bg-nori-500/15 text-nori-400"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  }`}
                >
                  <span className="text-xs font-medium leading-none mb-1">{day}</span>
                  <div className="flex gap-0.5">
                    {visibleDots.map((ev, di) => (
                      <div
                        key={di}
                        className={`w-1 h-1 rounded-full ${
                          isSelected ? "bg-white/70" : dotColors[ev.color]
                        }`}
                      />
                    ))}
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
              {selectedDay === today.getDate() && month === today.getMonth()
                ? "Today"
                : `${MONTHS[month].slice(0, 3)} ${selectedDay}`}
              {" "}
              <span className="text-text-muted font-normal">
                {loading ? "loading..." : `(${selectedEvents.length} events)`}
              </span>
            </h3>
            <Link
              href={`/chat?q=Add+event+on+${MONTHS[month]}+${selectedDay}`}
              className="text-nori-400 text-xs font-medium hover:text-nori-300"
            >
              + Add
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-nori-500/30 border-t-nori-500 rounded-full animate-spin" />
            </div>
          ) : selectedEvents.length === 0 ? (
            <Card className="!p-6 flex flex-col items-center gap-2">
              <span className="text-3xl">📅</span>
              <p className="text-text-secondary text-sm text-center">No events this day</p>
              <Link
                href="/chat?q=Add+event"
                className="text-nori-400 text-xs mt-1 hover:text-nori-300"
              >
                Ask Consuela to add one →
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev) => (
                <Card key={ev.id} className="!p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center text-lg shrink-0">
                      {ev.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">{ev.title}</p>
                      <p className="text-text-muted text-xs mt-0.5">{ev.time}</p>
                      {ev.description && <p className="text-text-muted text-xs mt-0.5 truncate">{ev.description}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={badgeVariants[ev.color] ?? "green"}>{ev.member}</Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming events */}
        <section className="pb-24">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Upcoming</h3>
          <div className="space-y-2">
            {events
              .filter((e) => e.date > selectedDateStr)
              .slice(0, 5)
              .map((ev) => {
                const d = new Date(ev.date + "T12:00:00");
                return (
                  <div key={ev.id} className="flex items-center gap-3 px-1">
                    <div className={`w-1 h-8 rounded-full shrink-0 ${dotColors[ev.color]}`} />
                    <div className="w-10 text-center">
                      <p className="text-[10px] text-text-muted">
                        {MONTHS[d.getMonth()].slice(0, 3)}
                      </p>
                      <p className="text-sm font-semibold text-text-primary leading-tight">{d.getDate()}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm truncate">{ev.title}</p>
                      <p className="text-text-muted text-xs">{ev.time} · {ev.member}</p>
                    </div>
                    <span className="text-lg shrink-0">{ev.emoji}</span>
                  </div>
                );
              })}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
