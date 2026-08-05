# Kitchen UI Redesign

**Date:** 2026-08-05
**Status:** Approved
**Scope:** Grocery tab (Plan/Shop duplication, checked→pantry handoff, Quick Add hierarchy), Kitchen tabs overall coherence.

## Problem

1. **Plan/Shop duplication.** GroceryTab has a Plan/Shop mode toggle. Both modes render the same categorized shopping list with checkboxes — Plan adds the add form/quick-add/sync rail on top, Shop adds a progress bar and bigger checkboxes. The list is editable in two places, which is confusing.
2. **Checked → pantry gap.** There is no way to move checked-off shopping items into the pantry. `clearCompleted` *deletes* `!needed` items entirely. Pantry's "Grocery items to restock" panel only surfaces *needed* grocery items, so checked-off (bought) items vanish from the system instead of becoming pantry inventory.
3. **Quick Add hierarchy.** The Quick Add category selector and its preset items render as two nearly identical 2-col grids of glass cards; users cannot distinguish selectors from items.

## Design (approved decisions)

### 1. Single-list Grocery tab — remove the Plan/Shop toggle

One canonical place to add and check off items. New layout:

**Main column:**
- **Quick Add card** (`SectionCard` "⚡ Quick Add", description "Tap a category, then tap items to add"), moved to its own card:
  - Manual add form (TextField + Add + Qty/Category/Priority selects) at top
  - Recently Bought chips under a divider
  - **Category pills row**: horizontal scrollable rounded-full pills `🥬 Produce` … `🧽 Household` with preset-count badges; selected pill = accent fill (`--color-accent-selected` + white text), unselected = glass chip
  - Label row between pills and grid: `🥬 Produce · 12 items`
  - **Items grid**: existing 2-col glass cards; already-on-list items dimmed (60% opacity, mint border), name in mint, ✓ checkmark instead of `+`, `disabled` (PantryTab pattern at `PantryTab.tsx:222-246`); "Show N more ↓" (6/page); dashed empty state for categories without presets
- **Category filter row** (2-col grid of glass cards — All + 8 categories with "N picked up" subtitles, unchanged)
- **Shopping list**: `SectionCard`s grouped by category (existing Plan-mode list, unchanged rows), each with `catPicked/catItems` count action
  - Row actions: edit ✏, delete 🗑, and a mint **"Add to pantry"** button shown only on **checked** rows
- **Bulk bar** — appears only when ≥1 items checked:
  - Mobile: sticky pill above the list ("Send N to pantry" · "Clear N" · "Re-check all")
  - Desktop (xl): a SectionCard row under the list, same three actions
- **Undo banner** — transient in-list banner after a Bulk Send (~8s): "Sent N items to pantry · Undo". Undo restores the rows to the grocery list and removes them from the pantry. Implemented with local GroceryTab state (no global Toast retrofit).

**Right rail (xl desktop only, unchanged from current Plan rail):**
- Shopping progress (pct + bar + "Clear N checked")
- Sync from Meals / Sync from Pantry buttons
- Auto-added from meals summary

On mobile/tablet the rail collapses to a single column above the list (progress + sync buttons).

### 2. Checked → pantry handoff

- **Individual**: checked rows get a mint "🥫 Add to pantry" button; tap → `addPantryItem(name, "plenty")` + `deleteGroceryItem(id)` + toast.
- **Bulk**: "Send N to pantry" → for each checked item, `addPantryItem(name, "plenty")` (naturally deduped — `addPantryItem` returns false on existing pantry items), then delete all checked grocery rows; toast "Sent N items to pantry" + Undo banner.
- `useGrocery.sendCheckedToPantry` (or component-level logic) removes `!needed` rows from state after the pantry writes; `meals/page.tsx` passes `addPantryItem` + `removePantryItem` into GroceryTab.
- **Undo** semantics: restore the deleted grocery rows from a snapshot, and remove the just-added pantry items (by name, case-insensitive, via `removePantryItem` on matched ids).

### 3. Other Kitchen tabs

- Meals, Pantry, Recipes tabs: **unchanged** — Pantry's "Grocery items to restock" panel stays (it handles *needed* items you discover you lack; the new bulk-send handles *bought* items).

## Matching rules

- Already-added preset detection: preset counts as added when a `needed` grocery item matches by case-insensitive normalized name (mirror `useGrocery`'s `normalizeName`).
- Bulk-send skip: `addPantryItem` already returns `false` for pantry duplicates; count only successful adds in the toast ("Sent 3 of 4 items to pantry").

## Files

- `src/components/meals/GroceryTab.tsx` — rewrite (main change)
- `src/hooks/useGrocery.ts` — add `sendCheckedToPantry` + `sendSingleToPantry` (or equivalent)
- `src/app/meals/page.tsx` — pass `addPantryItem`/`removePantryItem` to GroceryTab
- `AGENTS.md` — UI Change Record + "Current Dashboard Snapshot" per repo convention

## Testing

- `tsc --noEmit`, `npm run lint`, `npm run build` clean.
- Playwright @ 375px & 1280px:
  1. Quick Add: pills scroll, no horizontal page scroll; ✓ on already-added presets, disabled
  2. Add item → correct category section; check → strike-through + mint "Add to pantry" on row
  3. Check 2 → bulk bar "Send 2 to pantry" → pantry gains 2 (plenty), grocery rows gone → Undo restores rows and clears pantry
  4. Category filter, progress bar, sync buttons work; no Plan/Shop toggle remains
