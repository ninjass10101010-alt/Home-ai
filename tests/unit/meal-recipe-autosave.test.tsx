// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useEffect } from "react";

const h = vi.hoisted(() => ({
  meals: [] as any[],
  recipes: [] as any[],
  failNext: false,
}));

vi.mock("@/db", () => ({
  db: {
    gatewayReadStatus: async (collection: string) => {
      if (collection === "meal_plan_entries") {
        return { items: h.meals.map((m) => ({ ...m })), blocked: false };
      }
      if (collection === "recipes") {
        return { items: h.recipes.map((r) => ({ ...r })), blocked: false };
      }
      return { items: [], blocked: false };
    },
    selectMeals: async () => h.meals.map((m) => ({ ...m })),
    insertMeal: async (meal: any) => {
      if (h.failNext) return null;
      h.meals.push({ ...meal });
      return { ...meal };
    },
    updateMeal: async (id: string, updates: any) => {
      if (h.failNext) return null;
      const row = h.meals.find((m) => String(m.id) === id);
      if (!row) return null;
      Object.assign(row, updates);
      return { ...row };
    },
    deleteMeal: async (id: string) => {
      if (h.failNext) return false;
      const idx = h.meals.findIndex((m) => String(m.id) === id);
      if (idx === -1) return false;
      h.meals.splice(idx, 1);
      return true;
    },
    selectRecipes: async () => h.recipes.map((r) => ({ ...r })),
    upsertRecipe: async (recipe: any) => {
      if (h.failNext) return null;
      const existing = h.recipes.find(
        (r) => r.name?.toLowerCase() === recipe.name?.toLowerCase()
      );
      if (existing) {
        Object.assign(existing, recipe);
        return { ...existing };
      }
      h.recipes.push({ ...recipe });
      return { ...recipe };
    },
    deleteRecipe: async (id: string) => {
      if (h.failNext) return false;
      const idx = h.recipes.findIndex((r) => String(r.id) === id);
      if (idx === -1) return false;
      h.recipes.splice(idx, 1);
      return true;
    },
    mealsStore: h.meals,
  },
}));

import { useMeals } from "@/hooks/useMeals";
import { useRecipes } from "@/hooks/useRecipes";
import { listPendingWrites } from "@/lib/pending-writes";

let mealsResult: any;
let recipesResult: any;
let toastMsgs: string[];

function Harness() {
  const meals = useMeals();
  const recipes = useRecipes((msg: string) => toastMsgs.push(msg));
  useEffect(() => {
    // Publish the live hook results after render (effect side effects are the
    // sanctioned way to hand state out of a test harness).
    mealsResult = meals;
    recipesResult = recipes;
  });
  return null;
}

async function mount() {
  toastMsgs = [];
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(<Harness />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  h.meals = [];
  h.recipes = [];
  h.failNext = false;
  localStorage.clear();
  mealsResult = null;
  recipesResult = null;
});

describe("useMeals auto-save", () => {
  it("saveMeal returns true and queues nothing when the server accepts the meal", async () => {
    await mount();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await mealsResult.saveMeal({ id: 1, name: "Tacos", time: "Mon", mealType: "dinner" });
    });
    expect(ok).toBe(true);
    expect(listPendingWrites()).toHaveLength(0);
    expect(h.meals.map((m) => m.name)).toContain("Tacos");
  });

  it("saveMeal returns false and queues the meal when the server write fails", async () => {
    await mount();
    h.failNext = true;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await mealsResult.saveMeal({ id: 2, name: "Pizza", time: "Fri", mealType: "dinner" });
    });
    expect(ok).toBe(false);
    const pending = listPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].collection).toBe("meal_plan_entries");
    expect(pending[0].payload.name).toBe("Pizza");
  });

  it("deleteMeal queues the delete when the server write fails", async () => {
    h.meals.push({ id: "7", name: "Old Stew", time: "Sun", mealType: "dinner" });
    await mount();
    h.failNext = true;
    await act(async () => {
      await mealsResult.deleteMeal("7");
    });
    const pending = listPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].op).toBe("delete");
    expect(pending[0].id).toBe("7");
  });

  it("re-merges meals when consuela-data-refreshed fires", async () => {
    h.meals.push({ id: "1", name: "Original", time: "Mon", mealType: "dinner" });
    await mount();
    expect(mealsResult.meals.map((m: any) => m.name)).toContain("Original");

    h.meals.push({ id: "2", name: "Added Elsewhere", time: "Tue", mealType: "lunch" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mealsResult.meals.map((m: any) => m.name)).toContain("Added Elsewhere");
  });
});

describe("useRecipes auto-save", () => {
  it("shows the added toast when the server accepts the recipe", async () => {
    await mount();
    await act(async () => {
      await recipesResult.saveCatalogRecipe({
        id: 1, name: "Casserole", ingredients: ["Eggs"], tags: ["Homemade"],
      } as any);
    });
    expect(toastMsgs.some((t) => t.includes("added"))).toBe(true);
    expect(toastMsgs.some((t) => t.includes("⚠️"))).toBe(false);
    expect(listPendingWrites()).toHaveLength(0);
  });

  it("shows a sync-pending warning and queues the recipe when the save fails", async () => {
    await mount();
    h.failNext = true;
    await act(async () => {
      await recipesResult.saveCatalogRecipe({
        id: 2, name: "Ghost Soup", ingredients: ["Water"], tags: ["Homemade"],
      } as any);
    });
    expect(toastMsgs.some((t) => t.includes("⚠️"))).toBe(true);
    const pending = listPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].collection).toBe("recipes");
    expect(pending[0].payload.name).toBe("Ghost Soup");
  });

  it("re-merges recipes when consuela-data-refreshed fires", async () => {
    h.recipes.push({ id: "1", name: "Pancakes", ingredients: [], tags: [] });
    await mount();
    expect(recipesResult.recipes.map((r: any) => r.name)).toContain("Pancakes");

    h.recipes.push({ id: "2", name: "Waffles", ingredients: [], tags: [] });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(recipesResult.recipes.map((r: any) => r.name)).toContain("Waffles");
  });
});
