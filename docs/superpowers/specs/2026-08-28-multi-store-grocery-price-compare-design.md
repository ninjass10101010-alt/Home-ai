# Multi-Store Grocery — Store-Aware Lists + Live Price Compare + Consuela Store Suggestions

**Date:** 2026-08-28
**Status:** Draft — awaiting implementation plan
**Scope:** Single spec for store-aware grocery, price comparison with live-research fallback, and Consuela suggestions
**Decision:** Approach B — build store-aware lists and research live prices together in the first slice (live prices are the research spike, history is the fallback)

## 1. Overview & Goals

For the Garcia family in Holland, MI (49423) who splits shopping across **Aldi, Meijer, and Walmart** (favorite three) and also uses **Target, Family Fare, and Costco**.

- Turn the current store-agnostic grocery list into a **store-aware list** where each item knows its store (with per-item defaults + a one-tap per-list override).
- On send, generate **one Instacart shopping page per store via Composio** (`ak_XRY...`, validated 2026-08-28: `tool_execution` write granted, `INSTACART_GET_NEARBY_RETAILERS` returns 17 retailers for 49423 including ALDI + Meijer, `INSTACART_CREATE_SHOPPING_LIST_PAGE` returns a URL). Walmart is not on Instacart in Holland, so its items go to a separate "Walmart" list (local + walmart.com search link).
- Add a **"Compare & suggest"** step: attempt to fetch live prices at the 6 pinned stores, fall back to price history when live data isn't exposed, and surface the cheapest split.
- Live inside the existing grocery flow: grocery tab → "Compare prices" / "Send to…" → per-store Instacart pages. No rebuild needed for Composio key — already saved as `COMPOSIO_API_KEY` in PocketBase (`db` source).

Success: A user can add "milk," see it default to Aldi, tap "Compare" to see Aldi $2.99 vs Meijer $3.39, let Consuela suggest "Move dairy to Aldi — save ~$2," and send one-tap per-store Instacart pages labeled by store.

## 2. Architecture

- **Composio is primary** for Instacart (tools: `INSTACART_CREATE_SHOPPING_LIST_PAGE`, `INSTACART_GET_NEARBY_RETAILERS`, `INSTACART_CREATE_RECIPE_PAGE`, `INSTACART_CREATE_INSTACART_RECIPE_LINK`). Auth is `X-API-Key: ak_XRY...` via `POST /api/v3.1/tools/execute/{slug}` (text-based payload works; `arguments` object also supported). No `keys.` partner key required (`NO_AUTH` toolkit).
- **Direct Instacart API** (`src/lib/instacart.ts` → `https://connect.instacart.com/idp/v1`) remains as a legacy fallback; Composio is the default path. `src/app/api/instacart/route.ts` will branch: if `COMPOSIO_API_KEY` is set, call Composio; else fall back to direct `keys.` key if present.
- **Store data** lives with the grocery item + a small **price_history** collection (see §3). Store registry is dynamic: 6 pinned + the rest from `GET_NEARBY_RETAILERS` for 49423 (refreshed on dashboard load), so new stores appear without a code change.
- **Walmart boundary:** Instacart does not list Walmart in Holland (confirmed 17 retailers, no Walmart). Walmart items are flagged "outside Instacart" — we generate the list locally and link to `https://www.walmart.com/search?q=...` or a future Walmart API without blocking Aldi/Meijer flows.
- **Services config:** Composio key managed via Settings → Integrations → Services & Keys (`composio` service, `COMPOSIO_API_KEY`). Runtime is non-secret client config (`weather_location` already uses it); Composio key stays server-only.

## 3. Data Model

- **GroceryItem** extension (in `src/types/meals.ts` / `src/hooks/useGrocery.ts`):
  - New field `store: StoreId` where `StoreId = "aldi" | "meijer" | "walmart" | "target-corp" | "family-fare-supermarkets" | "costco" | "any"` (any = no preference). Migration: existing items → `"any"`.
  - Defaults per category + last-store memory: `produce/dairy → aldi`, `bulk/meat/pantry → meijer/costco`, `household → target/family-fare` (tunable map). Also remembers the last store you sent that normalized item name to.
