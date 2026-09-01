// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ meals: [] as any[], inserted: [] as any[] }));

vi.mock("@/db", () => ({
  db: {
    selectMeals: async () => h.meals.map((m) => ({ ...m })),
    insertMeal: async (meal: any) => {
      h.inserted.push(meal);
      return { ...meal, id: `pb_${h.inserted.length}` };
    },
    upsertGroceryItem: async () => ({ id: "g" }),
    upsertPantryItem: async () => ({ id: "p" }),
    upsertRecipe: async () => ({ id: "r" }),
    insertEvent: async () => ({ id: "e" }),
    insertSchedule: async () => ({ id: "s" }),
    selectEmergencyContacts: async () => [],
    insertEmergencyContact: async () => ({ id: "c" }),
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
  h.inserted = [];
});

describe("pushLocalToPB meals dedupe", () => {
  it("skips meals the server already holds (same name + weekOf)", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([
        { id: 1, name: "Chicken Nuggets", time: "Mon", mealType: "dinner", weekOf: "2026-08-31" },
        { id: 2, name: "New Soup", time: "Tue", mealType: "dinner", weekOf: "2026-08-31" },
      ])
    );
    h.meals.push({ id: "pb_1", name: "Chicken Nuggets", weekOf: "2026-08-31" });

    const results = await pushLocalToPB();
    const mealsResult = results.find((r) => r.collection === "meal_plan_entries");
    expect(mealsResult?.pushed).toBe(1);
    expect(h.inserted.map((m) => m.name)).toEqual(["New Soup"]);
  });

  it("pushes everything when the server has no meals", async () => {
    localStorage.setItem(
      "consuela-meals",
      JSON.stringify([
        { id: 1, name: "Tacos", time: "Mon", mealType: "dinner", weekOf: "2026-08-31" },
      ])
    );

    const results = await pushLocalToPB();
    const mealsResult = results.find((r) => r.collection === "meal_plan_entries");
    expect(mealsResult?.pushed).toBe(1);
    expect(h.inserted).toHaveLength(1);
  });
});
