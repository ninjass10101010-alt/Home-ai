import { getPB } from "@/lib/pb";

let localFallback = false;

function pb() {
  try {
    return getPB();
  } catch {
    localFallback = true;
    return null;
  }
}

async function safeList<T>(collection: string, fallback: T[]): Promise<T[]> {
  try {
    const client = pb();
    if (!client) return fallback;
    const records = await client.collection(collection).getFullList<T>({ requestKey: null });
    return records as any;
  } catch {
    localFallback = true;
    return fallback;
  }
}

async function safeGet<T>(collection: string, id: string, fallback: T | null): Promise<T | null> {
  try {
    const client = pb();
    if (!client) return fallback;
    return (await client.collection(collection).getOne<T>(id, { requestKey: null })) as any;
  } catch {
    return fallback;
  }
}

async function safeCreate<T>(collection: string, data: any): Promise<T | null> {
  try {
    const client = pb();
    if (!client) return null;
    return (await client.collection(collection).create<T>(data)) as any;
  } catch {
    return null;
  }
}

async function safeUpdate<T>(collection: string, id: string, data: any): Promise<T | null> {
  try {
    const client = pb();
    if (!client) return null;
    return (await client.collection(collection).update<T>(id, data)) as any;
  } catch {
    return null;
  }
}

async function safeDelete(collection: string, id: string): Promise<boolean> {
  try {
    const client = pb();
    if (!client) return false;
    await client.collection(collection).delete(id);
    return true;
  } catch {
    return false;
  }
}

const memberColor = (i: number) =>
  ["green", "cyan", "violet", "amber", "rose", "blue", "cyan", "green", "cyan"][i % 9] || "green";

