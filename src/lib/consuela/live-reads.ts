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

import { withAdmin, getAuthedPB } from "@/lib/pb-auth";
import { DEMO_USER_ID, sanitizeUserId } from "@/lib/auth";
import { readUserCapsules } from "@/lib/time-capsule";
import type { TimeCapsule } from "@/db/features/time-capsule";
import type { SkillTreeProfile, SkillBranch, Quest } from "@/db/features/skill-tree";
import { localTodayISO, localWeekdayShort } from "@/lib/local-date";
import { mergeTodaysEvents, mergeEventsRange } from "./todays-events";
import { readSnapshotTasks, type SnapshotTask } from "@/lib/snapshot-tasks";

export type CanonicalTaskSource = "snapshot" | "pb" | "unavailable";

export interface CanonicalTaskRead {
  tasks: SnapshotTask[];
  source: CanonicalTaskSource;
}

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
        fields: "summary,start_iso,end_iso,all_day,calendar_id",
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
      fields: "summary,start_iso,end_iso,all_day,calendar_id", requestKey: null,
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

function taskFromCollectionRow(row: Record<string, any>): SnapshotTask | null {
  const id = Number(row?.taskId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const assignee = typeof row.assignee === "string" ? row.assignee : "";
  return {
    id,
    title: typeof row.title === "string" ? row.title : "task",
    assignee,
    assigned: typeof row.assigned === "string" ? row.assigned : assignee,
    due: row.due ?? null,
    points: row.points ?? 0,
    completed: row.completed === true || row.status === "done",
    completedInWeek: row.completedInWeek ?? null,
  };
}

export async function readCanonicalTasks(): Promise<CanonicalTaskRead> {
  const snapshot = await readSnapshotTasks().then(
    (tasks) => ({ tasks, source: "snapshot" as const }),
    () => null
  );
  if (snapshot) return snapshot;
  console.warn("[consuela] consuela_data_snapshots read failed — falling back to the PB replica");
  const replica = await withAdmin(async (pb) =>
    pb.collection("tasks").getFullList({ requestKey: null })
  ).then(
    (rows) => ({
      tasks: (Array.isArray(rows) ? rows : [])
        .map(taskFromCollectionRow)
        .filter((task): task is SnapshotTask => task !== null),
      source: "pb" as const,
    }),
    () => null
  );
  if (replica) return replica;
  console.warn("[consuela] every task source failed (consuela_data_snapshots, tasks) — reporting tasks unavailable");
  return { tasks: [], source: "unavailable" };
}

/** Pending tasks, read live. Unlike the pbDb listing (capped at 3 for the
 *  Home widget) the chat tool returns every pending row. */
async function pendingTaskRows(): Promise<any[] | null> {
  // Read the SNAPSHOT (what the dashboard renders) — the PB `tasks` collection
  // is a derived replica and diverged from it (2026-09-21). Points come from
  // the task itself; the old priority→15/20 guess fabricated numbers.
  const read = await readCanonicalTasks();
  if (read.source === "unavailable") return null;
  const members = await withAdmin(async (pb) =>
    pb.collection("members").getFullList({ requestKey: null })
  ).then((rows) => (Array.isArray(rows) ? rows : []), () => []);
  const today = localTodayISO();
  const tomorrow = localTodayISO(new Date(Date.now() + 86400000));
  return read.tasks
    .filter((task: any) => !task.completed)
    .map((task: any) => {
      const name = task.assignee || task.assigned;
      const member = members.find((m: any) => m.fullName === name || m.name === name);
      const due = task.due === today ? "Today"
        : task.due === tomorrow ? "Tomorrow"
        : task.due || "Later";
      return {
        id: task.id,
        title: task.title,
        assigned: member?.fullName || name || "Unassigned",
        due,
        points: task.points ?? 0,
      };
    });
}

export async function livePendingTasks(): Promise<any[] | null> {
  return pendingTaskRows();
}

export async function livePendingTasksForPack(): Promise<any[] | null> {
  return livePendingTasks();
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

/** Emergency contacts, read live. Null = the read FAILED so the alert path can
 *  fall back to the process-start cache and flag it honestly (contactsSource).
 *  The cache is warmed once at module load and only the browser refreshCaches()
 *  updates it, so a contact added/corrected/removed after container start was
 *  invisible to a real emergency until restart (F1). */
export async function liveEmergencyContacts(): Promise<any[] | null> {
  try {
    const rows = await withAdmin(async (pb) =>
      pb.collection("emergency_contacts").getFullList({ requestKey: null }));
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

/** Time capsules visible to `userId`, or null when the read FAILED. Wraps
 *  readUserCapsules, NOT getUserCapsules — the latter returns [] for both "no
 *  capsules" and "read failed", so an outage would read as a confident "you
 *  have none". */
export async function liveTimeCapsules(userId: string): Promise<TimeCapsule[] | null> {
  try {
    const rows = await readUserCapsules(userId);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Skill branches + quests, read live, or null when EITHER read FAILED. Reads
 *  PocketBase directly instead of calling skill-tree.ts's getSkillBranches /
 *  getAllQuests — both of those `catch → []`, so an outage would answer with a
 *  real profile beside `branches: []`, which reads as "no branches yet". Empty
 *  arrays here mean the catalog is genuinely empty. */
export async function liveSkillCatalog(): Promise<{ branches: SkillBranch[]; quests: Quest[] } | null> {
  try {
    const [branches, quests] = await Promise.all([
      withAdmin(async (pb) => pb.collection("skill_branches").getFullList<SkillBranch>({ sort: "order", requestKey: null })),
      withAdmin(async (pb) => pb.collection("quests").getFullList<Quest>({ sort: "branchId, order", requestKey: null })),
    ]);
    return {
      branches: Array.isArray(branches) ? branches : [],
      quests: Array.isArray(quests) ? quests : [],
    };
  } catch {
    return null;
  }
}

/** Read-only skill-tree profile. Null = the read FAILED. Never creates a row
 *  (the packaged getSkillTreeProfile CREATES on a miss) and never returns the
 *  legacy `demo-user` row, whose XP belongs to whoever wrote it before the
 *  per-member identity migration. A brand-new member gets a synthesized ZERO
 *  profile — a read must not leave a row behind. */
export async function readSkillTreeProfile(userId: string): Promise<SkillTreeProfile | null> {
  const memberId = sanitizeUserId(userId);
  // sanitizeUserId maps a blank id to the legacy namespace, so a blank or
  // explicitly-legacy id is refused BEFORE the query, not resolved to it.
  if (!memberId || memberId === DEMO_USER_ID) return null;
  try {
    const pb = await getAuthedPB();
    const exact = await pb.collection("skill_tree_profiles").getList<SkillTreeProfile>(1, 1, {
      filter: `userId = "${memberId}"`,
    });
    if (exact.items.length > 0) return exact.items[0];
    return zeroSkillTreeProfile(memberId);
  } catch {
    return null;
  }
}

/** The profile a brand-new member WOULD have. Mirrors skill-tree.ts's
 *  newProfileData field-for-field, minus its write — the same shape, never
 *  persisted. */
function zeroSkillTreeProfile(memberId: string): SkillTreeProfile {
  return {
    id: "",
    userId: memberId,
    totalXP: 0,
    level: 1,
    xpToNextLevel: 100,
    unlockedBranches: [],
    completedQuests: [],
    activeQuests: [],
    achievementCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: new Date().toISOString(),
    createdAt: "",
    updatedAt: "",
  };
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
