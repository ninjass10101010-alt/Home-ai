// Deficit math used to subtract raw numbers across incompatible units: a recipe
// asking for "2 cups Rice" against a pantry row of `500 g` computed
// 2 - 500 <= 0 and the ingredient silently vanished from the grocery list.
// Under-listing is the dangerous direction, so the rules pinned here are:
// compatible units convert, incompatible units LIST the item, and a pantry
// quantity with no unit at all is not a numeric claim we may contradict (the
// explicit plenty/low/out status decides).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  pantry: [] as any[],
  grocery: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    gatewayReadStatus: async (collection: string) => {
      if (collection === "meal_plan_entries") return { items: h.meals.map((m: any) => ({ ...m })), blocked: false };
      if (collection === "pantry_items") return { items: h.pantry.map((p: any) => ({ ...p })), blocked: false };
      return { items: h.grocery.map((g: any) => ({ ...g })), blocked: false };
    },
    selectMeals: async () => h.meals.map((m: any) => ({ ...m })),
    selectPantry: async () => h.pantry.map((p: any) => ({ ...p })),
    selectGrocery: async () => h.grocery.map((g: any) => ({ ...g })),
    upsertGroceryItem: async (item: any) => {
      const byId = item.id != null ? h.grocery.find((g: any) => String(g.id) === String(item.id)) : undefined;
      const existing = byId || h.grocery.find((g: any) => g.name?.toLowerCase() === item.name?.toLowerCase());
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

const meal = (ingredients: string[]) => [
  { id: "pb1", name: "Dinner", time: "Mon", ingredients, servings: 4 },
] as any[];

beforeEach(() => {
  h.meals = [];
  h.pantry = [];
  h.grocery = [];
  localStorage.clear();
});

describe("compatible units are converted before subtracting", () => {
  it("treats matching imperial mass units as real math (3 lb needed, 5 lb in stock → nothing to buy)", async () => {
    h.meals = meal(["3 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 5, unit: "lb" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(0);
    expect(h.grocery).toHaveLength(0);
  });

  it("subtracts converted units and lists only the real deficit (3 lb needed, 1 lb in stock → 2 lb)", async () => {
    h.meals = meal(["3 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "low", quantity: 1, unit: "lb" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0]).toMatchObject({ name: "Chicken breast", quantity: "2 lb" });
  });

  it("converts metric ↔ imperial mass (900 g in stock vs 2 lb needed → deficit in lb)", async () => {
    h.meals = meal(["2 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "low", quantity: 900, unit: "g" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    // 2 lb = 907 g; 907 - 900 = 7 g of a pound ≈ 0.015 lb → rounds to the 1-unit floor.
    expect(h.grocery[0].quantity).toBe("1 lb");
  });

  it("converts volume units (2000 ml needed vs 1 l in stock → 1000 ml short)", async () => {
    h.meals = meal(["2000 ml Milk"]);
    h.pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "low", quantity: 1, unit: "l" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("1000 ml");
  });

  it("converts spoons into millilitres instead of subtracting nonsense", async () => {
    h.meals = meal(["2 tbsp Olive oil"]);
    h.pantry = [{ id: "p1", item: "Olive oil", name: "Olive oil", status: "low", quantity: 20, unit: "ml" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    // 2 tbsp = 29.6 ml, so 20 ml in stock is 9.6 ml short ≈ 0.65 tbsp — the
    // old raw subtraction (2 − 20) called it fully stocked and listed nothing.
    // The deficit is reported back in the RECIPE's unit.
    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("1 tbsp");
  });

  it("uses an out-of-stock pantry row as fully needed", async () => {
    h.meals = meal(["2 cups Rice"]);
    h.pantry = [{ id: "p1", item: "Rice", name: "Rice", status: "out", quantity: 4, unit: "cups" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("2 cups");
  });
});

describe("incompatible units bias toward LISTING (never silently in-stock)", () => {
  it("lists a volume ingredient when the pantry only records a mass (2 cups vs 500 g)", async () => {
    h.meals = meal(["2 cups Rice"]);
    h.pantry = [{ id: "p1", item: "Rice", name: "Rice", status: "plenty", quantity: 500, unit: "g" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0]).toMatchObject({ name: "Rice", quantity: "2 cups" });
  });

  it("lists a countable ingredient when the pantry records grams (2 Chicken breast vs 500 g)", async () => {
    h.meals = meal(["2 Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 500, unit: "g" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0].name).toBe("Chicken breast");
  });

  it("lists an ingredient when the pantry records a count and the recipe asks for grams", async () => {
    h.meals = meal(["250 g Sugar"]);
    h.pantry = [{ id: "p1", item: "Sugar", name: "Sugar", status: "plenty", quantity: 3, unit: "can" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("250 g");
  });

  it("treats a pantry quantity with NO unit as status-driven, not as convertible stock", async () => {
    h.meals = meal(["3 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 5 }];

    const preview = mealSyncService.previewMealPlanToGrocery(h.meals, h.pantry as any, []);
    expect(preview.items).toHaveLength(0);
  });

  it("lists a unit-less pantry row whose status is low", async () => {
    h.meals = meal(["3 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "low", quantity: 5 }];

    const preview = mealSyncService.previewMealPlanToGrocery(h.meals, h.pantry as any, []);
    expect(preview.items.map((i) => i.name)).toEqual(["Chicken breast"]);
  });
});

describe("pantry quantity + unit reach the sync (they used to be dropped by the read)", () => {
  it("carries quantity and unit from PocketBase into the deficit math", async () => {
    h.meals = meal(["2 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 1, unit: "lb" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    // 2 lb needed − 1 lb in stock = 1 lb short. Before the read carried
    // quantity/unit this fell to status logic and produced "1 lb" by accident;
    // the assertion that matters is that a plenty row can still yield a deficit.
    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("1 lb");
  });

  it("coerces a numeric-string quantity from PocketBase", async () => {
    h.meals = meal(["3 lb Chicken breast"]);
    h.pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: "2", unit: "lb" }];

    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(1);
    expect(h.grocery[0].quantity).toBe("1 lb");
  });
});

describe("preview agrees with the commit", () => {
  it("previews exactly the item the sync would add for a unit mismatch", async () => {
    const meals = meal(["2 cups Rice"]);
    const pantry = [{ id: "p1", item: "Rice", name: "Rice", status: "plenty", quantity: 500, unit: "g" }] as any[];

    const preview = mealSyncService.previewMealPlanToGrocery(meals as any, pantry, []);
    expect(preview.items).toHaveLength(1);

    h.meals = meals;
    h.pantry = pantry;
    const result = await mealSyncService.syncMealPlanToGrocery("demo");

    expect(result.added).toBe(preview.items.length);
    expect(h.grocery[0].name).toBe(preview.items[0].name);
    expect(h.grocery[0].quantity).toBe(preview.items[0].quantity);
  });
});