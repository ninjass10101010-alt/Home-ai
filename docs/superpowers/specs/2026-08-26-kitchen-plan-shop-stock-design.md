# Kitchen Redesign — Plan → Shop → Stock

**Date:** 2026-08-26
**Status:** Approved design, pending implementation
**Predecessors:** `2026-08-05-kitchen-ui-redesign-design.md`, `.superpowers/ui-scan/kitchen.md`, `.superpowers/ui-scan/recipe-import-research.md`

---

## 1. Why

The Kitchen page grew four tabs (Meals / Grocery / Pantry / Recipes) whose UI no longer matches the backend logic:

- The same sync function is exposed under multiple labels ("Sync from Meals", "Sync from Pantry", "Mark all as needed", a fake "Sync" StatTile) — nobody can tell what each does.
- The pantry tip claims grocery→pantry sync is automatic; it is a manual "Send to pantry" action.
- A "Grocery items to restock" panel adds **unbought** grocery items directly into the pantry — backwards.
- Two near-identical category grids on Grocery (Quick Add presets + list filter).
- Row actions (pin/delete/edit) are invisible on touch; the grocery checkbox target is too small.
- Recipes is a separate tab that only exists to feed the planner.

The mental model the backend actually implements is a three-step loop: **plan meals → shop what's missing → stock the pantry**. The redesign restructures the UI around that loop and explains it on every screen.

## 2. Goals / Non-goals

**Goals**
- Restructure Kitchen into three tabs that mirror the loop: 🍽️ Plan, 🛒 Shop, 🥫 Stock.
- Fold Recipes into Plan (no standalone tab).
- One "How it works" card (`KitchenFlowCard`) on every tab with a live summary.
- Reduce sync surface from 4 confusing buttons to 2 clearly-labeled actions, each with a preview-before-commit step.
- Fix the touch/UX bugs from the UI scan.
- Remove features that don't work or duplicate each other.

**Non-goals**
- No backend or PocketBase schema changes. Hooks (`useGrocery`, `usePantry`, `useMeals`) and sync services stay as-is (local-first, fixed 2026-08-26).
- No new external APIs (Spoonacular / Mealie / Telegram import remain deferred per recipe-import research).
- No changes to the capsule nav or other pages.

## 3. Structure

### 3.1 Tabs

| Tab | Icon | Replaces |
|-----|------|----------|
| Plan | 🍽️ | Meals + Recipes |
| Shop | 🛒 | Grocery |
| Stock | 🥫 | Pantry |

### 3.2 Deep-link mapping (legacy params keep working)

| URL param | Lands on |
|-----------|----------|
| `?tab=meals` | Plan |
| `?tab=recipes` | Plan, scrolled to the Recipe box |
| `?tab=grocery` | Shop |
| `?tab=pantry` | Stock |
| no param | Plan |

### 3.3 KitchenFlowCard (top of every tab)

A compact card, same `WidgetCard` family, containing:

- **Stepper:** `Plan → Shop → Stock`, current step highlighted.
- **One sentence** for the current step:
  - Plan: "Pick this week's meals — missing ingredients become your shopping list."
  - Shop: "Check items off as you buy them — bought items move into your pantry."
  - Stock: "Track what you have — items running low go back on the shopping list."
- **Live summary line**, computed from real state:
  - Plan: "12 meals planned · 5 ingredients missing"
  - Shop: "8 items to buy · 3 checked off"
  - Stock: "24 stocked · 3 running low · 1 out"
- **Collapsible** — collapse state remembered in localStorage.

## 4. Tab layouts

### 4.1 🍽️ Plan

Top to bottom:

1. KitchenFlowCard (step 1).
2. **Who's eating tonight** strip — kept; ghost-member count fixed (L1 from UI scan).
3. **Week nav + day strip** — kept, including copy-day 📋 and duplicate-meal ↗️.
4. **Meal slots** for the active day — kept.
5. **✨ AI Suggest / Generate week** — kept.
6. **Recipe box** (collapsible section at the bottom, absorbs the old Recipes tab):
   - Search the catalog.
   - 🌐 Web Import (existing modal with preview/edit).
   - 📖 TheMealDB search (existing modal).
   - Tapping a recipe offers "Add to {day} as {slot}".
   - No separate filter-chip wall; the catalog list uses the existing card grid.

### 4.2 🛒 Shop

1. KitchenFlowCard (step 2).
2. **Add item** — one input + add button. No preset grid, no category pills, no priority selector.
3. **Buy again** — one horizontal scrollable chip row (emoji + name). Tap adds the item straight back to the list; mint ✓ if already on it. Populated from items checked off / sent to pantry (same source as the old Recently Bought). Renders nothing when empty.
4. **The list** — grouped by category with slim section headers (emoji + name + count). Category filter is a single horizontal chip row (not the 2×2 grid).
5. **One sync action:** "🍽️ Add missing from meal plan" — with preview (§5).
6. **Check off → bulk bar** — "Send N to pantry" + 8s Undo banner. Kept.
7. **📌 Pin** per row — kept, with a visible ≥44px touch target.

