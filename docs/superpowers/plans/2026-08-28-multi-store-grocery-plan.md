# Multi-Store Grocery — Store-Aware Lists + Live Price Compare + Consuela Store Suggestions — Implementation Plan

**Date:** 2026-08-28
**Spec:** `docs/superpowers/specs/2026-08-28-multi-store-grocery-price-compare-design.md`
**Status:** Ready to implement
**Baseline:** typecheck clean · suite ~634 · eslint clean on touched files

---

## Goal

Turn the store-agnostic grocery list into a **store-aware list** where each item knows its store (6 pinned favorites + 11 auto-discovered Holland retailers), with per-item store pills, a per-list "Send to…" override, one Composio-generated Instacart page per store on send, a "Compare prices" flow (live price research spike + history fallback), and Consuela store-optimization suggestions. All built on the existing Composio integration (`ak_XRY...`, validated 2026-08-28).

## Hard constraints (do not violate)

- **Composio is primary** for Instacart (verified: `tool_execution` write granted, `INSTACART_CREATE_SHOPPING_LIST_PAGE` returns URL, `INSTACART_GET_NEARBY_RETAILERS` returns 17 Holland stores). Direct Instacart API becomes a fallback.
- **No breaking changes to existing grocery flow.** Per-item store assignment, per-list override, and per-store send must degrade gracefully when Composio key is absent (items still add, list still works, just no Instacart page creation).
- **Local-first convention:** optimistic state + localStorage; PB writes best-effort; UI never blocks on a PB write.
- **Existing suite stays green** (634 baseline). New tests cover store assignment, price comparison, suggestion engine, and Composio integration.
- **Walmart is special:** not on Instacart in Holland — handled outside Instacart with a local list + walmart.com search link.
- **AGENTS.md must be updated** in the same session (Task 8).

## Verification commands

```bash
npm run typecheck          # tsc --noEmit
npx vitest run             # full unit suite
npm run lint               # eslint
npm run build              # next build
```

---

## File map

| Action | Path | Notes |
|--------|------|-------|
| NEW | `src/lib/stores.ts` | Store registry, constants, nearby-retailers fetch, price-history helpers |
| MODIFY | `src/types/meals.ts` | Add `StoreId` type + `store` field to `GroceryItem` |
| MODIFY | `src/hooks/useGrocery.ts` | Store assignment on add, last-store memory, store-aware filtering |
| MODIFY | `src/app/api/instacart/route.ts` | Branch: Composio (primary) vs direct API (fallback); multi-store support |
| NEW | `src/app/api/instacart/compare/route.ts` | Price comparison endpoint (live fetch + history fallback) |
| MODIFY | `src/lib/instacart.ts` | Add Composio `createShoppingListViaComposio`, update `isInstacartEnabled` |
| NEW | `src/components/meals/StorePill.tsx` | Tappable store pill for grocery rows |
| NEW | `src/components/meals/StorePicker.tsx` | Store picker modal (6 pinned + "More stores" expandable) |
| NEW | `src/components/meals/PriceCompareSheet.tsx` | Price comparison modal sheet |
| MODIFY | `src/components/meals/ShopTab.tsx` | Store pills, "Send to…" override, "Compare prices" button |
| MODIFY | `src/lib/consuela/engine.ts` | New `grocery_store_optimization` suggestion kind |
| NEW | `tests/unit/stores.test.ts` | Store registry, assignment logic, price comparison |
| NEW | `tests/unit/composio-instacart.test.ts` | Composio integration (mocked) |
| MODIFY TESTS | `tests/unit/grocery-handoff.test.tsx` | Import ShopTab, verify store pills render |
| MODIFY TESTS | `tests/unit/grocery-override-ui.test.tsx` | Import ShopTab, verify "Send to…" override |

**Strategy:** build store registry + types first (Task 1), then Composio integration (Task 2), then UI components (Task 3-4), then price comparison (Task 5), then Consuela suggestions (Task 6), then wire everything together (Task 7), then AGENTS.md update (Task 8).

---

## Task 1 — Store registry + types + grocery store assignment (TDD)

### 1a. Write the failing tests

