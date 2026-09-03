// Shared row mappers for meal/recipe PB reads. PocketBase stores
// ingredients/tags JSON-stringified on write (db.upsertRecipe / insertMeal
// stringify arrays), so every read path must parse them back — previously the
// mapping was duplicated (pb-db selectMeals inline) or missing entirely
// (recipes reads returned stringified arrays).
import { describe, it, expect } from "vitest";
import { mapMealRows, mapRecipeRows } from "@/lib/meal-rows";

describe("mapMealRows", () => {
  it("parses stringified ingredients and tags back into arrays", () => {
    const rows = [
      { id: "1", name: "Tacos", ingredients: '["Tortillas","Beef"]', tags: '["Kid-friendly"]' },
    ];
    const [meal] = mapMealRows(rows);
    expect(meal.ingredients).toEqual(["Tortillas", "Beef"]);
    expect(meal.tags).toEqual(["Kid-friendly"]);
  });

  it("passes already-array fields through untouched", () => {
    const rows = [{ id: "2", name: "Soup", ingredients: ["Broth"], tags: [] }];
    const [meal] = mapMealRows(rows);
    expect(meal.ingredients).toEqual(["Broth"]);
    expect(meal.tags).toEqual([]);
  });

  it("falls back to empty arrays for missing, invalid, or non-array values", () => {
    const rows = [
      { id: "3", name: "A" },
      { id: "4", name: "B", ingredients: "not-json", tags: 42 },
    ];
    const [a, b] = mapMealRows(rows);
    expect(a.ingredients).toEqual([]);
    expect(a.tags).toEqual([]);
    expect(b.ingredients).toEqual([]);
    expect(b.tags).toEqual([]);
  });
});

describe("mapRecipeRows", () => {
  it("parses stringified ingredients and tags back into arrays", () => {
    const rows = [
      { id: "r1", name: "Casserole", ingredients: '["Eggs"]', tags: '["Homemade","Dinner"]' },
    ];
    const [recipe] = mapRecipeRows(rows);
    expect(recipe.ingredients).toEqual(["Eggs"]);
    expect(recipe.tags).toEqual(["Homemade", "Dinner"]);
  });

  it("falls back to empty arrays for missing or invalid values", () => {
    const [recipe] = mapRecipeRows([{ id: "r2", name: "Ghost", ingredients: "{oops" }]);
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.tags).toEqual([]);
  });
});
