import { db as pbDb } from "./pb-db";

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

const membersFallback = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🐱", fullName: "Rebecca Garcia", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202" },
  { id: 2, name: "Jeffery (Dad)", role: "parent", emoji: "👨", fullName: "Jeffery Garcia", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828" },
  { id: 3, name: "Emily", role: "child", emoji: "👧", fullName: "Emily Garcia", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024" },
  { id: 4, name: "Bailey", role: "child", emoji: "👧", fullName: "Bailey Garcia", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005" },
  { id: 5, name: "Jasmine", role: "child", emoji: "👧", fullName: "Jasmine Garcia", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402" },
  { id: 6, name: "Aurora", role: "child", emoji: "👧", fullName: "Aurora Garcia", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025" },
  { id: 7, name: "Caspian", role: "child", emoji: "🧒", fullName: "Caspian Garcia", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010" },
  { id: 8, name: "Rocco", role: "pet", emoji: "🐶", fullName: "Rocco (Frenchie)", age: 3, joined: "Feb 2024", pin: "0000" },
  { id: 9, name: "Rico", role: "pet", emoji: "🐩", fullName: "Rico (Poodle)", age: 5, joined: "Feb 2024", pin: "0000" },
];

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

// Hydrate once
void (async () => {
  try {
    const [m, e, t, s, ec, ml, p, g] = await Promise.all([
      pbDb.selectMembers().catch(() => membersFallback),
      pbDb.selectTodaysEvents().catch(() => []),
      pbDb.selectPendingTasks().catch(() => []),
      pbDb.selectTodaysSchedulesRaw().catch(() => []),
      pbDb.selectEmergencyContacts().catch(() => []),
      pbDb.selectMeals().catch(() => []),
      pbDb.selectPantry().catch(() => []),
      pbDb.selectGrocery().catch(() => []),
    ]);
    membersCache = m as any[];
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
    if (result) membersCache.push(result);
    return result;
  },

  updateMember: async (name: string, updates: any) => {
    const result = await pbDb.updateMember(name, updates);
    if (result) {
      const idx = membersCache.findIndex((m: any) => m.name === name);
      if (idx !== -1) membersCache[idx] = { ...membersCache[idx], ...updates };
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
      const idx = membersCache.findIndex((m: any) => m.name === name);
      if (idx !== -1) membersCache.splice(idx, 1);
    }
    return result;
  },

  selectTodaysEvents: () => {
    if (eventsCache.length > 0) return eventsCache;
    const today = new Date().toISOString().split('T')[0];
    return [];
  },

  selectPendingTasks: () => tasksCache,

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

  selectMeals: () => mealsCache,
  insertMeal: async (meal: any) => {
    const result = await pbDb.insertMeal(meal);
    if (result) mealsCache.push(result);
    return result;
  },

  selectPantry: () => pantryCache,
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

  selectGrocery: () => groceryCache,
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

  // Expose cache for direct access
  mealsStore: mealsCache,
  pantryStore: pantryCache,
  groceryStore: groceryCache,
};