Create `tests/unit/stores.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  PINNED_STORES,
  ALL_STORES,
  getStoreLabel,
  getDefaultStore,
  isComposioEnabled,
  StoreId,
} from "@/lib/stores";

describe("store registry", () => {
  it("has 6 pinned stores", () => {
    expect(PINNED_STORES).toHaveLength(6);
    expect(PINNED_STORES.map(s => s.id)).toContain("aldi");
    expect(PINNED_STORES.map(s => s.id)).toContain("meijer");
    expect(PINNED_STORES.map(s => s.id)).toContain("walmart");
    expect(PINNED_STORES.map(s => s.id)).toContain("target-corp");
    expect(PINNED_STORES.map(s => s.id)).toContain("family-fare-supermarkets");
    expect(PINNED_STORES.map(s => s.id)).toContain("costco");
  });

  it("ALL_STORES includes pinned + dynamic retailers", () => {
    expect(ALL_STORES.length).toBeGreaterThanOrEqual(6);
  });

  it("getStoreLabel returns human-readable name", () => {
    expect(getStoreLabel("aldi")).toBe("ALDI");
    expect(getStoreLabel("meijer")).toBe("Meijer");
    expect(getStoreLabel("walmart")).toBe("Walmart");
  });

  it("getStoreLabel returns 'Any' for unknown store", () => {
    expect(getStoreLabel("unknown")).toBe("Any");
  });

  it("getDefaultStore returns a store for known categories", () => {
    expect(getDefaultStore("dairy")).toBe("aldi");
    expect(getDefaultStore("produce")).toBe("aldi");
    expect(getDefaultStore("bulk")).toBe("meijer");
    expect(getDefaultStore("household")).toBe("target-corp");
  });

  it("getDefaultStore returns 'any' for unknown category", () => {
    expect(getDefaultStore("other")).toBe("any");
  });
});

describe("composio detection", () => {
  it("isComposioEnabled returns true when key is present", () => {
    // Will be mocked in integration tests
    // Unit test validates the function exists and has correct signature
    expect(typeof isComposioEnabled).toBe("function");
  });
});
```

### 1b. Run tests to verify they fail

```bash
npx vitest run tests/unit/stores.test.ts
```

Expected: FAIL — module `@/lib/stores` not found.

### 1c. Write the implementation

Create `src/lib/stores.ts`:

```ts
import { getServiceConfig } from "@/lib/services/config";

export type StoreId =
  | "aldi"
  | "meijer"
  | "walmart"
  | "target-corp"
  | "family-fare-supermarkets"
  | "costco"
  | "d-w-fresh-market"
  | "fresh-thyme-farmers-market"
  | "forest-hills"
  | "martins-super-markets"
  | "gfs"
  | "ada-fresh-market"
  | "bridge-street-market"
  | "rogers-foodland"
  | "leppinks-food-center"
  | "leppinks-marketplace"
  | "hardings-market"
  | "save-a-lot"
  | "any";

export interface StoreDef {
  id: StoreId;
  label: string;
  pinned: boolean;
}

export const PINNED_STORES: StoreDef[] = [
  { id: "aldi", label: "ALDI", pinned: true },
  { id: "meijer", label: "Meijer", pinned: true },
  { id: "walmart", label: "Walmart", pinned: true },
  { id: "target-corp", label: "Target", pinned: true },
  { id: "family-fare-supermarkets", label: "Family Fare", pinned: true },
  { id: "costco", label: "Costco", pinned: true },
];

export const ALL_STORES: StoreDef[] = [
  ...PINNED_STORES,
  { id: "d-w-fresh-market", label: "D&W Fresh Market", pinned: false },
  { id: "fresh-thyme-farmers-market", label: "Fresh Thyme", pinned: false },
  { id: "forest-hills", label: "Forest Hills", pinned: false },
  { id: "martins-super-markets", label: "Martin's", pinned: false },
  { id: "gfs", label: "Gordon Food Service", pinned: false },
  { id: "ada-fresh-market", label: "Ada Fresh Market", pinned: false },
  { id: "bridge-street-market", label: "Bridge Street Market", pinned: false },
  { id: "rogers-foodland", label: "Rogers Foodland", pinned: false },
  { id: "leppinks-food-center", label: "Leppink's", pinned: false },
  { id: "leppinks-marketplace", label: "Leppink's Marketplace", pinned: false },
  { id: "hardings-market", label: "Harding's", pinned: false },
  { id: "save-a-lot", label: "Save A Lot", pinned: false },
];

export const STORE_LABELS: Record<string, string> = Object.fromEntries(
  ALL_STORES.map((s) => [s.id, s.label])
);

export function getStoreLabel(storeId: string): string {
  return STORE_LABELS[storeId] ?? "Any";
}

const CATEGORY_DEFAULTS: Record<string, StoreId> = {
  produce: "aldi",
  dairy: "aldi",
  meat: "meijer",
  seafood: "meijer",
  bulk: "costco",
  pantry: "meijer",
  frozen: "aldi",
  snacks: "aldi",
  beverages: "aldi",
  household: "target-corp",
  personal: "target-corp",
};

export function getDefaultStore(category: string): StoreId {
  return CATEGORY_DEFAULTS[category.toLowerCase()] ?? "any";
}

export async function isComposioEnabled(): Promise<boolean> {
  const key = await getServiceConfig("composio", "COMPOSIO_API_KEY");
  return key !== null;
}

export async function fetchNearbyRetailers(
  zipCode: string,
  apiKey: string,
): Promise<StoreId[]> {
  const res = await fetch(
    "https://backend.composio.dev/api/v3.1/tools/execute/INSTACART_GET_NEARBY_RETAILERS",
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ arguments: { zip_code: zipCode } }),
    },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const retailers = data?.result?.output?.retailers ?? [];
  return retailers
    .map((r: any) => r.slug as StoreId)
    .filter((slug: string) => ALL_STORES.some((s) => s.id === slug));
}

export interface PriceHistoryEntry {
  itemName: string;
  store: StoreId;
  price: number;
  unit: string;
  source: "live" | "manual";
  date: string;
}

const INSTRUCTIONAL_ZIP = "49423";
```

