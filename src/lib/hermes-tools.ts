import { db } from "@/db";
import { groceryCategories } from "@/data/meals";
import { withAdmin } from "@/lib/pb-auth";
import { weekKey } from "@/lib/task-utils";
import type { WeekData } from "@/types/tasks";
import { getHAWebSocketClient } from "@/lib/ha/websocket-client";
import { getStoreLabel, groupByStore } from "@/lib/stores";
import { localTodayISO, localWeekdayShort, familyTimeZone, weekdayOfISO, localWeekStartISO } from "@/lib/local-date";
import { fetchLiveWeather } from "@/lib/weather-live";
import { weekStartForDate, isoDateForWeekday } from "@/lib/meals-week-utils";
import { storeMemory, queryMemories, deleteMemory, incrementMemoryUsage, type MemoryCategory } from "@/lib/family-memory";
import { MEMORY_USER_ID, MEMORY_FAMILY_ID } from "@/lib/memory-ids";
import { mergeTodaysEvents, mergeEventsRange, googleEventTime } from "@/lib/consuela/todays-events";

// === Live reads for tool handlers (2026-09-09) ===
// The chat tools used to read db.selectTodaysEvents()/selectPendingTasks()/
// selectTodaysSchedulesRaw() — PROCESS-START caches (src/db/index.ts warms
// them once at module load; only the BROWSER refreshCaches() updates them).
// Server-side handlers therefore answered from a snapshot taken when the
// container started, and the events read never saw the Google-synced rows
// (a separate PB collection only the Calendar page merges). Tool handlers
// must read PB live at call time instead.

/** Family events for `dayISO` (default today), read live. Degrades to [] when
 *  PB is unreachable. */
