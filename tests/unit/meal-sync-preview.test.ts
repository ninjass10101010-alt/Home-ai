import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[], pantry: [] as any[], meals: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    selectMeals: async () => h.state.meals.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => ({ id: "g_new", ...item }),
  },
}));

import { mealSyncService } from "@/services/mealSync";

describe("mealSyncService.previewMealPlanToGrocery", () => {
  it("lists missing ingredients not in pantry or grocery", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, [], []);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ name: "Chicken breast", quantity: "3 lb", category: "meat", priority: "high" });
    expect(preview.alreadyOnList).toBe(0);
  });

  it("counts an ingredient already on the grocery list as alreadyOnList, not a new item", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const grocery = [{ id: "g1", name: "Chicken breast", source: "meal-plan", manualOverride: false, needed: true } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, [], grocery);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(1);
  });

  it("skips ingredients already stocked in the pantry (no deficit)", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 5 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, pantry, []);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(0);
  });

  it("treats pantry items that only have `item` (no `name`) as stock", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["2 cups Rice"], servings: 4 } as any];
    const pantry = [{ id: "p1", item: "Rice", status: "plenty", quantity: 5 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, pantry, []);
    expect(preview.items).toHaveLength(0);
  });
});

describe("mealSyncService.previewPantryToGrocery", () => {
  it("lists low/out pantry items not already on the grocery list", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "low" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ name: "Milk", quantity: "1", category: "dairy", priority: "medium" });
  });

  it("marks out-of-stock items high priority", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "out" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items[0].priority).toBe("high");
  });

  it("counts items already on the grocery list as alreadyOnList", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "out" } as any];
    const grocery = [{ id: "g1", name: "Milk", source: "pantry-check", manualOverride: false, needed: true } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, grocery);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(1);
  });

  it("skips pantry items that are plenty", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "plenty" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items).toHaveLength(0);
  });
});