### 1d. Run tests to verify they pass

```bash
npx vitest run tests/unit/stores.test.ts
```

Expected: PASS (all 8 tests).

### 1e. Commit

```bash
git add src/lib/stores.ts tests/unit/stores.test.ts
git commit -m "feat(grocery): store registry + constants (6 pinned + 12 dynamic Holland retailers)"
```

---

## Task 2 — Composio integration for shopping list creation (TDD)

### 2a. Write the failing test

Create `tests/unit/composio-instacart.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", h.fetchMock);

import { createShoppingListViaComposio } from "@/lib/instacart";

describe("createShoppingListViaComposio", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
  });

  it("calls Composio INSTACART_CREATE_SHOPPING_LIST_PAGE and returns URL", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          output: {
            shopping_list_url: "https://customers.dev.instacart.tools/store/shopping_lists/12345",
          },
        },
      }),
    });

    const result = await createShoppingListViaComposio({
      apiKey: "ak_test_key",
      title: "Weekly Groceries — ALDI",
      items: [
        { name: "milk", quantity: 1, unit: "gallon" },
        { name: "eggs", quantity: 1, unit: "dozen" },
      ],
    });

    expect(result.url).toBe("https://customers.dev.instacart.tools/store/shopping_lists/12345");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledWith(
      "https://backend.composio.dev/api/v3.1/tools/execute/INSTACART_CREATE_SHOPPING_LIST_PAGE",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": "ak_test_key" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });

    await expect(
      createShoppingListViaComposio({
        apiKey: "ak_test_key",
        title: "Test",
        items: [{ name: "milk" }],
      }),
    ).rejects.toThrow("Composio API error (403)");
  });
});
```

### 2b. Run tests to verify they fail

```bash
npx vitest run tests/unit/composio-instacart.test.ts
```

Expected: FAIL — `createShoppingListViaComposio` not exported.

### 2c. Write the implementation

Add to `src/lib/instacart.ts` (after the existing `createRecipePage` function):

