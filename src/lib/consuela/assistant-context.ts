// Assistant context pack (Task 8, 2026-09-14) — the shared live-data brief the
// chat routes hand the model BEFORE it answers a dashboard question, so it
// stops tool-guessing dates and rosters. Two halves:
//   composeContextPrompt(pack) — PURE string assembly, deterministic zone
//   order, capped so prompts stay small (3 events/day, 14 days max).
//   loadContextPack(scope)     — impure zone reads from consuela/live-reads;
//   a failed read pushes the zone name onto pack.unavailable so the prompt
//   can tell the model the truth instead of letting it invent.

import type { ToolEvent } from "./todays-events";
import {
  liveMembers,
  liveEventsRange,
  liveMealRows,
  livePantry,
  liveGrocery,
  livePendingTasks,
  liveRewards,
  liveWeekArchive,
  liveSchedulesAll,
  mealsForWeek,
  parseJSON,
} from "./live-reads";
import {
  localTodayISO,
  localWeekdayShort,
  localPreviousDayISO,
  localWeekStartISO,
  familyTimeZone,
} from "@/lib/local-date";
import { fetchLiveWeather } from "@/lib/weather-live";

export type PackScope = "meal" | "task" | "schedule";

export interface ContextPack {
  roster: Array<{ name: string; role: string; age?: number }>;
  today: { iso: string; weekday: string; yesterdayIso: string; weekStartISO: string; tz: string };
  calendar?: Record<string, ToolEvent[]>;
  routines?: any[];
  meals?: { weekOf: string; filled: string[]; emptySlots: number };
  pantry?: { low: string[]; out: string[] };
  grocery?: number;
  tasks?: Array<{ member: string; pending: number; overdue: number }>;
  rewards?: Array<{ title: string; cost: number }>;
  lastWeek?: { weekStart: string; champion: string | null } | null;
  weather?: { condition: string; precipProb: number } | null;
  unavailable: string[];
}

/** Calendar digest caps — a 30-day dump would blow the prompt budget. */
const MAX_CALENDAR_DAYS = 14;
const MAX_EVENTS_PER_DAY = 3;

const WEEKDAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Deterministic weekday label from an ISO date (UTC-noon parse — no host
 *  timezone can shift the day). */
function weekdayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "?" : WEEKDAY_LETTERS[d.getUTCDay()];
}

/**
 * Pure composer. Zone order is FIXED (dates, roster, calendar, routines,
 * meals, pantry, grocery, tasks, rewards, lastWeek, weather, unavailable) —
 * tests and Task 9's prompt contract depend on it.
 */
export function composeContextPrompt(pack: ContextPack): string {
  const lines: string[] = [];
  const t = pack.today;
  lines.push(`Consuela live context pack — Today is ${t.weekday} ${t.iso} (${t.tz}). Yesterday was ${weekdayOf(t.yesterdayIso)} ${t.yesterdayIso}. This week's Monday is ${t.weekStartISO}.`);
  lines.push(`Roster: ${pack.roster.map((m) => `${m.name} (${m.role}${typeof m.age === "number" ? `, ${m.age}` : ""})`).join("; ") || "no members loaded"}.`);

  if (pack.calendar) {
    const days = Object.keys(pack.calendar).sort().slice(0, MAX_CALENDAR_DAYS);
    lines.push(`Calendar digest (max ${MAX_CALENDAR_DAYS} days, ${MAX_EVENTS_PER_DAY} events/day):`);
    for (const day of days) {
      const events = pack.calendar[day] || [];
      if (events.length === 0) {
        lines.push(`${weekdayOf(day)} ${day}: nothing scheduled`);
        continue;
      }
      for (const e of events.slice(0, MAX_EVENTS_PER_DAY)) {
        lines.push(`- ${weekdayOf(day)} ${day}: ${e?.title ?? "Untitled"}${e?.time ? ` @ ${e.time}` : ""}${e?.member ? ` (${e.member})` : ""}`);
      }
    }
  }

  if (pack.routines) {
    lines.push(`Family routines: ${pack.routines.map((r: any) => `${r?.title ?? "Untitled"}${r?.time ? ` ${r.time}` : ""}${r?.days ? ` (${r.days})` : ""}`).join("; ") || "none set up"}.`);
  }

  if (pack.meals) {
    lines.push(`Meal plan (week of ${pack.meals.weekOf}): ${pack.meals.filled.length ? pack.meals.filled.join("; ") : "nothing planned"} — ${pack.meals.emptySlots} empty slot(s).`);
  }

  if (pack.pantry) {
    const low = pack.pantry.low.join(", ") || "none";
    const out = pack.pantry.out.join(", ") || "none";
    lines.push(`Pantry — running low: ${low}; out: ${out}.`);
  }

  if (typeof pack.grocery === "number") {
    lines.push(`Grocery list: ${pack.grocery} item(s) needed.`);
  }

  if (pack.tasks) {
    lines.push(`Pending tasks — ${pack.tasks.map((g) => `${g.member}: ${g.pending} pending${g.overdue > 0 ? ` (${g.overdue} overdue)` : ""}`).join("; ") || "nothing pending"}.`);
  }

  if (pack.rewards) {
    lines.push(`Reward shop: ${pack.rewards.map((r) => `${r.title} (${r.cost} pts)`).join("; ") || "catalog empty"}.`);
  }

  if (pack.lastWeek) {
    lines.push(`Last archived week (${pack.lastWeek.weekStart}): champion ${pack.lastWeek.champion ?? "none recorded"}.`);
  }

  if (pack.weather) {
    lines.push(`Weather now: ${pack.weather.condition}, ${pack.weather.precipProb}% chance of precipitation.`);
  }

  for (const zone of pack.unavailable) {
    lines.push(`${zone}: unavailable — do not guess about it; tell the family that data is unavailable and offer to try again.`);
  }

  return lines.join("\n");
}