- **price_history** (new PocketBase collection):
  - Fields: `itemName` (normalized lowercase), `store` (StoreId), `price` (number), `unit` (string, e.g., "each", "gallon"), `source: "live" | "manual"`, `date` (ISO), `expires?` (optional).
  - Index: `(itemName, store)`. Written on live fetch success and on manual price entry.
- **Store registry** (in code, not PB):
  - Pinned: `aldi`, `meijer`, `walmart`, `target-corp`, `family-fare-supermarkets`, `costco` (labels: ALDI, Meijer, Walmart, Target, Family Fare, Costco).
  - Dynamic: remaining 11 Holland retailers from `GET_NEARBY_RETAILERS` (e.g., `d-w-fresh-market`, `fresh-thyme-farmers-market`, `forest-hills`, `martins-super-markets`, `gfs`, `ada-fresh-market`, `bridge-street-market`, `rogers-foodland`, `leppinks-*`, `hardings-market`, `save-a-lot-*`). Fetched on dashboard mount and cached per ZIP.

## 4. Store Assignment Flow

- **Per-item:** When adding an item, assign `store` via: last-store memory for that normalized name → category default → `"any"`. The row shows a small tappable store pill (e.g., "Aldi") that opens a store picker (6 pinned on top, "More stores" expandable for the other 11). Changing the pill updates the item and its memory.
- **Per-list override:** A "Send to…" segmented control above the grocery list: `Any | Aldi | Meijer | Walmart | Target | Family Fare | Costco | Split by item` (default "Split by item"). Picking a single store overrides per-item stores for that send only; "Split by item" respects each row's pill.
- **On send:** Split the list by `store`. For each non-empty non-Walmart group, call `INSTACART_CREATE_SHOPPING_LIST_PAGE` via Composio (text payload: `Create a shopping list titled "Weekly Groceries — ALDI" with line_items [...]`). For Walmart group, generate a local list + `https://www.walmart.com/search?q=...` link. Return one card per store with its URL and item count (e.g., "ALDI — 5 items → Open in Instacart"), each clearly labeled — no mixing of stores in a single page.

## 5. Price Comparison (Live + Fallback)

