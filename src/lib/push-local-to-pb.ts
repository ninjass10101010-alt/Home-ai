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

// Runs one item write and reports the outcome honestly. The browser db layer
// never throws on a failed gateway write (safeGatewayRow swallows the 401 and
// returns null), so counting must look at the RESULT: a returned row is a
// push, null or a throw is an error. The old `.then(() => pushed++)` counted
// swallowed failures as pushes — a fully-401'd push reported "Pushed N items"
// with errors: 0.
async function pushItem(fn: () => Promise<any>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

export async function pushLocalToPB(): Promise<{ collection: string; pushed: number; errors: number }[]> {
  const results: { collection: string; pushed: number; errors: number }[] = [];

  let pushed = 0;
  let errors = 0;

  // Grocery
  const grocery = loadJSON<any[]>("consuela-grocery", []);
  pushed = 0; errors = 0;
  if (grocery.length) {
    const outcomes = await Promise.all(
      grocery.map((item: any) => pushItem(() => db.upsertGroceryItem(item)))
    );
    pushed = outcomes.filter(Boolean).length;
    errors = outcomes.length - pushed;
  }
  results.push({ collection: "grocery_list_items", pushed, errors });

  // Pantry
  const pantry = loadJSON<any[]>("consuela-pantry", []);
  pushed = 0; errors = 0;
  if (pantry.length) {
    const outcomes = await Promise.all(
      pantry.map((item: any) =>
        pushItem(() => db.upsertPantryItem({ name: item.item || item.name, status: item.status || "plenty" }))
      )
    );
    pushed = outcomes.filter(Boolean).length;
    errors = outcomes.length - pushed;
  }
  results.push({ collection: "pantry_items", pushed, errors });

  // Meals (dedupe by name+weekOf so re-pushing a device's cache after a
  // partial sync doesn't duplicate rows the server already holds)
  const meals = loadJSON<any[]>("consuela-meals", []);
  pushed = 0; errors = 0;
  if (meals.length) {
    let existingMeals: any[] = [];
    try {
      existingMeals = await db.selectMeals();
    } catch { existingMeals = []; }
    const existingKeys = new Set(
      existingMeals.map((m: any) => `${m.name?.toLowerCase()}|${m.weekOf || ""}`)
    );
    const outcomes = await Promise.all(
      meals.map((meal: any) => {
        const key = `${meal.name?.toLowerCase()}|${meal.weekOf || ""}`;
        // Deduped meals resolve to null: neither a push nor an error.
        if (meal.name && existingKeys.has(key)) return Promise.resolve(null);
        return pushItem(() => db.insertMeal(meal)).then((ok) => (ok ? "pushed" : "error"));
      })
    );
    for (const outcome of outcomes) {
      if (outcome === "pushed") pushed++;
      else if (outcome === "error") errors++;
    }
  }
  results.push({ collection: "meal_plan_entries", pushed, errors });

  // Recipes
  const recipes = loadJSON<any[]>("consuela-recipes", []);
  pushed = 0; errors = 0;
  if (recipes.length) {
    const outcomes = await Promise.all(
      recipes.map((recipe: any) => pushItem(() => db.upsertRecipe(recipe)))
    );
    pushed = outcomes.filter(Boolean).length;
    errors = outcomes.length - pushed;
  }
  results.push({ collection: "recipes", pushed, errors });

  // Events (insert — no dedup check; runs once for initial migration)
  const events = loadJSON<any[]>("consuela-events", []);
  pushed = 0; errors = 0;
  if (events.length) {
    const outcomes = await Promise.all(
      events.map((ev: any) => pushItem(() => db.insertEvent(ev)))
    );
    pushed = outcomes.filter(Boolean).length;
    errors = outcomes.length - pushed;
  }
  results.push({ collection: "events", pushed, errors });

  // Schedules (insert — no dedup check; runs once for initial migration)
  const schedules = loadJSON<any[]>("consuela-schedules", []);
  pushed = 0; errors = 0;
  if (schedules.length) {
    const outcomes = await Promise.all(
      schedules.map((sch: any) => pushItem(() => db.insertSchedule(sch)))
    );
    pushed = outcomes.filter(Boolean).length;
    errors = outcomes.length - pushed;
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
    const outcomes = await Promise.all(
      contacts.map((c: any) => {
        // Deduped contacts resolve to null: neither a push nor an error.
        if (existingNames.has(c.name?.toLowerCase())) return Promise.resolve(null);
        return pushItem(() => db.insertEmergencyContact(c)).then((ok) => (ok ? "pushed" : "error"));
      })
    );
    for (const outcome of outcomes) {
      if (outcome === "pushed") pushed++;
      else if (outcome === "error") errors++;
    }
  }
  results.push({ collection: "emergency_contacts", pushed, errors });

  return results;
}
