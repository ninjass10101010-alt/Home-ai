// @vitest-environment jsdom
// Honest counting for the Settings "Push local data to cloud" flow. In the
// browser the db layer NEVER throws on a failed gateway write —
// safeGatewayRow swallows the 401 and returns null — so `.then(() => pushed++)`
// counted swallowed failures as pushes and the toast reported fake success
// ("Pushed N items", errors: 0) for a fully-blocked push.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  recipes: [] as any[],
  insertMealOk: false,
  upsertRecipeOk: false,
  groceryThrows: false,
  insertedMeals: [] as any[],
  upsertedRecipes: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    selectMeals: async () => h.meals.map((m) => ({ ...m })),
    insertMeal: async (meal: any) => {
      h.insertedMeals.push(meal);
      return h.insertMealOk ? { ...meal, id: "pb_new" } : null;
    },
    upsertRecipe: async (recipe: any) => {
      h.upsertedRecipes.push(recipe);
      return h.upsertRecipeOk ? { ...recipe, id: "pb_r" } : null;
    },
    upsertGroceryItem: async () => {
      if (h.groceryThrows) throw new Error("gateway_create_failed:401");
      return null;
    },
    upsertPantryItem: async () => null,
    insertEvent: async () => null,
    insertSchedule: async () => null,
    selectEmergencyContacts: async () => [],
    insertEmergencyContact: async () => null,
  },
}));

vi.mock("@/lib/task-utils", () => ({
  syncAllTasksToPB: async () => ({}),
  syncFamilyGoalToPB: async () => ({}),
}));

import { pushLocalToPB } from "@/lib/push-local-to-pb";

beforeEach(() => {
  localStorage.clear();
  h.meals = [];
  h.recipes = [];
  h.insertMealOk = false;
  h.upsertRecipeOk = false;
  h.groceryThrows = false;
  h.insertedMeals = [];
  h.upsertedRecipes = [];
});

describe("pushLocalToPB honest counts", () => {
  it("counts 401-swallowed meal write failures as errors, not pushes", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([
        { id: 1, name: "Tacos", time: "Mon", mealType: "dinner", weekOf: "2026-08-31" },
        { id: 2, name: "Soup", time: "Tue", mealType: "dinner", weekOf: "2026-08-31" },
      ])
    );
    h.insertMealOk = false; // browser path: safeGatewayRow swallows the 401 → null

    const results = await pushLocalToPB();
    const mealsResult = results.find((r) => r.collection === "meal_plan_entries");
    expect(mealsResult?.pushed).toBe(0);
    expect(mealsResult?.errors).toBe(2);
  });

  it("counts recipe write failures honestly", async () => {
    localStorage.setItem(
      "consuela-recipes",
      JSON.stringify([
        { id: 1, name: "Casserole", ingredients: ["Eggs"], tags: ["Homemade"] },
        { id: 2, name: "Stew", ingredients: [], tags: [] },
        { id: 3, name: "Salad", ingredients: [], tags: [] },
      ])
    );
    h.upsertRecipeOk = false;

    const results = await pushLocalToPB();
    const recipesResult = results.find((r) => r.collection === "recipes");
    expect(recipesResult?.pushed).toBe(0);
    expect(recipesResult?.errors).toBe(3);
  });

  it("counts successful meal pushes with no errors", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([
        { id: 1, name: "Tacos", time: "Mon", mealType: "dinner", weekOf: "2026-08-31" },
      ])
    );
    h.insertMealOk = true;

    const results = await pushLocalToPB();
    const mealsResult = results.find((r) => r.collection === "meal_plan_entries");
    expect(mealsResult?.pushed).toBe(1);
    expect(mealsResult?.errors).toBe(0);
  });

  it("still dedupes meals the server already holds (no push, no error)", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([
        { id: 1, name: "Pizza", time: "Mon", mealType: "dinner", weekOf: "2026-08-31" },
        { id: 2, name: "Curry", time: "Tue", mealType: "dinner", weekOf: "2026-08-31" },
      ])
    );
    h.meals.push({ id: "pb_1", name: "Pizza", weekOf: "2026-08-31" });
    h.insertMealOk = true;

    const results = await pushLocalToPB();
    const mealsResult = results.find((r) => r.collection === "meal_plan_entries");
    expect(mealsResult?.pushed).toBe(1);
    expect(mealsResult?.errors).toBe(0);
    expect(h.insertedMeals.map((m) => m.name)).toEqual(["Curry"]);
  });

  it("counts THROWN write errors on the first collection (no results[-1] TypeError path)", async () => {
    localStorage.setItem(
      "consuela-grocery",
      JSON.stringify([{ name: "Milk" }, { name: "Eggs" }])
    );
    h.groceryThrows = true;

    const results = await pushLocalToPB();
    const groceryResult = results.find((r) => r.collection === "grocery_list_items");
    expect(groceryResult?.pushed).toBe(0);
    expect(groceryResult?.errors).toBe(2);
  });

  it("keeps the results-array shape the Settings toast consumes (collection/pushed/errors)", async () => {
    const results = await pushLocalToPB();
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r.collection).toBe("string");
      expect(typeof r.pushed).toBe("number");
      expect(typeof r.errors).toBe("number");
    }
    const collections = results.map((r) => r.collection);
    expect(collections).toEqual([
      "grocery_list_items",
      "pantry_items",
      "meal_plan_entries",
      "recipes",
      "events",
      "schedules",
      "tasks/leaderboard (6 collections)",
      "family_goals",
      "emergency_contacts",
    ]);
  });
});
