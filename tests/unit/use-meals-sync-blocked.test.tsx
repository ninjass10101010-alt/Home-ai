// @vitest-environment jsdom
// Honest "sign in" state when the meals/recipes PB reads are blocked. In the
// browser, db.selectMeals()/selectRecipes() swallow 401s and return [] (via
// clientListOrEmpty), so a signed-out device showed its stale localStorage
// cache — or an empty planner — with no hint that the family server actually
// holds more. gatewayReadStatus exposes the blocked flag the hooks need.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useEffect } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  meals: [] as any[],
  recipes: [] as any[],
  mealsBlocked: false,
  recipesBlocked: false,
  mealRows: [] as any[],
  recipeRows: [] as any[],
}));

vi.mock("@/db", () => ({
  db: {
    gatewayReadStatus: async (collection: string) => {
      if (collection === "meal_plan_entries") {
        return h.mealsBlocked
          ? { items: [], blocked: true }
          : { items: h.meals.map((m) => ({ ...m })), blocked: false };
      }
      if (collection === "recipes") {
        return h.recipesBlocked
          ? { items: [], blocked: true }
          : { items: h.recipes.map((r) => ({ ...r })), blocked: false };
      }
      return { items: [], blocked: false };
    },
    selectMeals: async () => (h.mealsBlocked ? [] : h.meals.map((m) => ({ ...m }))),
    selectRecipes: async () => (h.recipesBlocked ? [] : h.recipes.map((r) => ({ ...r }))),
    selectMembersFallback: () => [],
    selectMembersDetailed: () => [],
    selectMembers: () => [],
    insertMeal: async (meal: any) => ({ ...meal, id: "pb_new" }),
    updateMeal: async () => ({}),
    deleteMeal: async () => true,
    upsertRecipe: async (recipe: any) => ({ ...recipe, id: "pb_r" }),
    deleteRecipe: async () => true,
    selectPantry: async () => [],
    mealsStore: h.meals,
  },
}));

import { useMeals } from "@/hooks/useMeals";
import { useRecipes } from "@/hooks/useRecipes";
import PlanTab from "@/components/meals/PlanTab";
import RecipeBox from "@/components/meals/RecipeBox";

vi.mock("@/hooks/useAtmosphericTheme", () => ({
  useAtmosphericTheme: () => ({
    colors: { glow: "#22d3ee", gradientStop: "rgba(34,211,238,0.35)", accentColor: "#22d3ee" },
    accentRgb: "34,211,238",
  }),
}));

const results: { meals: any; recipes: any } = { meals: null, recipes: null };

function HookHarness() {
  const meals = useMeals();
  const recipes = useRecipes((msg: string) => {});
  useEffect(() => {
    // Publish the live hook results after render (effect side effects are the
    // sanctioned way to hand state out of a test harness).
    results.meals = meals;
    results.recipes = recipes;
  });
  return null;
}

async function renderHook() {
  results.meals = null;
  results.recipes = null;
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<HookHarness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return results.meals !== null;
}

function planTabProps(overrides: Record<string, any> = {}) {
  const noop = () => {};
  return {
    meals: [],
    activeDay: "Wed",
    setActiveDay: noop,
    activeMeals: [],
    deleteMeal: noop,
    openRecipeModal: noop,
    showAiSuggestions: false,
    aiMealIdeas: [],
    aiMealLoading: false,
    recipes: [],
    addRecipeToMealSlot: noop,
    copyDayMeals: noop,
    duplicateMeal: noop,
    activeWeek: "2026-08-31",
    goToWeek: noop,
    archiveCurrentWeek: noop,
    isCurrentWeek: true,
    flowSummary: "0 meals planned",
    focusRecipeBox: false,
    saveCatalogRecipe: noop,
    deleteCatalogRecipe: noop,
    addRecipeToPlan: noop,
    addRecipeToGrocery: noop,
    startAddRecipe: noop,
    startEditRecipe: noop,
    handleFileUpload: noop,
    openImportModal: noop,
    openSearchModal: noop,
    ...overrides,
  };
}

async function renderAsync(ui: ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  h.meals = [];
  h.recipes = [];
  h.mealsBlocked = false;
  h.recipesBlocked = false;
  h.mealRows = [];
  h.recipeRows = [];
});

