import { Recipe } from "@/types/meals";
import { THEMEALDB_ATTRIBUTION, THEMEALDB_SITE_URL } from "@/lib/themealdb-constants";

export { THEMEALDB_ATTRIBUTION, THEMEALDB_SITE_URL };
export const THEMEALDB_API_KEY = "1";
export const THEMEALDB_BASE_URL = `https://www.themealdb.com/api/json/v1/${THEMEALDB_API_KEY}`;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_INGREDIENT_SLOTS = 20;

export interface MealDBMeal {
  idMeal: string;
  strMeal: string;
  strCategory?: string | null;
  strArea?: string | null;
  strInstructions?: string | null;
  strMealThumb?: string | null;
  strTags?: string | null;
  strSource?: string | null;
  [key: string]: string | null | undefined;
}

export function mealDbSourceUrl(meal: Pick<MealDBMeal, "idMeal" | "strSource">): string {
  const strSource = typeof meal.strSource === "string" ? meal.strSource.trim() : "";
  if (strSource && /^https?:\/\//i.test(strSource)) return strSource;
  return `${THEMEALDB_SITE_URL}/meal/${meal.idMeal}`;
}

export function zipIngredients(meal: MealDBMeal): string[] {
  const ingredients: string[] = [];
  for (let i = 1; i <= MAX_INGREDIENT_SLOTS; i++) {
    const name = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) continue;
    const trimmedMeasure = typeof measure === "string" ? measure.trim() : "";
    ingredients.push(trimmedMeasure ? `${trimmedMeasure} ${trimmedName}`.replace(/\s+/g, " ").trim() : trimmedName);
  }
  return ingredients;
}

export function splitTags(strTags?: string | null): string[] {
  if (!strTags) return [];
  return strTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function mapMealToRecipe(meal: MealDBMeal): Recipe {
  const sourceUrl = mealDbSourceUrl(meal);
  const tags = splitTags(meal.strTags);
  if (meal.strCategory) tags.unshift(meal.strCategory);
  if (meal.strArea) tags.push(meal.strArea);
  return {
    id: Number(meal.idMeal) || 0,
    name: String(meal.strMeal || "").trim(),
    emoji: "🍽️",
    prepTime: "30 min",
    tags: Array.from(new Set(tags.filter(Boolean))),
    ingredients: zipIngredients(meal),
    instructions: typeof meal.strInstructions === "string" ? meal.strInstructions.trim() : "",
    servings: 4,
    calories: 0,
    source: THEMEALDB_ATTRIBUTION,
    sourceUrl,
    createdAt: new Date().toISOString(),
    image: typeof meal.strMealThumb === "string" && meal.strMealThumb.trim() ? meal.strMealThumb.trim() : undefined,
  };
}

async function fetchMealDb(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${THEMEALDB_BASE_URL}/${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TheMealDB responded with ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchMeals(query: string): Promise<Recipe[]> {
  const data = (await fetchMealDb(`search.php?s=${encodeURIComponent(query)}`)) as { meals?: MealDBMeal[] | null };
  if (!Array.isArray(data.meals)) return [];
  return data.meals.filter((meal) => meal && meal.idMeal && meal.strMeal).map(mapMealToRecipe);
}

export async function getMealById(id: string): Promise<Recipe | null> {
  const data = (await fetchMealDb(`lookup.php?i=${encodeURIComponent(id)}`)) as { meals?: MealDBMeal[] | null };
  const meal = Array.isArray(data.meals) ? data.meals[0] : undefined;
  return meal && meal.idMeal && meal.strMeal ? mapMealToRecipe(meal) : null;
}