- **Trigger:** "Compare prices" button next to "Order Delivery" (or automatically when the grocery list has ≥3 items and hasn't been compared recently).
- **Live fetch (research spike):** Attempt to fetch live prices for the current list at the 6 pinned stores. Research path: Composio product search (if available for instacart toolkit), else a direct store product API (Walmart Open API, etc.). This is the spike — we validate whether Aldi/Meijer live prices are fetchable for 49423. Payload is text-based (`Get price for milk at ALDI` style) or `arguments` object if the pricing tool exposes structured inputs.
- **Fallback:** For any store/item where live price is not exposed (expected for most Instacart items — pricing is only shown on the Instacart page itself), show the latest entry from `price_history` with a note: "showing your last seen price from 2026-08-20 (live price not available)". If no history, show "—".
- **Presentation:** Modal sheet — rows = items, columns = 6 pinned stores, cells = `$X.XX` or `—` or `~$X.XX (history)`. Footer: totals per store and a highlighted "Cheapest split" (e.g., "Aldi $42.30 vs Meijer $48.90 — save $6.60 by moving dairy to Aldi"). An "Apply suggestion" button moves items to their cheapest store.
- **Non-blocking:** Price research never blocks sending. If live fetching fails entirely, the compare button still shows history-based suggestions.

## 6. Consuela Suggestions

- **Kind:** New suggestion kind `grocery_store_optimization` (in `src/lib/consuela/engine.ts`, alongside `pantry_low`, `task_penalty_streak`, `calendar_conflict`, `stale_data`).
- **When:** The engine watches the grocery list (on grocery add/toggle and on schedule) and emits when a cheaper split is detected: ≥$1.50 savings or ≥2 items belong to a different store per history.
- **What:** Specific, actionable copy: `title: "Milk & yogurt cheaper at Aldi"`, `body: "You paid $0.40 less for milk at Aldi last time — move 2 dairy items to Aldi to save ~$2.80 this trip."`, `actionLabel: "Move to Aldi"`, `actionPayload: { tool: "move_grocery_items", args: { itemNames: ["milk","yogurt"], store: "aldi" } }`.
- **Where:** Inline in the grocery tab as a small suggestion card ("Consuela suggests: Send dairy to Aldi, save ~$3" with "Move" / "Dismiss"), plus the full `/suggestions` feed for the complete list. Uses the existing suggestion dedup (`kind + normalized title`).

## 7. UI/UX

- **Grocery tab (ShopTab):** Each row gains a tappable store pill on the right (shows store name, e.g., "Aldi", gray for "Any"). Header gains the "Send to…" control (segmented control + "Split by item" default) and the "Compare prices" button. Existing category filter, manual add, and sync remain.
- **Price sheet:** Modal (using existing `SyncPreviewSheet` pattern or a new `PriceCompareSheet`): rows = items with store pills, columns = 6 pinned stores, cells show price/history/—, footer shows totals + cheapest split + "Apply suggestion". Close + "Send to stores" action.
- **On send:** After the per-store split, show one result card per store with its Instacart URL (ALDI — 5 items → Open in Instacart), Meijer card, etc., plus a Walmart card with a walmart.com search link. Each card is clearly labeled by store — no combined mixed-store page.
- **Design language:** Pastel bento cards in the grocery tab retain the warm-glass language; store pills use the existing `Chip`/`SoftButton` patterns; icons are emoji (🛒, 🏷️) to keep the family-friendly tone.

## 8. Error Handling & Testing

- **Error handling:**
  - Live price fetch fails → cell shows "live price unavailable" and falls back to history; banner: "Live prices not available for [store] — showing your history."
  - Composio `CREATE_SHOPPING_LIST_PAGE` fails → show "Couldn't create [Store] page — try again" with retry and a fallback `https://www.instacart.com/store/search?query=...` link per item.
  - Walmart items: always flagged "outside Instacart" — no failure, just a local list + search link.
  - Offline / Composio down → grocery list still works locally; "Compare prices" is disabled with "Connect to compare prices."
- **Testing:**
  - Unit: store assignment (category defaults, per-item override, per-list override, migration from `"any"`), price comparison (cheapest split calculation, history fallback, total computation), suggestion engine (emits when savings threshold met, dedup).
  - Integration: mock Composio `INSTACART_CREATE_SHOPPING_LIST_PAGE` and `GET_NEARBY_RETAILERS` for 49423 (verifies 6 pinned + 11 others, one URL per store, Walmart excluded from Instacart path); mock `price_history` reads.
  - No live pricing in tests — all pricing mocked via history.
  - Manual QA: add milk to Aldi, eggs to Meijer, hit Compare, verify sheet shows totals and suggestion; send split list, verify two Instacart URLs open.

## 9. Open Questions & Future

- **Live price source:** Instacart pages show prices but the toolkit does not expose a price-fetch tool. Research whether a product-search pricing API exists for Aldi/Meijer in 49423 (Composio, Walmart Open API, or Instacart hidden pricing). If none is reliable, ship with history-based suggestions and add live prices as a future enhancement without blocking the core feature.
- **Walmart integration:** Walmart's own grocery API vs manual search link — evaluate after Aldi/Meijer slice ships.
- **ZIP handling:** Currently 49423 (Holland). If the family shops in a different ZIP, the nearby-retailers fetch should re-run per ZIP; defer multi-ZIP support to a follow-up.

