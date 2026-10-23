import { db } from "@/db";

export const SAFE_LOCAL_PUSH_COLLECTIONS = Object.freeze([
  "grocery_list_items",
  "pantry_items",
  "meal_plan_entries",
  "recipes",
  "events",
  "schedules",
]);

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// An event without a real date is invisible on every screen (the calendar
// drops undated rows) and used to be inserted as an empty-date row on every
// push. Only dated events are worth migrating.
function hasUsableEventDate(event: any): boolean {
  return typeof event?.date === "string" && ISO_DATE_PATTERN.test(event.date.trim());
}

function eventKey(event: any): string {
  const title = String(event?.title ?? "").trim().toLowerCase();
  const date = String(event?.date ?? "").trim();
  return `${title}|${date}`;
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
    try {
      const existingMeals = await db.selectMealsAuthoritative();
      const existingKeys = new Set(
        existingMeals.map((m: any) => `${m.name?.toLowerCase()}|${m.weekOf || ""}`)
      );
      const outcomes = await Promise.all(
        meals.map((meal: any) => {
          const key = `${meal.name?.toLowerCase()}|${meal.weekOf || ""}`;
          if (meal.name && existingKeys.has(key)) return Promise.resolve(null);
          return pushItem(() => db.insertMeal(meal)).then((ok) => (ok ? "pushed" : "error"));
        })
      );
      for (const outcome of outcomes) {
        if (outcome === "pushed") pushed++;
        else if (outcome === "error") errors++;
      }
    } catch {
      errors = 1;
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

  // Events (dated rows only, deduped against the server so re-pushing the
  // same device cache cannot multiply rows)
  const events = loadJSON<any[]>("consuela-events", [])
    .filter((event: any) => event?.member !== "Google")
    .filter(hasUsableEventDate);
  pushed = 0; errors = 0;
  if (events.length) {
    try {
      const existingEvents = await db.selectEventsAuthoritative();
      const existingKeys = new Set(existingEvents.map(eventKey));
      const pushedKeys = new Set<string>();
      const outcomes = await Promise.all(
        events.map((ev: any) => {
          const key = eventKey(ev);
          if (existingKeys.has(key) || pushedKeys.has(key)) return Promise.resolve(null);
          pushedKeys.add(key);
          return pushItem(() => db.insertEvent(ev)).then((ok) => (ok ? "pushed" : "error"));
        })
      );
      for (const outcome of outcomes) {
        if (outcome === "pushed") pushed++;
        else if (outcome === "error") errors++;
      }
    } catch {
      errors = 1;
    }
  }
  results.push({ collection: "events", pushed, errors });

  // Schedules (dedupe by title+time+days so re-pushing a device's cache
  // after a partial sync doesn't duplicate rows the server already holds —
  // the push button is safe to tap more than once)
  const schedules = loadJSON<any[]>("consuela-schedules", []);
  pushed = 0; errors = 0;
  if (schedules.length) {
    try {
      const existingSchedules = await db.selectSchedulesAuthoritative();
      const existingKeys = new Set(
        existingSchedules.map((sch: any) =>
          `${String(sch.title || "").toLowerCase()}|${String(sch.time || "")}|${String(sch.days || "").toLowerCase()}`
        )
      );
      const outcomes = await Promise.all(
        schedules.map((sch: any) => {
          const key = `${String(sch.title || "").toLowerCase()}|${String(sch.time || "")}|${String(sch.days || "").toLowerCase()}`;
          if (existingKeys.has(key)) return Promise.resolve(null);
          return pushItem(() => db.insertSchedule(sch)).then((ok) => (ok ? "pushed" : "error"));
        })
      );
      for (const outcome of outcomes) {
        if (outcome === "pushed") pushed++;
        else if (outcome === "error") errors++;
      }
    } catch {
      errors = 1;
    }
  }
  results.push({ collection: "schedules", pushed, errors });

  return results;
}