export const db = {
  async selectMembers() {
    const records = await safeList<any>("members", []);
    if (records.length === 0) return membersFallback.map(m => ({
      id: m.id, name: m.name.split(' ')[0], fullName: m.name,
      role: m.role, color: memberColor(m.id - 1), emoji: m.emoji || "😊",
      skinColor: m.skinColor, hairColor: m.hairColor, pin: (m as any).pin,
    }));
    return records.map((r: any, i: number) => ({
      id: r.id, name: r.name.split(' ')[0], fullName: r.name,
      role: r.role || "member", color: memberColor(i), emoji: r.emoji || "😊",
      pin: r.pin,
    }));
  },

  async selectMembersDetailed() {
    const records = await safeList<any>("members", []);
    if (records.length === 0) return membersFallback.map(m => ({
      name: m.name, role: m.role === 'parent' ? 'Parent' : m.role === 'pet' ? 'Pet' : 'Child',
      emoji: m.emoji || "😊", color: memberColor(m.id - 1),
      age: m.age.toString(), joined: m.joined,
      skinColor: m.skinColor, hairColor: m.hairColor, pin: (m as any).pin || "",
      avatarSize: (m as any).avatarSize || "md", glow: (m as any).glow || false,
    }));
    return records.map((r: any, i: number) => ({
      name: r.name, role: r.role || "member", emoji: r.emoji || "😊",
      color: memberColor(i), age: r.age || "", joined: r.created || "",
      skinColor: r.skinColor, hairColor: r.hairColor, pin: r.pin || "",
      avatarSize: r.avatarSize || "md", glow: r.glow || false,
    }));
  },

  async selectMembersForCalendar() {
    const records = await this.selectMembers();
    return [
      { name: "All", color: "green", emoji: "👨‍👩‍👧‍👦" },
      ...records.map(m => ({ name: m.name, color: m.color, emoji: m.emoji })),
    ];
  },

  async insertMember(memberData: any): Promise<any> {
    return safeCreate("members", memberData);
  },

  async updateMember(name: string, updates: any): Promise<any> {
    const records = await safeList<any>("members", []);
    const member = records.find((r: any) => r.name === name);
    if (!member) return null;
    return safeUpdate("members", member.id, updates);
  },

  async verifyMemberPin(memberName: string, pin: string) {
    const records = await safeList<any>("members", []);
    const member = records.find((r: any) => r.name === memberName || r.name.startsWith(memberName));
    if (!member) return null;
    if (member.pin && member.pin === pin) return member;
    return null;
  },

  async deleteMember(name: string): Promise<any> {
    const records = await safeList<any>("members", []);
    const member = records.find((r: any) => r.name === name);
    if (!member) return false;
    return safeDelete("members", member.id);
  },

  async selectTodaysEvents() {
    const records = await safeList<any>("events", eventsFallback);
    const today = new Date().toISOString().split('T')[0];
    const members = await this.selectMembers();
    return records
      .filter((e: any) => e.date === today)
      .sort((a: any, b: any) => (a.time || '').localeCompare(b.time || ''))
      .map((event: any) => {
        const member = members.find((m: any) => m.fullName === event.member || m.name === event.member);
        return {
          id: event.id, title: event.title,
          time: event.time ? new Date(`2000-01-01T${event.time}`).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true,
          }) : undefined,
          member: member?.fullName || event.member || 'Unknown',
          emoji: member?.emoji || '👤',
          color: member?.color || 'amber',
          icon: event.icon || '📅',
        };
      });
  },

  async insertEvent(event: any): Promise<any> {
    return safeCreate("events", event);
  },
  async updateEvent(id: number | string, updates: any): Promise<any> {
    return safeUpdate("events", String(id), updates);
  },
  async deleteEvent(id: number | string): Promise<boolean> {
    return safeDelete("events", String(id));
  },

  async insertSchedule(schedule: any): Promise<any> {
    return safeCreate("schedules", schedule);
  },
  async updateSchedule(id: number | string, updates: any): Promise<any> {
    return safeUpdate("schedules", String(id), updates);
  },
  async deleteSchedule(id: number | string): Promise<boolean> {
    return safeDelete("schedules", String(id));
  },

  async insertTask(task: any): Promise<any> {
    return safeCreate("tasks", task);
  },
  async updateTask(id: number | string, updates: any): Promise<any> {
    return safeUpdate("tasks", String(id), updates);
  },
  async deleteTask(id: number | string): Promise<boolean> {
    return safeDelete("tasks", String(id));
  },

  async selectPendingTasks() {
    const records = await safeList<any>("tasks", tasksFallback);
    const members = await this.selectMembers();
    return records
      .filter((t: any) => t.status === 'pending')
      .slice(0, 3)
      .map((task: any) => {
        const member = members.find((m: any) => m.fullName === task.assigned || m.name === task.assigned);
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
  },

  async selectTodaysSchedulesRaw() {
    const records = await safeList<any>("schedules", schedulesFallback);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const members = await this.selectMembers();
    return records
      .filter((s: any) => s.days === 'all' || s.days?.includes(today))
      .sort((a: any, b: any) => a.time.localeCompare(b.time))
      .map((s: any) => {
        const member = s.member ? members.find((m: any) => m.fullName === s.member || m.name === s.member) : null;
        return { id: s.id, title: s.title, time: s.time, emoji: s.icon, type: s.type, color: s.color, member: member?.fullName, memberColor: member?.color || 'amber' };
      });
  },

  async selectTodaysSchedules() {
    const raw = await this.selectTodaysSchedulesRaw();
    return raw.map((s: any) => ({
      ...s,
      time: new Date(`2000-01-01T${s.time}`).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      }),
    }));
  },

  async selectEmergencyContacts() {
    return safeList<any>("emergency_contacts", emergencyFallback);
  },

  async insertEmergencyContact(data: any): Promise<any> {
    return safeCreate("emergency_contacts", data);
  },

  async updateEmergencyContact(id: number | string, updates: any): Promise<any> {
    return safeUpdate("emergency_contacts", String(id), updates);
  },

  async deleteEmergencyContact(id: number | string): Promise<any> {
    return safeDelete("emergency_contacts", String(id));
  },

  async selectMeals(userId = "demo") {
    return safeList<any>("meal_plan_entries", []);
  },

  async insertMeal(meal: any): Promise<any> {
    return safeCreate("meal_plan_entries", meal);
  },

  async updateMeal(id: string, updates: any): Promise<any> {
    return safeUpdate("meal_plan_entries", id, updates);
  },

  async deleteMeal(id: string): Promise<boolean> {
    return safeDelete("meal_plan_entries", id);
  },

  async selectPantry(userId = "demo"): Promise<any[]> {
    return safeList<any>("pantry_items", pantryFallback);
  },

  async upsertPantryItem(item: any): Promise<any> {
    const items = await safeList<any>("pantry_items", []);
    const existing = items.find((p: any) => (p.item || p.name)?.toLowerCase() === item.name?.toLowerCase());
    if (existing) return safeUpdate("pantry_items", existing.id, { ...item, item: item.name });
    return safeCreate("pantry_items", { ...item, item: item.name });
  },

  async deletePantryItem(id: number | string): Promise<boolean> {
    return safeDelete("pantry_items", String(id));
  },

  async selectGrocery(userId = "demo"): Promise<any[]> {
    return safeList<any>("grocery_list_items", groceryFallback);
  },

  async upsertGroceryItem(item: any): Promise<any> {
    const items = await safeList<any>("grocery_list_items", []);
    const existing = items.find((g: any) =>
      g.name?.toLowerCase() === item.name?.toLowerCase() && !g.manualOverride
    );
    if (existing) return safeUpdate("grocery_list_items", existing.id, item);
    return safeCreate("grocery_list_items", item);
  },

  async toggleGroceryOverride(id: number | string, override: boolean): Promise<any> {
    return safeUpdate("grocery_list_items", String(id), { manualOverride: override });
  },

  async deleteGroceryItem(id: number | string): Promise<boolean> {
    return safeDelete("grocery_list_items", String(id));
  },

  // === Schedules (full list) ===
  async selectSchedules(): Promise<any[]> {
    return safeList<any>("schedules", schedulesFallback);
  },

  // === Auth Sessions ===
  async createAuthSession(data: any): Promise<any> {
    return safeCreate("auth_sessions", data);
  },
  async findAuthSession(token: string): Promise<any | null> {
    const records = await safeList<any>("auth_sessions", []);
    return records.find((r: any) => r.token === token) || null;
  },
  async deleteAuthSession(token: string): Promise<boolean> {
    const records = await safeList<any>("auth_sessions", []);
    const session = records.find((r: any) => r.token === token);
    if (!session) return false;
    return safeDelete("auth_sessions", session.id);
  },
  async deleteExpiredAuthSessions(maxAgeDays = 30): Promise<void> {
    const records = await safeList<any>("auth_sessions", []);
    const cutoff = Date.now() - maxAgeDays * 86400000;
    for (const r of records) {
      const lastActive = new Date(r.lastActiveAt || r.createdAt).getTime();
      if (lastActive < cutoff) await safeDelete("auth_sessions", r.id).catch(() => {});
    }
  },

  // === Tasks (structured) ===
  async selectAllTasks(): Promise<any[]> {
    return safeList<any>("tasks", []);
  },
  async upsertTask(task: any): Promise<any | null> {
    const records = await safeList<any>("tasks", []);
    const existing = records.find((r: any) => r.taskId === task.taskId);
    if (existing) return safeUpdate("tasks", existing.id, task);
    return safeCreate("tasks", task);
  },
  async deleteTaskByTaskId(taskId: number): Promise<boolean> {
    const records = await safeList<any>("tasks", []);
    const task = records.find((r: any) => r.taskId === taskId);
    if (!task) return false;
    return safeDelete("tasks", task.id);
  },

  // === Week Data ===
  async getWeekData(weekStart: string): Promise<any | null> {
    const records = await safeList<any>("week_data", []);
    return records.find((r: any) => r.weekStart === weekStart) || null;
  },
  async upsertWeekData(data: any): Promise<any | null> {
    const records = await safeList<any>("week_data", []);
    const existing = records.find((r: any) => r.weekStart === data.weekStart);
    if (existing) return safeUpdate("week_data", existing.id, data);
    return safeCreate("week_data", data);
  },

  // === Week Archive ===
  async archiveWeek(data: any): Promise<any | null> {
    return safeCreate("week_archive", data);
  },
  async listArchivedWeeks(): Promise<any[]> {
    return safeList<any>("week_archive", []);
  },

  // === Rewards ===
  async selectRewards(): Promise<any[]> {
    return safeList<any>("rewards", []);
  },
  async upsertReward(data: any): Promise<any | null> {
    const records = await safeList<any>("rewards", []);
    const existing = records.find((r: any) => r.name === data.name);
    if (existing) return safeUpdate("rewards", existing.id, data);
    return safeCreate("rewards", data);
  },
  async deleteReward(id: string): Promise<boolean> {
    return safeDelete("rewards", id);
  },

  // === Penalties ===
  async selectPenalties(): Promise<any[]> {
    return safeList<any>("penalties", []);
  },
  async upsertPenalty(data: any): Promise<any | null> {
    const records = await safeList<any>("penalties", []);
    const existing = records.find((r: any) => r.name === data.name);
    if (existing) return safeUpdate("penalties", existing.id, data);
    return safeCreate("penalties", data);
  },
  async deletePenalty(id: string): Promise<boolean> {
    return safeDelete("penalties", id);
  },

  // === Family Goals ===
  async getActiveFamilyGoal(): Promise<any | null> {
    const records = await safeList<any>("family_goals", []);
    return records.find((r: any) => r.active !== false) || null;
  },
  async upsertFamilyGoal(data: any): Promise<any | null> {
    const records = await safeList<any>("family_goals", []);
    const existing = records.find((r: any) => r.active !== false || r.weekStart === data.weekStart);
    if (existing) return safeUpdate("family_goals", existing.id, data);
    return safeCreate("family_goals", data);
  },

  // === Hall of Fame ===
  async insertHallOfFameEntry(data: any): Promise<any | null> {
    return safeCreate("hall_of_fame", data);
  },
  async selectHallOfFame(): Promise<any[]> {
    return safeList<any>("hall_of_fame", []);
  },

  // === Recipes ===
  async selectRecipes(): Promise<any[]> {
    return safeList<any>("recipes", []);
  },
  async upsertRecipe(recipe: any): Promise<any | null> {
    const records = await safeList<any>("recipes", []);
    const existing = records.find((r: any) => r.name?.toLowerCase() === recipe.name?.toLowerCase());
    if (existing) return safeUpdate("recipes", existing.id, recipe);
    return safeCreate("recipes", recipe);
  },
  async deleteRecipe(id: string): Promise<boolean> {
    return safeDelete("recipes", id);
  },
};

