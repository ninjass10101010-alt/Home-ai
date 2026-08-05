import { db } from "@/db";
import { defaultMeals, mealIdeas, initialGroceryItems, groceryCategories } from "@/data/meals";
import { withAdmin } from "@/lib/pb-auth";
import { weekKey } from "@/lib/task-utils";
import type { Transaction, WeekData } from "@/types/tasks";

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
  return new Date().toISOString().split("T")[0];
}

function formatTime(iso?: string): string {
  if (!iso) return "no time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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

async function adminUpsertTask(task: Record<string, unknown>): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("tasks").getFullList({ requestKey: null });
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

async function adminUpsertGroceryItem(input: {
  name: string;
  category?: string;
  source?: string;
  needed?: boolean;
}): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const trimmed = input.name.trim();
      const category = input.category || "pantry";
      const catDef = groceryCategories.find((c) => c.id === category);
      const emoji = catDef?.emoji || "📦";
      const aisle = catDef?.aisles?.[0]?.split("-")[0] || "1";
      const records = await pb.collection("grocery_list_items").getFullList({ requestKey: null });
      const existing = records.find((g: any) => g.name && normalizeGroceryName(g.name) === normalizeGroceryName(trimmed));
      if (existing) {
        const patch: Record<string, unknown> = { needed: input.needed ?? true };
        if (input.needed === undefined) patch.source = input.source || existing.source || "chat";
        return pb.collection("grocery_list_items").update(existing.id, patch);
      }
      return pb.collection("grocery_list_items").create({
        name: trimmed,
        emoji,
        category,
        aisle,
        quantity: "",
        priority: "medium",
        needed: true,
        source: input.source || "chat",
      });
    });
  } catch (e: any) {
    console.error("[hermes-tools] upsertGroceryItem failed:", e?.message);
    return null;
  }
}

