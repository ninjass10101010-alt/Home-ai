// Shared PB row mappers for meal/recipe reads. Writes stringify
// ingredients/tags arrays before they hit PocketBase (see db.insertMeal /
// db.upsertRecipe), so every read path parses them back — previously this
// mapping lived only inside pb-db's selectMeals while other read paths
// (recipes) returned the raw stringified fields.

function parseArrayField(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through to empty */ }
  }
  return [];
}

export function mapMealRows(rows: any[]): any[] {
  return rows.map((meal: any) => ({
    ...meal,
    ingredients: parseArrayField(meal.ingredients),
    tags: parseArrayField(meal.tags),
  }));
}

export function mapRecipeRows(rows: any[]): any[] {
  return rows.map((recipe: any) => ({
    ...recipe,
    ingredients: parseArrayField(recipe.ingredients),
    tags: parseArrayField(recipe.tags),
  }));
}