/** `YYYY-MM-DD` + N days (UTC-noon anchor — the day never shifts). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 7 days from today, inclusive. */
const CALENDAR_WINDOW_DAYS = 7;
/** The weekly meal grid: 7 days × breakfast/lunch/dinner/snack. */
const MEAL_SLOTS_PER_WEEK = 28;

/**
 * Read the live zones for a scope and compose a ContextPack. Impure (PB +
 * Open-Meteo); failures never throw — a dead zone pushes its name onto
 * `pack.unavailable` so the composed prompt tells the model the truth.
 * Not unit-covered here by design (Task 9's route tests cover it).
 */
export async function loadContextPack(scope: PackScope): Promise<ContextPack> {
  const iso = localTodayISO();
  const pack: ContextPack = {
    roster: [],
    today: {
      iso,
      weekday: localWeekdayShort(),
      yesterdayIso: localPreviousDayISO(iso),
      weekStartISO: localWeekStartISO(),
      tz: familyTimeZone(),
    },
    unavailable: [],
  };

  const members = await liveMembers();
  if (members === null) {
    pack.unavailable.push("roster");
  } else {
    pack.roster = members
      .map((m: any) => ({
        name: String(m.fullName || m.name || ""),
        role: String(m.role || "member"),
        age: typeof m.age === "number" ? m.age : undefined,
      }))
      .filter((m) => m.name);
  }

  const wantsCalendar = scope === "meal" || scope === "schedule";
  if (wantsCalendar) {
    const merged = await liveEventsRange(iso, addDaysISO(iso, CALENDAR_WINDOW_DAYS - 1));
    if (merged === null) pack.unavailable.push("calendar");
    else pack.calendar = merged.days;
  }

  if (scope === "meal") {
    const rows = await liveMealRows();
    if (rows === null) {
      pack.unavailable.push("meals");
    } else {
      const week = mealsForWeek(rows, pack.today.weekStartISO);
      pack.meals = {
        weekOf: pack.today.weekStartISO,
        filled: week.map((m: any) => `${m.time || m.day || "?"} ${m.mealType || "meal"}: ${m.name || "unnamed"}`),
        emptySlots: Math.max(0, MEAL_SLOTS_PER_WEEK - week.length),
      };
    }
    const pantry = await livePantry();
    if (pantry === null) {
      pack.unavailable.push("pantry");
    } else {
      const nameOf = (i: any) => String(i.name || i.item || "");
      pack.pantry = {
        low: pantry.filter((i: any) => i.status === "low").map(nameOf).filter(Boolean),
        out: pantry.filter((i: any) => i.status === "out").map(nameOf).filter(Boolean),
      };
    }
    const grocery = await liveGrocery();
    if (grocery === null) pack.unavailable.push("grocery");
    else pack.grocery = grocery.filter((i: any) => i.needed !== false).length;
  }

  if (scope === "task") {
    const tasks = await livePendingTasks();
    const byMember = new Map<string, { pending: number; overdue: number }>();
    for (const t of tasks) {
      const member = String(t.assigned || t.assignee || "Unassigned");
      const g = byMember.get(member) || { pending: 0, overdue: 0 };
      g.pending += 1;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(t.due || "")) && String(t.due) < iso) g.overdue += 1;
      byMember.set(member, g);
    }
    pack.tasks = [...byMember.entries()].map(([member, g]) => ({ member, ...g }));

    const rewards = await liveRewards();
    if (rewards === null) pack.unavailable.push("rewards");
    else pack.rewards = rewards.map((r: any) => ({ title: String(r.title || r.name || "Reward"), cost: r.cost ?? r.points ?? 0 }));

    const archived = await liveWeekArchive();
    if (archived === null) {
      pack.unavailable.push("lastWeek");
    } else {
      const latest = [...archived].sort((a: any, b: any) => String(b.weekStart || "").localeCompare(String(a.weekStart || "")))[0];
      if (latest) {
        const points = parseJSON<Record<string, number>>(latest.points, {});
        const standings = Object.entries(points).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
        pack.lastWeek = { weekStart: String(latest.weekStart || ""), champion: standings[0]?.[0] ?? null };
      } else {
        pack.lastWeek = null;
      }
    }
  }

  if (scope === "schedule") {
    const routines = await liveSchedulesAll();
    if (routines === null) pack.unavailable.push("routines");
    else pack.routines = routines.map((s: any) => ({
      title: s.title, time: s.time, days: s.days || "daily", type: s.type, icon: s.icon, member: s.member,
    }));
  }

  if (scope === "meal" || scope === "schedule") {
    const weather = await fetchLiveWeather();
    if (weather.ok) pack.weather = { condition: weather.data.condition, precipProb: weather.data.precipProb };
    else {
      pack.weather = null;
      pack.unavailable.push("weather");
    }
  }

  return pack;
}