async function adminUpsertWeekData(data: WeekData): Promise<any | null> {
  try {
    return await withAdmin(async (pb) => {
      const records = await pb.collection("week_data").getFullList({ requestKey: null });
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

const TOOLS: Tool[] = [
  {
    definition: {
      name: "get_weather",
      description: "Get today's weather summary for the family. This is a simulated weather report based on the current season. Returns temperature, condition, and a brief forecast.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const now = new Date();
      const month = now.getMonth();
      const hour = now.getHours();
      const season = month < 2 || month === 11 ? "winter" : month < 5 ? "spring" : month < 8 ? "summer" : "autumn";
      const temps: Record<string, { high: number; low: number; condition: string }> = {
        spring: { high: 65, low: 45, condition: "Partly cloudy with light showers possible" },
        summer: { high: 85, low: 65, condition: "Warm and sunny" },
        autumn: { high: 58, low: 40, condition: "Cool with scattered clouds" },
        winter: { high: 35, low: 22, condition: "Cold with possible snow flurries" },
      };
      const t = temps[season];
      const timeLabel = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
      return summarize({
        season,
        current_temp: timeLabel === "afternoon" ? t.high : timeLabel === "evening" ? t.low + 10 : t.low + 5,
        high: t.high,
        low: t.low,
        condition: t.condition,
        time_of_day: timeLabel,
      });
    },
  },
  {
    definition: {
      name: "get_family_members",
      description: "List all family members with their names, roles, and emojis.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const members = db.selectMembers();
      return summarize(members.map((m: any) => ({ name: m.fullName || m.name, role: m.role, emoji: m.emoji })));
    },
  },
  {
    definition: {
      name: "get_todays_events",
      description: "Get all calendar events scheduled for today. Returns event titles, times, and who they're for.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const events = db.selectTodaysEvents();
      return summarize(events.map((e: any) => ({
        title: e.title,
        time: e.time,
        member: e.member,
        emoji: e.emoji,
        color: e.color,
      })));
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
      let result: { removed: boolean; title?: any; reason?: string };
      try {
        result = await withAdmin(async (pb) => {
          const records = await pb.collection("events").getFullList({ requestKey: null });
          const match = records.find(
            (e: any) => String(e.title).trim().toLowerCase() === title && (!date || e.date === date)
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
      name: "get_todays_schedule",
      description: "Get the family's daily routine schedule for today. Returns time-ordered routines like wake-up, meals, bedtime.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const sched = db.selectTodaysSchedulesRaw();
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
      const tasks = db.selectPendingTasks();
      let filtered = tasks.filter((t: any) => t.status === "pending" || !t.done);
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
        priority: t.priority,
      })));
    },
  },
  {
    definition: {
      name: "add_task",
      description: "Add a new chore or task for a family member. Use this when the user asks to create a new task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title (e.g. 'Walk Rocco', 'Clean bathroom')" },
          assigned_to: { type: "string", description: "Family member name to assign to (e.g. 'Emily', 'Jeffery')" },
          points: { type: "number", description: "Points for completing this task (5-20 range)" },
          due: { type: "string", description: "Due date in YYYY-MM-DD format. Defaults to today if not provided." },
          priority: { type: "string", description: "Priority level", enum: ["low", "medium", "high"] },
        },
        required: ["title", "assigned_to"],
      },
    },
    handler: async (args) => {
      const due = args.due || todayISO();
      const points = Number(args.points) || 10;
      const priority = args.priority || "medium";
      const members = db.selectMembers();
      const match = members.find((m: any) => {
        const name = (m.fullName || m.name || "").toLowerCase();
        const search = String(args.assigned_to).toLowerCase();
        return name.includes(search) || name.startsWith(search);
      });
      const task: Record<string, unknown> = {
        taskId: Date.now(),
        title: String(args.title).trim(),
        assignee: match ? (match.fullName || match.name) : String(args.assigned_to).trim(),
        assigneeEmoji: match?.emoji || "✅",
        due,
        points,
        priority,
        recurring: "none",
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
        assigneeEmoji: row.assigneeEmoji,
        points: row.points,
        due: row.due,
        priority: row.priority,
      });
    },
  },
  {
    definition: {
      name: "complete_task",
      description: "Mark a pending chore as completed for the week. The task's points are awarded to its assigned family member. Find the task by title or taskId.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title to complete (e.g. 'Walk Rocco')" },
          taskId: { type: "number", description: "Optional: numeric task id to complete" },
          assignee: { type: "string", description: "Optional: family member name to disambiguate (e.g. 'Emily')" },
        },
      },
    },
    handler: async (args) => {
      const taskId = args.taskId !== undefined ? Number(args.taskId) : undefined;
      const title = args.title ? String(args.title).trim() : undefined;
      const assignee = args.assignee ? String(args.assignee).trim().toLowerCase() : undefined;
      let result: Record<string, any>;
      if (!taskId && !title) {
        return summarize({ ok: false, error: "Provide a title or taskId of the task to complete" });
      }
      try {
        result = await withAdmin(async (pb) => {
          const records = await pb.collection("tasks").getFullList({ requestKey: null });
          let task: any = taskId !== undefined ? records.find((r: any) => r.taskId === taskId) : undefined;
          if (!task && title) {
            task = records.find((r: any) => String(r.title).trim().toLowerCase() === title.toLowerCase());
            if (!task) task = records.find((r: any) => String(r.title).trim().toLowerCase().includes(title.toLowerCase()));
            if (task && assignee) {
              const t = String(task.assignee || "").toLowerCase();
              if (!t.includes(assignee) && !t.startsWith(assignee)) {
                const alt = records.find(
                  (r: any) => String(r.title).trim().toLowerCase() === title.toLowerCase() &&
                    String(r.assignee || "").toLowerCase().includes(assignee)
                );
                if (alt) task = alt;
              }
            }
          }
          if (!task) {
            return {
              ok: false,
              error: `No pending task found${title ? ` matching "${title}"` : ""}${taskId !== undefined ? ` (taskId ${taskId})` : ""}`,
            };
          }

          const currentWeek = weekKey();
          const weekRecords = await pb.collection("week_data").getFullList({ requestKey: null });
          const week = weekRecords.find((r: any) => r.weekStart === currentWeek) || null;
          const points = parseJSON<Record<string, number>>(week?.points, {});
          const history = parseJSON<Transaction[]>(week?.history, []);
          const existingTx = history.find((tx: any) => tx.taskId === Number(task.taskId) && tx.type === "earn");
          if (existingTx) {
            return {
              ok: false,
              error: `Task "${task.title}" was already completed this week by ${existingTx.member}`,
              completedBy: existingTx.member,
            };
          }

          const memberName = task.assignee || "Unknown";
          const amount = Number(task.points) || 0;
          const tx: Transaction = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            timestamp: new Date().toISOString(),
            member: memberName,
            type: "earn",
            amount,
            description: `Completed: ${task.title}${amount > 0 ? ` (+${amount}pts)` : ""}`,
            taskId: Number(task.taskId),
          };
          const updatedWeek: WeekData = {
            weekStart: currentWeek,
            points: { ...points, [memberName]: (points[memberName] || 0) + amount },
            streak: parseJSON<Record<string, number>>(week?.streak, {}),
            lastActive: parseJSON<Record<string, string>>(week?.lastActive, {}),
            history: [...history, tx],
          };
          if (week) {
            await pb.collection("week_data").update(week.id, updatedWeek as any);
          } else {
            await pb.collection("week_data").create(updatedWeek as any);
          }

          await pb.collection("tasks").update(task.id, {
            status: "done",
            completedInWeek: currentWeek,
            completedAt: new Date().toISOString(),
          });

          return {
            ok: true,
            taskId: Number(task.taskId),
            title: task.title,
            assignee: memberName,
            pointsEarned: amount,
            completedInWeek: currentWeek,
          };
        });
      } catch (e: any) {
        result = { ok: false, error: `complete_task failed: ${e?.message}` };
      }
      return summarize(result);
    },
  },
  {
    definition: {
      name: "get_weekly_meals",
      description: "Get the family's meal plan for the week. Returns each day's meals with names, emojis, and meal types (breakfast/lunch/dinner).",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const meals = await db.selectMeals();
      let data = meals.length > 0 ? meals : defaultMeals;
      const byDay: Record<string, any[]> = {};
      for (const m of data) {
        const day = m.time || m.day || "unscheduled";
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push({
          name: m.name,
          emoji: m.emoji,
          mealType: m.mealType || "meal",
          prepTime: m.prepTime,
          calories: m.calories,
          servings: m.servings,
          tags: m.tags,
        });
      }
      return summarize(byDay);
    },
  },
  {
    definition: {
      name: "get_recipes",
      description: "Get the recipe catalog. Use this to suggest recipes or answer questions about what's available. Returns recipe names, prep times, calories, tags, and ingredients.",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Optional: filter by tag (e.g. 'Quick', 'Vegetarian', 'Healthy', 'Family Fave', 'Kids Love')" },
        },
      },
    },
    handler: async (args) => {
      const meals = await db.selectMeals();
      let recipes = meals.length > 0 ? meals.filter((m: any) => m.name && m.ingredients) : defaultMeals.filter((m: any) => m.name && m.ingredients);
      if (args.tag) {
        const tag = String(args.tag).toLowerCase();
        recipes = recipes.filter((r: any) => (r.tags || []).some((t: string) => t.toLowerCase().includes(tag)));
      }
      return summarize(recipes.map((r: any) => ({
        name: r.name,
        emoji: r.emoji || "🍽️",
        prepTime: r.prepTime,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        tags: r.tags,
        servings: r.servings,
        ingredients: r.ingredients,
        day: r.time || r.day,
      })));
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
      if (items.length === 0) items = initialGroceryItems;
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
      let items = await db.selectPantry();
      if (items.length === 0) {
        items = [
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
      }
      const byStatus: Record<string, any[]> = { plenty: [], low: [], out: [] };
      for (const i of items) {
        const status = i.status || "plenty";
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push({ name: i.name || i.item, category: i.category });
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
      const members = db.selectMembers();
      return summarize({
        note: "The leaderboard is updated in real-time on the Tasks tab. Points reset every Monday. Here are the current family members who participate:",
        members: members.map((m: any) => ({
          name: m.fullName || m.name,
          role: m.role,
          emoji: m.emoji,
        })),
        how_it_works:
          "Each completed task earns points. Weekly champion gets a crown badge. Points reset every Monday at midnight.",
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
      const inserted: Array<{ name: string; emoji: string; category: string }> = [];
      for (const name of names) {
        const row = await adminUpsertGroceryItem({ name, category, source: "chat" });
        if (row) {
          inserted.push({
            name: row.name || name,
            emoji: row.emoji || "🛒",
            category: row.category || category,
          });
        }
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
      const events = db.selectTodaysEvents();
      const tasks = db.selectPendingTasks();
      const meals = await db.selectMeals();
      const today = todayISO();
      const todayMeals = meals.filter((m: any) => {
        const day = m.time || m.day || "";
        return day.toLowerCase() === new Date().toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
      });
      return summarize({
        date: today,
        events: events.map((e: any) => ({ title: e.title, time: e.time, member: e.member })),
        pending_tasks: tasks.filter((t: any) => t.status === "pending" || !t.done).map((t: any) => ({
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
      const today = new Date().toISOString().split("T")[0];
      const items = await db.selectPendingSuggestions({ limit: 50, scopeDate: today });
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
      if (parsed && typeof parsed === "object" && parsed.error) {
        return JSON.stringify({ ok: false, error: parsed.error, tool: payload.tool, result: parsed });
      }
      await db.updateSuggestion(args.id, { status: "actioned" });
      return JSON.stringify({ ok: true, tool: payload.tool, args: payload.args || {}, result: parsed });
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
        const res = await fetch(`${base}/api/admin/version`, { signal: AbortSignal.timeout(10000) });
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
        const res = await fetch(`${base}/api/admin/containers`, { signal: AbortSignal.timeout(10000) });
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
          headers: { "Content-Type": "application/json" },
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
];

export function getAllTools(): Tool[] {
  return TOOLS;
}

export function getToolDefinitions(): ToolDefinition[] {
  return TOOLS.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}

export function buildToolsForOpenAI(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: ToolDefinition["parameters"] };
}> {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters,
    },
  }));
}