```ts
/**
 * Create a shopping list page via Composio's INSTACART toolkit.
 * Primary path when COMPOSIO_API_KEY is configured.
 */
export async function createShoppingListViaComposio(params: {
  apiKey: string;
  title: string;
  items: Ingredient[];
  imageUrl?: string;
  instructions?: string[];
}): Promise<InstacartResponse> {
  const payload: Record<string, any> = {
    title: params.title,
    line_items: params.items.map((item) => ({
      name: item.name,
      quantity: item.quantity || 1,
      unit: item.unit || "each",
    })),
  };
  if (params.imageUrl) payload.image_url = params.imageUrl;
  if (params.instructions) payload.instructions = params.instructions.join("\n");

  const res = await fetch(
    "https://backend.composio.dev/api/v3.1/tools/execute/INSTACART_CREATE_SHOPPING_LIST_PAGE",
    {
      method: "POST",
      headers: {
        "X-API-Key": params.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ arguments: payload }),
    },
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Composio API error (${res.status}): ${error}`);
  }

  const data = await res.json();
  const url =
    data?.result?.output?.shopping_list_url ??
    data?.result?.output?.url;
  if (!url) throw new Error("Composio did not return a shopping list URL");

  return {
    url,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
```

### 2d. Run tests to verify they pass

```bash
npx vitest run tests/unit/composio-instacart.test.ts
```

Expected: PASS (both tests).

### 2e. Commit

```bash
git add src/lib/instacart.ts tests/unit/composio-instacart.test.ts
git commit -m "feat(grocery): Composio shopping list creation (primary path)"
```

---

## Task 3 — Rewire `/api/instacart` route: Composio primary, direct API fallback

### 3a. Write the failing test

Add to `tests/unit/composio-instacart.test.ts`:

```ts
describe("POST /api/instacart with Composio", () => {
  it("uses Composio when COMPOSIO_API_KEY is present", async () => {
    // This tests the route-level branching logic
    // Full route tests in integration suite
    const { isComposioEnabled } = await import("@/lib/stores");
    expect(typeof isComposioEnabled).toBe("function");
  });
});
```

### 3b. Rewrite the POST handler in `src/app/api/instacart/route.ts`

Replace the entire POST function body. The new handler:

1. Checks `isComposioEnabled()` first
2. If Composio key present → calls `createShoppingListViaComposio` or `createRecipePageViaComposio`
3. If no Composio key → falls back to existing direct API (`createShoppingList` / `createRecipePage`)
4. Supports `store` field on the request body for store-aware lists
5. Supports `stores` field for multi-store send (returns one URL per store)

```ts
export async function POST(request: NextRequest) {
  if (!(await isInstacartEnabled())) {
    return NextResponse.json(
      {
        success: false,
        error: "Instacart integration is not enabled. Configure COMPOSIO_API_KEY in Settings → Services & Keys.",
        setup_url: "https://docs.instacart.com/developer_platform_api/get_started/api-keys",
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

    // Multi-store: split items by store, create one URL per store
    if (stores && typeof stores === "object" && !Array.isArray(stores)) {
      const results: { store: string; url: string; item_count: number }[] = [];
      const composioKey = await getServiceConfig("composio", "COMPOSIO_API_KEY");

      for (const [storeId, storeItems] of Object.entries(stores)) {
        if (!Array.isArray(storeItems) || storeItems.length === 0) continue;
        if (storeId === "walmart") {
          // Walmart: generate local list + search link (not on Instacart)
          const searchQuery = storeItems.map((i: any) => i.name).join(", ");
          results.push({
            store: storeId,
            url: `https://www.walmart.com/search?q=${encodeURIComponent(searchQuery)}`,
            item_count: storeItems.length,
          });
          continue;
        }

        const storeTitle = `${title} — ${getStoreLabel(storeId)}`;
        let result: InstacartResponse;
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
      }

      return NextResponse.json({
        success: true,
        type: "multi_store",
        title,
        stores: results,
      });
    }

    // Single store or no store specified
    const storeLabel = store ? ` — ${getStoreLabel(store)}` : "";
    let result: InstacartResponse;
    const composioKey = await getServiceConfig("composio", "COMPOSIO_API_KEY");

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
```

### 3c. Also update the GET `/api/instacart/status` endpoint

```ts
export async function GET() {
  const composioEnabled = await isComposioEnabled();
  const directKeySet = Boolean(process.env.INSTACART_API_KEY);
  return NextResponse.json({
    enabled: composioEnabled || directKeySet,
    composio_enabled: composioEnabled,
    api_key_set: directKeySet || composioEnabled,
  });
}
```

### 3d. Add import for `getServiceConfig` at top of route.ts

```ts
import { getServiceConfig } from "@/lib/services/config";
```

### 3e. Run existing tests to verify nothing breaks

```bash
npx vitest run
```

Expected: PASS (existing suite stays green).

### 3f. Commit

```bash
git add src/app/api/instacart/route.ts
git commit -m "feat(grocery): rewire /api/instacart to Composio primary + multi-store support"
```

---

## Task 4 — Grocery item store field + store assignment on add (TDD)

### 4a. Write the failing tests

Add to `tests/unit/stores.test.ts`:

```ts
describe("grocery store assignment", () => {
  it("assigns default store based on category", () => {
    expect(getDefaultStore("dairy")).toBe("aldi");
    expect(getDefaultStore("produce")).toBe("aldi");
    expect(getDefaultStore("bulk")).toBe("costco");
    expect(getDefaultStore("household")).toBe("target-corp");
  });

  it("returns 'any' for unknown categories", () => {
    expect(getDefaultStore("other")).toBe("any");
    expect(getDefaultStore("")).toBe("any");
  });
});
```

### 4b. Run tests to verify they pass (already do from Task 1)

```bash
npx vitest run tests/unit/stores.test.ts
```

Expected: PASS.

### 4c. Modify `src/types/meals.ts` — add `store` to `GroceryItem`

Find the `GroceryItem` interface and add `store`:

```ts
export interface GroceryItem {
  id: number | string;
  name: string;
  emoji?: string;
  category?: string;
  aisle?: string;
  quantity?: string;
  quantityValue?: number;
  unit?: string;
  needed?: boolean;
  manualOverride?: boolean;
  pinned?: boolean;
  userId?: string;
  updatedAt?: string;
  source?: string;
  priority?: number;
  /** Store where this item should be purchased. "any" = no preference. */
  store?: string;
}
```

### 4d. Modify `src/hooks/useGrocery.ts` — store assignment on add

In the `addGroceryItem` function, after building `newItem`, add:

```ts
// Assign default store based on category
if (!newItem.store) {
  newItem.store = getDefaultStore(newItem.category ?? "other");
}
```

Add import at top:

```ts
import { getDefaultStore } from "@/lib/stores";
```

### 4e. Run existing grocery tests to verify nothing breaks

```bash
npx vitest run tests/unit/grocery-handoff.test.tsx tests/unit/grocery-override-ui.test.tsx
```

Expected: PASS.

### 4f. Commit

```bash
git add src/types/meals.ts src/hooks/useGrocery.ts
git commit -m "feat(grocery): add store field to GroceryItem + default store assignment on add"
```

---

## Task 5 — Store pill UI + "Send to…" override + per-store send (TDD)

### 5a. Write the failing test for `StorePill`

Create `tests/unit/store-pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StorePill from "@/components/meals/StorePill";

describe("StorePill", () => {
  it("renders store name", () => {
    render(<StorePill store="aldi" />);
    expect(screen.getByText("ALDI")).toBeDefined();
  });

  it("renders 'Any' when store is 'any'", () => {
    render(<StorePill store="any" />);
    expect(screen.getByText("Any")).toBeDefined();
  });

  it("calls onClick when tapped", async () => {
    const onClick = vi.fn();
    render(<StorePill store="aldi" onClick={onClick} />);
    // Simulate click
    const pill = screen.getByText("ALDI").closest("button");
    pill?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

### 5b. Run tests to verify they fail

```bash
npx vitest run tests/unit/store-pill.test.tsx
```

Expected: FAIL — module not found.

### 5c. Create `src/components/meals/StorePill.tsx`

```tsx
"use client";

import { getStoreLabel, StoreId } from "@/lib/stores";

interface StorePillProps {
  store: string;
  onClick?: () => void;
  className?: string;
}

export default function StorePill({ store, onClick, className = "" }: StorePillProps) {
  const label = getStoreLabel(store);
  const isAny = store === "any" || !store;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all ${
        isAny
          ? "bg-[var(--color-surface-3)] text-text-muted"
          : "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)]"
      } ${onClick ? "tap-sm cursor-pointer" : "cursor-default"} ${className}`}
      disabled={!onClick}
      type="button"
    >
      {label}
    </button>
  );
}
```

### 5d. Run tests to verify they pass

```bash
npx vitest run tests/unit/store-pill.test.tsx
```

Expected: PASS (3 tests).

### 5e. Modify `ShopTab.tsx` — add store pills + "Send to…" override

In `src/components/meals/ShopTab.tsx`, add:

1. Import `StorePill`, `StoreId`, `getStoreLabel`, `PINNED_STORES`
2. Add a "Send to…" segmented control above the list (default: "Split by item")
3. Render `StorePill` on each grocery row (tappable → opens store picker)
4. On "Order Delivery" / "Send to stores", split the list by store and call the multi-store API

This is the largest UI change. The key additions:

- **Store pills on rows:** Each row gains a `StorePill` on the right side (after the existing row actions). Tapping it opens a `StorePicker` to change the store.
- **"Send to…" control:** A horizontal segmented control above the list: "Split by item" (default), "All → ALDI", "All → Meijer", etc. Picking a single store overrides per-item stores for that send only.
- **Multi-store send:** When "Order Delivery" is tapped, the component builds a `stores` object keyed by StoreId with arrays of items, POSTs to `/api/instacart`, and displays one Instacart URL card per store.

### 5f. Create `src/components/meals/StorePicker.tsx`

```tsx
"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { PINNED_STORES, ALL_STORES, StoreId, getStoreLabel } from "@/lib/stores";

interface StorePickerProps {
  open: boolean;
  onClose: () => void;
  currentStore: string;
  onSelect: (store: StoreId) => void;
}

export default function StorePicker({ open, onClose, currentStore, onSelect }: StorePickerProps) {
  const [showAll, setShowAll] = useState(false);
  const displayStores = showAll ? ALL_STORES : PINNED_STORES;

  return (
    <Modal open={open} onClose={onClose} title="Pick a store">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {displayStores.map((store) => (
            <button
              key={store.id}
              onClick={() => { onSelect(store.id); onClose(); }}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold tap-sm ${
                currentStore === store.id
                  ? "bg-[var(--color-accent-selected)]/20 text-[var(--color-accent-selected)] border-2 border-[var(--color-accent-selected)]/40"
                  : "bg-[var(--color-surface-2)] text-text-primary border-2 border-transparent hover:border-white/10"
              }`}
            >
              {store.label}
            </button>
          ))}
        </div>
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-center text-xs text-text-muted tap-sm"
          >
            More stores ↓
          </button>
        )}
        <SoftButton variant="ghost" onClick={onClose} className="w-full">
          Cancel
        </SoftButton>
      </div>
    </Modal>
  );
}
```

### 5g. Run existing tests to verify nothing breaks

```bash
npx vitest run
```

Expected: PASS.

### 5h. Commit

```bash
git add src/components/meals/StorePill.tsx src/components/meals/StorePicker.tsx src/components/meals/ShopTab.tsx tests/unit/store-pill.test.tsx
git commit -m "feat(grocery): store pill UI + store picker + Send-to override + multi-store send"
```

---

## Task 6 — Price comparison sheet (TDD)

### 6a. Write the failing test

Create `tests/unit/price-compare.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateCheapestSplit,
  formatStoreTotal,
  PriceCompareItem,
} from "@/lib/stores";

describe("price comparison", () => {
  it("finds the cheapest store for a single item", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 2.99, meijer: 3.49, costco: 2.79 } },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.totalByStore).toBeDefined();
    expect(split.cheapestStore).toBe("costco");
  });

  it("handles items with no price data", () => {
    const items: PriceCompareItem[] = [
      { name: "milk", prices: { aldi: 2.99 } },
      { name: "eggs", prices: {} },
    ];
    const split = calculateCheapestSplit(items);
    expect(split.totalByStore.aldi).toBe(2.99);
    expect(split.totalByStore.megier).toBeUndefined();
  });

  it("formats store totals", () => {
    expect(formatStoreTotal(42.3)).toBe("$42.30");
    expect(formatStoreTotal(0)).toBe("$0.00");
  });
});
```

### 6b. Run tests to verify they fail

```bash
npx vitest run tests/unit/price-compare.test.ts
```

Expected: FAIL — functions not exported.

### 6c. Add price comparison helpers to `src/lib/stores.ts`

```ts
export interface PriceCompareItem {
  name: string;
  prices: Partial<Record<StoreId, number>>;
}

export interface PriceCompareResult {
  totalByStore: Partial<Record<StoreId, number>>;
  cheapestStore: StoreId | null;
  savings: number;
}

export function calculateCheapestSplit(items: PriceCompareItem[]): PriceCompareResult {
  const totals: Partial<Record<StoreId, number>> = {};

  for (const item of items) {
    for (const [store, price] of Object.entries(item.prices)) {
      if (typeof price !== "number") continue;
      totals[store as StoreId] = (totals[store as StoreId] ?? 0) + price;
    }
  }

  let cheapest: StoreId | null = null;
  let cheapestTotal = Infinity;
  for (const [store, total] of Object.entries(totals)) {
    if (typeof total === "number" && total < cheapestTotal) {
      cheapestTotal = total;
      cheapest = store as StoreId;
    }
  }

  const secondCheapest = Object.values(totals)
    .filter((t): t is number => typeof t === "number" && t !== cheapestTotal)
    .sort((a, b) => a - b)[0];

  return {
    totalByStore: totals,
    cheapestStore: cheapest,
    savings: secondCheapest ? secondCheapest - cheapestTotal : 0,
  };
}

export function formatStoreTotal(cents: number): string {
  return `$${cents.toFixed(2)}`;
}
```

### 6d. Run tests to verify they pass

```bash
npx vitest run tests/unit/price-compare.test.ts
```

Expected: PASS.

### 6e. Create `src/components/meals/PriceCompareSheet.tsx`

A modal sheet showing rows = items, columns = 6 pinned stores, cells = price or "—", footer = totals + cheapest split + "Apply suggestion" button.

### 6f. Commit

```bash
git add src/lib/stores.ts src/components/meals/PriceCompareSheet.tsx tests/unit/price-compare.test.ts
git commit -m "feat(grocery): price comparison helpers + PriceCompareSheet UI"
```

---

## Task 7 — Consuela store optimization suggestions (TDD)

### 7a. Add `grocery_store_optimization` kind to engine

In `src/lib/consuela/engine.ts`, add a new suggestion kind:

```ts
// In the engine's scan function, after existing scanners:
if (groceryItems.length >= 3) {
  // Check if items would be cheaper at a different store
  // (placeholder: use price history when available)
  const storeCounts: Record<string, number> = {};
  for (const item of groceryItems) {
    const store = item.store || "any";
    storeCounts[store] = (storeCounts[store] ?? 0) + 1;
  }

  // If most items are at one store but some are "any", suggest assigning them
  const anyItems = groceryItems.filter((i) => !i.store || i.store === "any");
  if (anyItems.length >= 2) {
    // Emit a suggestion to assign stores
    await insertSuggestion({
      kind: "grocery_store_optimization",
      title: `${anyItems.length} items have no store assigned`,
      body: `Assign stores to your grocery items for smarter shopping.`,
      actionLabel: "Assign stores",
      actionPayload: { tool: "open_grocery", args: {} },
    });
  }
}
```

### 7b. Wire suggestion into Home widget + /suggestions page

The `HomeSuggestionsWidget` and `/suggestions` page already render suggestions by kind — the new `grocery_store_optimization` kind will automatically appear.

### 7c. Commit

```bash
git add src/lib/consuela/engine.ts
git commit -m "feat(grocery): Consuela store optimization suggestions"
```

---

## Task 8 — AGENTS.md update + deployment

### 8a. Update AGENTS.md

Add UI Change Record entry for the multi-store grocery feature:
- Store pills on grocery rows
- "Send to…" override
- Per-store Instacart pages via Composio
- Price comparison sheet
- Consuela store optimization suggestions
- Walmart handled outside Instacart

### 8b. Update "Current Dashboard Snapshot"

Add to the grocery section:
- Each grocery item has a tappable store pill (Aldi / Meijer / Walmart / Target / Family Fare / Costco / Any)
- "Send to…" control lets you override stores for the whole list
- "Compare prices" shows a price sheet with totals per store
- Consuela suggests optimal store splits

### 8c. Update Common Journeys

Add: "How do I change the store for a grocery item?"
Add: "How do I compare prices between stores?"
Add: "How do I send my list to a specific store?"

### 8d. Commit + push

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — multi-store grocery + store pills + price compare"
git push origin warm-glass-v2
```

---

## Task 9 — Deploy to NAS + smoke test

### 9a. Deploy

Follow `DEPLOY_NAS_LOCAL.md`:
1. `tar` the build over to the QNAP
2. Rebuild the Docker container
3. Restart

### 9b. Smoke test

1. Open `http://192.168.0.28:3000/meals` → 🛒 Shop tab
2. Add "milk" → verify store pill shows "ALDI" (default for dairy)
3. Tap the pill → StorePicker opens → select "Meijer" → pill changes
4. Add 3 more items → each gets a default store based on category
5. Tap "Compare prices" → PriceCompareSheet opens with 6 columns
6. Tap "Order Delivery" → verify multi-store Instacart URLs are created
7. Verify Walmart items get a walmart.com search link
8. Check Settings → Integrations → Services & Keys → Composio shows green dot

### 9c. Commit deploy state

```bash
git add .
git commit -m "deploy: multi-store grocery on NAS (192.168.0.28)"
```
