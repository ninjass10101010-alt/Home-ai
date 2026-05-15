import pb from "@/lib/pocketbase";

/**
 * Smart Meal Planning Sync Service
 * Handles bidirectional synchronization between Meal Planning, Pantry, and Grocery List
 */

export class MealPlanningSync {
  /**
   * Sync when a meal plan entry is created/updated
   * Adds missing ingredients to grocery list based on pantry levels
   */
  static async syncMealPlanToGrocery(mealPlanEntry: any) {
    try {
      // Get the recipe
      const recipe = await pb.collection("recipes").getOne(mealPlanEntry.recipeId);
      if (!recipe) return;

      // Get recipe ingredients
      const recipeIngredients = await pb.collection("recipe_ingredients")
        .getFullList({ filter: `recipeId = "${recipe.id}"` });

      // Process each ingredient requirement
      for (const req of recipeIngredients) {
        const ingredient = await pb.collection("ingredients").getOne(req.ingredientId);

        // Scale quantity based on servings
        const scaledQuantity = (req.quantity * mealPlanEntry.servings) / 4; // assuming recipes are for 4 servings

        // Check current pantry levels
        const pantryItems = await pb.collection("pantry_items")
          .getFullList({ filter: `ingredientId = "${ingredient.id}"` });

        const totalPantryQuantity = pantryItems.reduce((sum, item) => {
          return sum + this.convertToBaseUnit(item.quantity, item.unit, ingredient.unit);
        }, 0);

        // Calculate deficit
        const deficit = scaledQuantity - totalPantryQuantity;
        if (deficit > 0) {
          // Check if grocery item already exists
          const existingGrocery = await pb.collection("grocery_items")
            .getFirstListItem(`ingredientId = "${ingredient.id}"`, { $autoCancel: false })
            .catch(() => null);

          if (existingGrocery) {
            // Update existing item if it's not manually added
            if (existingGrocery.source !== "manual") {
              await pb.collection("grocery_items").update(existingGrocery.id, {
                quantityNeeded: Math.max(existingGrocery.quantityNeeded, deficit),
                priority: deficit > scaledQuantity * 0.5 ? "high" : "medium",
                source: "meal-plan",
                addedFromMealPlanId: mealPlanEntry.id,
                addedAt: new Date().toISOString(),
              });
            }
          } else {
            // Create new grocery item
            await pb.collection("grocery_items").create({
              ingredientId: ingredient.id,
              quantityNeeded: deficit,
              unit: ingredient.unit,
              priority: deficit > scaledQuantity * 0.5 ? "high" : "medium",
              source: "meal-plan",
              addedFromMealPlanId: mealPlanEntry.id,
              addedAt: new Date().toISOString(),
              suggestedStoreSection: this.getStoreSection(ingredient.category),
              priceEstimate: this.getPriceEstimate(ingredient.category),
            });
          }
        }
      }

      // Mark meal plan as synced
      await pb.collection("meal_plan_entries").update(mealPlanEntry.id, {
        lastSyncedAt: new Date().toISOString(),
      });

    } catch (error) {
      console.error("Failed to sync meal plan to grocery:", error);
    }
  }

  /**
   * Sync when pantry items are updated
   * Removes satisfied grocery items
   */
  static async syncPantryToGrocery(pantryItem: any) {
    try {
      const ingredient = await pb.collection("ingredients").getOne(pantryItem.ingredientId);

      // Find grocery items for this ingredient that aren't manually added
      const groceryItems = await pb.collection("grocery_items")
        .getFullList({ filter: `ingredientId = "${ingredient.id}" && source != "manual"` });

      for (const groceryItem of groceryItems) {
        // Check if pantry now satisfies this grocery need
        const pantryItems = await pb.collection("pantry_items")
          .getFullList({ filter: `ingredientId = "${ingredient.id}"` });

        const totalPantryQuantity = pantryItems.reduce((sum, item) => {
          return sum + this.convertToBaseUnit(item.quantity, item.unit, ingredient.unit);
        }, 0);

        if (totalPantryQuantity >= groceryItem.quantityNeeded) {
          // Remove from grocery list
          await pb.collection("grocery_items").delete(groceryItem.id);
        }
      }
    } catch (error) {
      console.error("Failed to sync pantry to grocery:", error);
    }
  }

  /**
   * Handle manual grocery list edits to preserve user intent
   */
  static async handleManualGroceryEdit(groceryItem: any, changes: any) {
    // If user manually adds or modifies an item, mark it as manual
    if (changes.source !== undefined && changes.source === "manual") {
      await pb.collection("grocery_items").update(groceryItem.id, {
        source: "manual",
        addedFromMealPlanId: null, // Disconnect from auto-sync
      });
    }
  }

