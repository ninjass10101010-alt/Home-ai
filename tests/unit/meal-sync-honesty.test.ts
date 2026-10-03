// The meal/grocery sync must never invent meals. An empty or blocked read of
// the family's real planner used to fall through to seven hardcoded demo meals
// whose ~30 ingredients were written into the REAL grocery list in PocketBase
// (mealSync.ts getScheduledMeals demo fallback). Under-listing and fake
// successes are the same family of bug: this file pins "no writes, honest
// failure" for every empty/failed/blocked read, plus the sweep-ownership rule
// (the meal-plan sweep may only retire rows it owns — never pantry-check rows).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  pantry: [] as any[],
  grocery: [] as any[],
  mealsBlocked: false,
  pantryBlocked: false,
  pantryThrows: false,
  groceryThrows: false,
  mealsThrow: false,
  upserts: [] as any[],
  failUpserts: false,
}));

vi.mock("@/db", () => ({
  db: {
    // The honest read seam: reports blocked reads instead of swallowing them
    // into an indistinguishable empty list.
    gatewayReadStatus: async (collection: string) => {
      if (collection === "meal_plan_entries") {
        if (h.mealsThrow) throw new Error("gateway 500");
        return h.mealsBlocked
          ? { items: [], blocked: true }
          : { items: h.meals.map((m: any) => ({ ...m })), blocked: false };
      }
      if (collection === "pantry_items") {
        if (h.pantryThrows) throw new Error("gateway 500");
        return h.pantryBlocked
          ? { items: [], blocked: true }
          : { items: h.pantry.map((p: any) => ({ ...p })), blocked: false };
      }
      if (h.groceryThrows) throw new Error("gateway 500");
      return { items: h.grocery.map((g: any) => ({ ...g })), blocked: false };
    },
    selectMeals: async () => {
      if (h.mealsThrow) throw new Error("gateway 500");
      return h.meals.map((m: any) => ({ ...m }));
    },
    selectPantry: async () => {
      if (h.pantryThrows) throw new Error("gateway 500");
      return h.pantry.map((p: any) => ({ ...p }));
    },
    selectGrocery: async () => {
      if (h.groceryThrows) throw new Error("gateway 500");
      return h.grocery.map((g: any) => ({ ...g }));
    },
    upsertGroceryItem: async (item: any) => {
      h.upserts.push(item);
      if (h.failUpserts) return null;
      const byId = item.id != null ? h.grocery.find((g) => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.grocery.find((g) => g.name?.toLowerCase() === item.name?.toLowerCase());
      const { id: _omit, ...data } = item;
      if (existing) { Object.assign(existing, data); return { ...existing }; }
      if (!data.name) return null;
      const rec = { id: `g_${h.grocery.length + 1}`, ...data };
      h.grocery.push(rec);
      return { ...rec };
    },
    toggleGroceryOverride: async () => null,
  },
}));

import { mealSyncService } from "@/services/mealSync";

// The opt-in seed surface is imported lazily so this file also runs (and fails
// on the bug) against a build that does not have it yet.
const seedSurface = () => import("@/services/mealSync");

describe("mealSyncService never substitutes demo meals for an empty/failed read (P0)", () => {
  beforeEach(() => {
    h.meals = [];
    h.pantry = [];
    h.grocery = [];
    h.mealsBlocked = false;
    h.pantryBlocked = false;
    h.pantryThrows = false;
    h.groceryThrows = false;
    h.mealsThrow = false;
    h.upserts = [];
    h.failUpserts = false;
    localStorage.clear();
  });

  it("writes NOTHING and fails honestly when the meal read comes back empty (fresh install)", async () => {
    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.upserts).toHaveLength(0);
    expect(h.grocery).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.reason).toBe("no_meals_planned");
    expect(result.message).toBeTruthy();
  });

  it("never writes a demo-meal ingredient into the real grocery list", async () => {
    await mealSyncService.syncMealPlanToGrocery("demo");

    const { DEMO_MEAL_SEED } = await seedSurface();
    const demoIngredients = DEMO_MEAL_SEED.flatMap((m) => m.ingredients).map((n) => n.toLowerCase());
    expect(demoIngredients.length).toBeGreaterThan(20); // the seed really is ~30 ingredients

    const written = h.grocery.map((g: any) => String(g.name || "").toLowerCase());
    expect(written.length).toBe(0);
    for (const name of written) {
      expect(demoIngredients).not.toContain(name);
    }
  });

  it("writes NOTHING when the meal read is blocked (signed-out / gateway 401)", async () => {
    h.mealsBlocked = true;
    localStorage.setItem("consuela-meals", JSON.stringify([{ id: 1, name: "Cached Tacos", time: "Mon", ingredients: ["Taco shells"] }]));

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.upserts).toHaveLength(0);
    expect(h.grocery).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("meals_read_blocked");
  });

  it("reports a real failure when the meal read throws (never a fake +0 success)", async () => {
    h.mealsThrow = true;
    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.upserts).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("meals_read_failed");
  });

  it("uses the local cache when PB is empty but the cache has real meals", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([{ id: 1, name: "Cached Tacos", time: "Mon", ingredients: ["2 lb Chicken breast"], servings: 4 }])
    );

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.ok).toBe(true);
    expect(result.mealsRead).toBe("local-cache");
    expect(h.grocery.map((g: any) => g.name)).toEqual(["Chicken breast"]);
  });

  it("honors an EXPLICITLY opted-in demo seed instead of deleting it", async () => {
    const { MealSyncService } = await seedSurface();
    const seeded = new MealSyncService({ allowDemoSeed: true });
    const result = await seeded.syncMealPlanToGrocery("demo");

    expect(result.ok).toBe(true);
    expect(result.mealsRead).toBe("demo-seed");
    expect(h.grocery.length).toBeGreaterThan(20);
  });

  it("syncs real planned meals normally (no regression on the happy path)", async () => {
    h.meals.push({ id: "pb1", name: "Taco Night", time: "Tue", ingredients: ["2 lb Ground beef"], servings: 4 });
    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.ok).toBe(true);
    expect(result.mealsRead).toBe("pb");
    expect(result.added).toBe(1);
    expect(h.grocery[0]).toMatchObject({ name: "Ground beef", source: "meal-plan", needed: true });
  });

  it("uses the caller's plannedMeals without touching the meal read", async () => {
    const result = await mealSyncService.syncMealPlanToGrocery("demo", [
      { id: 9, name: "Caller Meal", emoji: "🍽️", time: "Wed", prepTime: "10 min", tags: [], ingredients: ["1 lb Salmon"], servings: 2, calories: 300 } as any,
    ]);

    expect(result.ok).toBe(true);
    expect(result.mealsRead).toBe("provided");
    expect(h.grocery.map((g: any) => g.name)).toEqual(["Salmon"]);
  });
});

