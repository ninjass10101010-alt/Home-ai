import { eventsFallback, tasksFallback, schedulesFallback, emergencyFallback, pantryFallback, groceryFallback, memberColor } from './fallback-data';
import { getPB } from "@/lib/pb";
import { withAdmin } from "@/lib/pb-auth";
import { idempotencyHashOf } from "@/lib/consuela/hash";
import type { NewSuggestion, ProactiveSuggestion, SuggestionStatus } from "@/lib/consuela/types";
import { memberFallbacks as membersFallback } from "@/lib/member-fallback";
import { mapMealRows } from "@/lib/meal-rows";

let localFallback = false;

function pb() {
  try {
    return getPB();
  } catch {
    localFallback = true;
    return null;
  }
}

// MF-2 — PB execution client for the safe* helpers. Server code MUST run on
// the superuser client now that LOCKED_RULES makes every app collection
// admin-only: the public client 403s on every read/write and callers silently
// degrade to fallback data (worst case: /api/emergency read placeholder
// contacts and alerts vanished). The browser keeps its historical public
// client — useAuth's legacy auth_sessions calls are the only direct client
// reach into this module, and they keep failing soft under lockdown (caught
// by each helper below).
async function pbClient(): Promise<ReturnType<typeof getPB> | null> {
  if (typeof window !== "undefined") return pb();
  try {
    return await withAdmin(async (admin) => admin);
  } catch {
    localFallback = true;
    return null;
  }
}

async function safeList<T>(collection: string, fallback: T[]): Promise<T[]> {
  try {
    const client = await pbClient();
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
    const client = await pbClient();
    if (!client) return fallback;
    return (await client.collection(collection).getOne<T>(id, { requestKey: null })) as any;
  } catch {
    return fallback;
  }
}

async function safeCreate<T>(collection: string, data: any): Promise<T | null> {
  try {
    const client = await pbClient();
    if (!client) return null;
    return (await client.collection(collection).create<T>(data)) as any;
  } catch {
    return null;
  }
}

async function safeUpdate<T>(collection: string, id: string, data: any): Promise<T | null> {
  try {
    const client = await pbClient();
    if (!client) return null;
    return (await client.collection(collection).update<T>(id, data)) as any;
  } catch {
    return null;
  }
}

async function safeDelete(collection: string, id: string): Promise<boolean> {
  try {
    const client = await pbClient();
    if (!client) return false;
    await client.collection(collection).delete(id);
    return true;
  } catch {
    return false;
  }
}