  /**
   * Add a pantry item to the grocery list
   * Looks up the ingredient to get the category and creates a grocery item
   */
  static async addPantryToGrocery(pantryItem: any): Promise<any | null> {
    try {
      // Get the ingredient to retrieve category
      const ingredient = await pb.collection("ingredients").getOne(pantryItem.ingredientId);
      if (!ingredient) return null;

      // Check if grocery item already exists for this ingredient
      const existingGrocery = await pb.collection("grocery_items")
        .getFirstListItem(`ingredientId = "${ingredient.id}"`, { $autoCancel: false })
        .catch(() => null);

      if (existingGrocery) {
        // If manual item exists, don't overwrite
        if (existingGrocery.source === "manual") {
          return existingGrocery;
        }
        // Update existing auto-generated item
        const updated = await pb.collection("grocery_items").update(existingGrocery.id, {
          quantityNeeded: (existingGrocery.quantityNeeded || 0) + (pantryItem.quantity || 1),
          source: "pantry",
          addedAt: new Date().toISOString(),
          suggestedStoreSection: this.getStoreSection(ingredient.category),
          priceEstimate: this.getPriceEstimate(ingredient.category),
        });
        return updated;
      }

      // Create new grocery item with correct category from ingredient
      const groceryItem = await pb.collection("grocery_items").create({
        ingredientId: ingredient.id,
        quantityNeeded: pantryItem.quantity || 1,
        unit: pantryItem.unit || ingredient.unit,
        priority: "medium",
        source: "pantry",
        addedAt: new Date().toISOString(),
        suggestedStoreSection: this.getStoreSection(ingredient.category),
        priceEstimate: this.getPriceEstimate(ingredient.category),
      });

      return groceryItem;
    } catch (error) {
      console.error("Failed to add pantry to grocery:", error);
      return null;
    }
  }

  /**
   * Convert quantity to base unit for comparison
   */
  private static convertToBaseUnit(quantity: number, fromUnit: string, toUnit: string): number {
    // Unit aliases and conversion factors to base units (grams for weight, ml for volume)
    const unitAliases: Record<string, string> = {
      // Weight aliases
      'g': 'g', 'grams': 'g', 'gram': 'g', 'g.': 'g',
      'kg': 'kg', 'kilograms': 'kg', 'kilo': 'kg',
      'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
      'lb': 'lb', 'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb',

      // Volume aliases
      'ml': 'ml', 'milliliters': 'ml', 'milliliter': 'ml', 'cc': 'ml',
      'l': 'l', 'liters': 'l', 'liter': 'l', 'litre': 'l',

      // Cooking volume aliases
      'cup': 'cup', 'cups': 'cup',
      'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbs': 'tbsp',
      'tsp': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',

      // Count
      'count': 'count', 'piece': 'count', 'pieces': 'count', 'item': 'count', 'items': 'count', 'whole': 'count',
    };

    // Convert to base unit grams/ml/count
    const baseFactors: Record<string, number> = {
      'g': 1, 'kg': 1000, 'oz': 28.35, 'lb': 453.59,
      'ml': 1, 'l': 1000,
      'cup': 240, 'tbsp': 15, 'tsp': 5,
      'count': 1,
    };

    const from = unitAliases[fromUnit?.toLowerCase() || fromUnit] || fromUnit;
    const to = unitAliases[toUnit?.toLowerCase() || toUnit] || toUnit;

    if (from === to) return quantity;
    if (!baseFactors[from] || !baseFactors[to]) return quantity;

    // Convert via base unit (grams for weight, ml for volume)
    const inBase = quantity * baseFactors[from];
    return inBase / baseFactors[to];
  }

  /**
   * Get suggested store section based on ingredient category
   */
  private static getStoreSection(category: string): string {
    const sections: Record<string, string> = {
      produce: "Produce",
      dairy: "Dairy",
      meat: "Meat",
      pantry: "Pantry Staples",
      frozen: "Frozen Foods",
      snacks: "Snacks",
      beverages: "Beverages",
      household: "Household",
    };
    return sections[category] || "General";
  }

  /**
   * Get price estimate based on category (rough estimates)
   */
  private static getPriceEstimate(category: string): number {
    const estimates: Record<string, number> = {
      produce: 2.50,
      dairy: 3.00,
      meat: 8.00,
      pantry: 3.50,
      frozen: 4.00,
      snacks: 2.00,
      beverages: 1.50,
      household: 5.00,
    };
    return estimates[category] || 3.00;
  }
}

export default MealPlanningSync;