async function liveEvents(dayISO = localTodayISO()): Promise<any[]> {
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
async function liveGoogleEvents(dayISO = localTodayISO()): Promise<any[]> {
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
async function liveEventsRange(startISO: string, endISO: string): Promise<{ days: Record<string, any[]> } | null> {
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
function textEmoji(emoji?: string | null): string {
  if (typeof emoji === "string" && emoji.length > 0 && !emoji.startsWith("data:") && !emoji.startsWith("http")) {
    return emoji;
  }
  return "👤";
}

/** "18:30" → "6:30 PM" (the db layer's display format). */
function formatEventTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  const h24 = Number(m[1]);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Today's events merged from the family collection + the Google calendar. */
async function mergedTodaysEvents(dayISO = localTodayISO()) {
  const [family, google] = await Promise.all([liveEvents(dayISO), liveGoogleEvents(dayISO)]);
  return mergeTodaysEvents(family, google, dayISO);
}

/** Pending tasks, read live. Unlike the pbDb listing (capped at 3 for the
 *  Home widget) the chat tool returns every pending row. Degrades to [] when
 *  PB is unreachable — an outage must not break get_dashboard_summary. */
async function livePendingTasks(): Promise<any[]> {
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
async function liveSchedules(): Promise<any[]> {
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
async function liveMealRows(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("meal_plan_entries").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** The real recipe catalog (`recipes` collection), read live. Null = read failed. */
async function liveRecipes(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("recipes").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Full roster, read live. Null = read failed — callers must handle empty. */
async function liveMembers(): Promise<any[] | null> {
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
async function livePantry(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("pantry_items").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** EVERY schedule row (weekly view, unfiltered by day), read live.
 *  Null = read failed — callers must emit an honest unavailable signal. */
async function liveSchedulesAll(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("schedules").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** Archived weeks (`week_archive`), read live. Null = read failed. */
async function liveWeekArchive(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("week_archive").getFullList({ requestKey: null }));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

/** The reward shop catalog, read live. Null = read failed. */
async function liveRewards(): Promise<any[] | null> {
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
function mealsForWeek(rows: any[], weekOf: string): any[] {
  return (rows || []).filter((m: any) => (m.weekOf || weekOf) === weekOf);
}

/** Weekday coverage mirror of schedule-time.ts (kept local to avoid a client
 *  import chain; same semantics: "weekdays"/"weekends" keywords + SMTWTFS). */
function scheduleCoversDay(days: unknown, weekdayShort: string, todayIdx: number): boolean {
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

function scheduleTimeMinutes(time?: string): number | null {
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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export type ToolHandler = (args: Record<string, any>) => Promise<string>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

async function summarize(obj: any): Promise<string> {
  return JSON.stringify(obj, null, 2);
}

function todayISO(): string {
  return localTodayISO();
}

function formatTime(iso?: string): string {
  if (!iso) return "no time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

const MEMORY_CATEGORIES: MemoryCategory[] = ["preference", "allergy", "routine", "location", "schedule", "personality", "restriction", "contact", "note"];

function memoryKey(person: string | undefined, content: string): string {
  const raw = `${person?.trim() ?? ""} ${content}`.trim().toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 50) || "memory";
}

// === Admin-backed persistence helpers ===
// The dev/prod PocketBase restricts collections to superusers (PB v0.39+ rejects
// unauthenticated writes), so every write goes through withAdmin.

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

function normalizeGroceryName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePantryName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function adminUpsertTask(task: Record<string, unknown>): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("tasks").getFullList({
        filter: `taskId=${Number(task.taskId)}`,
        requestKey: null,
      });
      const existing = records.find((r: any) => r.taskId === task.taskId);
      return existing ? pb.collection("tasks").update(existing.id, task) : pb.collection("tasks").create(task);
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertTask failed:", e?.message);
    return null;
  }
}

async function adminInsertEvent(event: Record<string, unknown>): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => pb.collection("events").create(event));
  } catch (e: any) {
    console.error("[hermes-tools] insertEvent failed:", e?.message);
    return null;
  }
}

async function adminUpsertMeal(meal: Record<string, unknown>): Promise<{ row: any | null; replaced: boolean }> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("meal_plan_entries").getFullList({ requestKey: null });
      const existing = records.find(
        (r: any) =>
          r.time === meal.time &&
          (r.mealType || "dinner") === (meal.mealType || "dinner") &&
          (r.weekOf || "") === (meal.weekOf || "")
      );
      if (existing) {
        const row = await pb.collection("meal_plan_entries").update(existing.id, meal);
        return { row, replaced: true };
      }
      const row = await pb.collection("meal_plan_entries").create(meal);
      return { row, replaced: false };
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertMeal failed:", e?.message);
    return { row: null, replaced: false };
  }
}

async function adminUpsertWeekData(data: WeekData): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("week_data").getFullList({
        filter: `weekStart="${data.weekStart}"`,
        requestKey: null,
      });
      const existing = records.find((r: any) => r.weekStart === data.weekStart);
      return existing
        ? pb.collection("week_data").update(existing.id, data as any)
        : pb.collection("week_data").create(data as any);
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertWeekData failed:", e?.message);
    return null;
  }
}

/** Shared task lookup for update_task/delete_task/reopen_task — mirrors
 *  complete_task's resolution: numeric taskId first, then exact title
 *  (case-insensitive, optional assignee disambiguation). */
async function findTaskRow(pb: any, args: { taskId?: number; title?: string; assignee?: string }): Promise<any | null> {
  const records = await pb.collection("tasks").getFullList({ requestKey: null });
  if (args.taskId !== undefined) {
    return records.find((r: any) => Number(r.taskId) === Number(args.taskId)) || null;
  }
  if (args.title) {
    const t = String(args.title).trim().toLowerCase();
    const a = args.assignee ? String(args.assignee).toLowerCase() : undefined;
    return records.find((r: any) =>
      String(r.title).trim().toLowerCase() === t &&
      (!a || String(r.assignee || "").toLowerCase().includes(a))) || null;
  }
  return null;
}

async function updateTaskCore(args: any) {
  try {
    return await withAdmin(async (pb) => {
      const row = await findTaskRow(pb, args);
      if (!row) return { ok: false, error: "task not found — call get_pending_tasks first" };
      if (row.status === "done") return { ok: false, error: "task is completed — mark it pending in the UI first" };
      const patch: Record<string, unknown> = {};
      if (args.newTitle) patch.title = String(args.newTitle).trim();
      if (args.points !== undefined) {
        const p = Number(args.points);
        if (!Number.isFinite(p)) return { ok: false, error: "points must be a number between 1 and 100" };
        patch.points = Math.max(1, Math.min(100, p));
      }
      if (args.due && /^\d{4}-\d{2}-\d{2}$/.test(args.due)) patch.due = args.due;
      if (args.priority) patch.priority = args.priority;
      if (args.recurring) patch.recurring = ["none", "daily", "weekly"].includes(args.recurring) ? args.recurring : "none";
      if (args.stealable !== undefined) patch.stealable = args.stealable === true;
      if (args.newAssignee) {
        const members = await liveMembers();
        const m = (members || []).find((x: any) => String(x.fullName || x.name || "").toLowerCase().includes(String(args.newAssignee).toLowerCase()));
        if (!m) return { ok: false, error: `unknown member "${args.newAssignee}" — call get_family_members first` };
        patch.assignee = m.fullName || m.name;
        patch.assigneeEmoji = m.emoji; // raw value into storage (UI renders via Avatar); textEmoji() is for OUTPUT only
      }
      if (Object.keys(patch).length === 0) return { ok: false, error: "no valid fields to update" };
      const before = { title: row.title, assignee: row.assignee, points: row.points, due: row.due, priority: row.priority, recurring: row.recurring, stealable: row.stealable };
      const updated = await pb.collection("tasks").update(row.id, patch);
      const after = { title: updated.title ?? before.title, assignee: updated.assignee ?? before.assignee, points: updated.points ?? before.points, due: updated.due ?? before.due, priority: updated.priority ?? before.priority, recurring: updated.recurring ?? before.recurring, stealable: updated.stealable ?? before.stealable };
      return { ok: true, taskId: Number(row.taskId), before, after };
    });
  } catch (e: any) {
    return { ok: false, error: `update_task failed: ${e?.message}` };
  }
}

const TOOLS: Tool[] = [
  {
    definition: {
      name: "get_weather",
      description: "Get today's REAL live weather for the family (Open-Meteo, Fahrenheit). Returns current temperature, feels-like, high/low, condition, and precipitation chance. Never invent weather — if this tool reports an error, say the weather data is unavailable.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const w = await fetchLiveWeather();
      if (!w.ok) return summarize({ error: "weather data unavailable — do not guess the weather" });
      return summarize({ today: localTodayISO(), current_temp: w.data.tempF, feels_like: w.data.feelsLikeF, high: w.data.highF, low: w.data.lowF, condition: w.data.condition, precip_chance: `${w.data.precipProb}%`, units: "Fahrenheit" });
    },
  },
  {
    definition: {
      name: "get_family_members",
      description: "List all family members with their names, roles, and emojis.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const members = await liveMembers();
      if (members === null) return summarize({ error: "member data unavailable", members: [] });
      return summarize({ members: members.map((m: any) => ({ name: m.fullName || m.name, role: m.role, age: m.age, emoji: textEmoji(m.emoji) })) });
    },
  },
  {
    definition: {
      name: "get_todays_events",
      description: "Get all calendar events scheduled for today — family events AND synced Google Calendar events. Returns event titles, times, and who they're for.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const events = await mergedTodaysEvents();
      return summarize(events.map((e) => ({
        title: e.title,
        time: e.time,
        member: e.member,
        emoji: e.emoji,
        color: e.color,
        source: e.source,
      })));
    },
  },
  {
    definition: {
      name: "get_calendar_range",
      description: "Get calendar events for a date range (family + Google, merged). Use for 'what's on Thursday?', 'this week', 'next week'. Max 30 days.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "YYYY-MM-DD (default: today)" },
          end: { type: "string", description: "YYYY-MM-DD inclusive (default: today)" },
        },
      },
    },
    handler: async (args: any) => {
      const start = String(args.start || localTodayISO());
      const end = String(args.end || start);
      const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (!isDate(start) || !isDate(end)) return summarize({ error: "start/end must be YYYY-MM-DD" });
      if (end < start) return summarize({ error: "end is before start" });
      const daysBetween = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000;
      if (daysBetween > 29) return summarize({ error: "range capped at 30 days — narrow it" });
      const merged = await liveEventsRange(start, end);
      if (merged === null) return summarize({ error: "calendar data unavailable — do not guess events", days: {} });
      return summarize({ start, end, days: merged.days });
    },
  },
  {
    definition: {
      name: "add_event",
      description: "Add a new event to the family calendar. Use this when the user asks to create or schedule an event.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title (e.g. 'Soccer practice', 'Dentist appointment')" },
          date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
          time: { type: "string", description: "Time in HH:MM 24-hour format. Defaults to 09:00." },
          icon: { type: "string", description: "Emoji icon for the event (default 📅)" },
          color: { type: "string", description: "Accent color (default mint)" },
          member: { type: "string", description: "Family member the event is for" },
        },
        required: ["title"],
      },
    },
    handler: async (args) => {
      const event: Record<string, unknown> = {
        title: String(args.title).trim(),
        date: args.date || todayISO(),
        time: args.time || "09:00",
        icon: args.icon || "📅",
        color: args.color || "mint",
        member: args.member,
      };
      const row = await adminInsertEvent(event);
      if (!row) return summarize({ ok: false, error: "Could not create event" });
      return summarize({
        ok: true,
        event: {
          id: row.id,
          title: row.title,
          date: row.date,
          time: row.time,
          icon: row.icon,
          color: row.color,
          member: row.member,
        },
      });
    },
  },
  {
    definition: {
      name: "remove_event",
      description: "Remove an event from the family calendar by title. Optionally narrow by date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title to remove (e.g. 'Soccer practice')" },
          date: { type: "string", description: "Optional: date in YYYY-MM-DD format to disambiguate" },
        },
        required: ["title"],
      },
    },
    handler: async (args) => {
      const title = String(args.title).trim().toLowerCase();
      const date = args.date ? String(args.date) : undefined;
      // Model-supplied garbage must never reach the PB filter string unescaped;
      // an invalid date degrades to a title-only search (same as omitting it).
      const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
      let result: { removed: boolean; title?: any; reason?: string };
      try {
        result = await withAdmin(async (pb) => {
          // PB `~` is a coarse pre-narrowing; the exact client-side match below
          // stays authoritative (semantics unchanged).
          const titleLike = title.replace(/"/g, "");
          const records = await pb.collection("events").getFullList({
            filter: `title ~ "${titleLike}"${safeDate ? ` && date="${safeDate}"` : ""}`,
            requestKey: null,
          });
          const match = records.find(
            (e: any) => String(e.title).trim().toLowerCase() === title && (!safeDate || e.date === safeDate)
          );
          if (!match) return { removed: false, reason: "not found" };
          await pb.collection("events").delete(match.id);
          return { removed: true, title: match.title };
        });
      } catch (e: any) {
        result = { removed: false, reason: `error: ${e?.message}` };
      }
      return summarize(result);
    },
  },
  {
    definition: {
      name: "update_event",
      description: "Move or edit a family calendar event: date, time, title, member. Find by title (+date when ambiguous). Does not edit Google-synced events.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Current event title to find" },
          date: { type: "string", description: "New date YYYY-MM-DD" },
          time: { type: "string", description: "New time HH:MM 24-hour" },
          newTitle: { type: "string", description: "New title to rename the event to" },
          member: { type: "string", description: "New member the event is for" },
          findDate: { type: "string", description: "Current date of the event (disambiguates repeats)" },
        },
        required: ["title"],
      },
    },
    handler: async (args: any) => {
      const title = String(args.title || "").trim().toLowerCase();
      const findDate = args.findDate && /^\d{4}-\d{2}-\d{2}$/.test(args.findDate) ? args.findDate : undefined;
      const patch: Record<string, unknown> = {};
      if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date))) patch.date = args.date;
      if (args.time && /^(\d{1,2}):(\d{2})$/.test(String(args.time))) patch.time = args.time;
      if (args.newTitle) patch.title = String(args.newTitle).trim();
      if (args.member) patch.member = String(args.member).trim();
      if (Object.keys(patch).length === 0) return summarize({ ok: false, error: "nothing to update — pass date/time/newTitle/member" });
      try {
        const result = await withAdmin(async (pb) => {
          const records = await pb.collection("events").getFullList({ requestKey: null });
          const matches = records.filter((e: any) =>
            String(e.title).trim().toLowerCase() === title && (!findDate || e.date === findDate));
          if (matches.length === 0) return { ok: false, error: `no family event titled "${args.title}" (Google events are edited on Google's side)` };
          if (matches.length > 1 && !findDate) return { ok: false, error: "multiple events share that title — pass the event's current date as findDate to pick one" };
          const row = matches[0];
          const before = { title: row.title, date: row.date, time: row.time, member: row.member };
          const updated = await pb.collection("events").update(row.id, patch);
          return { ok: true, id: row.id, before, after: { title: updated.title ?? before.title, date: updated.date ?? before.date, time: updated.time ?? before.time, member: updated.member ?? before.member } };
        });
        return summarize(result);
      } catch (e: any) {
        return summarize({ ok: false, error: `update_event failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_todays_schedule",
      description: "Get the family's daily routine schedule for today. Returns time-ordered routines like wake-up, meals, bedtime.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const sched = await liveSchedules();
      return summarize(sched.map((s: any) => ({
        title: s.title,
        time: s.time,
        type: s.type,
        emoji: s.emoji,
        member: s.member,
      })));
    },
  },
  {
    definition: {
      name: "get_pending_tasks",
      description: "Get all pending chores and tasks that need to be done. Returns task titles, who they're assigned to, points, and due dates.",
      parameters: {
        type: "object",
        properties: {
          member: { type: "string", description: "Optional: filter tasks by family member name (e.g. 'Emily', 'Bailey')" },
        },
      },
    },
    handler: async (args) => {
      const tasks = await livePendingTasks();
      let filtered = tasks;
      if (args.member) {
        const m = String(args.member).toLowerCase();
        filtered = filtered.filter((t: any) => {
          const name = (t.assigned || t.assignee || "").toLowerCase();
          return name.includes(m) || name.startsWith(m);
        });
      }
      return summarize(filtered.map((t: any) => ({
        title: t.title,
        assigned: t.assigned || t.assignee,
        points: t.points,
        due: t.due,
      })));
    },
  },
  {
    definition: {
      name: "add_task",
      description: "Add a new chore or task for a family member. Unknown member names are refused — resolve them with get_family_members first.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title (e.g. 'Walk Rocco', 'Clean bathroom')" },
          assigned_to: { type: "string", description: "Family member name to assign to (e.g. 'Emily', 'Jeffery')" },
          points: { type: "number", description: "Points for completing this task (5-20 range)" },
          due: { type: "string", description: "Due date in YYYY-MM-DD format. Defaults to today if not provided." },
          priority: { type: "string", description: "Priority level", enum: ["low", "medium", "high"] },
          recurring: { type: "string", description: "Repeat cadence", enum: ["none", "daily", "weekly"] },
          stealable: { type: "boolean", description: "Up for grabs by anyone once the due date passes" },
        },
        required: ["title", "assigned_to"],
      },
    },
    handler: async (args) => {
      const due = args.due || todayISO();
      const points = Math.max(1, Math.min(100, Number(args.points) || 10));
      const priority = args.priority || "medium";
      const members = await liveMembers();
      if (members === null) {
        return summarize({ ok: false, error: "member data unavailable — call get_family_members first" });
      }
      const match = members.find((m: any) => {
        const name = (m.fullName || m.name || "").toLowerCase();
        const search = String(args.assigned_to).toLowerCase();
        return name.includes(search) || name.startsWith(search);
      });
      if (!match) {
        return summarize({
          ok: false,
          error: `unknown member "${args.assigned_to}" — call get_family_members to see the roster, then retry`,
        });
      }
      const task: Record<string, unknown> = {
        taskId: Date.now(),
        title: String(args.title).trim(),
        assignee: match.fullName || match.name,
        assigneeEmoji: match.emoji,
        due,
        points,
        priority,
        recurring: ["none", "daily", "weekly"].includes(args.recurring) ? args.recurring : "none",
        stealable: args.stealable === true,
        category: "chore",
        universal: false,
        createdAt: new Date().toISOString(),
      };
      const row = await adminUpsertTask(task);
      if (!row) return summarize({ ok: false, error: "Could not persist task to the dashboard" });
      return summarize({
        ok: true,
        taskId: row.taskId ?? task.taskId,
        id: row.id,
        title: row.title,
        assignee: row.assignee,
        assigneeEmoji: textEmoji(match.emoji),
        points: row.points,
        due: row.due,
        priority: row.priority,
      });
    },
  },
  {
    definition: {
      name: "update_task",
      description: "Update a pending task: title, assignee, points, due, priority, recurring, or stealable. Find by taskId or exact title.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "number", description: "Numeric task id from get_pending_tasks" },
          title: { type: "string", description: "Exact title if taskId not known" },
          assignee: { type: "string", description: "Disambiguate by assignee when searching by title" },
          newTitle: { type: "string", description: "Replacement title" },
          newAssignee: { type: "string", description: "New assignee name" },
          points: { type: "number", description: "New point value" },
          due: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", description: "New priority", enum: ["low", "medium", "high"] },
          recurring: { type: "string", description: "New repeat cadence", enum: ["none", "daily", "weekly"] },
          stealable: { type: "boolean", description: "Up for grabs when late" },
        },
      },
    },
    handler: async (args: any) => summarize(await updateTaskCore(args)),
  },
  {
    definition: {
      name: "delete_task",
      description: "Delete a task by taskId or exact title. The row is removed permanently — completed tasks must be undone in the Tasks UI instead.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "number", description: "Numeric task id from get_pending_tasks" },
          title: { type: "string", description: "Exact title if taskId not known" },
          assignee: { type: "string", description: "Disambiguate by assignee when searching by title" },
        },
      },
    },
    handler: async (args: any) => {
      try {
        const result = await withAdmin(async (pb) => {
          const row = await findTaskRow(pb, args);
          if (!row) return { ok: false, error: "task not found — call get_pending_tasks first" };
          if (row.status === "done") return { ok: false, error: "task is completed — undo it in the Tasks UI (parent PIN) instead of deleting" };
          await pb.collection("tasks").delete(row.id);
          return { ok: true, taskId: Number(row.taskId), title: row.title, assignee: row.assignee, deleted: true };
        });
        return summarize(result);
      } catch (e: any) {
        return summarize({ ok: false, error: `delete_task failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "reopen_task",
      description: "Reopen a completed task that is still waiting in the parent approval queue (no points moved yet). Already-paid completions must be undone in the Tasks UI.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "number", description: "Numeric task id" },
          title: { type: "string", description: "Exact title if taskId not known" },
          assignee: { type: "string", description: "Disambiguate by assignee when searching by title" },
        },
      },
    },
    handler: async (args: any) => {
      try {
        const result = await withAdmin(async (pb) => {
          const row = await findTaskRow(pb, args);
          if (!row) return { ok: false, error: "task not found — call get_pending_tasks or get_completed_tasks first" };
          if (row.status !== "done") return { ok: false, error: "task is already pending" };
          if (!row.pendingApproval || row.sentBackAt) {
            return { ok: false, error: "this task's points were already awarded — undo it in the Tasks UI (parent PIN)" };
          }
          await pb.collection("tasks").update(row.id, { status: "pending", completedInWeek: null, completedAt: null, pendingApproval: null, sentBackAt: null });
          return { ok: true, taskId: Number(row.taskId), title: row.title, reopened: true };
        });
        return summarize(result);
      } catch (e: any) {
        return summarize({ ok: false, error: `reopen_task failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_completed_tasks",
      description: "List recently completed chores (default last 7 days, max 30). Returns title, who did it, and when.",
      parameters: { type: "object", properties: { days: { type: "number", description: "How far back to look (1-30, default 7)" } } },
    },
    handler: async (args: any) => {
      const days = Math.max(1, Math.min(30, Number(args.days) || 7));
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      try {
        const done = await withAdmin(async (pb) => {
          const records = await pb.collection("tasks").getFullList({ requestKey: null });
          return records.filter((r: any) => {
            if (r.status !== "done") return false;
            const stamp = String(r.completedAt || r.updated || "");
            // Legacy rows carry no completion timestamp — include them (they
            // predate the field) rather than hiding finished chores.
            return !stamp || stamp >= cutoff;
          });
        });
        return summarize({ days, completed: (done || []).map((t: any) => ({ title: t.title, assignee: t.assignee, completedBy: t.completedBy || t.assignee, completedAt: t.completedAt, week: t.completedInWeek })) });
      } catch (e: any) {
        return summarize({ error: `completed-task read failed: ${e?.message}`, completed: [] });
      }
    },
  },
  {
    definition: {
      name: "complete_task",
      description: "Mark a chore as done — it lands in the parent approval queue (points only move when a parent approves). Find by title or taskId.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title to complete (e.g. 'Walk Rocco')" },
          taskId: { type: "number", description: "Optional: numeric task id to complete" },
          assignee: { type: "string", description: "Optional: family member name to disambiguate (e.g. 'Emily')" },
        },
      },
    },
    handler: async (args: any) => {
      const taskId = args.taskId !== undefined ? Number(args.taskId) : undefined;
      const title = args.title ? String(args.title).trim() : undefined;
      const assignee = args.assignee ? String(args.assignee).trim().toLowerCase() : undefined;
      if (!taskId && !title) return summarize({ ok: false, error: "Provide a title or taskId of the task to complete" });
      try {
        const result: Record<string, any> = await withAdmin(async (pb) => {
          const records = await pb.collection("tasks").getFullList({ requestKey: null });
          // Chat never moves points: only pending rows are completable, and a
          // completion lands as a done-but-UNPAID row for the parent queue —
          // the exact shape the claim route + tapCompletePending write.
          const pending = records.filter((r: any) => r.status !== "done");
          const findIn = (pool: any[]): any => {
            let task: any = taskId !== undefined ? pool.find((r: any) => Number(r.taskId) === taskId) : undefined;
            if (!task && title) {
              const t = title.toLowerCase();
              task = pool.find((r: any) => String(r.title).trim().toLowerCase() === t);
              if (!task) task = pool.find((r: any) => String(r.title).trim().toLowerCase().includes(t));
              if (task && assignee && !String(task.assignee || "").toLowerCase().includes(assignee)) {
                const alt = pool.find((r: any) => String(r.title).trim().toLowerCase() === t && String(r.assignee || "").toLowerCase().includes(assignee));
                if (alt) task = alt;
              }
            }
            return task;
          };
          const task = findIn(pending);
          if (!task) {
            // A queued row is status "done", so the pending-only lookup can
            // never see it — re-match against ALL records and answer an
            // already-queued completion with the honest queue refusal instead
            // of the generic not-found. Approved/paid/legacy done rows carry
            // no live pendingApproval and still fall to not-found.
            const queued = findIn(records);
            if (queued?.pendingApproval && !queued.sentBackAt) {
              return { ok: false, error: "Already completed — waiting for parent approval" };
            }
            return { ok: false, error: `No pending task found${title ? ` matching "${title}"` : ""}${taskId !== undefined ? ` (taskId ${taskId})` : ""}` };
          }
          if (task.pendingApproval && !task.sentBackAt) return { ok: false, error: "Already completed — waiting for parent approval" };
          const amount = Number(task.points) || 0;
          const now = new Date().toISOString();
          await pb.collection("tasks").update(task.id, {
            completed: true,
            status: "done",
            completedBy: task.assignee || "Unknown",
            completedInWeek: weekKey(),
            completedAt: now,
            assigned: task.assignee ?? null,
            pendingApproval: { byName: task.assignee || "Unknown", at: now, points: amount },
            sentBackAt: null,
          });
          return { ok: true, taskId: Number(task.taskId), title: task.title, assignee: task.assignee, points: amount, queuedForApproval: true };
        });
        if (result.ok) result.note = "A parent approves it in the Tasks queue — points only move on approval.";
        return summarize(result);
      } catch (e: any) {
        return summarize({ ok: false, error: `complete_task failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_weekly_meals",
      description: "Get the family's meal plan for the week. Returns each day's meals with names, emojis, and meal types (breakfast/lunch/dinner).",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const weekOf = localWeekStartISO();
      const raw = await liveMealRows();
      if (raw === null) {
        return summarize({ today: `${localWeekdayShort()} (${localTodayISO()})`, current_week_monday: weekOf, days: {}, error: "meal data unavailable — do not guess meals" });
      }
      const byDay: Record<string, any[]> = {};
      for (const m of mealsForWeek(raw, weekOf)) {
        const day = m.time || m.day || "unscheduled";
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push({
          name: m.name,
          emoji: m.emoji,
          mealType: m.mealType || "meal",
          prepTime: m.prepTime,
          calories: m.calories,
          servings: m.servings,
          tags: parseJSON(m.tags, []),
          weekOf: m.weekOf,
          date: m.date,
        });
      }
      return summarize({
        today: `${localWeekdayShort()} (${localTodayISO()})`,
        current_week_monday: weekOf,
        days: byDay,
      });
    },
  },
  {
    definition: {
      name: "add_meal",
      description:
        "Add or replace a meal on the family meal planner for a specific day. Use when the user says what they ate or wants planned (e.g. 'yesterday was pizza dinner', 'put leftovers on Tuesday lunch'). Day must be a weekday short (Mon..Sun) or a YYYY-MM-DD date — resolve 'today'/'yesterday' using the Current date block in your system prompt.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Meal name (e.g. 'Little Caesars Pizza')" },
          day: { type: "string", description: "Weekday short (Mon/Tue/Wed/Thu/Fri/Sat/Sun) or YYYY-MM-DD" },
          mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "Which meal (default dinner)" },
          emoji: { type: "string", description: "Emoji for the meal (default 🍽️)" },
        },
        required: ["name", "day"],
      },
    },
    handler: async (args) => {
      const name = String(args.name ?? "").trim();
      if (!name) return summarize({ ok: false, error: "Meal name is required" });
      const dayRaw = String(args.day ?? "").trim();
      const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const todayISO = localTodayISO();
      let mealDate: string;
      let weekdayShort: string;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
        mealDate = dayRaw;
        weekdayShort = weekdayOfISO(dayRaw);
      } else {
        const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === dayRaw.toLowerCase());
        if (idx === -1) {
          return summarize({ ok: false, error: `day must be Mon..Sun or YYYY-MM-DD, got "${dayRaw}"` });
        }
        weekdayShort = WEEKDAYS[idx];
        mealDate = isoDateForWeekday(weekStartForDate(todayISO), weekdayShort);
      }
      const weekOf = weekStartForDate(mealDate);
      const mealType = (typeof args.mealType === "string" ? args.mealType : "dinner").toLowerCase();
      const meal: Record<string, unknown> = {
        name,
        emoji: typeof args.emoji === "string" && args.emoji ? args.emoji : "🍽️",
        time: weekdayShort,
        mealType,
        weekOf,
        date: mealDate,
        prepTime: "30 min",
        tags: JSON.stringify([]),
        ingredients: JSON.stringify([]),
        servings: 7,
        calories: 0,
      };
      const { row, replaced } = await adminUpsertMeal(meal);
      if (!row) return summarize({ ok: false, error: "Could not save the meal" });
      return summarize({
        ok: true,
        replaced,
        meal: { id: row.id, name: row.name, day: row.time, time: row.time, mealType: row.mealType, date: row.date, weekOf: row.weekOf },
      });
    },
  },
  {
    definition: {
      name: "get_recipes",
      description: "Get the family recipe catalog (saved recipes) plus ingredient-bearing planned meals. Returns names, tags, ingredients.",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Optional: filter by tag (e.g. 'Quick', 'Vegetarian', 'Healthy', 'Family Fave', 'Kids Love')" },
        },
      },
    },
    handler: async (args) => {
      const catalogRaw = await liveRecipes();
      const mealRaw = await liveMealRows();
      if (catalogRaw === null && mealRaw === null) {
        return summarize({ error: "recipe data unavailable — do not guess recipes", recipes: [] });
      }
      const catalog = (catalogRaw || []).map((r: any) => ({
        name: r.name, emoji: r.emoji || "🍽️", prepTime: r.prepTime, calories: r.calories,
        protein: r.protein, carbs: r.carbs, fat: r.fat, tags: parseJSON(r.tags, []),
        servings: r.servings, ingredients: parseJSON(r.ingredients, []), source: "catalog",
      }));
      const seen = new Set(catalog.map((r) => String(r.name).toLowerCase()));
      const planned = (mealRaw || [])
        .filter((m: any) => m.name && !seen.has(String(m.name).toLowerCase()) && parseJSON<any[]>(m.ingredients, []).length > 0)
        .map((m: any) => ({
          name: m.name, emoji: m.emoji || "🍽️", prepTime: m.prepTime, calories: m.calories,
          tags: parseJSON(m.tags, []), servings: m.servings, ingredients: parseJSON(m.ingredients, []),
          day: m.time || m.day, source: "planned",
        }));
      let recipes = [...catalog, ...planned];
      if (args.tag) {
        const tag = String(args.tag).toLowerCase();
        recipes = recipes.filter((r: any) => (r.tags || []).some((t: string) => String(t).toLowerCase().includes(tag)));
      }
      return summarize({ recipes });
    },
  },
  {
    definition: {
      name: "get_grocery_list",
      description: "Get the grocery shopping list. Returns items that need to be bought, organized by category and priority.",
      parameters: {
        type: "object",
        properties: {
          needed_only: { type: "boolean", description: "If true, only show items marked as needed (default: false — show all)" },
        },
      },
    },
    handler: async (args) => {
      let items = await db.selectGrocery();
      if (args.needed_only) items = items.filter((i: any) => i.needed !== false);
      const byCategory: Record<string, any[]> = {};
      for (const i of items) {
        const cat = i.category || "other";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({
          name: i.name,
          emoji: i.emoji || "🛒",
          quantity: i.quantity,
          priority: i.priority,
          needed: i.needed !== false,
          aisle: i.aisle,
        });
      }
      return summarize({ total_items: items.length, needed_count: items.filter((i: any) => i.needed !== false).length, by_category: byCategory });
    },
  },
  {
    definition: {
      name: "get_pantry",
      description: "Get the pantry inventory. Returns what's in stock, organized by status (plenty/low/out).",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      let items: any[] | null = null;
      try {
        items = await withAdmin(async (pb) => pb.collection("pantry_items").getFullList({ requestKey: null }));
      } catch { items = null; }
      if (!Array.isArray(items)) {
        return summarize({ error: "pantry data unavailable — do not guess inventory", total: 0, by_status: { plenty: [], low: [], out: [] } });
      }
      const byStatus: Record<string, any[]> = { plenty: [], low: [], out: [] };
      for (const i of items) {
        const status = i.status || "plenty";
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push({ name: i.name || i.item, category: i.category, quantity: i.quantity, unit: i.unit });
      }
      return summarize({ total: items.length, by_status: byStatus });
    },
  },
  {
    definition: {
      name: "get_leaderboard",
      description: "Get the family task leaderboard. Returns weekly points, streaks, levels, and rankings for all family members.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      // Real standings (2026-09-09): the old handler returned a static
      // "how it works" blurb with member names and NO points — kids asking
      // "who's winning?" got nothing answerable. Read week_data live and
      // rank the actual weekly points.
      const weekStart = localWeekStartISO();
      let members: any[] = [];
      let week: any = null;
      try {
        [members, week] = await Promise.all([
          withAdmin(async (pb) => pb.collection("members").getFullList({ requestKey: null })),
          withAdmin(async (pb) =>
            pb.collection("week_data").getFullList({ filter: `weekStart="${weekStart}"`, requestKey: null })),
        ]);
      } catch {
        members = [];
        week = null;
      }
      const points = (week?.[0]?.points ?? {}) as Record<string, number>;
      const entries = (members || [])
        .filter((m: any) => m.role !== "pet")
        .map((m: any) => ({
          name: m.fullName || m.name,
          role: m.role,
          emoji: textEmoji(m.emoji),
          points: points[m.fullName] ?? points[m.name] ?? 0,
        }))
        .sort((a, b) => b.points - a.points);
      const leader = entries[0] && entries[0].points > 0 ? entries[0] : null;
      return summarize({
        week_start: weekStart,
        note: "Points reset every Monday. The weekly champion gets the crown.",
        leaderboard: entries,
        champion: leader ? { name: leader.name, points: leader.points } : null,
      });
    },
  },
  {
    definition: {
      name: "add_grocery_item",
      description: "Add one or more items to the grocery shopping list.",
      parameters: {
        type: "object",
        properties: {
          items: { type: "string", description: "Item names separated by commas (e.g. 'milk, eggs, bread')" },
          category: { type: "string", description: "Optional: category (produce, dairy, meat, pantry, frozen, snacks, beverages, household)" },
        },
        required: ["items"],
      },
    },
    handler: async (args) => {
      const names = String(args.items ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      if (names.length === 0) return summarize({ inserted: 0, items: [], error: "No item names provided" });
      const category = args.category || "pantry";
      let inserted: Array<{ name: string; emoji: string; category: string }> = [];
      try {
        inserted = await withAdmin(async (pb) => {
          const records = await pb.collection("grocery_list_items").getFullList({ requestKey: null });
          const byNorm = new Map<string, any>();
          for (const g of records as any[]) {
            if (g.name) byNorm.set(normalizeGroceryName(g.name), g);
          }
          const catDef = groceryCategories.find((c) => c.id === category);
          const emoji = catDef?.emoji || "📦";
          const aisle = catDef?.aisles?.[0]?.split("-")[0] || "1";
          const out: Array<{ name: string; emoji: string; category: string }> = [];
          for (const name of names) {
            const trimmed = name.trim();
            const existing = byNorm.get(normalizeGroceryName(trimmed));
            if (existing) {
              await pb.collection("grocery_list_items").update(existing.id, {
                needed: true,
                source: existing.source || "chat",
              });
              out.push({ name: existing.name || trimmed, emoji: existing.emoji || emoji, category: existing.category || category });
            } else {
              const created = await pb.collection("grocery_list_items").create({
                userId: "demo",
                name: trimmed,
                emoji,
                category,
                aisle,
                quantity: "",
                priority: "medium",
                needed: true,
                source: "chat",
              });
              byNorm.set(normalizeGroceryName(trimmed), created);
              out.push({ name: trimmed, emoji, category });
            }
          }
          return out;
        });
      } catch (e: any) {
        return summarize({ inserted: 0, items: [], error: e?.message || "grocery add failed" });
      }
      return summarize({
        inserted: inserted.length,
        items: inserted,
        note: `${inserted.length} item(s) added to the grocery list. Check the Grocery tab in the dashboard.`,
      });
    },
  },
  {
    definition: {
      name: "complete_grocery_item",
      description: "Mark a grocery item as picked up / no longer needed on the shopping list.",
      parameters: {
        type: "object",
        properties: {
          item: { type: "string", description: "Item name to mark as picked up (e.g. 'milk')" },
        },
        required: ["item"],
      },
    },
    handler: async (args) => {
      const name = String(args.item || "").trim();
      let result: { ok: boolean; reason?: string; item?: any; needed?: boolean };
      if (!name) {
        return summarize({ ok: false, error: "Item name required" });
      }
      try {
        result = await withAdmin(async (pb) => {
          const records = await pb.collection("grocery_list_items").getFullList({ requestKey: null });
          const found = records.find(
            (g: any) => g.name && normalizeGroceryName(g.name) === normalizeGroceryName(name)
          );
          if (!found) return { ok: false, reason: "not found", item: name };
          await pb.collection("grocery_list_items").update(found.id, { needed: false });
          return { ok: true, item: found.name, needed: false };
        });
      } catch (e: any) {
        result = { ok: false, reason: `error: ${e?.message}` };
      }
      return summarize(result);
    },
  },
  {
    definition: {
      name: "get_dashboard_summary",
      description: "Get a high-level summary of everything happening today: events, tasks, meals, and any important notes. Use this when the user asks 'what's going on today?' or 'give me a summary'.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const events = await mergedTodaysEvents();
      const tasks = await livePendingTasks();
      const mealRows = await liveMealRows();
      const meals = mealsForWeek(mealRows ?? [], localWeekStartISO());
      const today = localTodayISO();
      const todayWeekday = localWeekdayShort();
      const todayMeals = meals.filter((m: any) => {
        const day = m.time || m.day || "";
        return day.toLowerCase() === todayWeekday.toLowerCase();
      });
      return summarize({
        date: today,
        today_weekday: todayWeekday,
        family_timezone: familyTimeZone(),
        ...(mealRows === null ? { meals_error: "meal data unavailable — do not guess" } : {}),
        events: events.map((e) => ({ title: e.title, time: e.time, member: e.member, source: e.source })),
        pending_tasks: tasks.map((t: any) => ({
          title: t.title,
          assigned: t.assigned || t.assignee,
          points: t.points,
          due: t.due,
        })),
        meals_today: todayMeals.map((m: any) => ({
          name: m.name,
          emoji: m.emoji,
          mealType: m.mealType,
          prepTime: m.prepTime,
          calories: m.calories,
        })),
      });
    },
  },
  {
    definition: {
      name: "get_proactive_suggestions",
      description: "Get Consuela's pending proactive alerts that need the family's attention. Returns pantry lows, task penalty streaks, calendar conflicts, etc.",
      parameters: { type: "object", properties: { limit: { type: "number", description: "Max to return (default 10)" } } },
    },
    handler: async (args) => {
      const items = await db.selectPendingSuggestions({ limit: args.limit ?? 10 });
      return summarize(items);
    },
  },
  {
    definition: {
      name: "dismiss_suggestion",
      description: "Mark a proactive suggestion as dismissed. Use when the user wants to dismiss an alert.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Suggestion id" } }, required: ["id"] },
    },
    handler: async (args) => {
      await db.updateSuggestion(args.id, { status: "dismissed" });
      return JSON.stringify({ ok: true, dismissed: args.id });
    },
  },
  {
    definition: {
      name: "action_suggestion",
      description: "Run the suggested action attached to a proactive suggestion. e.g. add a pantry item to the grocery list.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Suggestion id" } }, required: ["id"] },
    },
    handler: async (args) => {
      // C2 — no scopeDate filter: past-day suggestions must still be findable
      // by id (snoozed/older rows live on after midnight).
      const items = await db.selectPendingSuggestions({ limit: 50 });
      const suggestion = items.find((s: any) => s.id === args.id);
      if (!suggestion) {
        return JSON.stringify({ ok: false, error: `Suggestion "${args.id}" not found` });
      }
      const payload = suggestion.actionPayload;
      if (!payload?.tool) {
        return JSON.stringify({ ok: false, error: "This suggestion has no attached action" });
      }
      const tool = getTool(payload.tool);
      if (!tool) {
        return JSON.stringify({ ok: false, error: `Unknown tool: ${payload.tool}` });
      }
      let result: string;
      try {
        result = await tool.handler((payload.args as Record<string, any>) || {});
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: `Action failed: ${e?.message}`, tool: payload.tool });
      }
      let parsed: any = result;
      try {
        parsed = JSON.parse(result);
      } catch {
        // keep raw string result
      }
      // I5 — mirror /act/route.ts R3: success is only !parsed.error &&
      // parsed.ok !== false. Handlers report failure via `error` OR `ok:false`
      // (no error key); on failure DO NOT mark the suggestion actioned.
      if (parsed && typeof parsed === "object" && (parsed.error || parsed.ok === false)) {
        return JSON.stringify({
          ok: false,
          error: parsed.error || parsed.reason || "Action failed",
          tool: payload.tool,
          result: parsed,
        });
      }
      await db.updateSuggestion(args.id, { status: "actioned" });
      return JSON.stringify({ ok: true, tool: payload.tool, args: payload.args || {}, result: parsed });
    },
  },
  {
    definition: {
      name: "remember_fact",
      description:
        "Store a durable family fact in your memory bank (preferences, allergies, routines, people). CONFIRM with the user before storing. Categories: preference, allergy, routine, location, schedule, personality, restriction, contact, note.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact in one natural sentence" },
          category: { type: "string", description: "One of: preference, allergy, routine, location, schedule, personality, restriction, contact, note", enum: MEMORY_CATEGORIES },
          person: { type: "string", description: "Who this is about (optional)" },
        },
        required: ["content"],
      },
    },
    handler: async (args) => {
      const content = String(args.content ?? "").trim();
      if (!content) return JSON.stringify({ error: "content is required" });
      const category = (MEMORY_CATEGORIES as string[]).includes(args.category) ? (args.category as MemoryCategory) : "note";
      const person = typeof args.person === "string" && args.person.trim() ? args.person.trim() : undefined;
      const tags = person ? [person] : [];
      const memory = await storeMemory(MEMORY_USER_ID, MEMORY_FAMILY_ID, category, memoryKey(person, content), content, tags, 0.9);
      if (!memory) return JSON.stringify({ error: "memory store is unavailable right now — try again later" });
      return JSON.stringify({ ok: true, id: memory.id, key: memory.key, stored: content });
    },
  },
  {
    definition: {
      name: "recall_memories",
      description:
        "Search your memory bank for family facts. Use BEFORE answering questions about people, preferences, allergies, or routines — never guess what you may know.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Keyword search" },
          person: { type: "string", description: "Restrict to one person" },
          category: { type: "string", description: "One of the memory categories", enum: MEMORY_CATEGORIES },
        },
      },
    },
    handler: async (args) => {
      let memories;
      try {
        memories = await queryMemories({
          familyId: MEMORY_FAMILY_ID,
          search: args.person ? String(args.person) : args.search ? String(args.search) : undefined,
          category: (MEMORY_CATEGORIES as string[]).includes(args.category) ? (args.category as MemoryCategory) : undefined,
          limit: 10,
        });
      } catch (err) {
        return JSON.stringify({ error: "memory is unavailable right now — answer without it and say so" });
      }
      await Promise.allSettled(memories.filter((m) => m.id).map((m) => incrementMemoryUsage(m.id)));
      return JSON.stringify({
        memories: memories.map((m) => ({
          id: m.id,
          category: m.category,
          key: m.key,
          content: m.content,
          person: (() => { try { const t = typeof m.tags === "string" ? JSON.parse(m.tags) : m.tags; return Array.isArray(t) && t.length ? t[0] : null; } catch { return null; } })(),
          updated: m.updatedAt,
        })),
      });
    },
  },
  {
    definition: {
      name: "forget_memory",
      description:
        "Delete one memory by id. Get the id from recall_memories first. CONFIRM with the user before forgetting.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "The memory id from recall_memories" },
        },
        required: ["memoryId"],
      },
    },
    handler: async (args) => {
      const id = String(args.memoryId ?? "").trim();
      if (!id) return JSON.stringify({ error: "memoryId is required — recall_memories first" });
      const ok = await deleteMemory(id);
      return ok ? JSON.stringify({ ok: true, forgotten: id }) : JSON.stringify({ error: `couldn't forget ${id}` });
    },
  },
  {
    definition: {
      name: "check_for_update",
      description: "Check if a new version of the Consuela Dashboard is available on GitHub. Returns the current version, latest remote version, and whether an update is available.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${base}/api/admin/version`, {
          headers: { authorization: `Bearer ${process.env.ADMIN_SECRET || ""}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return summarize({ error: `Version check returned ${res.status}` });
        const data = await res.json();
        return summarize({
          current_version: data.built_at?.short || "unknown",
          current_message: data.built_at?.message || "",
          latest_remote: data.latest_remote?.short || null,
          latest_message: data.latest_remote?.message || null,
          update_available: data.update_available || false,
          commits_behind: data.commits_behind || 0,
          repo: data.repo,
          branch: data.branch,
        });
      } catch (e: any) {
        return summarize({ error: `Could not check for updates: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "trigger_update",
      description: "Pull the latest code from GitHub and rebuild the Consuela Dashboard container. This will restart the dashboard — users will see a brief downtime. Use check_for_update first to confirm an update is available before calling this.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${base}/api/admin/update`, {
          method: "POST",
          headers: { authorization: `Bearer ${process.env.ADMIN_SECRET || ""}` },
          signal: AbortSignal.timeout(300000),
        });
        const data = await res.json();
        if (!res.ok) return summarize({ error: data.error || "Update failed", logs: data.logs || [] });
        return summarize({
          success: true,
          message: data.message || "Dashboard updated successfully",
          logs: (data.logs || []).map((l: any) => `${l.step}: ${l.status} — ${l.detail}`),
        });
      } catch (e: any) {
        return summarize({ error: `Update trigger failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_container_status",
      description: "Get the status of Docker containers (consuela-dashboard, pocketbase, hermes-agent-2). Returns name, state, status, image, and ports for each.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${base}/api/admin/containers`, {
          headers: { authorization: `Bearer ${process.env.ADMIN_SECRET || ""}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return summarize({ error: `Container check returned ${res.status}` });
        const data = await res.json();
        return summarize({
          containers: data.containers || [],
          note: "Use restart_container to restart any of these containers if they are unhealthy.",
        });
      } catch (e: any) {
        return summarize({ error: `Could not get container status: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "restart_container",
      description: "Restart a Docker container. Allowed containers: consuela-dashboard, pocketbase, hermes-agent-2. Use get_container_status first to check which containers need restarting.",
      parameters: {
        type: "object",
        properties: {
          container: {
            type: "string",
            description: "Container name to restart (consuela-dashboard, pocketbase, or hermes-agent-2)",
          },
        },
        required: ["container"],
      },
    },
    handler: async (args) => {
      const name = String(args.container || "").trim();
      const allowed = ["consuela-dashboard", "pocketbase", "hermes-agent-2"];
      if (!allowed.includes(name)) {
        return summarize({
          error: `"${name}" is not allowed. Allowed: ${allowed.join(", ")}`,
        });
      }
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${base}/api/admin/restart`, {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: `Bearer ${process.env.ADMIN_SECRET || ""}` },
          body: JSON.stringify({ container: name }),
          signal: AbortSignal.timeout(35000),
        });
        const data = await res.json();
        if (!res.ok) return summarize({ error: data.error || "Restart failed" });
        return summarize({ success: true, message: data.message });
      } catch (e: any) {
        return summarize({ error: `Restart failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "check_pocketbase",
      description: "Check if PocketBase is running and healthy. Returns the PocketBase version, admin URL, and connectivity status. Use this when troubleshooting database issues.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      try {
        const pbUrl = process.env.NEXT_PUBLIC_PB_URL || "http://pocketbase:8090";
        const res = await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return summarize({ error: `PocketBase returned ${res.status}`, url: pbUrl });
        const data = await res.json();
        return summarize({
          status: "healthy",
          version: data.version || "unknown",
          url: pbUrl,
          admin_panel: `${pbUrl}/_/`,
          note: "PocketBase is the database backend for the dashboard. It stores calendar events, grocery items, pantry inventory, and task transactions. The admin panel at the URL above lets you inspect and edit data directly.",
        });
      } catch (e: any) {
        return summarize({
          status: "unreachable",
          error: e?.message,
          url: process.env.NEXT_PUBLIC_PB_URL || "http://pocketbase:8090",
          note: "If PocketBase is down, the dashboard will use in-memory fallback data. Try restart_container with container=pocketbase.",
        });
      }
    },
  },
  {
    definition: {
      name: "check_conflicts",
      description: "Check if creating an event would cause scheduling conflicts. Use this BEFORE creating any event to detect overlaps, travel time issues, or double-bookings.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title/summary" },
          start: { type: "string", description: "Event start time (ISO 8601 format)" },
          end: { type: "string", description: "Event end time (ISO 8601 format)" },
          location: { type: "string", description: "Event location (optional)" },
          attendees: { type: "array", description: "List of attendee emails (optional)" },
        },
        required: ["summary", "start", "end"],
      },
    },
    handler: async (args: any) => {
      try {
        const { wouldConflict, familyRowToConflictEvent } = await import("./conflict-detection");
        // Conflicts must see the family's own events too, not just the Google
        // cache. The family row's OWN time drives its span (never the new
        // event's start) — pinned by hermes-tools-calendar-range tests.
        const dayISO = String(args.start || "").slice(0, 10) || localTodayISO();
        const family = await liveEvents(dayISO);
        const mapped = family.map((e: any) =>
          familyRowToConflictEvent({ id: e.id, title: e.title, date: dayISO, time: e.time }));
        const result = await wouldConflict({
          newEvent: {
            summary: args.summary,
            start: args.start,
            end: args.end,
            location: args.location,
            attendees: args.attendees,
          },
          travelTimeMinutes: 15,
        }, mapped);
        return JSON.stringify({
          hasConflict: result.hasConflict,
          conflictCount: result.conflicts.length,
          summary: result.summary,
          conflicts: result.conflicts.map(c => ({
            type: c.type,
            severity: c.severity,
            message: c.message,
            suggestion: c.suggestion,
          })),
        });
      } catch (error: any) {
        return JSON.stringify({ error: error.message });
      }
    },
  },
  {
    definition: {
      name: "suggest_buffers",
      description: "Suggest buffer times and travel time for an event. Use this after checking for conflicts to add preparation and travel time.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "Event start time (ISO 8601 format)" },
          end: { type: "string", description: "Event end time (ISO 8601 format)" },
          location: { type: "string", description: "Event location (optional)" },
        },
        required: ["start", "end"],
      },
    },
    handler: async (args: any) => {
      try {
        const { suggestBuffers } = await import("./auto-buffer-scheduling");
        const { buffers, totalBufferTime } = await suggestBuffers({
          start: args.start,
          end: args.end,
          location: args.location,
        });
        return JSON.stringify({
          bufferCount: buffers.length,
          totalBufferTime,
          buffers: buffers.map(b => ({
            type: b.type,
            start: b.start,
            end: b.end,
            duration: b.duration,
            description: b.description,
          })),
          message: buffers.length > 0
            ? `I found ${buffers.length} buffer${buffers.length > 1 ? 's' : ''} (${totalBufferTime} min total) to add travel and preparation time.`
            : 'No additional buffers needed - your schedule looks clear!',
        });
      } catch (error: any) {
        return JSON.stringify({ error: error.message });
      }
    },
  },
  {
    definition: {
      name: "create_buffers",
      description: "Create buffer events (travel time, preparation time) in Google Calendar. Use this after suggesting buffers and getting user approval.",
      parameters: {
        type: "object",
        properties: {
          buffers: { type: "array", description: "Array of buffer objects with start, end, description" },
          mainEventSummary: { type: "string", description: "Summary of the main event these buffers are for" },
        },
        required: ["buffers", "mainEventSummary"],
      },
    },
    handler: async (args: any) => {
      try {
        const { createBufferEvents } = await import("./auto-buffer-scheduling");
        const { created, errors } = await createBufferEvents(
          args.buffers,
          args.mainEventSummary
        );
        return JSON.stringify({
          created,
          errors,
          message: created > 0
            ? `✅ Created ${created} buffer event${created > 1 ? 's' : ''} in your calendar!`
            : errors > 0
              ? `⚠️ Failed to create some buffers (${errors} error${errors > 1 ? 's' : ''})`
              : 'No buffers to create',
        });
      } catch (error: any) {
        return JSON.stringify({ error: error.message });
      }
    },
  },

  // ---- House control (HA Phase 2) — allowlisted domains only. Alarms and
  // locks are permanently excluded at the code level, never by prompt. ----
  {
    definition: {
      name: "ha_list_devices",
      description:
        "List controllable Home Assistant devices (lights, switches, scenes, thermostats, media players, vacuums) with their entity_id and current state.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Optional domain filter, e.g. light or climate" },
        },
        required: [],
      },
    },
    handler: async (args) => {
      try {
        const entities = (await withAdmin(async (pb) =>
          pb.collection("ha_entities").getFullList()
        )) as Array<{ entity_id: string; domain: string; friendly_name?: string; state?: string }>;
        const domainFilter = typeof args.domain === "string" ? args.domain : null;
        const devices = entities
          .filter((e) => HA_ALLOWED_DOMAINS.has(String(e.entity_id).split(".")[0]))
          .filter((e) => (domainFilter && HA_ALLOWED_DOMAINS.has(domainFilter) ? e.domain === domainFilter : true))
          .slice(0, 30)
          .map((e) => ({
            entity_id: e.entity_id,
            name: e.friendly_name || e.entity_id,
            state: e.state ?? "",
          }));
        return JSON.stringify(devices);
      } catch {
        return "Home Assistant device list unavailable right now.";
      }
    },
  },
  {
    definition: {
      name: "ha_control_device",
      description:
        "Control a smart home device. Provide entity_id and action; value is needed only for set_temperature (°F number) and volume_set (0 to 1).",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "Target entity, e.g. light.kitchen" },
          action: { type: "string", description: "toggle, turn_on, turn_off, set_temperature, set_hvac_mode, volume_set, media_play, media_pause, start, pause, stop, return_to_base" },
          value: { type: "number", description: "Temperature or volume when required by the action" },
        },
        required: ["entity_id", "action"],
      },
    },
    handler: async (args) => {
      const entityId = String(args.entity_id ?? "");
      const action = String(args.action ?? "");
      const domain = entityId.split(".")[0];

      if (!HA_ALLOWED_DOMAINS.has(domain)) {
        return "❌ I'm not allowed to control that type of device.";
      }

      const allowedByDomain: Record<string, string[]> = {
        light: ["toggle", "turn_on", "turn_off"],
        switch: ["toggle", "turn_on", "turn_off"],
        scene: ["turn_on"],
        climate: ["set_temperature", "set_hvac_mode"],
        media_player: ["volume_set", "media_play", "media_pause"],
        vacuum: ["start", "pause", "stop", "return_to_base"],
      };
      const allowed = allowedByDomain[domain] ?? [];
      if (!allowed.includes(action)) {
        return `❌ "${action}" isn't something I can do with a ${domain}. Try one of: ${allowed.join(", ")}.`;
      }

      const serviceData: Record<string, unknown> = { entity_id: entityId };
      if (action === "set_temperature") {
        if (typeof args.value !== "number" || !Number.isFinite(args.value)) {
          return "❌ Tell me the temperature to set (a number).";
        }
        serviceData.temperature = args.value;
      }
      if (action === "set_hvac_mode") {
        const mode = typeof args.value === "string" ? args.value : typeof args.mode === "string" ? args.mode : "";
        if (!mode) {
          return "❌ Tell me which mode to set (heat, cool, off…).";
        }
        serviceData.hvac_mode = mode;
      }
      if (action === "volume_set") {
        if (typeof args.value !== "number" || args.value < 0 || args.value > 1) {
          return "❌ Volume needs a number between 0 and 1.";
        }
        serviceData.volume_level = args.value;
      }

      let friendlyName = entityId;
      try {
        const entities = (await withAdmin(async (pb) =>
          pb.collection("ha_entities").getFullList()
        )) as Array<{ entity_id: string; friendly_name?: string }>;
        friendlyName = entities.find((e) => e.entity_id === entityId)?.friendly_name || entityId;
      } catch {
        /* cosmetic only */
      }

      try {
        await (await getHAWebSocketClient()).callService(domain, action, serviceData);
        return `✅ Done — ${friendlyName} · ${action}`;
      } catch (err) {
        return `⚠️ Home Assistant didn't respond (${err instanceof Error ? err.message : String(err)}).`;
      }
    },
  },
  {
    definition: {
      name: "compare_grocery_prices",
      description: "Report the current grocery list's store assignment split. No live price feed exists — never state prices with this tool.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      let items: any[] = [];
      try {
        items = (await withAdmin(async (pb) => pb.collection("grocery_list_items").getFullList({ requestKey: null })))
          .filter((g: any) => g.needed !== false);
      } catch { return summarize({ error: "grocery data unavailable — do not guess prices" }); }
      const split = groupByStore(items.map((g: any) => ({ store: g.store })));
      const stores = Object.entries(split)
        .filter(([id]) => id !== "any")
        .map(([id, list]) => ({ id, label: getStoreLabel(id), item_count: (list as any[]).length }));
      const unassigned = (split["any"] || []).length;
      return summarize({
        stores, unassigned,
        walmart_note: "Walmart items are bought in-store (not on Instacart).",
        message: "There is no live feed of store costs yet — this is where your list is assigned, not a comparison.",
      });
    },
  },
  {
    definition: {
      name: "add_pantry_item",
      description: "Add or update a pantry item (upserts by name). Setting a quantity is how stock is decremented after cooking — pass the NEW amount, not the amount used.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Item name (e.g. 'Milk', 'Rice')" },
          status: { type: "string", description: "Stock level", enum: ["plenty", "low", "out"] },
          quantity: { type: "number", description: "Optional: current quantity (set the new total after use)" },
          unit: { type: "string", description: "Optional: unit for the quantity (e.g. 'gal', 'box')" },
          category: { type: "string", description: "Optional: pantry category (e.g. 'condiments')" },
        },
        required: ["name"],
      },
    },
    handler: async (args: any) => {
      const name = String(args.name ?? "").trim();
      if (!name) return summarize({ ok: false, error: "no item name provided" });
      const status = ["plenty", "low", "out"].includes(args.status) ? args.status : null;
      const quantity = args.quantity !== undefined && Number.isFinite(Number(args.quantity)) ? Number(args.quantity) : undefined;
      const unit = args.unit !== undefined ? String(args.unit) : undefined;
      const category = args.category !== undefined ? String(args.category) : undefined;
      const pantry = await livePantry();
      if (pantry === null) {
        return summarize({ ok: false, error: "pantry data unavailable — do not guess inventory, retry later" });
      }
      const norm = normalizePantryName(name);
      const existing = pantry.find((r: any) => normalizePantryName(r.name || r.item) === norm);
      try {
        const result = await withAdmin(async (pb) => {
          if (existing) {
            const patch: Record<string, unknown> = {};
            if (status) patch.status = status;
            if (quantity !== undefined) patch.quantity = quantity;
            if (unit !== undefined) patch.unit = unit;
            if (category !== undefined) patch.category = category;
            if (Object.keys(patch).length === 0) patch.status = status || "plenty";
            const updated = await pb.collection("pantry_items").update(existing.id, patch);
            return { ok: true, created: false, ...patch, ...(updated || {}), id: existing.id, name: existing.name || existing.item || name };
          }
          const created = await pb.collection("pantry_items").create({
            name,
            item: name,
            status: status || "plenty",
            ...(quantity !== undefined ? { quantity } : {}),
            ...(unit !== undefined ? { unit } : {}),
            ...(category !== undefined ? { category } : {}),
          });
          return { ok: true, created: true, id: created?.id ?? null, name, status: status || "plenty" };
        });
        return summarize(result);
      } catch (e: any) {
        return summarize({ ok: false, error: `add_pantry_item failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "remove_pantry_item",
      description: "Remove a pantry item by name (exact match, case-insensitive). Refuses honestly when nothing matches.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact pantry item name to remove" },
        },
        required: ["name"],
      },
    },
    handler: async (args: any) => {
      const name = String(args.name ?? "").trim();
      if (!name) return summarize({ ok: false, error: "no item name provided" });
      const pantry = await livePantry();
      if (pantry === null) {
        return summarize({ ok: false, error: "pantry data unavailable — do not guess inventory, retry later" });
      }
      const norm = normalizePantryName(name);
      const existing = pantry.find((r: any) => normalizePantryName(r.name || r.item) === norm);
      if (!existing) {
        return summarize({ ok: false, error: `"${name}" is not in the pantry — call get_pantry to see what's there` });
      }
      try {
        await withAdmin(async (pb) => pb.collection("pantry_items").delete(existing.id));
        return summarize({ ok: true, name: existing.name || existing.item, deleted: true });
      } catch (e: any) {
        return summarize({ ok: false, error: `remove_pantry_item failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_family_routines",
      description: "Get the family's FULL weekly routine schedule — every routine with the days it covers (weekdays/weekends/daily/day letters), not filtered to today.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const rows = await liveSchedulesAll();
      if (rows === null) {
        return summarize({ error: "schedule data unavailable — do not guess routines", routines: [] });
      }
      return summarize({
        count: rows.length,
        routines: rows.map((s: any) => ({
          title: s.title,
          time: s.time,
          days: s.days || "daily",
          type: s.type,
          icon: s.icon,
          member: s.member,
          mealType: s.mealType || null,
        })),
      });
    },
  },
  {
    definition: {
      name: "add_schedule_item",
      description: "Add a family routine to the weekly schedule. days is 'weekdays', 'weekends', 'daily', or day letters (e.g. 'mon,wed,fri').",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Routine title (e.g. 'Homework')" },
          time: { type: "string", description: "12-hour time as shown on the dashboard (e.g. '5:30 PM')" },
          days: { type: "string", description: "Day scope: weekdays | weekends | daily | comma day letters" },
          type: { type: "string", description: "Optional: routine category (e.g. 'routine', 'meal')" },
          icon: { type: "string", description: "Optional: emoji icon" },
          member: { type: "string", description: "Optional: family member the routine belongs to" },
        },
        required: ["title", "time", "days"],
      },
    },
    handler: async (args: any) => {
      const title = String(args.title ?? "").trim();
      const time = String(args.time ?? "").trim();
      const days = String(args.days ?? "").trim();
      if (!title || !time || !days) return summarize({ ok: false, error: "title, time and days are all required" });
      try {
        const created = await withAdmin(async (pb) => pb.collection("schedules").create({
          title,
          time,
          days,
          type: args.type || "routine",
          icon: args.icon || null,
          member: args.member || null,
          mealType: null,
        }));
        return summarize({ ok: true, id: created?.id ?? null, title, time, days });
      } catch (e: any) {
        return summarize({ ok: false, error: `add_schedule_item failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "update_schedule_item",
      description: "Update a family routine by exact title (case-insensitive) — patches time/days/type/icon/member and echoes before/after. Ambiguous or missing titles are refused.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Exact routine title to find (e.g. 'Bedtime')" },
          time: { type: "string", description: "New 12-hour time (e.g. '8:30 PM')" },
          days: { type: "string", description: "New day scope: weekdays | weekends | daily | comma day letters" },
          type: { type: "string", description: "New routine category" },
          icon: { type: "string", description: "New emoji icon" },
          member: { type: "string", description: "New owning member" },
        },
        required: ["title"],
      },
    },
    handler: async (args: any) => {
      const title = String(args.title ?? "").trim().toLowerCase();
      if (!title) return summarize({ ok: false, error: "no routine title provided" });
      const patch: Record<string, unknown> = {};
      for (const field of ["time", "days", "type", "icon", "member"] as const) {
        if (args[field] !== undefined && String(args[field]).trim() !== "") patch[field] = String(args[field]).trim();
      }
      if (Object.keys(patch).length === 0) return summarize({ ok: false, error: "nothing to update — pass time/days/type/icon/member" });
      const rows = await liveSchedulesAll();
      if (rows === null) return summarize({ ok: false, error: "schedule data unavailable — do not guess routines, retry later" });
      const matches = rows.filter((s: any) => String(s.title ?? "").trim().toLowerCase() === title);
      if (matches.length === 0) return summarize({ ok: false, error: `no routine titled "${args.title}" — call get_family_routines to see the real titles` });
      if (matches.length > 1) return summarize({ ok: false, error: `${matches.length} routines share the title "${args.title}" — remove one in the Calendar UI first` });
      const row = matches[0];
      const before = { title: row.title, time: row.time, days: row.days, type: row.type, icon: row.icon, member: row.member };
      try {
        await withAdmin(async (pb) => pb.collection("schedules").update(row.id, patch));
        return summarize({ ok: true, id: row.id, before, after: { ...before, ...patch } });
      } catch (e: any) {
        return summarize({ ok: false, error: `update_schedule_item failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "delete_schedule_item",
      description: "Delete a family routine by exact title (case-insensitive). Ambiguous or missing titles are refused.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Exact routine title to delete" },
        },
        required: ["title"],
      },
    },
    handler: async (args: any) => {
      const title = String(args.title ?? "").trim().toLowerCase();
      if (!title) return summarize({ ok: false, error: "no routine title provided" });
      const rows = await liveSchedulesAll();
      if (rows === null) return summarize({ ok: false, error: "schedule data unavailable — do not guess routines, retry later" });
      const matches = rows.filter((s: any) => String(s.title ?? "").trim().toLowerCase() === title);
      if (matches.length === 0) return summarize({ ok: false, error: `no routine titled "${args.title}" — call get_family_routines to see the real titles` });
      if (matches.length > 1) return summarize({ ok: false, error: `${matches.length} routines share the title "${args.title}" — delete one in the Calendar UI first` });
      try {
        await withAdmin(async (pb) => pb.collection("schedules").delete(matches[0].id));
        return summarize({ ok: true, title: matches[0].title, deleted: true });
      } catch (e: any) {
        return summarize({ ok: false, error: `delete_schedule_item failed: ${e?.message}` });
      }
    },
  },
  {
    definition: {
      name: "get_past_weeks",
      description: "Get archived past leaderboard weeks (newest first, max 12): each week's champion and top-3 point standings.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many weeks to return (1-12, default 12)" },
        },
      },
    },
    handler: async (args: any) => {
      const limit = Math.max(1, Math.min(12, Number(args.limit) || 12));
      const archived = await liveWeekArchive();
      if (archived === null) {
        return summarize({ error: "archive data unavailable — do not guess past results", weeks: [] });
      }
      // Pets are best-effort filtered from standings when the roster read works;
      // a roster failure still reports the standings honestly.
      const members = await liveMembers();
      const petNames = new Set<string>((members || [])
        .filter((m: any) => m.role === "pet")
        .map((m: any) => String(m.fullName || m.name || "").toLowerCase()));
      const weeks = [...archived]
        .sort((a: any, b: any) => String(b.weekStart || "").localeCompare(String(a.weekStart || "")))
        .slice(0, limit)
        .map((row: any) => {
          const points = parseJSON<Record<string, number>>(row.points, {});
          const standings = Object.entries(points)
            .filter(([name]) => !petNames.has(String(name).toLowerCase()))
            .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
          return {
            weekStart: row.weekStart,
            archivedAt: row.archivedAt,
            champion: standings[0]?.[0] ?? null,
            champion_points: standings[0] ? Number(standings[0][1]) || 0 : null,
            top3: standings.slice(0, 3).map(([name, pts]) => ({ name, points: Number(pts) || 0 })),
          };
        });
      return summarize({ weeks });
    },
  },
  {
    definition: {
      name: "get_rewards",
      description: "Get the kids' reward shop catalog: every redeemable reward with its point cost.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const rewards = await liveRewards();
      if (rewards === null) {
        return summarize({ error: "reward data unavailable — do not guess the shop", rewards: [] });
      }
      return summarize({
        count: rewards.length,
        rewards: rewards.map((r: any) => ({
          title: r.title || r.name,
          cost: r.cost ?? r.points ?? 0,
          emoji: r.emoji,
          description: r.description || null,
        })),
      });
    },
  },
];

const HA_ALLOWED_DOMAINS = new Set(["light", "switch", "scene", "climate", "media_player", "vacuum"]);
const HA_HOUSE_TOOL_NAMES = new Set(["ha_list_devices", "ha_control_device"]);

export function getAllTools(): Tool[] {
  return TOOLS;
}

export function getToolDefinitions(): ToolDefinition[] {
  return TOOLS.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}

export function buildToolsForOpenAI(options?: {
  houseControl?: boolean;
  /** Session role. "child" = kid soul surface: reads/summaries ONLY — no
   * writes, no admin, no logistics, no house. (Voice pair: KID_SYSTEM_PROMPT.
   * Kids act through the real UI where PIN/pending-approval gates live.) */
  role?: string;
}): Array<{
  type: "function";
  function: { name: string; description: string; parameters: ToolDefinition["parameters"] };
}> {
  const houseControl = options?.houseControl !== false;
  const kid = options?.role === "child";
  const allowed = kid
    ? (t: Tool) => KID_TOOL_NAMES.has(t.definition.name)
    : (t: Tool) => houseControl || !HA_HOUSE_TOOL_NAMES.has(t.definition.name);
  return TOOLS.filter(allowed).map((t) => ({
    type: "function" as const,
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters,
    },
  }));
}

// Kid-safe tool surface (user-locked 2026-09-06): dashboard questions +
// summaries + learning ONLY. Every write (add/complete/remove), admin
// (update/restart/containers/PB), suggestion ops, logistics (conflicts,
// buffers, price compare), and house control is excluded for child sessions.
const KID_TOOL_NAMES: ReadonlySet<string> = new Set([
  "get_weather",
  "get_family_members",
  "get_todays_events",
  "get_calendar_range",
  "get_todays_schedule",
  "get_pending_tasks",
  "get_completed_tasks",
  "get_weekly_meals",
  "get_recipes",
  "get_grocery_list",
  "get_pantry",
  "get_leaderboard",
  "get_dashboard_summary",
  "get_proactive_suggestions",
  "get_family_routines",
  "get_past_weeks",
  "get_rewards",
]);
