import { db } from "@/db";
import { upsertGroceryItem } from "./grocery-service";
import { saveOrQueue } from "./pending-writes";

export type LocalActionType =
  | "event"
  | "meal"
  | "task"
  | "grocery"
  | "pantry"
  | "recipe"
  | "reward"
  | "clear"
  | "schedule";

export type HermesActionType =
  | LocalActionType
  | "add_event"
  | "remove_event"
  | "add_task"
  | "complete_task"
  | "clear_leaderboard"
  | "add_meal"
  | "remove_meal"
  | "update_grocery"
  | "update_pantry"
  | "send_message";

export interface ActionCard {
  type: HermesActionType;
  title: string;
  detail?: string;
  emoji?: string;
  data?: any;
  confirmed?: boolean;
}

export async function runAction(action: ActionCard): Promise<{ success: boolean; message: string }> {
  try {
    const payload = (action as any).data;
    const detailFromAction = action.detail;

    const getEmoji = () => action.emoji || payload?.emoji || "✨";
    const getTitle = () => action.title || payload?.title || action.detail || "";

    const getDetailString = () => {
      if (typeof detailFromAction === "string") return detailFromAction;
      if (typeof payload === "string") return payload;
      if (payload && typeof payload === "object") {
        if (payload?.assignedTo && payload?.points) {
          return `${payload.assignedTo} ${payload.points}pts`;
        }
        if (payload?.member && payload?.time) {
          return `${payload.member} · ${payload.time}`;
        }
        if (payload?.items && Array.isArray(payload.items)) {
          return payload.items.join("· ");
        }
      }
      return "";
    };

    const normalizedAction: ActionCard = {
      ...action,
      title: getTitle(),
      emoji: getEmoji(),
      detail: getDetailString(),
    };

    // Map Hermes-native action types to local handlers
    let mappedType = normalizedAction.type;
    if (mappedType === "add_event" || mappedType === "remove_event") mappedType = "event";
    if (mappedType === "add_task" || mappedType === "complete_task") mappedType = "task";
    if (mappedType === "clear_leaderboard") mappedType = "clear";
    if (mappedType === "add_meal" || mappedType === "remove_meal") mappedType = "meal";
    if (mappedType === "update_grocery") mappedType = "grocery";
    if (mappedType === "update_pantry") mappedType = "pantry";
    const isRemove = normalizedAction.type === "remove_event" || normalizedAction.type === "remove_meal";

    switch (mappedType) {
      case "meal": {
        const MEALS_KEY = "consuela-meals";
        if (isRemove) {
          if (typeof window !== "undefined") {
            try {
              const stored = localStorage.getItem(MEALS_KEY);
              const meals: any[] = stored ? JSON.parse(stored) : [];
              const targetName = action.title || payload?.name || payload?.title || "";
              const filtered = meals.filter((m: any) =>
                !targetName || !m.name?.toLowerCase().includes(targetName.toLowerCase()));
              localStorage.setItem(MEALS_KEY, JSON.stringify(filtered));
            } catch {}
          }
          try { await db.selectMeals(); } catch {}
          return { success: true, message: `Removed meal "${action.title || payload?.name || payload?.title || ""}"` };
        }
        const dayMatch = normalizedAction.detail?.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
        const dayMap: Record<string, string> = {
          monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
          friday: "Fri", saturday: "Sat", sunday: "Sun",
        };
        let day = "Mon";
        if (dayMatch) {
          const raw = dayMatch[1].toLowerCase();
          day = dayMap[raw] || raw.charAt(0).toUpperCase() + raw.slice(1, 3);
        }
        const typeMatch = normalizedAction.detail?.match(/\b(breakfast|lunch|dinner|snack)\b/i);
        const mealType = typeMatch ? typeMatch[1].toLowerCase() as any : "dinner";
        const newMeal = {
          id: Date.now(),
          name: action.title,
          emoji: action.emoji || "🍽️",
          time: day,
          mealType,
          prepTime: "30 min",
          tags: ["AI Suggested"],
          ingredients: [] as string[],
          servings: 4,
          calories: 500,
          userId: "demo",
        };
        await saveOrQueue(
          {
            key: `meal:create:${newMeal.name}|${newMeal.time}|${newMeal.mealType}|`,
            collection: "meal_plan_entries",
            op: "create",
            payload: newMeal,
            queuedAt: new Date().toISOString(),
          },
          () => db.insertMeal(newMeal)
        );
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(MEALS_KEY);
            const meals = stored ? JSON.parse(stored) : [];
            meals.push(newMeal);
            localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
          } catch {}
        }
        return { success: true, message: `Added "${action.title}" to ${day}` };
      }
      case "task": {
        const TASKS_KEY = "consuela-tasks";
        const isComplete = normalizedAction.type === "complete_task";
        if (isComplete) {
          if (typeof window !== "undefined") {
            try {
              const stored = localStorage.getItem(TASKS_KEY);
              const tasks: any[] = stored ? JSON.parse(stored) : [];
              const targetName = action.title || payload?.title || "";
              const updated = tasks.map((t: any) =>
                t.title?.toLowerCase().includes(targetName.toLowerCase()) ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
              );
              localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
            } catch {}
          }
          return { success: true, message: `Completed task "${action.title || payload?.title || ""}"` };
        }
        const stored = (() => {
          if (typeof window === "undefined") return [];
          try { const d = localStorage.getItem(TASKS_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
        })();
        const members = db.selectMembers();
        const assignee = action.detail?.match(/^(\w+)/)?.[1] || payload?.assignedTo || members[0]?.name || "Caspian";
        const member = members.find((m: any) => m.name === assignee || m.name.startsWith(assignee));
        const points = parseInt(action.detail?.match(/(\d+)\s*pts?/)?.[1] || payload?.points || "10");
        stored.push({
          id: Date.now(), title: action.title || payload?.title, assignee: member?.name || assignee,
          assigneeEmoji: member?.emoji || "🧒", due: "Today", points,
          recurring: null, category: "AI Suggested", completed: false, priority: "medium" as const,
        });
        if (typeof window !== "undefined") localStorage.setItem(TASKS_KEY, JSON.stringify(stored));
        return { success: true, message: `Created task "${action.title}" for ${member?.name || assignee} (${points}pts)` };
      }
      case "grocery": {
        const items = payload?.items || [action.title || payload?.name];
        for (const item of items) {
          await upsertGroceryItem({
            name: typeof item === "string" ? item : item.name || item,
            category: "pantry",
            aisle: "1",
            quantity: "1",
            priority: "medium",
            source: "ai",
            autoGenerated: false,
          });
        }
        return { success: true, message: `Added ${items.length} item(s) to grocery list` };
      }
      case "pantry": {
        const items = payload?.items || [action.title || payload?.name];
        const PANTRY_KEY = "consuela-pantry";
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(PANTRY_KEY);
            const pantry: any[] = stored ? JSON.parse(stored) : [];
            for (const item of items) {
              const name = typeof item === "string" ? item : item.name || item;
              pantry.push({ id: Date.now() + Math.random(), name, emoji: "🥫", quantity: 1, category: "pantry", stocked: true });
            }
            localStorage.setItem(PANTRY_KEY, JSON.stringify(pantry));
          } catch {}
        }
        return { success: true, message: `Added ${items.length} item(s) to pantry` };
      }
      case "event": {
        const EVENTS_KEY = "consuela-events";
        if (isRemove) {
          if (typeof window !== "undefined") {
            try {
              const stored = localStorage.getItem(EVENTS_KEY);
              const events: any[] = stored ? JSON.parse(stored) : [];
              const targetName = action.title || payload?.title || "";
              const filtered = events.filter((e: any) =>
                !targetName || !e.title?.toLowerCase().includes(targetName.toLowerCase()));
              localStorage.setItem(EVENTS_KEY, JSON.stringify(filtered));
            } catch {}
          }
          return { success: true, message: `Removed event "${action.title || payload?.title || ""}"` };
        }
        const stored = (() => {
          if (typeof window === "undefined") return [];
          try { const d = localStorage.getItem(EVENTS_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
        })();
        stored.push({
          id: Date.now(), title: action.title, time: payload?.time || "4:00 PM",
          member: action.detail?.split("·")?.[0]?.trim() || payload?.member || "All",
          color: "green" as const, emoji: action.emoji || payload?.emoji || "📅", day: new Date().getDate(),
        });
        if (typeof window !== "undefined") localStorage.setItem(EVENTS_KEY, JSON.stringify(stored));
        return { success: true, message: `Added event "${action.title}"` };
      }
      case "recipe": {
        const RECIPES_KEY = "consuela-recipes";
        const newRecipe = {
          id: Date.now(),
          name: action.title,
          emoji: action.emoji || "📖",
          prepTime: action.detail?.match(/(\d+\s*min)/)?.[1] || "30 min",
          tags: ["AI Created"],
          ingredients: action.detail?.split("·").map((s: string) => s.trim()).filter(Boolean) || [],
          instructions: action.detail || "",
          servings: 4,
          calories: 500,
          createdAt: new Date().toISOString(),
        };
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(RECIPES_KEY);
            const recipes = stored ? JSON.parse(stored) : [];
            recipes.push(newRecipe);
            localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
          } catch {}
        }
        return { success: true, message: `Created recipe "${action.title}"` };
      }
      case "reward": {
        const REWARDS_KEY = "consuela-rewards";
        const points = parseInt(action.detail?.match(/(\d+)/)?.[1] || "50");
        const newReward = { id: Date.now(), name: action.title, emoji: action.emoji || "🎁", cost: points };
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(REWARDS_KEY);
            const rewards = stored ? JSON.parse(stored) : [];
            rewards.push(newReward);
            localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards));
          } catch {}
        }
        return { success: true, message: `Added reward "${action.title}" (${points}pts)` };
      }
      case "clear": {
        if (typeof window !== "undefined") {
          localStorage.removeItem("consuela-points");
          localStorage.removeItem("consuela-week-points");
          localStorage.removeItem("consuela-week-transactions");
        }
        return { success: true, message: "Cleared leaderboard — all points reset!" };
      }
      default:
        return { success: false, message: `Unknown action type` };
    }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed" };
  }
}
