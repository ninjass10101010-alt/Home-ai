/**
 * POST /api/instacart — Create an Instacart shopping list or recipe page.
 *
 * Primary path: Composio INSTACART_CREATE_SHOPPING_LIST_PAGE (via COMPOSIO_API_KEY)
 * Fallback: Direct Instacart Developer Platform API (via INSTACART_API_KEY)
 *
 * Supports:
 *   - Single store: { store: "aldi", items: [...] }
 *   - Multi-store: { stores: { "aldi": [...items], "meijer": [...items] } }
 *   - Walmart (not on Instacart in Holland): generates walmart.com search link
 *
 * Response (single store):
 *   { success: true, url: "...", type, title, store, item_count, expires_at }
 *
 * Response (multi store):
 *   { success: true, type: "multi_store", title, stores: [{ store, url, item_count }] }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createShoppingList,
  createRecipePage,
  createShoppingListViaComposio,
  isInstacartEnabled,
  parseIngredients,
} from "@/lib/instacart";
import { getStoreLabel } from "@/lib/stores";
import { getServiceConfig } from "@/lib/services/config";

export async function POST(request: NextRequest) {
  try {
    // Check if Instacart or Composio is configured (inside try so failures
    // return an honest JSON 503 instead of a raw non-JSON 500).
    const enabled = await isInstacartEnabled();
    const composioKey = await getServiceConfig("composio", "COMPOSIO_API_KEY");
    if (!enabled && !composioKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Instacart integration is not enabled. Configure COMPOSIO_API_KEY in Settings → Services & Keys.",
          setup_url: "https://docs.instacart.com/developer_platform_api/get_started/api-keys",
        },
        { status: 503 },
      );
    }

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
      store,
      stores,
    } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "title is required" },
        { status: 400 },
      );
    }

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

    // Multi-store: split items by store, create one URL per store.
    // Each store is isolated so one failure doesn't abort the whole request.
    if (stores && typeof stores === "object" && !Array.isArray(stores)) {
      const results: {
        store: string;
        url?: string;
        item_count: number;
        error?: string;
      }[] = [];

      for (const [storeId, storeItems] of Object.entries(stores)) {
        if (!Array.isArray(storeItems) || storeItems.length === 0) continue;

        // Walmart: generate local list + search link (not on Instacart in Holland)
        if (storeId === "walmart") {
          const searchQuery = storeItems.map((i: any) => i.name).join(", ");
          results.push({
            store: storeId,
            url: `https://www.walmart.com/search?q=${encodeURIComponent(searchQuery)}`,
            item_count: storeItems.length,
          });
          continue;
        }

        const storeTitle = `${title} — ${getStoreLabel(storeId)}`;
        try {
          let result;

          if (composioKey) {
            result = await createShoppingListViaComposio({
              apiKey: composioKey,
              title: storeTitle,
              items: storeItems,
              imageUrl,
              instructions,
            });
          } else {
            result = await createShoppingList({
              title: storeTitle,
              items: storeItems,
              imageUrl,
              instructions,
            });
          }

          results.push({ store: storeId, url: result.url, item_count: storeItems.length });
        } catch (storeErr: any) {
          console.error(`Instacart store "${storeId}" failed:`, storeErr);
          results.push({
            store: storeId,
            item_count: storeItems.length,
            error: storeErr?.message || "Failed to create list for this store",
          });
        }
      }

      // Partial success: at least one store produced a URL.
      const success = results.some((r) => r.url);
      const storeErrors = results.filter((r) => r.error).length;

      return NextResponse.json({
        success,
        type: "multi_store",
        title,
        partial: storeErrors > 0 && success,
        stores: results,
      });
    }

    // Single store or no store specified
    const storeLabel = store ? ` — ${getStoreLabel(store)}` : "";
    let result;

    if (composioKey) {
      result = await createShoppingListViaComposio({
        apiKey: composioKey,
        title: `${title}${storeLabel}`,
        items: parsedItems,
        imageUrl,
        instructions,
      });
    } else {
      result = await createShoppingList({
        title: `${title}${storeLabel}`,
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
      store: store || "any",
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
 * GET /api/instacart — Check if Instacart is enabled.
 */
export async function GET() {
  try {
    const composioKey = await getServiceConfig("composio", "COMPOSIO_API_KEY");
    const instacartKey = await getServiceConfig("instacart", "INSTACART_API_KEY");
    const directKeySet = Boolean(process.env.INSTACART_API_KEY);
    const composioEnabled = composioKey !== null;
    const instacartEnabled = instacartKey !== null;

    return NextResponse.json({
      enabled: instacartEnabled || composioEnabled || directKeySet,
      composio_enabled: composioEnabled,
      api_key_set: instacartEnabled || directKeySet || composioEnabled,
    });
  } catch (error: any) {
    console.error("Instacart status error:", error);
    return NextResponse.json(
      {
        enabled: false,
        composio_enabled: false,
        api_key_set: false,
        error: error?.message || "Failed to read service config",
      },
      { status: 500 },
    );
  }
}
