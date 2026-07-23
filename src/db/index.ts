import { db as pbDb } from "./pb-db";
import { membersFallback, schedulesFallback, memberColor, todayISO } from './fallback-data';
import { defaultMeals, mealIdeas, initialGroceryItems } from "../data/meals";


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
    const pbFirstNames = new Set(pbMembers.map((m: any) => (m.name || "").split(" ")[0].toLowerCase()));
    for (const pbm of pbMembers) {
      if (!pbm.pin) {
        const first = (pbm.name || "").split(" ")[0].toLowerCase();
        const fallback = membersFallback.find(
          (f: any) => f.name.split(" ")[0].toLowerCase() === first,
        );
        if (fallback) pbm.pin = fallback.pin;
      }
    }
    const missingFallback = membersFallback.filter((f: any) => {
      const firstName = f.name.split(" ")[0].toLowerCase();
      return !pbFirstNames.has(firstName);
    });
    membersCache = [...pbMembers, ...missingFallback];
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



// Hydrate once
void (async () => {
  try {
    const [m, e, t, s, ec, ml, p, g] = await Promise.all([
      pbDb.selectMembers().catch(() => []),
      pbDb.selectTodaysEvents().catch(() => []),
      pbDb.selectPendingTasks().catch(() => []),
      pbDb.selectTodaysSchedulesRaw().catch(() => []),
      pbDb.selectEmergencyContacts().catch(() => []),
      pbDb.selectMeals().catch(() => []),
      pbDb.selectPantry().catch(() => []),
      pbDb.selectGrocery().catch(() => []),
    ]);
    const pbMembers = (m as any[]) || [];
    const pbFirstNames = new Set(pbMembers.map((m: any) => (m.name || "").split(" ")[0].toLowerCase()));
    for (const pbm of pbMembers) {
      if (!pbm.pin) {
        const first = (pbm.name || "").split(" ")[0].toLowerCase();
        const fallback = membersFallback.find(
          (f: any) => f.name.split(" ")[0].toLowerCase() === first,
        );
        if (fallback) pbm.pin = fallback.pin;
      }
    }
    const missingFallback = membersFallback.filter((f: any) => {
      const firstName = f.name.split(" ")[0].toLowerCase();
      return !pbFirstNames.has(firstName);
    });
    membersCache = [...pbMembers, ...missingFallback];
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

  verifyMemberPin: (memberName: string, pin: string) => {
    const list = membersCache.length > 0 ? membersCache : membersFallback;
    const member = list.find((m: any) => m.name === memberName || m.name?.startsWith(memberName));
    if (!member) return null;
    if (member.pin && member.pin === pin) return member;
    return null;
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
    const result = await pbDb.insertEvent(event);
    if (result) eventsCache.push(result);
    return result;
  },
  updateEvent: async (id: number | string, updates: any) => {
    const result = await pbDb.updateEvent(id, updates);
    if (result) {
      const idx = eventsCache.findIndex((e: any) => e.id == id);
      if (idx !== -1) eventsCache[idx] = result;
    }
    return result;
  },
  deleteEvent: async (id: number | string) => {
    const result = await pbDb.deleteEvent(id);
    if (result) {
      const idx = eventsCache.findIndex((e: any) => e.id == id);
      if (idx !== -1) eventsCache.splice(idx, 1);
    }
    return result;
  },

  selectPendingTasks: () => tasksCache,

  insertTask: async (task: any) => {
    const result = await pbDb.insertTask(task);
    if (result) tasksCache.push(result);
    return result;
  },
  updateTask: async (id: number | string, updates: any) => {
    const result = await pbDb.updateTask(id, updates);
    if (result) {
      const idx = tasksCache.findIndex((t: any) => t.id == id);
      if (idx !== -1) tasksCache[idx] = result;
    }
    return result;
  },
  deleteTask: async (id: number | string) => {
    const result = await pbDb.deleteTask(id);
    if (result) {
      const idx = tasksCache.findIndex((t: any) => t.id == id);
      if (idx !== -1) tasksCache.splice(idx, 1);
    }
    return result;
  },

  selectTodaysSchedulesRaw: () => {
    if (schedulesCache.length > 0) return schedulesCache;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return schedulesFallback
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
    const result = await pbDb.insertSchedule(schedule);
    if (result) schedulesCache.push(result);
    return result;
  },
  updateSchedule: async (id: number | string, updates: any) => {
    const result = await pbDb.updateSchedule(id, updates);
    if (result) {
      const idx = schedulesCache.findIndex((s: any) => s.id == id);
      if (idx !== -1) schedulesCache[idx] = result;
    }
    return result;
  },
  deleteSchedule: async (id: number | string) => {
    const result = await pbDb.deleteSchedule(id);
    if (result) {
      const idx = schedulesCache.findIndex((s: any) => s.id == id);
      if (idx !== -1) schedulesCache.splice(idx, 1);
    }
    return result;
  },

  selectEmergencyContacts: () => emergencyCache,

  insertEmergencyContact: async (data: any) => {
    const result = await pbDb.insertEmergencyContact(data);
    if (result) emergencyCache.push(result);
    return result;
  },

  updateEmergencyContact: async (id: number | string, updates: any) => {
    const result = await pbDb.updateEmergencyContact(id, updates);
    if (result) {
      const idx = emergencyCache.findIndex((c: any) => c.id == id);
      if (idx !== -1) emergencyCache[idx] = { ...emergencyCache[idx], ...updates };
    }
    return result;
  },

  deleteEmergencyContact: async (id: number | string) => {
    const result = await pbDb.deleteEmergencyContact(id);
    if (result) {
      const idx = emergencyCache.findIndex((c: any) => c.id == id);
      if (idx !== -1) emergencyCache.splice(idx, 1);
    }
    return result;
  },

  selectMeals: () => {
    if (mealsCache.length > 0) return mealsCache;
    return defaultMeals;
  },
  selectMealIdeas: () => mealIdeas,
  insertMeal: async (meal: any) => {
    const result = await pbDb.insertMeal(meal);
    if (result) mealsCache.push(result);
    return result;
  },
  updateMeal: async (id: string, updates: any) => {
    const result = await pbDb.updateMeal(id, updates);
    if (result) {
      const idx = mealsCache.findIndex((m: any) => m.id == id);
      if (idx !== -1) mealsCache[idx] = result;
    }
    return result;
  },
  deleteMeal: async (id: string) => {
    const result = await pbDb.deleteMeal(id);
    if (result) {
      const idx = mealsCache.findIndex((m: any) => m.id == id);
      if (idx !== -1) mealsCache.splice(idx, 1);
    }
    return result;
  },

  selectPantry: () => {
    if (pantryCache.length > 0) return pantryCache;
    return [
      { id: 101, name: "Olive oil", status: "plenty" },
      { id: 102, name: "Rice", status: "plenty" },
      { id: 103, name: "Pasta", status: "low" },
      { id: 104, name: "Canned tomatoes", status: "plenty" },
      { id: 105, name: "Chicken broth", status: "plenty" },
      { id: 106, name: "Flour", status: "plenty" },
      { id: 107, name: "Sugar", status: "plenty" },
      { id: 108, name: "Salt", status: "plenty" },
      { id: 109, name: "Black pepper", status: "low" },
    ];
  },
  selectGrocery: () => {
    if (groceryCache.length > 0) return groceryCache;
    return initialGroceryItems;
  },
  upsertPantryItem: async (item: any) => {
    const result = await pbDb.upsertPantryItem(item);
    if (result) {
      const idx = pantryCache.findIndex((p: any) => p.name?.toLowerCase() === item.name?.toLowerCase() || p.item?.toLowerCase() === item.name?.toLowerCase());
      if (idx !== -1) pantryCache[idx] = result;
      else pantryCache.push(result);
    }
    return result;
  },

  deletePantryItem: async (id: number | string) => {
    const result = await pbDb.deletePantryItem(id);
    if (result) {
      const idx = pantryCache.findIndex((p: any) => p.id == id);
      if (idx !== -1) pantryCache.splice(idx, 1);
    }
    return result;
  },

  upsertGroceryItem: async (item: any) => {
    const result = await pbDb.upsertGroceryItem(item);
    if (result) {
      const idx = groceryCache.findIndex((g: any) => g.name?.toLowerCase() === item.name?.toLowerCase());
      if (idx !== -1) groceryCache[idx] = result;
      else groceryCache.push(result);
    }
    return result;
  },

  toggleGroceryOverride: async (id: number | string, override: boolean) => {
    const result = await pbDb.toggleGroceryOverride(id, override);
    if (result) {
      const item = groceryCache.find((g: any) => g.id == id);
      if (item) item.manualOverride = override;
    }
    return result;
  },

  deleteGroceryItem: async (id: number | string) => {
    const result = await pbDb.deleteGroceryItem(id);
    if (result) {
      const idx = groceryCache.findIndex((g: any) => g.id == id);
      if (idx !== -1) groceryCache.splice(idx, 1);
    }
    return result;
  },

    // === PB pass-through methods for collections without local cache ===

  selectSchedules: async () => pbDb.selectSchedules(),

  upsertTask: async (task: any) => pbDb.upsertTask(task),
  selectAllTasks: async () => pbDb.selectAllTasks(),
  deleteTaskByTaskId: async (taskId: number) => pbDb.deleteTaskByTaskId(taskId),

  getWeekData: async (weekStart: string) => pbDb.getWeekData(weekStart),
  upsertWeekData: async (data: any) => pbDb.upsertWeekData(data),
  archiveWeek: async (data: any) => pbDb.archiveWeek(data),
  listArchivedWeeks: async () => pbDb.listArchivedWeeks(),

  selectRewards: async () => pbDb.selectRewards(),
  upsertReward: async (data: any) => pbDb.upsertReward(data),
  deleteReward: async (id: string) => pbDb.deleteReward(id),

  selectPenalties: async () => pbDb.selectPenalties(),
  upsertPenalty: async (data: any) => pbDb.upsertPenalty(data),
  deletePenalty: async (id: string) => pbDb.deletePenalty(id),

  getActiveFamilyGoal: async () => pbDb.getActiveFamilyGoal(),
  upsertFamilyGoal: async (data: any) => pbDb.upsertFamilyGoal(data),

  insertHallOfFameEntry: async (data: any) => pbDb.insertHallOfFameEntry(data),
  selectHallOfFame: async () => pbDb.selectHallOfFame(),

  selectRecipes: async () => pbDb.selectRecipes(),
  upsertRecipe: async (recipe: any) => pbDb.upsertRecipe(recipe),
  deleteRecipe: async (id: string) => pbDb.deleteRecipe(id),

  // Refresh all caches from PB (for cross-device sync)
  refreshCaches: async () => {
    await Promise.allSettled([
      refreshMembersCache(),
      refreshCache("events", () => pbDb.selectTodaysEvents(), eventsCache),
      refreshCache("schedules", () => pbDb.selectTodaysSchedulesRaw(), schedulesCache),
      refreshCache("emergency", () => pbDb.selectEmergencyContacts(), emergencyCache),
      refreshCache("meals", () => pbDb.selectMeals(), mealsCache),
      refreshCache("pantry", () => pbDb.selectPantry(), pantryCache),
      refreshCache("grocery", () => pbDb.selectGrocery(), groceryCache),
    ]);
  },

  // Expose cache for direct access
  mealsStore: mealsCache,
  pantryStore: pantryCache,
  groceryStore: groceryCache,
};
