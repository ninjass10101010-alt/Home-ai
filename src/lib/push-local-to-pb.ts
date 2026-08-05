import { db } from "@/db";
import { syncAllTasksToPB, syncFamilyGoalToPB } from "@/lib/task-utils";

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTaskCollection(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.tasks) return data.tasks;
  return Object.values(data).filter((v: any) => v && typeof v === "object");
}

export async function pushLocalToPB(): Promise<{ collection: string; pushed: number; errors: number }[]> {
  const results: { collection: string; pushed: number; errors: number }[] = [];

  const track = async <T>(collection: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      results[results.length - 1].errors++;
      throw undefined;
    }
  };

  let pushed = 0;
  let errors = 0;

  // Grocery
  const grocery = loadJSON<any[]>("consuela-grocery", []);
  pushed = 0; errors = 0;
  if (grocery.length) {
    await Promise.allSettled(
      grocery.map((item: any) =>
        track("grocery_list_items", () => db.upsertGroceryItem(item))
          .then(() => pushed++)
          .catch(() => {})
      )
    );
  }
  results.push({ collection: "grocery_list_items", pushed, errors });

  // Pantry
  const pantry = loadJSON<any[]>("consuela-pantry", []);
  pushed = 0; errors = 0;
  if (pantry.length) {
    await Promise.allSettled(
      pantry.map((item: any) =>
        track("pantry_items", () =>
          db.upsertPantryItem({ name: item.item || item.name, status: item.status || "plenty" })
        ).then(() => pushed++).catch(() => {})
      )
    );
  }
  results.push({ collection: "pantry_items", pushed, errors });

  // Meals (insert — no dedup check; runs once for initial migration)
  const meals = loadJSON<any[]>("consuela-meals", []);
  pushed = 0; errors = 0;
  if (meals.length) {
    await Promise.allSettled(
      meals.map((meal: any) =>
        track("meal_plan_entries", () => db.insertMeal(meal))
          .then(() => pushed++).catch(() => {})
      )
    );
  }
  results.push({ collection: "meal_plan_entries", pushed, errors });

  // Recipes
  const recipes = loadJSON<any[]>("consuela-recipes", []);
  pushed = 0; errors = 0;
  if (recipes.length) {
    await Promise.allSettled(
      recipes.map((recipe: any) =>
        track("recipes", () => db.upsertRecipe(recipe))
          .then(() => pushed++).catch(() => {})
      )
    );
  }
  results.push({ collection: "recipes", pushed, errors });

  // Events (insert — no dedup check; runs once for initial migration)
  const events = loadJSON<any[]>("consuela-events", []);
  pushed = 0; errors = 0;
  if (events.length) {
    await Promise.allSettled(
      events.map((ev: any) =>
        track("events", () => db.insertEvent(ev))
          .then(() => pushed++).catch(() => {})
      )
    );
  }
  results.push({ collection: "events", pushed, errors });

  // Schedules (insert — no dedup check; runs once for initial migration)
  const schedules = loadJSON<any[]>("consuela-schedules", []);
  pushed = 0; errors = 0;
  if (schedules.length) {
    await Promise.allSettled(
      schedules.map((sch: any) =>
        track("schedules", () => db.insertSchedule(sch))
          .then(() => pushed++).catch(() => {})
      )
    );
  }
  results.push({ collection: "schedules", pushed, errors });

  // Tasks / Leaderboard (already has syncAllTasksToPB)
  const tasks = loadJSON<any>("consuela-tasks", []);
  const weekData = loadJSON<any>("consuela-week-data", null);
  const archive = loadJSON<any>("consuela-week-archive", []);
  const rewards = loadJSON<any>("consuela-rewards", []);
  const penalties = loadJSON<any>("consuela-penalties", []);
  const hallOfFame = loadJSON<any>("consuela-hall-of-fame", []);
  pushed = 0; errors = 0;
  try {
    await syncAllTasksToPB(
      normalizeTaskCollection(tasks),
      weekData,
      archive,
      rewards,
      penalties,
      hallOfFame
    );
    pushed = 1;
  } catch {
    errors = 1;
  }
  results.push({ collection: "tasks/leaderboard (6 collections)", pushed, errors });

  // Family Goal (separate upsert)
  const familyGoal = loadJSON<any>("consuela-family-goal", null);
  pushed = 0; errors = 0;
  if (familyGoal) {
    try {
      await syncFamilyGoalToPB(familyGoal);
      pushed = 1;
    } catch {
      errors = 1;
    }
  }
  results.push({ collection: "family_goals", pushed, errors });

  // Emergency Contacts
  const contacts = loadJSON<any[]>("consuela-emergency-contacts", []);
  pushed = 0; errors = 0;
  if (contacts.length) {
    const existing = await db.selectEmergencyContacts();
    const existingNames = new Set(existing.map((c: any) => c.name?.toLowerCase()));
    await Promise.allSettled(
      contacts.map((c: any) => {
        if (existingNames.has(c.name?.toLowerCase())) return;
        return Promise.resolve()
          .then(() => db.insertEmergencyContact(c))
          .then(() => pushed++)
          .catch(() => {});
      })
    );
  }
  results.push({ collection: "emergency_contacts", pushed, errors });

  return results;
}
