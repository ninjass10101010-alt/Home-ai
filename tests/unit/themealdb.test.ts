import { describe, it, expect } from "vitest";
import {
  THEMEALDB_ATTRIBUTION,
  THEMEALDB_SITE_URL,
  mapMealToRecipe,
  mealDbSourceUrl,
  splitTags,
  zipIngredients,
  type MealDBMeal,
} from "@/lib/themealdb";

function makeMeal(overrides: Partial<MealDBMeal> = {}): MealDBMeal {
  return {
    idMeal: "52772",
    strMeal: "Teriyaki Chicken Casserole",
    strCategory: "Chicken",
    strArea: "Japanese",
    strInstructions: "Preheat oven to 350° F. Spray a 9x13-inch baking pan with cooking spray.",
    strMealThumb: "https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg",
    strTags: "Meat,Casserole",
    strSource: null,
    ...overrides,
  };
}

describe("zipIngredients", () => {
  it("zips ingredients with their measures", () => {
    const meal = makeMeal({
      strIngredient1: "soy sauce",
      strMeasure1: "3/4 cup",
      strIngredient2: "water",
      strMeasure2: "1/2 cup",
    });
    expect(zipIngredients(meal)).toEqual(["3/4 cup soy sauce", "1/2 cup water"]);
  });

  it("keeps the ingredient alone when the measure is empty", () => {
    const meal = makeMeal({
      strIngredient1: "salt",
      strMeasure1: "",
      strIngredient2: "pepper",
      strMeasure2: "   ",
    });
    expect(zipIngredients(meal)).toEqual(["salt", "pepper"]);
  });

  it("skips empty ingredient slots (including holes)", () => {
    const meal = makeMeal({
      strIngredient1: "chicken",
      strMeasure1: "1 lb",
      strIngredient2: "",
      strMeasure2: "2 cups",
      strIngredient3: null,
      strMeasure3: null,
      strIngredient4: "rice",
      strMeasure4: "1 cup",
    });
    expect(zipIngredients(meal)).toEqual(["1 lb chicken", "1 cup rice"]);
  });

  it("collapses whitespace in measure + ingredient pairs", () => {
    const meal = makeMeal({
      strIngredient1: "  brown   sugar ",
      strMeasure1: " 1/4  cup ",
    });
    expect(zipIngredients(meal)).toEqual(["1/4 cup brown sugar"]);
  });

  it("returns an empty array when there are no ingredients", () => {
    expect(zipIngredients(makeMeal())).toEqual([]);
  });
});

describe("splitTags", () => {
  it("splits comma-separated tags and trims them", () => {
    expect(splitTags("Meat, Casserole ,Dinner")).toEqual(["Meat", "Casserole", "Dinner"]);
  });

  it("drops empty segments", () => {
    expect(splitTags("Pasta,, ,Noodles")).toEqual(["Pasta", "Noodles"]);
  });

  it("returns an empty array for null/undefined/empty input", () => {
    expect(splitTags(null)).toEqual([]);
    expect(splitTags(undefined)).toEqual([]);
    expect(splitTags("")).toEqual([]);
  });
});

describe("mealDbSourceUrl", () => {
  it("falls back to the TheMealDB meal page when strSource is missing", () => {
    expect(mealDbSourceUrl({ idMeal: "52772", strSource: null })).toBe(`${THEMEALDB_SITE_URL}/meal/52772`);
    expect(mealDbSourceUrl({ idMeal: "52772", strSource: "" })).toBe(`${THEMEALDB_SITE_URL}/meal/52772`);
  });

  it("uses strSource when it is a real http(s) URL", () => {
    expect(mealDbSourceUrl({ idMeal: "1", strSource: "https://example.com/recipe" })).toBe(
      "https://example.com/recipe",
    );
  });

  it("falls back for non-URL strSource values", () => {
    expect(mealDbSourceUrl({ idMeal: "7", strSource: "not a url" })).toBe(`${THEMEALDB_SITE_URL}/meal/7`);
  });
});

describe("mapMealToRecipe", () => {
  it("maps a TheMealDB meal to the catalog Recipe shape", () => {
    const recipe = mapMealToRecipe(
      makeMeal({
        strIngredient1: "soy sauce",
        strMeasure1: "3/4 cup",
      }),
    );
    expect(recipe.name).toBe("Teriyaki Chicken Casserole");
    expect(recipe.image).toBe("https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg");
    expect(recipe.ingredients).toEqual(["3/4 cup soy sauce"]);
    expect(recipe.instructions).toContain("Preheat oven");
    expect(recipe.tags).toContain("Chicken");
    expect(recipe.tags).toContain("Japanese");
    expect(recipe.tags).toContain("Meat");
    expect(recipe.tags).toContain("Casserole");
    expect(recipe.source).toBe(THEMEALDB_ATTRIBUTION);
    expect(recipe.sourceUrl).toBe(`${THEMEALDB_SITE_URL}/meal/52772`);
    expect(recipe.emoji).toBe("🍽️");
    expect(recipe.createdAt).toBeTruthy();
  });

  it("dedupes tags when category/area overlap with strTags", () => {
    const recipe = mapMealToRecipe(makeMeal({ strTags: "Chicken,Weeknight" }));
    expect(recipe.tags.filter((t) => t === "Chicken")).toHaveLength(1);
  });

  it("handles meals with no tags, image, or instructions", () => {
    const recipe = mapMealToRecipe(
      makeMeal({ strCategory: null, strArea: null, strTags: null, strMealThumb: null, strInstructions: null }),
    );
    expect(recipe.tags).toEqual([]);
    expect(recipe.image).toBeUndefined();
    expect(recipe.instructions).toBe("");
  });
});
