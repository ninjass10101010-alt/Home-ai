# Grocery Quick Add redesign

**Date:** 2026-08-05
**Status:** Approved
**Scope:** `src/components/meals/GroceryTab.tsx` (Plan mode, "Quick Add" block)

## Problem

In the Grocery page's Quick Add section, the category selector (Produce, Dairy, etc.) and the preset items for the selected category (Bananas, Avocados, etc.) render as two nearly identical 2-column grids of glass cards. Both rows use the same emoji + label card shape, so users cannot tell which cards are categories to pick and which cards are items to add.

## Design

### 1. Structure

- Replace the 2-column category card grid with a single horizontal, scrollable row of **rounded-full pill selectors**: `🥬 Produce` `🥛 Dairy` `🥩 Meat` `🍝 Pantry` `🧊 Frozen` `🍿 Snacks` `☕ Beverages` `🧽 Household`, each with its preset-count badge.
- Selected pill uses accent fill (`--color-accent-selected`, white text); unselected pills use the glass chip treatment. Pills are unmistakably "selectors" — shape contrast with the item cards below establishes the hierarchy.
- Item cards stay as the existing 2-column grid (`grid grid-cols-2 gap-2`).
- Add a small label row between the pills and the grid showing the active category, e.g. `🥬 Produce · 12 items`.
- Move the entire Quick Add block into its **own `SectionCard`** ("⚡ Quick Add", description: "Tap a category, then tap items to add") placed below the "Add Item" card, so manual form, Recently Bought, and Quick Add each have clean card boundaries.

### 2. Already-added state

Reuse the exact PantryTab pattern (`src/components/meals/PantryTab.tsx` preset items): an item already on the grocery list renders dimmed (60% opacity, mint-tinted border), name in mint, with a ✓ checkmark instead of `+`, and is `disabled` so it cannot be double-added. A preset counts as "already added" when a `needed` grocery item matches its name, case-insensitively (mirrors `useGrocery`'s duplicate check).

### 3. Unchanged behavior

- Default category: `produce`; `PRESETS_PER_PAGE = 6` with "Show N more ↓" toggle.
- Dashed empty state for categories with no presets (Frozen, Household).
- Recently Bought chips, manual add form, category filter, and Shop mode are untouched.

## Files

- `src/components/meals/GroceryTab.tsx` — only file changed. `SectionCard` import already present. `groceryPresets`/`groceryCategories` data unchanged.

## Testing

- `tsc --noEmit`, `npm run lint`, `npm run build` clean.
- Manual/Playwright check at 375px: pill row scrolls without page-level horizontal scroll; selected pill and item cards are visually distinct; already-added preset shows ✓ and cannot be re-added.
- AGENTS.md UI Change Record + "Current Dashboard Snapshot" updated per repo convention.