const membersFallback = [
  { id: 1, name: "Rebecca (Mom)", role: "parent", emoji: "🐱", age: 38, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0202" },
  { id: 2, name: "Jeffery (Dad)", role: "parent", emoji: "👨", age: 40, joined: "Feb 2024", skinColor: "#fdbcb4", hairColor: "#1e40af", pin: "0828" },
  { id: 3, name: "Emily", role: "child", emoji: "👧", age: 14, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1024" },
  { id: 4, name: "Bailey", role: "child", emoji: "👧", age: 12, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1005" },
  { id: 5, name: "Jasmine", role: "child", emoji: "👧", age: 10, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#b45309", pin: "0402" },
  { id: 6, name: "Aurora", role: "child", emoji: "👧", age: 7, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#5b21b6", pin: "1025" },
  { id: 7, name: "Caspian", role: "child", emoji: "🧒", age: 5, joined: "Mar 2024", skinColor: "#fdbcb4", hairColor: "#166534", pin: "1010" },
  { id: 8, name: "Rocco", role: "pet", emoji: "🐶", age: 3, joined: "Feb 2024", pin: "0000" },
  { id: 9, name: "Rico", role: "pet", emoji: "🐩", age: 5, joined: "Feb 2024", pin: "0000" },
];

const eventsFallback = [
  { id: 1, title: "Soccer Practice", date: new Date().toISOString().split('T')[0], time: "16:00", member: "Emily", icon: "⚽", color: "violet" },
  { id: 2, title: "Dentist — Bailey", date: new Date().toISOString().split('T')[0], time: "17:30", member: "Bailey", icon: "🦷", color: "amber" },
  { id: 3, title: "Team dinner", date: new Date().toISOString().split('T')[0], time: "19:00", member: "Jeffery (Dad)", icon: "🍽️", color: "cyan" },
];

const tasksFallback = [
  { id: 1, title: "Take out trash", assigned: "Emily", due: new Date().toISOString().split('T')[0], priority: "medium", status: "pending", points: 15 },
  { id: 2, title: "Grocery run", assigned: "Rebecca (Mom)", due: new Date().toISOString().split('T')[0], priority: "high", status: "pending", points: 20 },
  { id: 3, title: "Clean bathroom", assigned: "Jasmine", due: new Date(Date.now() + 86400000).toISOString().split('T')[0], priority: "medium", status: "completed", points: 15 },
];

const schedulesFallback = [
  { id: 1, title: "Wake up / Morning routine", time: "07:00", days: "weekdays", type: "routine", icon: "⏰", color: "amber" },
  { id: 2, title: "Breakfast", time: "07:30", days: "all", type: "routine", icon: "🥞", color: "green" },
  { id: 3, title: "School / Learning time", time: "08:30", days: "weekdays", type: "routine", icon: "📚", color: "cyan" },
  { id: 4, title: "Lunch", time: "12:00", days: "all", type: "routine", icon: "🍽️", color: "amber" },
  { id: 5, title: "Screen time", time: "15:30", days: "weekdays", type: "routine", icon: "📱", color: "violet" },
  { id: 6, title: "Dinner", time: "18:00", days: "all", type: "routine", icon: "🍝", color: "green" },
  { id: 7, title: "Bedtime routine", time: "20:30", days: "all", type: "routine", icon: "🛁", color: "violet" },
  { id: 8, title: "Lights out", time: "21:00", days: "all", type: "routine", icon: "🌙", color: "rose" },
  { id: 9, title: "Family movie night", time: "19:00", days: "friday", type: "routine", icon: "🎬", color: "cyan" },
  { id: 10, title: "Take medication", time: "08:00", days: "all", member: "Rebecca (Mom)", type: "reminder", icon: "💊", color: "rose" },
];

const emergencyFallback = [
  { id: 1, name: "Rebecca", phone: "+16163448104", email: "Ninjass10101010@gmail.com", carrier: "verizon", relationship: "parent", isPrimary: true, emoji: "👩" },
  { id: 2, name: "Test Contact", phone: "+16167452736", email: "Ninjass10101010@gmail.com", carrier: "verizon", relationship: "parent", isPrimary: true, emoji: "👨" },
];

const pantryFallback = [
  { id: 101, name: "Olive oil", status: "plenty" },
  { id: 102, name: "Rice", status: "plenty" },
  { id: 103, name: "Pasta", status: "low" },
];

const groceryFallback = [
  { id: 201, name: "Ground beef", category: "meat", aisle: "6", quantity: "1 lb", priority: "high", needed: true },
  { id: 202, name: "Taco shells", category: "pantry", aisle: "8", priority: "medium", needed: true },
];