describe("mealSyncService pantry/grocery read failures are destructive-free", () => {
  beforeEach(() => {
    h.meals = [];
    h.pantry = [];
    h.grocery = [];
    h.mealsBlocked = false;
    h.pantryBlocked = false;
    h.pantryThrows = false;
    h.groceryThrows = false;
    h.mealsThrow = false;
    h.upserts = [];
    h.failUpserts = false;
    localStorage.clear();
  });

  it("does NOT retire grocery rows when the pantry read fails", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.grocery.push({ id: "g_1", name: "Old item", source: "meal-plan", autoGenerated: true, needed: true });
    h.pantryThrows = true;

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pantry_read_failed");
    // The dangerous half: an unread pantry must not look like "nothing is required".
    expect(h.upserts.filter((u: any) => u.needed === false)).toHaveLength(0);
    expect(h.grocery[0].needed).toBe(true);
  });

  it("does NOT retire grocery rows when the grocery read fails", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.groceryThrows = true;

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("grocery_read_failed");
  });

  it("syncPantryToGrocery fails honestly when the pantry read fails", async () => {
    h.pantryThrows = true;
    const result = await mealSyncService.syncPantryToGrocery("demo");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pantry_read_failed");
    expect(h.upserts).toHaveLength(0);
  });

  it("counts a write that PB refused as a write failure, not a success", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.failUpserts = true;

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(0);
    expect(result.writeFailures).toBeGreaterThan(0);
    // Nothing landed, so it is a failure — never "✅ Synced +0 items".
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("grocery_write_failed");
  });
});

describe("mealSyncService meal-plan sweep owns only its own rows", () => {
  beforeEach(() => {
    h.meals = [];
    h.pantry = [];
    h.grocery = [];
    h.mealsBlocked = false;
    h.pantryBlocked = false;
    h.pantryThrows = false;
    h.groceryThrows = false;
    h.mealsThrow = false;
    h.upserts = [];
    h.failUpserts = false;
    localStorage.clear();
  });

  it("keeps an out-of-stock pantry-check staple needed:true after a meal-plan sync", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.grocery.push({ id: "g_1", name: "Olive oil", source: "pantry-check", autoGenerated: true, needed: true });

    await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.grocery.find((g: any) => g.id === "g_1")?.needed).toBe(true);
  });

  it("keeps a manually overridden pantry-check row needed:true", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.grocery.push({ id: "g_1", name: "Olive oil", source: "pantry-check", manualOverride: true, needed: true });

    await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.grocery.find((g: any) => g.id === "g_1")?.needed).toBe(true);
  });

  it("still retires a stale meal-plan row the plan no longer requires", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["1 lb Shrimp"], servings: 4 });
    h.grocery.push({ id: "g_1", name: "Cilantro", source: "meal-plan", autoGenerated: true, needed: true });

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(h.grocery.find((g: any) => g.id === "g_1")?.needed).toBe(false);
    expect(result.removed).toBe(1);
  });

  it("does not duplicate a pantry-check row the meal plan also needs", async () => {
    h.meals.push({ id: "pb1", name: "Stir Fry", time: "Thu", ingredients: ["3 lb Olive oil"], servings: 4 });
    h.grocery.push({ id: "g_1", name: "Olive oil", source: "pantry-check", autoGenerated: true, needed: true });

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(h.grocery).toHaveLength(1);
    // Still the pantry sync's row, still needed.
    expect(h.grocery[0].source).toBe("pantry-check");
    expect(h.grocery[0].needed).toBe(true);
    expect(h.grocery[0].quantity).toBe("3 lb");
  });

  it("syncPantryToGrocery keeps a meal-plan row's real source when refreshing it", async () => {
    h.pantry.push({ id: "p_1", name: "Shrimp", status: "low" });
    h.grocery.push({ id: "g_1", name: "Shrimp", source: "meal-plan", autoGenerated: true, needed: true });

    await mealSyncService.syncPantryToGrocery("demo");

    expect(h.grocery[0].source).toBe("meal-plan");
    expect(h.grocery[0].needed).toBe(true);
  });
});