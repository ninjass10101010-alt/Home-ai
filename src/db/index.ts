import { db as pbDb } from "./pb-db";
import { gatewayList, gatewayCreate, gatewayUpdate, gatewayDelete } from "./gateway-client";
import { defaultMeals, mealIdeas, initialGroceryItems } from "../data/meals";
import { resolveMemberPin, memberPinMatches } from "@/lib/member-pins";
import { memberFallbacks, mergeMemberFallbacks } from "@/lib/member-fallback";

function isServer() {
  return typeof window === "undefined";
}

// === Client-mode (browser) helpers ===
// The gateway returns raw PocketBase rows; these replicate the small amount of
// mapping pb-db does internally so caller-facing shapes stay identical.
// (pb-db's mappers are not exported — duplicated minimally here on purpose.)

function parseJsonArray(value: any): any[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function stringifyMealArrays(row: Record<string, any>): Record<string, any> {
  const data = { ...row };
  for (const key of ["ingredients", "tags"]) {
    if (Array.isArray(data[key])) data[key] = JSON.stringify(data[key]);
  }
  return data;
}

async function safeGatewayRow(fn: () => Promise<any>): Promise<any | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function gatewayDeleteOk(collection: string, id: number | string): Promise<boolean> {
  try {
    await gatewayDelete(collection, String(id));
    return true;
  } catch {
    return false;
  }
}

async function clientListOrEmpty(collection: string): Promise<any[]> {
  try {
    return await gatewayList(collection);
  } catch {
    return [];
  }
}

// Mirrors pb-db selectMembers' mapped shape for event/task/schedule joins
// without fetching members over PB (members stay excluded from the gateway).
function memberJoinList(): any[] {
  const base = membersCache.length > 0 ? membersCache : (membersFallback as any[]);
  return base.map((m: any, i: number) => ({
    name: m.name?.split(" ")[0] || m.name,
    fullName: m.name,
    color: memberColor(i),
    emoji: m.emoji || "😊",
  }));
}

function findJoinMember(list: any[], name?: string) {
  return list.find((m: any) => m.fullName === name || m.name === name);
}

function formatTime12h(time?: string): string | undefined {
  if (!time) return undefined;
  return new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function filterQuery(filter: string, sort?: string): string {
  const params = new URLSearchParams({ filter });
  if (sort) params.set("sort", sort);
  return `?${params.toString()}`;
}

async function clientSelectTodaysEvents(): Promise<any[]> {
  const rows = await gatewayList("events");
  const today = new Date().toISOString().split('T')[0];
  const members = memberJoinList();
  return rows
    .filter((e: any) => e.date === today)
    .sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''))
    .map((event: any) => {
      const member = findJoinMember(members, event.member);
      return {
        id: event.id, title: event.title,
        time: formatTime12h(event.time),
        member: member?.fullName || event.member || 'Unknown',
        emoji: member?.emoji || '👤',
        color: member?.color || 'amber',
        icon: event.icon || '📅',
      };
    });
}

async function clientSelectPendingTasks(): Promise<any[]> {
  const rows = await gatewayList("tasks");
  const members = memberJoinList();
  return rows
    .filter((t: any) => t.status === 'pending')
    .slice(0, 3)
    .map((task: any) => {
      const member = findJoinMember(members, task.assigned);
      const d = task.due;
      const isToday = d === new Date().toISOString().split('T')[0];
      const isTomorrow = d === new Date(Date.now() + 86400000).toISOString().split('T')[0];
      return {
        id: task.id, title: task.title,
        assigned: member?.fullName || task.assigned || 'Unassigned',
        due: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : task.due || 'Later',
        points: task.priority === 'high' ? 20 : task.priority === 'medium' ? 15 : task.points || 10,
        done: task.status === 'done',
      };
    });
}

async function clientSelectTodaysSchedulesRaw(): Promise<any[]> {
  const rows = await gatewayList("schedules");
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const members = memberJoinList();
  return rows
    .filter((s: any) => s.days === 'all' || s.days?.includes(today))
    .sort((a: any, b: any) => a.time.localeCompare(b.time))
    .map((s: any) => {
      const member = s.member ? findJoinMember(members, s.member) : null;
      return { id: s.id, title: s.title, time: s.time, emoji: s.icon, type: s.type, color: s.color, member: member?.fullName, memberColor: member?.color || 'amber' };
    });
}