export const db = {
  async selectMembers() {
    const records = await safeList<any>("members", []);
    if (records.length === 0) return membersFallback.map(m => ({
      id: m.id, name: m.name.split(' ')[0], fullName: m.name,
      role: m.role, color: memberColor(m.id - 1), emoji: m.emoji || "😊",
      skinColor: m.skinColor, hairColor: m.hairColor,
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
      skinColor: m.skinColor, hairColor: m.hairColor,
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
    const member = records.find((r: any) => r.name === name || r.name?.startsWith(name) || name.startsWith(r.name || ""));
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
    const member = records.find((r: any) => r.name === name || r.name?.startsWith(name) || name.startsWith(r.name || ""));
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
    const meals = await safeList<any>("meal_plan_entries", []);
    return mapMealRows(meals);
  },

  async insertMeal(meal: any): Promise<any> {
    const data = { ...meal };
    if (Array.isArray(data.ingredients)) data.ingredients = JSON.stringify(data.ingredients);
    if (Array.isArray(data.tags)) data.tags = JSON.stringify(data.tags);
    return safeCreate("meal_plan_entries", data);
  },

  async updateMeal(id: string, updates: any): Promise<any> {
    const data = { ...updates };
    if (Array.isArray(data.ingredients)) data.ingredients = JSON.stringify(data.ingredients);
    if (Array.isArray(data.tags)) data.tags = JSON.stringify(data.tags);
    return safeUpdate("meal_plan_entries", id, data);
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
    const byId = item.id != null
      ? items.find((g: any) => String(g.id) === String(item.id))
      : undefined;
    const existing = byId || items.find((g: any) =>
      g.name?.toLowerCase() === item.name?.toLowerCase() && !g.manualOverride
    );
    const { id: _omitId, ...data } = item;
    if (existing) return safeUpdate("grocery_list_items", existing.id, data);
    return safeCreate("grocery_list_items", { userId: "demo", ...data });
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
    try {
      const client = await pbClient();
      if (!client) return;
      const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
      const records = await client.collection("auth_sessions").getFullList({
        filter: `lastActiveAt < "${cutoff}"`,
        requestKey: null,
      });
      for (const r of records) {
        await safeDelete("auth_sessions", r.id).catch(() => {});
      }
    } catch {
      // fallback: no-op if PB unavailable
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
    const data = { ...recipe };
    if (Array.isArray(data.ingredients)) data.ingredients = JSON.stringify(data.ingredients);
    if (Array.isArray(data.tags)) data.tags = JSON.stringify(data.tags);
    if (existing) return safeUpdate("recipes", existing.id, data);
    return safeCreate("recipes", data);
  },
  async deleteRecipe(id: string): Promise<boolean> {
    return safeDelete("recipes", id);
  },

  async selectMealWeekArchives(): Promise<any[]> {
    return safeList<any>("meal_week_archive", []);
  },
  async upsertMealWeekArchive(entry: any): Promise<any> {
    const records = await safeList<any>("meal_week_archive", []);
    const existing = records.find((r: any) => r.weekStart === entry.weekStart);
    if (existing) {
      return safeUpdate<any>("meal_week_archive", existing.id, entry);
    }
    return safeCreate<any>("meal_week_archive", entry);
  },
  async deleteMealWeekArchive(weekStart: string): Promise<boolean> {
    const records = await safeList<any>("meal_week_archive", []);
    const entry = records.find((r: any) => r.weekStart === weekStart);
    if (!entry) return false;
    return safeDelete("meal_week_archive", entry.id);
  },

  async insertProactiveSuggestions(items: NewSuggestion[]): Promise<{ inserted: number; rejected: number }> {
    let inserted = 0;
    let rejected = 0;
    await withAdmin(async (pb) => {
      for (const item of items) {
        const hash = idempotencyHashOf(item.kind, item.title, item.scopeDate, item.severity, item.actionPayload?.args);
        const body: Record<string, unknown> = {
          idempotencyHash: hash,
          kind: item.kind,
          severity: item.severity,
          title: item.title,
          scopeDate: item.scopeDate,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        if (item.body !== undefined) body.body = item.body;
        if (item.emoji !== undefined) body.emoji = item.emoji;
        if (item.actionLabel !== undefined) body.actionLabel = item.actionLabel;
        if (item.actionPayload !== undefined) body.actionPayload = item.actionPayload;
        if (item.expiresAt !== undefined) body.expiresAt = item.expiresAt;

        try {
          await pb.collection("proactive_suggestions").create(body);
          inserted++;
        } catch (err: any) {
          if (err.status === 400 && JSON.stringify(err.response).toLowerCase().includes("unique")) {
            rejected++;
          } else {
            throw err;
          }
        }
      }
    });
    return { inserted, rejected };
  },

  async selectPendingSuggestions(opts?: { scopeDate?: string; limit?: number }): Promise<ProactiveSuggestion[]> {
    const now = new Date().toISOString();
    const limit = opts?.limit ?? 20;
    // C1: no `scopeDate>="today"` clause — after midnight a snoozed row's
    // scopeDate is yesterday, so a lower-bound filter would permanently hide it.
    // The `status="pending"` + `(snoozedUntil=null || snoozedUntil<now)` clauses
    // already gate visibility correctly. scopeDate is kept only as an OPTIONAL
    // exact-match parameter for callers that want "what's relevant today"
    // (briefing/scanner); the widget/act path passes nothing and sees all
    // pending rows regardless of age.
    const filterParts = [
      'status="pending"',
      `(snoozedUntil=null || snoozedUntil<"${now}")`,
    ];
    if (opts?.scopeDate) filterParts.push(`scopeDate="${opts.scopeDate}"`);
    const filter = filterParts.join(" && ");
    return withAdmin(async (pb) => {
      const records = await pb.collection("proactive_suggestions").getFullList({
        filter,
        sort: "-createdAt",
        requestKey: null,
      });
      return records.slice(0, limit) as unknown as ProactiveSuggestion[];
    });
  },

  async updateSuggestion(id: string, patch: { status?: SuggestionStatus; snoozedUntil?: string }): Promise<void> {
    await withAdmin(async (pb) => {
      await pb.collection("proactive_suggestions").update(id, patch);
    });
  },

  async deleteStaleSuggestions(beforeISO: string): Promise<number> {
    return withAdmin(async (pb) => {
      const records = await pb.collection("proactive_suggestions").getFullList({
        filter: `createdAt<"${beforeISO}"`,
        requestKey: null,
      });
      let count = 0;
      for (const r of records) {
        try {
          await pb.collection("proactive_suggestions").delete(r.id);
          count++;
        } catch {
          // ignore individual delete failures
        }
      }
      return count;
    });
  },

  // === Morning Briefing ===
  async upsertMorningBriefing(scopeDate: string, summary: unknown): Promise<any> {
    return withAdmin(async (pb) => {
      const existing = await pb.collection("morning_briefing").getFullList({
        filter: `scopeDate="${scopeDate}"`,
        requestKey: null,
      });
      const body = {
        scopeDate,
        summary,
        generatedAt: new Date().toISOString(),
      };
      if (existing.length > 0) {
        return pb.collection("morning_briefing").update(existing[0].id, body);
      }
      return pb.collection("morning_briefing").create({ ...body, acknowledged: false });
    });
  },

  async selectMorningBriefing(scopeDate?: string): Promise<any | null> {
    return withAdmin(async (pb) => {
      const records = await pb.collection("morning_briefing").getFullList({
        filter: scopeDate ? `scopeDate="${scopeDate}"` : "",
        sort: "-scopeDate",
        requestKey: null,
      });
      return records.length > 0 ? records[0] : null;
    });
  },

  async ackMorningBriefing(id: string): Promise<any> {
    return withAdmin(async (pb) => {
      return pb.collection("morning_briefing").update(id, { acknowledged: true });
    });
  },

  // === Consuela State (key/value, e.g. last_telegram_update_id) ===
  async getState(key: string): Promise<unknown> {
    return withAdmin(async (pb) => {
      const records = await pb.collection("consuela_state").getFullList({
        filter: `key="${key}"`,
        requestKey: null,
      });
      return records.length > 0 ? records[0].value : null;
    });
  },

  async setState(key: string, value: unknown, expectedPrev?: unknown): Promise<boolean> {
    return withAdmin(async (pb) => {
      const records = await pb.collection("consuela_state").getFullList({
        filter: `key="${key}"`,
        requestKey: null,
      });
      if (records.length > 0) {
        // I6 — compare-and-set: if the caller knows the previous value and it
        // doesn't match the fresh read, someone else advanced it first. Refuse
        // the write (lost update under concurrency is expected and retried).
        if (expectedPrev !== undefined && records[0].value !== expectedPrev) {
          return false;
        }
        await pb.collection("consuela_state").update(records[0].id, { value });
        return true;
      }
      await pb.collection("consuela_state").create({ key, value });
      return true;
    });
  },

  // === Chat Messages ===
  async insertChatMessage(msg: { userId: string; role: string; content: string; source: string; threadId: string; createdAt?: string }): Promise<any> {
    return withAdmin(async (pb) => {
      return pb.collection("chat_messages").create({
        ...msg,
        // I3 — optional caller-provided createdAt (e.g. Telegram send time);
        // otherwise fall back to the insert time.
        createdAt: msg.createdAt || new Date().toISOString(),
      });
    });
  },

  async selectChatMessages(threadId: string, sinceISO?: string): Promise<any[]> {
    return withAdmin(async (pb) => {
      const filter = sinceISO
        ? `threadId="${threadId}" && createdAt>"${sinceISO}"`
        : `threadId="${threadId}"`;
      return pb.collection("chat_messages").getFullList({
        filter,
        sort: "createdAt",
        requestKey: null,
      });
    });
  },
};
