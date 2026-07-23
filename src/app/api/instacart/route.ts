/**
 * POST /api/instacart — Create an Instacart shopping list or recipe page.
 *
 * Request body:
 *   {
 *     "type": "shopping_list" | "recipe",
 *     "title": "Taco Tuesday Groceries",
 *     "items": [{ "name": "ground beef", "quantity": 1, "unit": "lb" }],
 *     "instructions": ["Brown the beef", "Add seasoning"]  // for recipe type
 *     "servings": 4,
 *     "cookingTime": 20
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "url": "https://www.instacart.com/...",
 *     "expires_at": "2026-07-20T..."
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createShoppingList,
  createRecipePage,
  isInstacartEnabled,
  parseIngredients,
} from "@/lib/instacart";

export async function POST(request: NextRequest) {
  // Check if Instacart is configured
  if (!isInstacartEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: "Instacart integration is not enabled. Configure INSTACART_API_KEY in your environment.",
        setup_url: "https://docs.instacart.com/developer_platform_api/guide/get_api_key",
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const {
      type = "shopping_list",
      title,
      items,
      ingredients,
      instructions = [],
      servings = 4,
      cookingTime = 30,
      author = "Consuela",
      imageUrl,
    } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "title is required" },
        { status: 400 },
      );
    }

    // Parse items — support both structured items and string ingredients
    let parsedItems = items;
    if (!parsedItems && ingredients) {
      parsedItems = typeof ingredients[0] === "string"
        ? parseIngredients(ingredients)
        : ingredients;
    }

    if (!parsedItems || parsedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "items or ingredients array is required" },
        { status: 400 },
      );
    }

    let result;

    if (type === "recipe") {
      result = await createRecipePage({
        title,
        author,
        servings,
        cookingTime,
        ingredients: parsedItems,
        instructions,
        imageUrl,
      });
    } else {
      result = await createShoppingList({
        title,
        items: parsedItems,
        imageUrl,
        instructions,
      });
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      type,
      title,
      item_count: parsedItems.length,
      expires_at: result.expires_at,
    });
  } catch (error: any) {
    console.error("Instacart API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create Instacart list",
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/instacart/status — Check if Instacart is enabled.
 */
export async function GET() {
  return NextResponse.json({
    enabled: isInstacartEnabled(),
    api_key_set: Boolean(process.env.INSTACART_API_KEY),
  });
}