const memberColor = (i: number) =>
  ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][i % 9] || "green";

// In-memory cache for sync reads during render
let membersCache: any[] = [];
let eventsCache: any[] = [];
let tasksCache: any[] = [];
let schedulesCache: any[] = [];
let emergencyCache: any[] = [];
let mealsCache: any[] = [];
let pantryCache: any[] = [];
let groceryCache: any[] = [];

let lastRefreshed: Record<string, number> = {};
const REFRESH_INTERVAL = 30_000;

function needsRefresh(name: string): boolean {
  const last = lastRefreshed[name];
  return !last || Date.now() - last > REFRESH_INTERVAL;
}

function markRefreshed(name: string) {
  lastRefreshed[name] = Date.now();
}

async function refreshMembersCache() {
  try {
    const fresh = await pbDb.selectMembers();
    const pbMembers = fresh || [];
    for (const pbm of pbMembers) {
      pbm.pin = resolveMemberPin(pbm);
    }
    membersCache = mergeMemberFallbacks(pbMembers);
    markRefreshed("members");
    window.dispatchEvent(new CustomEvent("consuela-members-updated"));
  } catch {}
}

async function refreshCache(name: string, fetcher: () => Promise<any[]>, cache: any[], fallback?: any[]) {
  try {
    const fresh = await fetcher();
    if (fresh && fresh.length > 0) {
      cache.length = 0;
      cache.push(...fresh);
    }
    markRefreshed(name);
  } catch {
    if (cache.length === 0 && fallback) {
      cache.length = 0;
      cache.push(...fallback);
    }
  }
}

const membersFallback = memberFallbacks;

const scheduleData = [
  { id: 1, title: "Wake up / Morning routine", time: "07:00", days: "weekdays", type: "routine", icon: "⏰", color: "amber" },
  { id: 2, title: "Breakfast", time: "07:30", days: "all", type: "routine", icon: "🥞", color: "green" },
  { id: 3, title: "School / Learning time", time: "08:30", days: "weekdays", type: "routine", icon: "📚", color: "cyan" },
  { id: 4, title: "Lunch", time: "12:00", days: "all", type: "routine", icon: "🍽️", color: "amber" },
  { id: 5, title: "Screen time", time: "15:30", days: "weekdays", type: "routine", icon: "📱", color: "violet" },
  { id: 6, title: "Dinner", time: "18:00", days: "all", type: "routine", icon: "🍝", color: "green" },
  { id: 7, title: "Bedtime routine", time: "20:30", days: "all", type: "routine", icon: "🛁", color: "violet" },
  { id: 8, title: "Lights out", time: "21:00", days: "all", type: "routine", icon: "🌙", color: "rose" },
  { id: 9, title: "Family movie night", time: "19:00", days: "friday", type: "routine", icon: "🎬", color: "cyan" },
  { id: 10, title: "Take medication", time: "08:00", days: "all", memberId: 1, type: "reminder", icon: "💊", color: "rose" },
];

// Dual-mode cache fetchers: browser → sessioned gateway, server → pb-db.
// Used by the module-level hydrate and refreshCaches.
const dualFetch = {
  events: () => (isServer() ? pbDb.selectTodaysEvents() : clientSelectTodaysEvents()),
  pendingTasks: () => (isServer() ? pbDb.selectPendingTasks() : clientSelectPendingTasks()),
  todaysSchedulesRaw: () => (isServer() ? pbDb.selectTodaysSchedulesRaw() : clientSelectTodaysSchedulesRaw()),
  emergencyContacts: () => (isServer() ? pbDb.selectEmergencyContacts() : clientListOrEmpty("emergency_contacts")),
  meals: async (): Promise<any[]> => {
    if (!isServer()) {
      const rows = await clientListOrEmpty("meal_plan_entries");
      return rows.map((meal: any) => ({
        ...meal,
        ingredients: parseJsonArray(meal.ingredients),
        tags: parseJsonArray(meal.tags),
      }));
    }
    return pbDb.selectMeals();
  },
  pantry: () => (isServer() ? pbDb.selectPantry() : clientListOrEmpty("pantry_items")),
  grocery: () => (isServer() ? pbDb.selectGrocery() : clientListOrEmpty("grocery_list_items")),
};

