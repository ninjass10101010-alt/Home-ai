import { db } from "@/db";
import { defaultMeals, mealIdeas, initialGroceryItems } from "@/data/meals";

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
      return summarize({
        added: {
          title: args.title,
          assigned_to: match ? (match.fullName || match.name) : args.assigned_to,
          points,
          due,
          priority,
        },
        note: "Task added to the dashboard (stored locally — will sync to Google Tasks when that integration is enabled).",
      });
    },
  },
  {
    definition: {
      name: "get_weekly_meals",
      description: "Get the family's meal plan for the week. Returns each day's meals with names, emojis, and meal types (breakfast/lunch/dinner).",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const meals = db.selectMeals();
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
      const meals = db.selectMeals();
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
      let items = db.selectGrocery();
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
      let items = db.selectPantry();
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
      const names = String(args.items).split(",").map((s: string) => s.trim()).filter(Boolean);
      const cat = args.category || "pantry";
      return summarize({
        added: names.map((n: string) => ({ name: n, category: cat, emoji: "🛒", priority: "medium", needed: true })),
        total: names.length,
        note: `${names.length} item(s) added to the grocery list. Check the Grocery tab in the dashboard.`,
      });
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
      const meals = db.selectMeals();
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
        const { wouldConflict } = await import("./conflict-detection");
        const result = await wouldConflict({
          newEvent: {
            summary: args.summary,
            start: args.start,
            end: args.end,
            location: args.location,
            attendees: args.attendees,
          },
          travelTimeMinutes: 15,
        });
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