### 4.3 🥫 Stock

1. KitchenFlowCard (step 3).
2. **Pantry grid** — status sections (Plenty / Running Low / Out) as a slim chip row, not 2×2 cards.
3. **One sync action:** "🛒 Add low & out to grocery list" — with preview (§5).
4. **Cook with what you have** — kept; "Missing: …" list wraps to 2 lines (`line-clamp-2`) instead of truncating.
5. **✨ Add staples** — kept, collapsed by default.

## 5. Sync preview pattern (adapted from Copy Me That / Mealie / Tandoor)

Both sync actions share one component (`SyncPreviewSheet`) and one 4-beat flow:

1. **Tap** the sync button.
2. **Preview sheet** slides up: "This will add N items to your grocery list:" + item list (emoji + name + qty). Buttons: **Add N** / **Cancel**.
   - If nothing to add: no sheet — an inline line "Nothing to add — your plan is fully stocked ✓" (Shop) / "Nothing running low ✓" (Stock).
3. **Working state** — button shows a spinner, disabled, "Adding…".
4. **Result line** replaces the button for ~4s: "Added 5 · 2 were already on list" or an honest failure ("Couldn't reach the database — items not added"). Where items moved (pantry send), the existing 8s **Undo** banner still applies.

Rules: no blind dumps, no silent no-ops, no fake success. The "already on list" count comes from the same normalized-name dedupe the hooks already use.

## 6. Removals

- Recently Bought section (replaced by the Buy again row).
- Grocery Quick Add preset grid + category pills + priority selector.
- "Grocery items to restock" panel (backwards: added unbought grocery items to pantry).
- Fake Sync StatTile.
- Duplicate sync buttons — 4 → 2, one per tab.
- Wrong pantry tip claiming sync is automatic.
- Use-it-up banner + Pantry overview + tip card (replaced by KitchenFlowCard).
- Infinite `popBounce` emoji animation on Kitchen surfaces (calm planner rule, AGENTS.md §1.3).
- RecipesTab as a standalone tab.

## 7. Fixes folded in

- Row actions (pin/delete/edit) get real visible hit targets on touch.
- Grocery checkbox ≥44px.
- "Missing: …" ingredient list wraps to 2 lines (M3).
- Pantry add form async-return bug.
- SegmentedControl label wrap at 320px (L2).
- Ghost member excluded from "Who's eating" count (C1/L1).

## 8. Scope

**Rewrite**
- `src/components/meals/MealsTab.tsx` → PlanTab (absorbs RecipesTab catalog/import/search as the Recipe box).
- `src/components/meals/GroceryTab.tsx` → ShopTab.
- `src/components/meals/PantryTab.tsx` → StockTab.

**New**
- `src/components/meals/KitchenFlowCard.tsx`
- `src/components/meals/SyncPreviewSheet.tsx`

**Delete**
- `src/components/meals/RecipesTab.tsx` (functionality absorbed into PlanTab).

**Modified**
- `src/app/meals/page.tsx` — 3 tabs, legacy param mapping, wiring.

**Untouched**
- Hooks (`useGrocery`, `usePantry`, `useMeals`, `useRecipes`), sync services, PB schema, all API routes.

## 9. Verification

- **Unit tests:** sync-preview computation (what-will-be-added, already-on-list dedupe counts), Buy again population, KitchenFlowCard summary lines, legacy tab-param mapping.
- **Existing suite** stays green (569 tests baseline).
- **Playwright (390px):** full loop — plan a meal → preview adds missing → shop checks off → send to pantry → undo works → low items preview back to list. Guest mode (all writes 401) still works local-first.
- **Typecheck + lint + build** clean.
- **AGENTS.md** updated (mandatory for Kitchen changes): snapshot + UI Change Record + journeys.

## 10. Decisions log

| Decision | Choice |
|----------|--------|
| Restructure approach | Full restructure, 3 tabs rebuilt around the loop (not a wizard, not incremental) |
| Recipes | Folded into Plan as a collapsible Recipe box |
| Sync buttons | 2 clearly-labeled actions, each with preview-before-commit |
| Recently Bought | Kept as slimmed "Buy again" chip row (fast re-order, Instacart/AnyList pattern) |
| Keep | pin (visible), undo banner, pantry staples collapsed, Who's eating, AI Suggest/Generate |
| Cut | preset grids, category pill walls, priority, restock panel, fake Sync tile, duplicate sync buttons, wrong tip, popBounce |
| Backend | No changes |
