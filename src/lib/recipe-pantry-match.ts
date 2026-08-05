import type { Recipe, PantryItem } from "@/types/meals";

const STOP_WORDS = /\b(the|fresh|diced|chopped|minced|sliced|canned|can\s+of|package\s+of|bag\s+of|jar\s+of|bottle\s+of|box\s+of)\b/gi;

export function normalizeIngredientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(STOP_WORDS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

export function ingredientNamesMatch(a: string, b: string): boolean {
  const na = normalizeIngredientName(a);
  const nb = normalizeIngredientName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 3 && nb.length > 3) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

export function recipeReadiness(
  recipe: Recipe,
  pantryItems: PantryItem[]
): { readyPct: number; missing: string[]; total: number } {
  const ingredients = (recipe.ingredients ?? []).filter(i => i.trim());
  if (ingredients.length === 0) return { readyPct: 100, missing: [], total: 0 };

  const missing: string[] = [];
  for (const ing of ingredients) {
    const found = pantryItems.some(p => {
      const pantryName = p.item || p.name || "";
      return ingredientNamesMatch(ing, pantryName) && p.status !== "out" && (p.quantity ?? 1) > 0;
    });
    if (!found) missing.push(ing);
  }

  const ready = ingredients.length - missing.length;
  return {
    readyPct: Math.round((ready / ingredients.length) * 100),
    missing,
    total: ingredients.length,
  };
}

export function findCookableRecipes(
  recipes: Recipe[],
  pantryItems: PantryItem[]
): Array<{ recipe: Recipe; readiness: ReturnType<typeof recipeReadiness> }> {
  return recipes
    .filter(r => (r.ingredients ?? []).length > 0)
    .map(r => ({ recipe: r, readiness: recipeReadiness(r, pantryItems) }))
    .filter(({ readiness }) => readiness.total > 0)
    .sort((a, b) => b.readiness.readyPct - a.readiness.readyPct);
}