describe("useMeals / useRecipes syncBlocked state", () => {
  it("exposes syncBlocked=true when the PB read is blocked (401)", async () => {
    localStorage.setItem("consuela-meals", JSON.stringify([{ id: 1, name: "Cached Tacos", time: "Mon", mealType: "dinner" }]));
    h.mealsBlocked = true;
    await renderHook();
    expect(results.meals.syncBlocked).toBe(true);
    // Local cache still shows — meals aren't lost, the hint appears only when empty.
    expect(results.meals.meals.map((m: any) => m.name)).toContain("Cached Tacos");
  });

  it("exposes syncBlocked=false when the read succeeds", async () => {
    h.meals.push({ id: "pb1", name: "Server Soup", time: "Tue", mealType: "dinner" });
    await renderHook();
    expect(results.meals.syncBlocked).toBe(false);
    expect(results.meals.meals.map((m: any) => m.name)).toContain("Server Soup");
  });

  it("exposes recipesSyncBlocked the same way", async () => {
    h.recipesBlocked = true;
    await renderHook();
    expect(results.recipes.syncBlocked).toBe(true);
  });

  it("clears syncBlocked after a successful re-read (consuela-data-refreshed)", async () => {
    h.mealsBlocked = true;
    await renderHook();
    expect(results.meals.syncBlocked).toBe(true);

    h.mealsBlocked = false;
    h.meals.push({ id: "pb1", name: "Late Soup", time: "Tue", mealType: "dinner" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(results.meals.syncBlocked).toBe(false);
    expect(results.meals.meals.map((m: any) => m.name)).toContain("Late Soup");
  });
});

describe("PlanTab sign-in hint (blocked reads + empty cache)", () => {
  it("shows the meals sign-in hint when syncBlocked and no local meals", async () => {
    const el = await renderAsync(
      <PlanTab {...planTabProps({ syncBlocked: true, meals: [] })} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Meals are synced to the family account");
    expect(text).toContain("Sign in with your PIN to see everyone's meals");
  });

  it("does not show the hint when reads are not blocked", async () => {
    const el = await renderAsync(
      <PlanTab {...planTabProps({ syncBlocked: false, meals: [] })} />
    );
    expect(el.textContent || "").not.toContain("Meals are synced to the family account");
  });

  it("does not show the hint when local meals exist despite blocking", async () => {
    const cached = [{ id: 1, name: "Cached Tacos", time: "Wed", mealType: "dinner", weekOf: "2026-08-31" }];
    const el = await renderAsync(
      <PlanTab {...planTabProps({ syncBlocked: true, meals: cached, activeMeals: cached })} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Cached Tacos");
    expect(text).not.toContain("Meals are synced to the family account");
  });
});

describe("RecipeBox sign-in hint (blocked reads + empty catalog)", () => {
  function recipeBoxProps(overrides: Record<string, any> = {}) {
    const noop = () => {};
    return {
      recipes: [],
      activeDay: "Wed",
      saveCatalogRecipe: noop,
      deleteCatalogRecipe: noop,
      addRecipeToPlan: noop,
      addRecipeToGrocery: noop,
      startAddRecipe: noop,
      startEditRecipe: noop,
      handleFileUpload: noop,
      openImportModal: noop,
      openSearchModal: noop,
      ...overrides,
    };
  }

  it("shows the recipes sign-in hint when syncBlocked and no local recipes", async () => {
    const el = await renderAsync(
      <RecipeBox {...recipeBoxProps({ recipes: [], syncBlocked: true })} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Recipes are synced to the family account");
    expect(text).toContain("Sign in with your PIN to see the family recipe box");
  });

  it("does not show the hint when reads are not blocked", async () => {
    const el = await renderAsync(
      <RecipeBox {...recipeBoxProps({ recipes: [], syncBlocked: false })} />
    );
    expect(el.textContent || "").not.toContain("Recipes are synced to the family account");
  });

  it("does not show the hint when local recipes exist despite blocking", async () => {
    const el = await renderAsync(
      <RecipeBox {...recipeBoxProps({ recipes: [{ id: 1, name: "Local Pancakes", tags: ["Homemade"], ingredients: [] }], syncBlocked: true })} />
    );
    const text = el.textContent || "";
    expect(text).toContain("Local Pancakes");
    expect(text).not.toContain("Recipes are synced to the family account");
  });
});
