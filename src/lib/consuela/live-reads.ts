// Shared LIVE readers for the chat tools + the assistant context pack
// (extracted verbatim from src/lib/hermes-tools.ts in Task 8, 2026-09-14 —
// hermes-tools re-exports every name here for back-compat; do NOT fork the
// logic). The original extraction comment is preserved below.

// === Live reads for tool handlers (2026-09-09) ===
// The chat tools used to read db.selectTodaysEvents()/selectPendingTasks()/
// selectTodaysSchedulesRaw() — PROCESS-START caches (src/db/index.ts warms
// them once at module load; only the BROWSER refreshCaches() updates them).
// Server-side handlers therefore answered from a snapshot taken when the
// container started, and the events read never saw the Google-synced rows
// (a separate PB collection only the Calendar page merges). Tool handlers
// must read PB live at call time instead.

import { withAdmin } from "@/lib/pb-auth";
import { localTodayISO, localWeekdayShort } from "@/lib/local-date";
import { mergeTodaysEvents, mergeEventsRange } from "./todays-events";

/** Family events for `dayISO` (default today), read live. Degrades to [] when
 *  PB is unreachable. */
export async function liveEvents(dayISO = localTodayISO()): Promise<any[]> {
  try {
    const rows = await withAdmin(async (pb) => {
      const evts = await pb.collection("events").getFullList({
        filter: `date="${dayISO}"`,
        requestKey: null,
      });
      const members = await pb.collection("members").getFullList({ requestKey: null });
      return evts
        .sort((a: any, b: any) => (a.time || "").localeCompare(b.time || ""))
        .map((event: any) => {
          const member = members.find((m: any) => m.fullName === event.member || m.name === event.member);
          return {
            id: event.id,
            title: event.title,
            time: event.time ? formatEventTime(event.time) : undefined,
            member: member?.fullName || event.member || "Unknown",
            emoji: textEmoji(member?.emoji),
            color: member?.color || "amber",
            icon: event.icon || "📅",
          };
        });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Google-synced calendar rows for `dayISO`, read live. Degrades to [] when
 *  the collection is unreachable — a dead Google sync must not blank the
 *  family's own events. */
export async function liveGoogleEvents(dayISO = localTodayISO()): Promise<any[]> {
  try {
    const rows = await withAdmin(async (pb) => {
      return pb.collection("consuela_google_calendar_events").getFullList({
        fields: "summary,start_iso,calendar_id",
        requestKey: null,
      });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Family + Google events for an inclusive [start,end] ISO-day range.
 *  Returns null when BOTH live reads failed (unavailable signal). The members
 *  read joins once alongside the two event reads — same fullName/emoji/color
 *  parity as liveEvents (range rows must not leak photo base64 either). */
export async function liveEventsRange(startISO: string, endISO: string): Promise<{ days: Record<string, any[]> } | null> {
  const [family, google, members] = await Promise.all([
    withAdmin(async (pb) => pb.collection("events").getFullList({
      filter: `date>="${startISO}" && date<="${endISO}"`, requestKey: null,
    })).catch(() => null),
    withAdmin(async (pb) => pb.collection("consuela_google_calendar_events").getFullList({
      fields: "summary,start_iso,calendar_id", requestKey: null,
    })).catch(() => null),
    withAdmin(async (pb) => pb.collection("members").getFullList({ requestKey: null })).catch(() => []),
  ]);
  if (family === null && google === null) return null;
  const familyRows = (family ?? []).map((e: any) => {
    const member = (members ?? []).find((m: any) => m.fullName === e.member || m.name === e.member);
    return {
      ...e,
      time: e.time ? formatEventTime(e.time) : undefined,
      member: member?.fullName || e.member || "Unknown",
      emoji: textEmoji(member?.emoji),
      color: member?.color || "amber",
      icon: e.icon || "📅",
    };
  });
  return { days: mergeEventsRange(familyRows, google ?? [], startISO, endISO) };
}

/** Member emoji for TOOL OUTPUT — photo avatars are 100KB+ base64 data URLs;
 *  one is bad, seven stacked in a tool result blows the provider's request
 *  limit (verified live: events+tasks+leaderboard = "snag connecting to my
 *  brain"). The LLM only needs a text glyph — data URLs become 👤. */
export function textEmoji(emoji?: string | null): string {
  if (typeof emoji === "string" && emoji.length > 0 && !emoji.startsWith("data:") && !emoji.startsWith("http")) {
    return emoji;
  }
  return "👤";
}

/** "18:30" → "6:30 PM" (the db layer's display format). */
export function formatEventTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  const h24 = Number(m[1]);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Today's events merged from the family collection + the Google calendar. */
export async function mergedTodaysEvents(dayISO = localTodayISO()) {
  const [family, google] = await Promise.all([liveEvents(dayISO), liveGoogleEvents(dayISO)]);
  return mergeTodaysEvents(family, google, dayISO);
}

/** Pending tasks, read live. Unlike the pbDb listing (capped at 3 for the
 *  Home widget) the chat tool returns every pending row. Degrades to [] when
 *  PB is unreachable — an outage must not break get_dashboard_summary. */
export async function livePendingTasks(): Promise<any[]> {
  try {
    const rows = await withAdmin(async (pb) => {
      const [taskRows, members] = await Promise.all([
        pb.collection("tasks").getFullList({ requestKey: null }),
        pb.collection("members").getFullList({ requestKey: null }),
      ]);
      return taskRows
        .filter((t: any) => t.status === "pending" || (!t.status && !t.done))
        .map((task: any) => {
          const member = members.find((m: any) => m.fullName === task.assigned || m.name === task.assigned);
          const due = task.due === localTodayISO() ? "Today"
            : task.due === localTodayISO(new Date(Date.now() + 86400000)) ? "Tomorrow"
            : task.due || "Later";
          return {
            id: task.id,
            title: task.title,
            assigned: member?.fullName || task.assigned || "Unassigned",
            due,
            points: task.priority === "high" ? 20 : task.priority === "medium" ? 15 : task.points || 10,
          };
        });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Today's routine schedule, read live. Degrades to [] when PB is down. */
export async function liveSchedules(): Promise<any[]> {
  try {
    const rows = await withAdmin(async (pb) => {
      const [schedRows, members] = await Promise.all([
        pb.collection("schedules").getFullList({ requestKey: null }),
        pb.collection("members").getFullList({ requestKey: null }),
      ]);
      const now = new Date();
      const weekdayShort = localWeekdayShort();
      const todayIdx = now.getDay();
      return schedRows
        .filter((s: any) => scheduleCoversDay(s.days, weekdayShort, todayIdx))
        .sort((a: any, b: any) => (scheduleTimeMinutes(a.time) ?? 0) - (scheduleTimeMinutes(b.time) ?? 0))
        .map((s: any) => {
          const member = s.member ? members.find((m: any) => m.fullName === s.member || m.name === s.member) : null;
          return {
            id: s.id, title: s.title, time: s.time, emoji: s.icon, type: s.type,
            member: member?.fullName,
          };
        });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** meal_plan_entries rows, read live. Null = the read FAILED (callers must
 *  emit an honest unavailable signal — [] because PB is empty stays []). */
export async function liveMealRows(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("meal_plan_entries").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** The real recipe catalog (`recipes` collection), read live. Null = read failed. */
export async function liveRecipes(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("recipes").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Full roster, read live. Null = read failed — callers must handle empty. */
export async function liveMembers(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("members").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Pantry rows, read live. Null = read failed — callers must emit an honest
 *  unavailable signal containing "do not guess". */
export async function livePantry(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("pantry_items").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Grocery list rows, read live. Null = read failed — callers must emit an
 *  honest unavailable signal (same `| null` idiom as the other catalog
 *  reads; the get_grocery_list tool's own read path is untouched). */
export async function liveGrocery(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("grocery_list_items").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** EVERY schedule row (weekly view, unfiltered by day), read live.
 *  Null = read failed — callers must emit an honest unavailable signal. */
export async function liveSchedulesAll(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("schedules").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Archived weeks (`week_archive`), read live. Null = read failed. */
export async function liveWeekArchive(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("week_archive").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** The reward shop catalog, read live. Null = read failed. */
export async function liveRewards(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("rewards").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Week convention shared with useMeals/PlanTab/CurrentMealWidget: legacy
 *  weekless rows count as the current week. */
export function mealsForWeek(rows: any[], weekOf: string): any[] {
  return (rows || []).filter((m: any) => (m.weekOf || weekOf) === weekOf);
}

/** Weekday coverage mirror of schedule-time.ts (kept local to avoid a client
 *  import chain; same semantics: "weekdays"/"weekends" keywords + SMTWTFS). */
export function scheduleCoversDay(days: unknown, weekdayShort: string, todayIdx: number): boolean {
  if (!days) return true;
  if (typeof days === "string") {
    const d = days.toLowerCase();
    if (d === "weekdays") return todayIdx >= 1 && todayIdx <= 5;
    if (d === "weekends") return todayIdx === 0 || todayIdx === 6;
    if (d === "daily" || d === "everyday") return true;
    const letters = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return d.includes(letters[todayIdx]);
  }
  if (Array.isArray(days)) {
    const letters = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return days.some((d) => String(d).toLowerCase().startsWith(letters[todayIdx].slice(0, 3)) || String(d).toLowerCase() === weekdayShort);
  }
  return true;
}

export function scheduleTimeMinutes(time?: string): number | null {
  if (!time) return null;
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (m24) return Number(m24[1]) * 60 + Number(m24[2]);
  const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (m12[3].toUpperCase() === "PM") h += 12;
    return h * 60 + Number(m12[2]);
  }
  return null;
}

export function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}
