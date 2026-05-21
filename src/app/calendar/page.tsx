"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import Link from "next/link";
import { db } from "@/db";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
  { id: 1, title: "Soccer Practice", time: "4:00 PM", member: "Jake", color: "violet", emoji: "⚽", day: 18 },
  { id: 2, title: "Piano Lesson", time: "3:00 PM", member: "Lily", color: "amber", emoji: "🎹", day: 19 },
  { id: 3, title: "Team Dinner", time: "7:00 PM", member: "Dad", color: "cyan", emoji: "🍽️", day: 19 },
  { id: 4, title: "Dentist — Lily", time: "2:00 PM", member: "Lily", color: "amber", emoji: "🦷", day: 21 },
  { id: 5, title: "Car Service", time: "10:00 AM", member: "Dad", color: "cyan", emoji: "🚗", day: 21 },
  { id: 6, title: "Movie Night", time: "8:00 PM", member: "All", color: "green", emoji: "🎬", day: 22 },
  { id: 7, title: "Park Picnic", time: "11:00 AM", member: "All", color: "green", emoji: "🌳", day: 23 },
  { id: 8, title: "Grocery Run", time: "10:00 AM", member: "Mom", color: "green", emoji: "🛒", day: 20 },
  { id: 9, title: "Swim Class", time: "9:00 AM", member: "Jake", color: "violet", emoji: "🏊", day: 25 },
  { id: 10, title: "Book Club", time: "6:30 PM", member: "Mom", color: "green", emoji: "📚", day: 26 },
];

const dotColors: Record<string, string> = {
  green: "bg-[var(--color-accent-selected)]/400",
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

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [filterMember, setFilterMember] = useState("All");

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedEvents = events.filter(
    (e) =>
      e.day === selectedDay &&
      (filterMember === "All" || e.member === filterMember || e.member === "All")
  );

  const dayEventMap = new Map<number, CalEvent[]>();
  events.forEach((e) => {
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

  return (
    <PageShell>
      <TopBar
        title="Calendar"
        subtitle="Johnson Family"
        right={
          <Link
            href="/chat?q=Add+new+event"
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--color-accent-selected)]/500/15 text-nori-400 hover:bg-[var(--color-accent-selected)]/500/25 transition-colors"
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

        {/* Member filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {members.map((m) => (
            <button
              key={m.name}
              onClick={() => setFilterMember(m.name)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterMember === m.name
                  ? "bg-[var(--color-accent-selected)]/500/20 text-nori-400 border border-nori-500/30"
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
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-text-muted py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const isSelected = day === selectedDay;
              const dayEvents = dayEventMap.get(day) ?? [];
              const visibleDots = dayEvents.slice(0, 3);

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(day)}
                  className={`flex flex-col items-center py-1.5 rounded-xl transition-all ${
                    isSelected
                      ? "bg-[var(--color-accent-selected)]/500 text-white"
                      : isToday
                      ? "bg-[var(--color-accent-selected)]/500/15 text-nori-400"
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
              <span className="text-text-muted font-normal">({selectedEvents.length} events)</span>
            </h3>
            <Link
              href={`/chat?q=Add+event+on+${MONTHS[month]}+${selectedDay}`}
              className="text-nori-400 text-xs font-medium hover:text-nori-300"
            >
              + Add
            </Link>
          </div>

          {selectedEvents.length === 0 ? (
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
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={badgeVariants[ev.color] ?? "gray"}>{ev.member}</Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming */}
        <section className="pb-2">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Upcoming</h3>
          <div className="space-y-2">
            {events
              .filter((e) => e.day > selectedDay)
              .slice(0, 4)
              .map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 px-1"
                >
                  <div
                    className={`w-1 h-8 rounded-full shrink-0 ${dotColors[ev.color]}`}
                  />
                  <div className="w-10 text-center">
                    <p className="text-[10px] text-text-muted">
                      {MONTHS[month].slice(0, 3)}
                    </p>
                    <p className="text-sm font-semibold text-text-primary leading-tight">{ev.day}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm truncate">{ev.title}</p>
                    <p className="text-text-muted text-xs">{ev.time} · {ev.member}</p>
                  </div>
                  <span className="text-lg shrink-0">{ev.emoji}</span>
                </div>
              ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
