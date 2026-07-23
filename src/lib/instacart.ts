/**
 * Instacart Integration — Shopping list and recipe page creation.
 *
 * Uses the Instacart Developer Platform API:
 *   https://docs.instacart.com/developer_platform_api/
 *
 * Two key endpoints:
 *   - POST /idp/v1/products/products_link  → Create shopping list page
 *   - POST /idp/v1/products/recipe         → Create recipe page
 *
 * Both return a URL to an Instacart Marketplace page where the user
 * can select a store, review items, and check out.
 *
 * Setup:
 *   1. Get an API key from https://docs.instacart.com/developer_platform_api/guide/get_api_key
 *   2. Set INSTACART_API_KEY in .env.local
 *   3. Set NEXT_PUBLIC_INSTACART_ENABLED=true to enable the UI
 */

const INSTACART_BASE = "https://connect.instacart.com/idp/v1";

interface Ingredient {
  name: string;
  quantity?: number;
  unit?: string;
}

interface CreateShoppingListParams {
  title: string;
  items: Ingredient[];
  imageUrl?: string;
  instructions?: string[];
}

interface CreateRecipePageParams {
  title: string;
  author?: string;
  servings?: number;
  cookingTime?: number;
  ingredients: Ingredient[];
  instructions: string[];
  imageUrl?: string;
}

interface InstacartResponse {
  url: string;
  expires_at?: string;
  link_id?: string;
}

/**
 * Check if Instacart integration is configured and enabled.
 * Checks both environment variables AND the connection store.
 */
export function isInstacartEnabled(): boolean {
  // Check env var first (for server-side)
  if (process.env.INSTACART_API_KEY && process.env.NEXT_PUBLIC_INSTACART_ENABLED === "true") {
    return true;
  }
  // Check client-side connection store
  try {
    const { isConnected } = require("@/lib/connections/store");
    return isConnected("instacart");
  } catch {
    return false;
  }
}

/**
 * Create a shopping list page on Instacart Marketplace.
 *
 * Returns a URL that the user can open to review and checkout.
 * The URL works for ~24 hours by default.
 *
 * Example:
 *   const result = await createShoppingList({
 *     title: "Taco Tuesday Groceries",
 *     items: [
 *       { name: "ground beef", quantity: 1, unit: "lb" },
 *       { name: "taco shells", quantity: 1 },
 *       { name: "cheddar cheese", quantity: 8, unit: "oz" },
 *       { name: "sour cream", quantity: 1 },
 *       { name: "lettuce", quantity: 1 },
 *       { name: "tomatoes", quantity: 2 },
 *     ],
 *   });
 *   // result.url → "https://www.instacart.com/..."
 */
export async function createShoppingList(
  params: CreateShoppingListParams,
): Promise<InstacartResponse> {
  if (!isInstacartEnabled()) {
    throw new Error("Instacart integration is not enabled. Set INSTACART_API_KEY and NEXT_PUBLIC_INSTACART_ENABLED=true");
  }

  const response = await fetch(`${INSTACART_BASE}/products/products_link`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.INSTACART_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      title: params.title,
      image_url: params.imageUrl,
      link_type: "shopping_list",
      expires_in: 86400, // 24 hours
      instructions: params.instructions,
      line_items: params.items.map((item) => ({
        name: item.name,
        quantity: item.quantity || 1,
        unit: item.unit,
        display_text: item.quantity && item.unit
          ? `${item.quantity} ${item.unit} ${item.name}`
          : item.name,
        line_item_measurements: item.quantity && item.unit
          ? [{ quantity: String(item.quantity), unit: item.unit }]
          : [],
      })),
      landing_page_configuration: {
        partner_linkback_url: `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/meals?tab=grocery`,
        enable_pantry_items: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Instacart API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Create a recipe page on Instacart Marketplace.
 *
 * This is richer than a shopping list — it shows ingredients, instructions,
 * and allows the user to mark items they already have (pantry items).
 *
 * Example:
 *   const result = await createRecipePage({
 *     title: "Taco Night",
 *     author: "Consuela",
 *     servings: 4,
 *     cookingTime: 20,
 *     ingredients: [
 *       { name: "ground beef", quantity: 1, unit: "lb" },
 *       { name: "taco shells", quantity: 12 },
 *     ],
 *     instructions: [
 *       "Brown the ground beef in a skillet",
 *       "Add taco seasoning and 1/2 cup water",
 *       "Warm taco shells in oven at 350°F for 3 min",
 *       "Assemble with toppings",
 *     ],
 *   });
 */
export async function createRecipePage(
  params: CreateRecipePageParams,
): Promise<InstacartResponse> {
  if (!isInstacartEnabled()) {
    throw new Error("Instacart integration is not enabled");
  }

  const response = await fetch(`${INSTACART_BASE}/products/recipe`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.INSTACART_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      title: params.title,
      image_url: params.imageUrl,
      author: params.author || "Consuela",
      servings: params.servings || 4,
      cooking_time: params.cookingTime || 30,
      external_reference_id: `consuela-${Date.now()}`,
      content_creator_credit_info: "Consuela — AI Family Organizer",
      expires_in: 86400,
      instructions: params.instructions,
      ingredients: params.ingredients.map((ing) => ({
        name: ing.name,
        display_text: ing.quantity && ing.unit
          ? `${ing.quantity} ${ing.unit} ${ing.name}`
          : ing.name,
        measurements: ing.quantity && ing.unit
          ? [{ quantity: ing.quantity, unit: ing.unit }]
          : [],
      })),
      landing_page_configuration: {
        partner_linkback_url: `${process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/meals`,
        enable_pantry_items: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Instacart API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Convert a meal's ingredients array (strings) into structured Ingredient objects.
 *
 * Handles simple parsing of formats like:
 *   "Ground beef" → { name: "Ground beef" }
 *   "1 lb ground beef" → { name: "ground beef", quantity: 1, unit: "lb" }
 *   "2 cups rice" → { name: "rice", quantity: 2, unit: "cups" }
 */
export function parseIngredients(ingredients: string[]): Ingredient[] {
  return ingredients.map((raw) => {
    const match = raw.match(/^(\d+(?:\.\d+)?)\s+(lb|lbs|oz|cup|cups|tbsp|tsp|can|pack|bag|bunch|cloves?|piece|pieces|slice|slices|head|stalk|bunch)?\s+(.+)$/i);
    if (match) {
      return {
        name: match[3].trim().toLowerCase(),
        quantity: parseFloat(match[1]),
        unit: match[2]?.toLowerCase(),
      };
    }
    return { name: raw.trim().toLowerCase() };
  });
}

/**
 * Get a deep link to Instacart search for a specific item.
 * Useful as a fallback when we can't create a full shopping list.
 */
export function getInstacartSearchUrl(query: string): string {
  return `https://www.instacart.com/store/search?query=${encodeURIComponent(query)}`;
}

/**
 * Get the Instacart homepage link for manual browsing.
 */
export function getInstacartHomeUrl(): string {
  return "https://www.instacart.com";
}