// Hydrate once
void (async () => {
  try {
    const [m, e, t, s, ec, ml, p, g] = await Promise.all([
      pbDb.selectMembers().catch(() => []),
      dualFetch.events().catch(() => []),
      dualFetch.pendingTasks().catch(() => []),
      dualFetch.todaysSchedulesRaw().catch(() => []),
      dualFetch.emergencyContacts(),
      dualFetch.meals().catch(() => []),
      dualFetch.pantry().catch(() => []),
      dualFetch.grocery().catch(() => []),
    ]);
    const pbMembers = (m as any[]) || [];
    for (const pbm of pbMembers) {
      pbm.pin = resolveMemberPin(pbm);
    }
    membersCache = mergeMemberFallbacks(pbMembers);
    eventsCache = e as any[];
    tasksCache = t as any[];
    schedulesCache = s as any[];
    emergencyCache = ec as any[];
    mealsCache = ml as any[];
    pantryCache = p as any[];
    groceryCache = g as any[];
  } catch { /* fallback data used below */ }

  if (membersCache.length === 0) membersCache = membersFallback as any;
})();

function cacheMemberColor(m: any, i: number) {
  return memberColor(i);
}

export const db = {
  selectMembers: () => {
    if (membersCache.length === 0) return membersFallback.map(m => ({
      id: m.id, name: m.name.split(' ')[0], fullName: m.name, role: m.role,
      color: cacheMemberColor(m, m.id - 1), emoji: m.emoji || "😊", pin: (m as any).pin,
    }));
    return membersCache.map((m: any, i: number) => ({
      id: i + 1, name: m.name?.split(' ')[0] || m.name, fullName: m.name,
      role: m.role || "member", color: cacheMemberColor(m, i), emoji: m.emoji || "😊",
      pin: m.pin,
    }));
  },

  selectMembersDetailed: () => {
    if (membersCache.length === 0) return membersFallback.map(m => ({
      name: m.name, role: m.role === 'parent' ? 'Parent' : m.role === 'pet' ? 'Pet' : 'Child',
      emoji: m.emoji || "😊", color: cacheMemberColor(m, m.id - 1),
      age: m.age.toString(), joined: m.joined, skinColor: (m as any).skinColor,
      hairColor: (m as any).hairColor, pin: (m as any).pin || "",
      avatarSize: (m as any).avatarSize || "md", glow: (m as any).glow || false,
    }));
    return membersCache.map((m: any, i: number) => ({
      name: m.name, role: m.role || "member", emoji: m.emoji || "😊",
      color: cacheMemberColor(m, i), age: m.age || "", joined: m.created || "",
      skinColor: (m as any).skinColor, hairColor: (m as any).hairColor,
      pin: m.pin || "", avatarSize: m.avatarSize || "md", glow: m.glow || false,
    }));
  },

  selectMembersForCalendar: () => [
    { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
    ...db.selectMembers().map((m: any) => ({ name: m.name, color: m.color, emoji: m.emoji })),
  ],

  insertMember: async (data: any) => {
    const result = await pbDb.insertMember(data);
    if (result) {
      await refreshMembersCache();
    }
    return result;
  },

  updateMember: async (name: string, updates: any) => {
    const result = await pbDb.updateMember(name, updates);
    if (result) {
      await refreshMembersCache();
    }
    return result;
  },

  // Optimistically patch a member in the local cache and notify subscribers
  // (e.g. right after a server-side profile save, so the UI reflects the new
  // avatar even when PB member reads are unavailable/restricted).
  patchMemberLocal: (name: string, patch: any) => {
    const list = membersCache.length > 0 ? membersCache : membersFallback;
    const idx = list.findIndex((m: any) => m.name === name || m.name?.startsWith(name));
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch };
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("consuela-members-updated"));
    }
  },

  verifyMemberPin: (memberName: string, pin: string) => {
    const list = membersCache.length > 0 ? membersCache : membersFallback;
    const member = list.find((m: any) => m.name === memberName || m.name?.startsWith(memberName));
    if (!member) return null;
    if (!memberPinMatches(member, pin)) return null;
    return member;
  },

  deleteMember: async (name: string) => {
    const result = await pbDb.deleteMember(name);
    if (result) {
      await refreshMembersCache();
    }
    return result;
  },

  selectTodaysEvents: () => {
    if (eventsCache.length > 0) return eventsCache;
    const today = new Date().toISOString().split('T')[0];
    return [];
  },

  insertEvent: async (event: any) => {
    const result = isServer()
      ? await pbDb.insertEvent(event)
      : await safeGatewayRow(() => gatewayCreate("events", event));
    if (result) eventsCache.push(result);
    return result;
  },
  updateEvent: async (id: number | string, updates: any) => {
    const result = isServer()
      ? await pbDb.updateEvent(id, updates)
      : await safeGatewayRow(() => gatewayUpdate("events", String(id), updates));
    if (result) {
      const idx = eventsCache.findIndex((e: any) => e.id == id);
      if (idx !== -1) eventsCache[idx] = result;
    }
    return result;
  },
  deleteEvent: async (id: number | string) => {
    const result = isServer() ? await pbDb.deleteEvent(id) : await gatewayDeleteOk("events", id);
    if (result) {
      const idx = eventsCache.findIndex((e: any) => e.id == id);
      if (idx !== -1) eventsCache.splice(idx, 1);
    }
    return result;
  },

  selectPendingTasks: () => tasksCache,

  insertTask: async (task: any) => {
    const result = isServer()
      ? await pbDb.insertTask(task)
      : await safeGatewayRow(() => gatewayCreate("tasks", task));
    if (result) tasksCache.push(result);
    return result;
  },
  updateTask: async (id: number | string, updates: any) => {
    const result = isServer()
      ? await pbDb.updateTask(id, updates)
      : await safeGatewayRow(() => gatewayUpdate("tasks", String(id), updates));
    if (result) {
      const idx = tasksCache.findIndex((t: any) => t.id == id);
      if (idx !== -1) tasksCache[idx] = result;
    }
    return result;
  },
  deleteTask: async (id: number | string) => {
    const result = isServer() ? await pbDb.deleteTask(id) : await gatewayDeleteOk("tasks", id);
    if (result) {
      const idx = tasksCache.findIndex((t: any) => t.id == id);
      if (idx !== -1) tasksCache.splice(idx, 1);
    }
    return result;
  },

  selectTodaysSchedulesRaw: () => {
    if (schedulesCache.length > 0) return schedulesCache;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return scheduleData
      .filter((s: any) => s.days === 'all' || s.days?.includes(today))
      .sort((a: any, b: any) => a.time.localeCompare(b.time))
      .map((s: any) => {
        const member = s.memberId ? membersFallback.find(m => m.id === s.memberId) : null;
        return { id: s.id, title: s.title, time: s.time, emoji: s.icon, type: s.type, color: s.color, member: member?.name, memberColor: cacheMemberColor(member, member?.id ?? 0) };
      });
  },

  selectTodaysSchedules: () => {
    const raw = db.selectTodaysSchedulesRaw();
    return raw.map((s: any) => ({
      ...s,
      time: new Date(`2000-01-01T${s.time}`).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
    }));
  },

  insertSchedule: async (schedule: any) => {
    const result = isServer()
      ? await pbDb.insertSchedule(schedule)
      : await safeGatewayRow(() => gatewayCreate("schedules", schedule));
    if (result) schedulesCache.push(result);
    return result;
  },
  updateSchedule: async (id: number | string, updates: any) => {
    const result = isServer()
      ? await pbDb.updateSchedule(id, updates)
      : await safeGatewayRow(() => gatewayUpdate("schedules", String(id), updates));
    if (result) {
      const idx = schedulesCache.findIndex((s: any) => s.id == id);
      if (idx !== -1) schedulesCache[idx] = result;
    }
    return result;
  },
  deleteSchedule: async (id: number | string) => {
    const result = isServer() ? await pbDb.deleteSchedule(id) : await gatewayDeleteOk("schedules", id);
    if (result) {
      const idx = schedulesCache.findIndex((s: any) => s.id == id);
      if (idx !== -1) schedulesCache.splice(idx, 1);
    }
    return result;
  },

  selectEmergencyContacts: () => emergencyCache,

  insertEmergencyContact: async (data: any) => {
    const result = isServer()
      ? await pbDb.insertEmergencyContact(data)
      : await safeGatewayRow(() => gatewayCreate("emergency_contacts", data));
    if (result) emergencyCache.push(result);
    return result;
  },

  updateEmergencyContact: async (id: number | string, updates: any) => {
    const result = isServer()
      ? await pbDb.updateEmergencyContact(id, updates)
      : await safeGatewayRow(() => gatewayUpdate("emergency_contacts", String(id), updates));
    if (result) {
      const idx = emergencyCache.findIndex((c: any) => c.id == id);
      if (idx !== -1) emergencyCache[idx] = { ...emergencyCache[idx], ...updates };
    }
    return result;
  },

  deleteEmergencyContact: async (id: number | string) => {
    const result = isServer() ? await pbDb.deleteEmergencyContact(id) : await gatewayDeleteOk("emergency_contacts", id);
    if (result) {
      const idx = emergencyCache.findIndex((c: any) => c.id == id);
      if (idx !== -1) emergencyCache.splice(idx, 1);
    }
    return result;
  },

  selectMeals: async () => dualFetch.meals(),
  selectMealIdeas: () => mealIdeas,
  insertMeal: async (meal: any) => {
    const result = isServer()
      ? await pbDb.insertMeal(meal)
      : await safeGatewayRow(() => gatewayCreate("meal_plan_entries", stringifyMealArrays(meal)));
    if (result) mealsCache.push(result);
    return result;
  },
  updateMeal: async (id: string, updates: any) => {
    const result = isServer()
      ? await pbDb.updateMeal(id, updates)
      : await safeGatewayRow(() => gatewayUpdate("meal_plan_entries", id, stringifyMealArrays(updates)));
    if (result) {
      const idx = mealsCache.findIndex((m: any) => m.id == id);
      if (idx !== -1) mealsCache[idx] = result;
    }
    return result;
  },
  deleteMeal: async (id: string) => {
    const result = isServer() ? await pbDb.deleteMeal(id) : await gatewayDeleteOk("meal_plan_entries", id);
    if (result) {
      const idx = mealsCache.findIndex((m: any) => m.id == id);
      if (idx !== -1) mealsCache.splice(idx, 1);
    }
    return result;
  },

  selectPantry: async () => dualFetch.pantry(),
  selectGrocery: async () => dualFetch.grocery(),
  upsertPantryItem: async (item: any) => {
    let result: any;
    if (!isServer()) {
      try {
        const items = await gatewayList("pantry_items");
        const existing = items.find((p: any) => (p.item || p.name)?.toLowerCase() === item.name?.toLowerCase());
        result = existing
          ? await gatewayUpdate("pantry_items", existing.id, { ...item, item: item.name })
          : await gatewayCreate("pantry_items", { ...item, item: item.name });
      } catch {
        result = null;
      }
    } else {
      result = await pbDb.upsertPantryItem(item);
    }
    if (result) {
      const idx = pantryCache.findIndex((p: any) => p.name?.toLowerCase() === item.name?.toLowerCase() || p.item?.toLowerCase() === item.name?.toLowerCase());
      if (idx !== -1) pantryCache[idx] = result;
      else pantryCache.push(result);
    }
    return result;
  },

  deletePantryItem: async (id: number | string) => {
    const result = isServer() ? await pbDb.deletePantryItem(id) : await gatewayDeleteOk("pantry_items", id);
    if (result) {
      const idx = pantryCache.findIndex((p: any) => p.id == id);
      if (idx !== -1) pantryCache.splice(idx, 1);
    }
    return result;
  },

  upsertGroceryItem: async (item: any) => {
    let result: any;
    if (!isServer()) {
      try {
        const items = await gatewayList("grocery_list_items");
        const byId = item.id != null
          ? items.find((g: any) => String(g.id) === String(item.id))
          : undefined;
        const existing = byId || items.find((g: any) =>
          g.name?.toLowerCase() === item.name?.toLowerCase() && !g.manualOverride
        );
        const { id: _omitId, ...data } = item;
        result = existing
          ? await gatewayUpdate("grocery_list_items", existing.id, data)
          : await gatewayCreate("grocery_list_items", data);
      } catch {
        result = null;
      }
    } else {
      result = await pbDb.upsertGroceryItem(item);
    }
    if (result) {
      const idx = groceryCache.findIndex((g: any) => g.name?.toLowerCase() === item.name?.toLowerCase());
      if (idx !== -1) groceryCache[idx] = result;
      else groceryCache.push(result);
    }
    return result;
  },

  toggleGroceryOverride: async (id: number | string, override: boolean) => {
    const result = isServer()
      ? await pbDb.toggleGroceryOverride(id, override)
      : await safeGatewayRow(() => gatewayUpdate("grocery_list_items", String(id), { manualOverride: override }));
    if (result) {
      const item = groceryCache.find((g: any) => g.id == id);
      if (item) item.manualOverride = override;
    }
    return result;
  },

  deleteGroceryItem: async (id: number | string) => {
    const result = isServer() ? await pbDb.deleteGroceryItem(id) : await gatewayDeleteOk("grocery_list_items", id);
    if (result) {
      const idx = groceryCache.findIndex((g: any) => g.id == id);
      if (idx !== -1) groceryCache.splice(idx, 1);
    }
    return result;
  },

    // === PB pass-through methods for collections without local cache ===

  selectSchedules: async () => isServer() ? pbDb.selectSchedules() : clientListOrEmpty("schedules"),

  upsertTask: async (task: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("tasks");
        const existing = records.find((r: any) => r.taskId === task.taskId);
        if (existing) return await gatewayUpdate("tasks", existing.id, task);
        return await gatewayCreate("tasks", task);
      } catch {
        return null;
      }
    }
    return pbDb.upsertTask(task);
  },
  selectAllTasks: async () => isServer() ? pbDb.selectAllTasks() : clientListOrEmpty("tasks"),
  deleteTaskByTaskId: async (taskId: number) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("tasks");
        const task = records.find((r: any) => r.taskId === taskId);
        if (!task) return false;
        await gatewayDelete("tasks", task.id);
        return true;
      } catch {
        return false;
      }
    }
    return pbDb.deleteTaskByTaskId(taskId);
  },

  getWeekData: async (weekStart: string) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("week_data", filterQuery(`weekStart="${weekStart}"`));
        return records.find((r: any) => r.weekStart === weekStart) || null;
      } catch {
        return null;
      }
    }
    return pbDb.getWeekData(weekStart);
  },
  upsertWeekData: async (data: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("week_data", filterQuery(`weekStart="${data.weekStart}"`));
        const existing = records.find((r: any) => r.weekStart === data.weekStart);
        if (existing) return await gatewayUpdate("week_data", existing.id, data);
        return await gatewayCreate("week_data", data);
      } catch {
        return null;
      }
    }
    return pbDb.upsertWeekData(data);
  },
  archiveWeek: async (data: any) =>
    isServer()
      ? pbDb.archiveWeek(data)
      : safeGatewayRow(() => gatewayCreate("week_archive", data)),
  listArchivedWeeks: async () => isServer() ? pbDb.listArchivedWeeks() : clientListOrEmpty("week_archive"),

  selectRewards: async () => isServer() ? pbDb.selectRewards() : clientListOrEmpty("rewards"),
  upsertReward: async (data: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("rewards");
        const existing = records.find((r: any) => r.name === data.name);
        if (existing) return await gatewayUpdate("rewards", existing.id, data);
        return await gatewayCreate("rewards", data);
      } catch {
        return null;
      }
    }
    return pbDb.upsertReward(data);
  },
  deleteReward: async (id: string) => isServer() ? pbDb.deleteReward(id) : gatewayDeleteOk("rewards", id),

  selectPenalties: async () => isServer() ? pbDb.selectPenalties() : clientListOrEmpty("penalties"),
  upsertPenalty: async (data: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("penalties");
        const existing = records.find((r: any) => r.name === data.name);
        if (existing) return await gatewayUpdate("penalties", existing.id, data);
        return await gatewayCreate("penalties", data);
      } catch {
        return null;
      }
    }
    return pbDb.upsertPenalty(data);
  },
  deletePenalty: async (id: string) => isServer() ? pbDb.deletePenalty(id) : gatewayDeleteOk("penalties", id),

  getActiveFamilyGoal: async () => {
    if (!isServer()) {
      try {
        const records = await gatewayList("family_goals");
        return records.find((r: any) => r.active !== false) || null;
      } catch {
        return null;
      }
    }
    return pbDb.getActiveFamilyGoal();
  },
  upsertFamilyGoal: async (data: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("family_goals");
        const existing = records.find((r: any) => r.active !== false || r.weekStart === data.weekStart);
        if (existing) return await gatewayUpdate("family_goals", existing.id, data);
        return await gatewayCreate("family_goals", data);
      } catch {
        return null;
      }
    }
    return pbDb.upsertFamilyGoal(data);
  },

  insertHallOfFameEntry: async (data: any) =>
    isServer()
      ? pbDb.insertHallOfFameEntry(data)
      : safeGatewayRow(() => gatewayCreate("hall_of_fame", data)),
  selectHallOfFame: async () => isServer() ? pbDb.selectHallOfFame() : clientListOrEmpty("hall_of_fame"),

  selectRecipes: async () => isServer() ? pbDb.selectRecipes() : clientListOrEmpty("recipes"),
  upsertRecipe: async (recipe: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("recipes");
        const existing = records.find((r: any) => r.name?.toLowerCase() === recipe.name?.toLowerCase());
        const data = stringifyMealArrays(recipe);
        if (existing) return await gatewayUpdate("recipes", existing.id, data);
        return await gatewayCreate("recipes", data);
      } catch {
        return null;
      }
    }
    return pbDb.upsertRecipe(recipe);
  },
  deleteRecipe: async (id: string) => isServer() ? pbDb.deleteRecipe(id) : gatewayDeleteOk("recipes", id),

  // Refresh all caches from PB (for cross-device sync)
  refreshCaches: async () => {
    await Promise.allSettled([
      refreshMembersCache(),
      refreshCache("events", dualFetch.events, eventsCache),
      refreshCache("schedules", dualFetch.todaysSchedulesRaw, schedulesCache),
      refreshCache("emergency", dualFetch.emergencyContacts, emergencyCache),
      refreshCache("meals", dualFetch.meals, mealsCache),
      refreshCache("pantry", dualFetch.pantry, pantryCache),
      refreshCache("grocery", dualFetch.grocery, groceryCache),
    ]);
  },

  // Expose cache for direct access
  mealsStore: mealsCache,
  pantryStore: pantryCache,
  groceryStore: groceryCache,

  selectMealWeekArchives: async () => isServer() ? pbDb.selectMealWeekArchives() : clientListOrEmpty("meal_week_archive"),
  upsertMealWeekArchive: async (entry: any) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("meal_week_archive", filterQuery(`weekStart="${entry.weekStart}"`));
        const existing = records.find((r: any) => r.weekStart === entry.weekStart);
        if (existing) return await gatewayUpdate("meal_week_archive", existing.id, entry);
        return await gatewayCreate("meal_week_archive", entry);
      } catch {
        return null;
      }
    }
    return pbDb.upsertMealWeekArchive(entry);
  },
  deleteMealWeekArchive: async (weekStart: string) => {
    if (!isServer()) {
      try {
        const records = await gatewayList("meal_week_archive", filterQuery(`weekStart="${weekStart}"`));
        const entry = records.find((r: any) => r.weekStart === weekStart);
        if (!entry) return false;
        await gatewayDelete("meal_week_archive", entry.id);
        return true;
      } catch {
        return false;
      }
    }
    return pbDb.deleteMealWeekArchive(weekStart);
  },

  // insertProactiveSuggestions / deleteStaleSuggestions stay server-only:
  // their only callers are the cron engine and cron routes (never the browser).
  insertProactiveSuggestions: async (items: any[]) => pbDb.insertProactiveSuggestions(items),
  selectPendingSuggestions: async (opts?: { scopeDate?: string; limit?: number }) => {
    if (!isServer()) {
      const now = new Date().toISOString();
      const limit = opts?.limit ?? 20;
      const filterParts = [
        'status="pending"',
        `(snoozedUntil=null || snoozedUntil<"${now}")`,
      ];
      if (opts?.scopeDate) filterParts.push(`scopeDate="${opts.scopeDate}"`);
      const records = await gatewayList("proactive_suggestions", filterQuery(filterParts.join(" && "), "-createdAt"));
      return records.slice(0, limit);
    }
    return pbDb.selectPendingSuggestions(opts);
  },
  updateSuggestion: async (id: string, patch: { status?: any; snoozedUntil?: string }) => {
    if (isServer()) return pbDb.updateSuggestion(id, patch);
    await gatewayUpdate("proactive_suggestions", id, patch);
  },
  deleteStaleSuggestions: async (beforeISO: string) => pbDb.deleteStaleSuggestions(beforeISO),

  upsertMorningBriefing: async (scopeDate: string, summary: any) => {
    if (!isServer()) {
      const existing = await gatewayList("morning_briefing", filterQuery(`scopeDate="${scopeDate}"`));
      const body = {
        scopeDate,
        summary,
        generatedAt: new Date().toISOString(),
      };
      if (existing.length > 0) {
        return gatewayUpdate("morning_briefing", existing[0].id, body);
      }
      return gatewayCreate("morning_briefing", { ...body, acknowledged: false });
    }
    return pbDb.upsertMorningBriefing(scopeDate, summary);
  },
  selectMorningBriefing: async (scopeDate?: string) => {
    if (!isServer()) {
      const filter = scopeDate ? `scopeDate="${scopeDate}"` : "";
      const query = filter ? filterQuery(filter, "-scopeDate") : "?sort=-scopeDate";
      const records = await gatewayList("morning_briefing", query);
      return records.length > 0 ? records[0] : null;
    }
    return pbDb.selectMorningBriefing(scopeDate);
  },
  ackMorningBriefing: async (id: string) =>
    isServer()
      ? pbDb.ackMorningBriefing(id)
      : gatewayUpdate("morning_briefing", id, { acknowledged: true }),

  insertChatMessage: async (msg: any) => {
    if (isServer()) return pbDb.insertChatMessage(msg);
    return gatewayCreate("chat_messages", {
      ...msg,
      createdAt: msg.createdAt || new Date().toISOString(),
    });
  },
  selectChatMessages: async (threadId: string, sinceISO?: string) => {
    if (isServer()) return pbDb.selectChatMessages(threadId, sinceISO);
    const filter = sinceISO
      ? `threadId="${threadId}" && createdAt>"${sinceISO}"`
      : `threadId="${threadId}"`;
    return gatewayList("chat_messages", filterQuery(filter, "createdAt"));
  },

  getState: async (key: string) => {
    if (!isServer()) {
      const records = await gatewayList("consuela_state", filterQuery(`key="${key}"`));
      return records.length > 0 ? records[0].value : null;
    }
    return pbDb.getState(key);
  },
  setState: async (key: string, value: any, expectedPrev?: any) => {
    if (!isServer()) {
      const records = await gatewayList("consuela_state", filterQuery(`key="${key}"`));
      if (records.length > 0) {
        if (expectedPrev !== undefined && records[0].value !== expectedPrev) {
          return false;
        }
        await gatewayUpdate("consuela_state", records[0].id, { value });
        return true;
      }
      await gatewayCreate("consuela_state", { key, value });
      return true;
    }
    return pbDb.setState(key, value, expectedPrev);
  },
};
