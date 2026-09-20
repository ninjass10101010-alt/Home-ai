// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  recipes: [] as any[],
  meals: [] as any[],
  deleteCalled: [] as number[],
  saveCalled: [] as any[],
  replace: vi.fn(),
  id: "1",
  from: "recipes",
  syncBlocked: false,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: h.id }),
  useRouter: () => ({ push: vi.fn(), replace: h.replace, prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "from" ? h.from : null) }),
  usePathname: () => "/meals/recipes/1",
}));
vi.mock("next/dynamic", () => {
  const Noop = () => null;
  return { default: () => Noop };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: null, isLoggedIn: false }),
}));

vi.mock("@/hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: h.recipes,
    syncBlocked: h.syncBlocked,
    saveCatalogRecipe: async (r: any) => {
      h.saveCalled.push(r);
      return true;
    },
    deleteCatalogRecipe: async (id: number) => {
      h.deleteCalled.push(id);
      return true;
    },
    handleFileUpload: async () => {},
  }),
}));

vi.mock("@/hooks/useMeals", () => ({
  useMeals: () => ({ meals: h.meals, setMeals: vi.fn(), activeDay: "Mon", activeWeek: "2026-09-14" }),
  mealCreateWrite: (meal: any) => ({
    key: `meal:create:${meal.id}`,
    collection: "meal_plan_entries",
    op: "create",
    payload: meal,
    queuedAt: new Date().toISOString(),
  }),
}));

vi.mock("@/db", () => ({
  db: {
    insertMeal: vi.fn(async (m: any) => ({ ...m })),
    upsertGroceryItem: vi.fn(async (i: any) => ({ ...i })),
    mealsStore: h.meals,
  },
}));

vi.mock("@/components/meals/RecipeModal", () => ({
  default: () => <div data-testid="recipe-modal-stub" />,
}));

vi.mock("@/components/meals/CookMode", () => ({
  default: ({ recipe }: any) => <div data-testid="cook-mode-stub">{recipe.name}</div>,
}));

import RecipeDetailPage from "@/app/meals/recipes/[id]/page";

let activeRoot: ReturnType<typeof createRoot> | null = null;

function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    activeRoot = createRoot(el);
    activeRoot.render(ui);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  h.recipes = [];
  h.meals = [];
  h.deleteCalled = [];
  h.saveCalled = [];
  h.replace.mockClear();
  h.id = "1";
  h.from = "recipes";
  h.syncBlocked = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  })));
});
afterEach(() => {
  act(() => {
    activeRoot?.unmount();
  });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const catalogRecipe = {
  id: 1,
  name: "Pancake Stack",
  emoji: "🥞",
  prepTime: "15 min",
  tags: ["Quick"],
  ingredients: ["1 cup flour", "2 eggs"],
  instructions: "Mix everything.\nCook on a hot griddle.",
  servings: 4,
  calories: 420,
  sourceUrl: "https://example.com/pancakes",
  source: "Web",
  createdAt: "2026-09-19T00:00:00.000Z",
};

describe("Recipe detail page", () => {
  it("renders a catalog recipe with quantity-styled ingredients, numbered steps and source", () => {
    h.recipes = [catalogRecipe];
    render(<RecipeDetailPage />);
    expect(document.body.textContent).toContain("Pancake Stack");
    expect(document.body.textContent).toContain("1");
    expect(document.body.textContent).toContain("cup");
    expect(document.body.textContent).toContain("flour");
    expect(document.body.textContent).toContain("Mix everything.");
    expect(document.body.textContent).toContain("Cook on a hot griddle.");
    const sourceLink = document.body.querySelector("a[href='https://example.com/pancakes']");
    expect(sourceLink).not.toBeNull();
    expect(document.body.textContent).not.toContain("deleted from your recipe box");
  });

  it("falls back to the meal snapshot with a banner and no edit/delete when the recipe is gone", () => {
    h.meals = [
      {
        id: 9,
        name: "Legacy Pasta",
        recipeId: "1",
        mealType: "dinner",
        time: "Mon",
        ingredients: ["pasta"],
        instructions: "Boil water.",
        servings: 2,
        calories: 300,
        emoji: "🍝",
        tags: [],
      },
    ];
    render(<RecipeDetailPage />);
    expect(document.body.textContent).toContain("Legacy Pasta");
    expect(document.body.textContent).toContain("deleted from your recipe box");
    expect(document.body.querySelector("button[aria-label='Edit recipe']")).toBeNull();
    expect(document.body.querySelector("button[aria-label='Delete recipe']")).toBeNull();
  });

  it("shows a not-found state when neither the catalog nor a snapshot has the id", () => {
    h.meals = [{ id: 8, name: "Unrelated", recipeId: "99", mealType: "dinner", time: "Tue" }];
    render(<RecipeDetailPage />);
    expect(document.body.textContent).toContain("Recipe not found");
  });

  it("shows the sign-in hint when the catalog read is blocked and nothing is stored", () => {
    h.syncBlocked = true;
    render(<RecipeDetailPage />);
    expect(document.body.textContent).toContain("Recipes are synced to the family account");
    expect(document.body.textContent).not.toContain("Recipe not found");
  });

  it("confirms then deletes a recipe and returns to the recipe box", async () => {
    h.recipes = [catalogRecipe];
    render(<RecipeDetailPage />);
    const deleteBtn = document.body.querySelector("button[aria-label='Delete recipe']") as HTMLButtonElement;
    await act(async () => {
      deleteBtn.click();
    });
    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete"
    ) as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    expect(h.deleteCalled).toEqual([1]);
    expect(h.replace).toHaveBeenCalledWith("/meals?tab=recipes");
  });

  it("opens cook mode from the cook button", async () => {
    h.recipes = [catalogRecipe];
    render(<RecipeDetailPage />);
    const cookBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Cook mode")
    ) as HTMLButtonElement;
    await act(async () => {
      cookBtn.click();
    });
    expect(document.body.querySelector("[data-testid='cook-mode-stub']")).not.toBeNull();
  });

  it("toggles favorite via saveCatalogRecipe", async () => {
    h.recipes = [catalogRecipe];
    render(<RecipeDetailPage />);
    const favBtn = document.body.querySelector("button[aria-label='favorite']") as HTMLButtonElement;
    await act(async () => {
      favBtn.click();
    });
    expect(h.saveCalled.length).toBe(1);
    expect(h.saveCalled[0].favorite).toBe(true);
  });
});
