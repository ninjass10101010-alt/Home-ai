# Kitchen Redesign — Plan → Shop → Stock — Implementation Plan

**Date:** 2026-08-26
**Spec:** `docs/superpowers/specs/2026-08-26-kitchen-plan-shop-stock-design.md`
**Status:** Ready to implement
**Baseline:** typecheck clean · `npx vitest run` 569/569 · eslint only 2 pre-existing unused-disable warnings

---

## Goal

Restructure the Kitchen page (`/meals`) from four tabs (Meals / Grocery / Pantry / Recipes) into three tabs that mirror the backend loop — **🍽️ Plan → 🛒 Shop → 🥫 Stock** — with a shared `KitchenFlowCard` on every tab, two preview-backed sync actions (down from four confusing buttons), Recipes folded into Plan as a collapsible Recipe box, and the touch/UX bugs from the UI scan fixed.

## Hard constraints (do not violate)

- **No backend / PocketBase / schema changes.** Hooks (`useGrocery`, `usePantry`, `useMeals`, `useRecipes`) and sync services stay as-is (local-first, fixed 2026-08-26). We only ADD two pure preview methods to `MealSyncService`.
- **Local-first convention:** optimistic state + localStorage; PB writes best-effort; UI never blocks on a PB write.
- **Existing suite stays green** (569 baseline). The two GroceryTab tests are re-pointed at ShopTab and must still pass — their asserted behaviors (bulk handoff, undo, pin) are preserved.
- **Calm planner surfaces** (AGENTS.md §1.3): no new float/bob/scale/translate motion on Kitchen. All new motion is one-shot, CSS-only, `prefers-reduced-motion`-safe.
- **≥44px** touch targets for the grocery checkbox and row actions.
- **AGENTS.md must be updated** in the same session (Task 10).

## Verification commands

```bash
npm run typecheck          # tsc --noEmit
npx vitest run             # full unit suite (baseline 569)
npm run lint               # eslint
npm run build              # next build
```

---

## File map

| Action | Path | Notes |
|--------|------|-------|
| MODIFY | `src/services/mealSync.ts` | Add `SyncPreviewItem`, `SyncPreview`, `previewMealPlanToGrocery`, `previewPantryToGrocery` (pure) |
| NEW | `src/lib/kitchen-tabs.ts` | Legacy `?tab=` param → new tab mapping |
| NEW | `src/components/meals/KitchenFlowCard.tsx` | Stepper card, collapsible, localStorage |
| NEW | `src/components/meals/SyncPreviewSheet.tsx` | Shared preview-before-commit modal |
| NEW | `src/components/meals/PlanTab.tsx` | from MealsTab; absorbs Recipe box |
| NEW | `src/components/meals/ShopTab.tsx` | from GroceryTab |
| NEW | `src/components/meals/StockTab.tsx` | from PantryTab |
| NEW | `src/components/meals/RecipeBox.tsx` | from RecipesTab (Task 8 rename) |
| MODIFY | `src/types/meals.ts` | `Tab` → `"plan" \| "shop" \| "stock"` |
| MODIFY | `src/app/meals/page.tsx` | 3 tabs, legacy mapping, wiring, summaries |
| MODIFY | `src/components/meals/CookWithWhatYouHave.tsx` | `line-clamp-2` on "Missing: …" |
| MODIFY | `src/components/ui/SegmentedControl.tsx` | label `whitespace-nowrap` (L2) |
| DELETE | `src/components/meals/MealsTab.tsx` `GroceryTab.tsx` `PantryTab.tsx` `RecipesTab.tsx` | after replacements wired (Task 8) |
| NEW TESTS | `tests/unit/meal-sync-preview.test.ts` `kitchen-tabs.test.ts` `kitchen-flow-card.test.tsx` `sync-preview-sheet.test.tsx` | |
| MODIFY TESTS | `tests/unit/grocery-handoff.test.tsx` `grocery-override-ui.test.tsx` | import ShopTab |

**Strategy:** create the new tab files alongside the old ones, wire `page.tsx` to each new tab as it lands (keeps every commit green), then delete the four old files in Task 8.

---

## Task 1 — Sync preview methods on `MealSyncService` (TDD)

These are **pure, in-memory** methods (no `db`, no `async`). They reuse the existing private matching/deficit logic so the preview is guaranteed to agree with the real sync. The confirm step (in the tabs) commits via the already-local-first `addGroceryItem`, so no DB-writing sync method is needed.

### 1a. Write the failing test

Create `tests/unit/meal-sync-preview.test.ts`. It needs the same `@/db` mock as `tests/unit/meal-sync.test.ts` because importing `mealSync.ts` imports `db` at module load (the preview methods themselves never call it).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ state: { grocery: [] as any[], pantry: [] as any[], meals: [] as any[] } }));

vi.mock("@/db", () => ({
  db: {
    selectGrocery: async () => h.state.grocery.map(r => ({ ...r })),
    selectPantry: async () => h.state.pantry.map(r => ({ ...r })),
    selectMeals: async () => h.state.meals.map(r => ({ ...r })),
    upsertGroceryItem: async (item: any) => ({ id: "g_new", ...item }),
  },
}));

import { mealSyncService } from "@/services/mealSync";

describe("mealSyncService.previewMealPlanToGrocery", () => {
  it("lists missing ingredients not in pantry or grocery", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, [], []);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ name: "Chicken breast", quantity: "3 lb", category: "meat", priority: "high" });
    expect(preview.alreadyOnList).toBe(0);
  });

  it("counts an ingredient already on the grocery list as alreadyOnList, not a new item", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const grocery = [{ id: "g1", name: "Chicken breast", source: "meal-plan", manualOverride: false, needed: true } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, [], grocery);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(1);
  });

  it("skips ingredients already stocked in the pantry (no deficit)", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["3 lb Chicken breast"], servings: 4 } as any];
    const pantry = [{ id: "p1", item: "Chicken breast", name: "Chicken breast", status: "plenty", quantity: 5 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, pantry, []);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(0);
  });

  it("treats pantry items that only have `item` (no `name`) as stock", () => {
    const meals = [{ id: 1, name: "Dinner", time: "Mon", ingredients: ["2 cups Rice"], servings: 4 } as any];
    const pantry = [{ id: "p1", item: "Rice", status: "plenty", quantity: 5 } as any];
    const preview = mealSyncService.previewMealPlanToGrocery(meals, pantry, []);
    expect(preview.items).toHaveLength(0);
  });
});

describe("mealSyncService.previewPantryToGrocery", () => {
  it("lists low/out pantry items not already on the grocery list", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "low" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ name: "Milk", quantity: "1", category: "dairy", priority: "medium" });
  });

  it("marks out-of-stock items high priority", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "out" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items[0].priority).toBe("high");
  });

  it("counts items already on the grocery list as alreadyOnList", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "out" } as any];
    const grocery = [{ id: "g1", name: "Milk", source: "pantry-check", manualOverride: false, needed: true } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, grocery);
    expect(preview.items).toHaveLength(0);
    expect(preview.alreadyOnList).toBe(1);
  });

  it("skips pantry items that are plenty", () => {
    const pantry = [{ id: "p1", item: "Milk", name: "Milk", status: "plenty" } as any];
    const preview = mealSyncService.previewPantryToGrocery(pantry, []);
    expect(preview.items).toHaveLength(0);
  });
});
```

Run: `npx vitest run tests/unit/meal-sync-preview.test.ts` → **fails** (methods don't exist).

### 1b. Implement

In `src/services/mealSync.ts`:

1. Add the exported interfaces just below the existing `SyncResult` interface (top of file):

```ts
export interface SyncPreviewItem {
  name: string;
  quantity: string;
  category: string;
  priority: "low" | "medium" | "high";
}

export interface SyncPreview {
  items: SyncPreviewItem[];
  alreadyOnList: number;
}
```

2. Add these two public methods inside `class MealSyncService` (place them right after `syncPantryToGrocery`, before `toggleManualOverride`). Note the pantry normalization (`p.name || p.item`) — hook pantry items carry `item`, not `name`, and the private `findPantryStock`/`ingredientNamesMatch` read `.name`.

```ts
  previewMealPlanToGrocery(meals: Meal[], pantryItems: PantryItem[], groceryItems: GroceryListItem[]): SyncPreview {
    const pantry = (pantryItems || []).map(p => ({ ...p, name: p.name || p.item || "" }));
    const items: SyncPreviewItem[] = [];
    let alreadyOnList = 0;
    const ingredientDeficits = new Map<string, RequiredIngredient>();

    for (const meal of meals || []) {
      for (const ingredient of this.calculateRequiredIngredients(meal)) {
        const key = this.normalizeIngredientName(ingredient.name);
        const pantryStock = this.findPantryStock(pantry, ingredient.name);
        const deficit = this.calculateDeficit(ingredient, pantryStock);
        if (deficit <= 0) continue;
        const accumulated = ingredientDeficits.get(key);
        if (accumulated) accumulated.quantity += deficit;
        else ingredientDeficits.set(key, { ...ingredient, quantity: deficit });
      }
    }

    for (const [, ingredient] of ingredientDeficits) {
      const existing = (groceryItems || []).find(g =>
        !g.manualOverride && !this.isManualSource(g.source) && this.ingredientNamesMatch(g.name, ingredient.name)
      );
      if (existing) { alreadyOnList++; continue; }
      items.push({
        name: ingredient.name,
        quantity: this.formatQuantity(ingredient.quantity, ingredient.unit),
        category: ingredient.category,
        priority: this.getPriorityForDeficit(ingredient.quantity),
      });
    }

    return { items, alreadyOnList };
  }

  previewPantryToGrocery(pantryItems: PantryItem[], groceryItems: GroceryListItem[]): SyncPreview {
    const items: SyncPreviewItem[] = [];
    let alreadyOnList = 0;
    const seen = new Set<string>();

    for (const raw of pantryItems || []) {
      if (raw.status === "plenty") continue;
      const name = raw.name || raw.item || "";
      if (!name) continue;
      const key = this.normalizeIngredientName(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = (groceryItems || []).find(g =>
        !g.manualOverride && !this.isManualSource(g.source) && this.ingredientNamesMatch(g.name, name)
      );
      if (existing) { alreadyOnList++; continue; }
      const category = this.getCategoryForIngredient(name);
      items.push({
        name,
        quantity: "1",
        category,
        priority: raw.status === "out" ? "high" : "medium",
      });
    }

    return { items, alreadyOnList };
  }
```

> `RequiredIngredient` is already declared in this file (module-private interface) — reuse it as-is. No new imports needed.

### 1c. Verify + commit

```bash
npx vitest run tests/unit/meal-sync-preview.test.ts   # 8 pass
npx vitest run tests/unit/meal-sync.test.ts           # still 3 pass
npm run typecheck
```
Commit: `feat(kitchen): add pure sync-preview methods to MealSyncService`

---

## Task 2 — Legacy tab-param mapping helper (TDD)

Deep links (`?tab=grocery`, `?tab=recipes`, etc.) must keep working. This helper is pure and independent of the `Tab` type change (it exports its own union; Task 8 aligns `types/meals.ts`).

### 2a. Failing test — `tests/unit/kitchen-tabs.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mapKitchenTabParam, isRecipesDeepLink } from "@/lib/kitchen-tabs";

describe("mapKitchenTabParam", () => {
  it("maps legacy params to the new tabs", () => {
    expect(mapKitchenTabParam("meals")).toBe("plan");
    expect(mapKitchenTabParam("recipes")).toBe("plan");
    expect(mapKitchenTabParam("grocery")).toBe("shop");
    expect(mapKitchenTabParam("pantry")).toBe("stock");
  });
  it("accepts the new params unchanged", () => {
    expect(mapKitchenTabParam("plan")).toBe("plan");
    expect(mapKitchenTabParam("shop")).toBe("shop");
    expect(mapKitchenTabParam("stock")).toBe("stock");
  });
  it("defaults to plan for null/unknown", () => {
    expect(mapKitchenTabParam(null)).toBe("plan");
    expect(mapKitchenTabParam("bogus")).toBe("plan");
  });
});

describe("isRecipesDeepLink", () => {
  it("is true only for ?tab=recipes", () => {
    expect(isRecipesDeepLink("recipes")).toBe(true);
    expect(isRecipesDeepLink("meals")).toBe(false);
    expect(isRecipesDeepLink(null)).toBe(false);
  });
});
```

Run → fails (module missing).

### 2b. Implement — `src/lib/kitchen-tabs.ts`

```ts
export type KitchenTab = "plan" | "shop" | "stock";

const LEGACY_MAP: Record<string, KitchenTab> = {
  meals: "plan",
  recipes: "plan",
  grocery: "shop",
  pantry: "stock",
  plan: "plan",
  shop: "shop",
  stock: "stock",
};

export function mapKitchenTabParam(param: string | null): KitchenTab {
  if (!param) return "plan";
  return LEGACY_MAP[param] ?? "plan";
}

export function isRecipesDeepLink(param: string | null): boolean {
  return param === "recipes";
}
```

### 2c. Verify + commit

```bash
npx vitest run tests/unit/kitchen-tabs.test.ts   # 4 pass
npm run typecheck
```
Commit: `feat(kitchen): add legacy tab-param mapping helper`

---

## Task 3 — `KitchenFlowCard` component (TDD)

Shared "How it works" card: stepper `Plan → Shop → Stock` (current highlighted), one sentence for the step, a live summary line, collapsible with collapse state remembered in localStorage. Same `WidgetCard` family. No new motion beyond existing `.tap-sm`.

### 3a. Failing test — `tests/unit/kitchen-flow-card.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import KitchenFlowCard from "@/components/meals/KitchenFlowCard";

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<KitchenFlowCard {...props} />); });
  return el;
}

describe("KitchenFlowCard", () => {
  beforeEach(() => { document.body.innerHTML = ""; localStorage.clear(); });

  it("renders the stepper with the current step highlighted", async () => {
    const root = await render({ step: "shop", summary: "8 items to buy · 3 checked off" });
    expect(root.textContent).toContain("Plan");
    expect(root.textContent).toContain("Shop");
    expect(root.textContent).toContain("Stock");
    const current = Array.from(root.querySelectorAll("[aria-current='step']"));
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Shop");
  });

  it("shows the step sentence and the live summary", async () => {
    const root = await render({ step: "plan", summary: "12 meals planned · 5 ingredients missing" });
    expect(root.textContent).toContain("Pick this week's meals");
    expect(root.textContent).toContain("12 meals planned · 5 ingredients missing");
  });

  it("collapses and remembers the collapse state", async () => {
    const root = await render({ step: "stock", summary: "24 stocked · 3 running low · 1 out" });
    const toggle = Array.from(root.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "Collapse kitchen flow card") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    expect(root.textContent).not.toContain("24 stocked");
    expect(localStorage.getItem("consuela-kitchen-flow-collapsed")).toBe("1");
  });
});
```

Run → fails (component missing).

### 3b. Implement — `src/components/meals/KitchenFlowCard.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import WidgetCard from "@/components/patterns/WidgetCard";

export type KitchenStep = "plan" | "shop" | "stock";

const STEPS: { id: KitchenStep; label: string; emoji: string }[] = [
  { id: "plan", label: "Plan", emoji: "🍽️" },
  { id: "shop", label: "Shop", emoji: "🛒" },
  { id: "stock", label: "Stock", emoji: "🥫" },
];

const STEP_SENTENCE: Record<KitchenStep, string> = {
  plan: "Pick this week's meals — missing ingredients become your shopping list.",
  shop: "Check items off as you buy them — bought items move into your pantry.",
  stock: "Track what you have — items running low go back on the shopping list.",
};

const STEP_TONE: Record<KitchenStep, string> = {
  plan: "#10b981",
  shop: "#3b82f6",
  stock: "#f59e0b",
};

const COLLAPSE_KEY = "***";

export default function KitchenFlowCard({ step, summary }: { step: KitchenStep; summary: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* SSR/no storage */ }
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* no storage */ }
      return next;
    });
  };

  const active = STEPS.find(s => s.id === step) ?? STEPS[0];

  return (
    <WidgetCard tone={STEP_TONE[step]} icon={active.emoji} className="p-5 pl-[72px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Kitchen flow">
          {STEPS.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-xs text-text-muted">→</span>}
              <span
                aria-current={s.id === step ? "step" : undefined}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${
                  s.id === step
                    ? "bg-[var(--color-accent-button)] text-white"
                    : "bg-[var(--color-surface-2)] text-text-muted"
                }`}
              >
                {s.emoji} {s.label}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand kitchen flow card" : "Collapse kitchen flow card"}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-text-muted hover:text-text-primary tap-sm"
        >
          {mounted && collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {(!mounted || !collapsed) && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-text-primary">{STEP_SENTENCE[step]}</p>
          <p className="mt-1 text-xs font-bold text-text-secondary">{summary}</p>
        </div>
      )}
    </WidgetCard>
  );
}
```

> The `mounted` gate means the first client render matches the server (expanded), then the stored preference applies — no hydration mismatch.

### 3c. Verify + commit

```bash
npx vitest run tests/unit/kitchen-flow-card.test.tsx   # 3 pass
npm run typecheck
```
Commit: `feat(kitchen): add KitchenFlowCard stepper card`

---

## Task 4 — `SyncPreviewSheet` component (TDD)

Shared preview-before-commit bottom sheet built on the existing `Modal`. Lists the items that will be added (emoji + name + qty), shows the "already on list" count, and has **Add N** / **Cancel** buttons with a busy ("Adding…") state.

### 4a. Failing test — `tests/unit/sync-preview-sheet.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";

const preview = {
  items: [
    { name: "Chicken breast", quantity: "3 lb", category: "meat", priority: "high" as const },
    { name: "Milk", quantity: "1", category: "dairy", priority: "medium" as const },
  ],
  alreadyOnList: 2,
};

async function render(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<SyncPreviewSheet {...props} />); });
  return el;
}

function makeProps(overrides: any = {}) {
  const calls = { confirm: 0, cancel: 0 };
  return {
    props: {
      open: true,
      title: "Add missing from meal plan",
      preview,
      busy: false,
      onConfirm: () => { calls.confirm++; },
      onCancel: () => { calls.cancel++; },
      ...overrides,
    },
    calls,
  };
}

describe("SyncPreviewSheet", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("lists the items and the Add N button", async () => {
    const { props } = makeProps();
    const root = await render(props);
    expect(root.textContent).toContain("Chicken breast");
    expect(root.textContent).toContain("Milk");
    const add = Array.from(root.querySelectorAll("button")).find(b => /Add 2/.test(b.textContent || ""));
    expect(add).toBeTruthy();
  });

  it("shows the already-on-list count", async () => {
    const { props } = makeProps();
    const root = await render(props);
    expect(root.textContent).toMatch(/2 more already on your list/);
  });

  it("calls onConfirm when Add is tapped", async () => {
    const { props, calls } = makeProps();
    const root = await render(props);
    const add = Array.from(root.querySelectorAll("button")).find(b => /Add 2/.test(b.textContent || "")) as HTMLButtonElement;
    await act(async () => { add.click(); });
    expect(calls.confirm).toBe(1);
  });

  it("shows Adding… and disables confirm while busy", async () => {
    const { props } = makeProps({ busy: true });
    const root = await render(props);
    const add = Array.from(root.querySelectorAll("button")).find(b => /Adding/.test(b.textContent || "")) as HTMLButtonElement;
    expect(add).toBeTruthy();
    expect(add.disabled).toBe(true);
  });
});
```

Run → fails (component missing).

### 4b. Implement — `src/components/meals/SyncPreviewSheet.tsx`

```tsx
"use client";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { groceryCategories } from "@/data/meals";
import type { SyncPreview } from "@/services/mealSync";

const emojiFor = (category: string) => groceryCategories.find(c => c.id === category)?.emoji || "📦";

interface SyncPreviewSheetProps {
  open: boolean;
  title: string;
  preview: SyncPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SyncPreviewSheet({ open, title, preview, busy, onConfirm, onCancel }: SyncPreviewSheetProps) {
  const count = preview.items.length;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={`This will add ${count} item${count === 1 ? "" : "s"} to your grocery list:`}
      footer={
        <>
          <SoftButton variant="primary" size="md" onClick={onConfirm} disabled={busy} className="flex-1">
            {busy ? "Adding…" : `Add ${count}`}
          </SoftButton>
          <SoftButton variant="ghost" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </SoftButton>
        </>
      }
    >
      <ul className="nice-scroll max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {preview.items.map(item => (
          <li key={`${item.name}-${item.category}`} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <span className="text-lg" aria-hidden>{emojiFor(item.category)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{item.name}</span>
            <span className="shrink-0 text-xs font-bold text-text-muted">{item.quantity}</span>
          </li>
        ))}
      </ul>
      {preview.alreadyOnList > 0 && (
        <p className="mt-3 text-xs font-semibold text-text-muted">
          {preview.alreadyOnList} more already on your list — they won&apos;t be added again.
        </p>
      )}
    </Modal>
  );
}
```

### 4c. Verify + commit

```bash
npx vitest run tests/unit/sync-preview-sheet.test.tsx   # 4 pass
npm run typecheck
```
Commit: `feat(kitchen): add SyncPreviewSheet preview-before-commit modal`

---

## Task 5 — `PlanTab` (from MealsTab, absorbs Recipe box)

Create `src/components/meals/PlanTab.tsx` as a copy of `MealsTab.tsx`, then apply these changes. Leave `MealsTab.tsx` in place (unused) until Task 8 deletes it.

**Props changes** (the component uses `: any` props, so just add/remove usages):
- Remove usages of `setActiveTab`, `handleSyncMealToGrocery`, `isSyncing`.
- Add `flowSummary: string` and `focusRecipeBox?: boolean`.
- Add the recipe-box props (same names RecipesTab receives): `saveCatalogRecipe, deleteCatalogRecipe, addRecipeToPlan, addRecipeToGrocery, startAddRecipe, startEditRecipe, handleFileUpload, openImportModal, openSearchModal`. (`recipes` and `activeDay` are already received.)

**Edits:**

1. **Rename** `export default function MealsTab(` → `export default function PlanTab(`.

2. **Import** at top:
   ```tsx
   import KitchenFlowCard from "@/components/meals/KitchenFlowCard";
   import RecipesTab from "@/components/meals/RecipesTab";
   ```
   (RecipesTab is rendered as the Recipe box until Task 8 renames it to RecipeBox.)

3. **Add state** near the other `useState` calls:
   ```tsx
   const [showRecipeBox, setShowRecipeBox] = useState(false);
   ```
   And an effect to honor the `?tab=recipes` deep link (open + scroll into view):
   ```tsx
   useEffect(() => {
     if (!focusRecipeBox) return;
     setShowRecipeBox(true);
     const t = setTimeout(() => {
       document.getElementById("kitchen-recipe-box")?.scrollIntoView({ behavior: "smooth", block: "start" });
     }, 50);
     return () => clearTimeout(t);
   }, [focusRecipeBox]);
   ```

4. **Fix ghost member (L1/C1).** In the `familyMembers` `useMemo`, filter out blank names. Change both return paths:
   ```tsx
   const familyMembers = useMemo(() => {
     if (!mounted) return db.selectMembers().filter((m: any) => (m.name || "").trim()).slice(0, 6);
     return ((db as any).selectMembersDetailed?.()?.filter?.((m: any) => m.role !== "Pet" && m.role !== "pet" && (m.name || "").trim()) ??
       db.selectMembers().filter((m: any) => (m.name || "").trim()).slice(0, 6));
   }, [mounted]);
   ```

5. **Remove the sync button.** Delete the entire "Actions" block (the `{activeMeals.length > 0 && ( … 🔄 Sync to Grocery … )}` section, ~lines 542–553 in MealsTab).

6. **Remove the Smart Tip card.** Delete the "Smart Tip" `glass-subtle` block in the right column (~lines 723–739), the `tip` `useMemo` (~lines 148–154), and drop `smartTips` from the `@/data/meals` import.

7. **Add `KitchenFlowCard` at the very top** of the returned JSX (first child inside `<div className="space-y-6 pb-6">`):
   ```tsx
   <KitchenFlowCard step="plan" summary={flowSummary} />
   ```

8. **Add the collapsible Recipe box at the bottom** (after the AI Suggestions `<section>`, before the final closing `</div>`):
   ```tsx
   <div id="kitchen-recipe-box" className="glass rounded-2xl scroll-mt-24">
     <button
       onClick={() => setShowRecipeBox(v => !v)}
       aria-expanded={showRecipeBox}
       className="flex w-full items-center justify-between px-5 py-4 tap-sm"
     >
       <span className="flex items-center gap-2 text-sm font-bold text-text-primary">📖 Recipe box</span>
       <svg className={`h-4 w-4 text-text-secondary transition-transform ${showRecipeBox ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
         <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
       </svg>
     </button>
     {showRecipeBox && (
       <div className="border-t border-white/10 p-5">
         <RecipesTab
           recipes={recipes}
           activeDay={activeDay}
           saveCatalogRecipe={saveCatalogRecipe}
           deleteCatalogRecipe={deleteCatalogRecipe}
           addRecipeToPlan={addRecipeToPlan}
           addRecipeToGrocery={addRecipeToGrocery}
           startAddRecipe={startAddRecipe}
           startEditRecipe={startEditRecipe}
           handleFileUpload={handleFileUpload}
           openImportModal={openImportModal}
           openSearchModal={openSearchModal}
         />
       </div>
     )}
   </div>
   ```

**Wire in `page.tsx`** (meals branch only, keep the other 3 tabs untouched for now):
- Import `PlanTab from "@/components/meals/PlanTab"` (keep the `MealsTab` import until Task 8, or remove it now if it becomes unused — run lint).
- Replace `<MealsTab …>` with `<PlanTab …>` and add the new props: `flowSummary={planSummary}`, `focusRecipeBox={focusRecipeBox}`, and the recipe-box props listed above (they already exist in page scope: `saveCatalogRecipe, deleteCatalogRecipe, addRecipeToPlan, addRecipeToGrocery, startAddRecipe, startEditRecipe, handleFileUpload, openImportModal, openSearchModal`).
- `planSummary` / `focusRecipeBox` are computed in Task 8; for this task, pass a temporary `flowSummary={`${meals.length} meals planned`} />` and `focusRecipeBox={false}` so it compiles. (Task 8 replaces these with the real computed values.)

### Verify + commit
```bash
npm run typecheck
npx vitest run          # full suite still green
```
Commit: `feat(kitchen): PlanTab — flow card, recipe box, ghost-member fix, sync button removed`

---

## Task 6 — `ShopTab` (from GroceryTab)

Create `src/components/meals/ShopTab.tsx` as a copy of `GroceryTab.tsx`, then apply these changes. **Preserve** `sendSingleToPantry`, `sendCheckedToPantry`, `handleUndo`, `pushUndo`, `clearCompleted`, `markAllNeeded`, `bulkActions`, the edit-row logic, and the pin toggle **exactly** — the two grocery tests assert these behaviors.

**Props:** keep all existing props (the tests pass them). Add `flowSummary: string` and `meals: Meal[]` (import `Meal` type). The preview uses `meals`, `pantryItems`, `groceryItems`.

**Edits:**

1. **Rename** `export default function GroceryTab(` → `export default function ShopTab(`.

2. **Imports:** add
   ```tsx
   import KitchenFlowCard from "@/components/meals/KitchenFlowCard";
   import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";
   import { mealSyncService, type SyncPreview } from "@/services/mealSync";
   ```
   Remove `groceryPresets` from the `@/data/meals` import (Quick Add presets are gone). Keep `groceryCategories`.

3. **Add sync-preview state + handlers** (near the other state):
   ```tsx
   const [preview, setPreview] = useState<SyncPreview | null>(null);
   const [syncBusy, setSyncBusy] = useState(false);
   const [syncNote, setSyncNote] = useState<string | null>(null);
   const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

   const flashNote = (msg: string) => {
     setSyncNote(msg);
     if (noteTimer.current) clearTimeout(noteTimer.current);
     noteTimer.current = setTimeout(() => setSyncNote(null), 4000);
   };

   const openMealSync = () => {
     const p = mealSyncService.previewMealPlanToGrocery(meals || [], pantryItems || [], groceryItems);
     if (p.items.length === 0) {
       flashNote(p.alreadyOnList > 0
         ? `Nothing to add — ${p.alreadyOnList} item${p.alreadyOnList === 1 ? "" : "s"} already on your list ✓`
         : "Nothing to add — your plan is fully stocked ✓");
       return;
     }
     setPreview(p);
   };

   const confirmMealSync = async () => {
     if (!preview || syncBusy) return;
     const toAdd = preview.items;
     const already = preview.alreadyOnList;
     setSyncBusy(true);
     try {
       let added = 0;
       for (const item of toAdd) {
         const ok = await addGroceryItem(item.name, item.category, item.priority, undefined, item.quantity, "", true, true);
         if (ok) added++;
       }
       setPreview(null);
       flashNote(`Added ${added} · ${already} were already on list`);
     } catch {
       setPreview(null);
       flashNote("Couldn't reach the database — items not added");
     } finally {
       setSyncBusy(false);
     }
   };
   ```

4. **`KitchenFlowCard` at the top** of the returned JSX:
   ```tsx
   <KitchenFlowCard step="shop" summary={flowSummary} />
   ```

5. **Replace the whole "Quick Add" `SectionCard`** with a single add input + Buy again row (no preset grid, no category pills, no priority/qty selectors):
   ```tsx
   <div className="space-y-3">
     <div className="flex gap-2">
       <TextField
         value={newGroceryItem}
         onChange={e => setNewGroceryItem(e.target.value)}
         onKeyDown={e => e.key === "Enter" && handleAdd()}
         placeholder='Add an item — e.g. "2 bananas" or "milk"'
         className="flex-1 min-w-0"
       />
       <SoftButton variant="primary" size="md" onClick={handleAdd} disabled={!newGroceryItem.trim()}>Add</SoftButton>
     </div>

     {recentlyBought && recentlyBought.length > 0 && (
       <div>
         <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">🔁 Buy again</p>
         <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
           {recentlyBought.map((item: { name: string; emoji: string; category: string }) => {
             const onList = groceryItems.some((i: any) => normalizeName(i.name) === normalizeName(item.name));
             return (
               <button
                 key={item.name}
                 onClick={() => !onList && addGroceryItem(item.name, item.category, "medium", item.emoji)}
                 disabled={onList}
                 className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold tap-sm ${
                   onList
                     ? "border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/10 text-[var(--color-accent-mint)]"
                     : "border-white/10 glass-subtle text-text-primary hover:border-[var(--color-accent-selected)]/30"
                 }`}
               >
                 <span aria-hidden>{item.emoji}</span>
                 <span>{item.name}</span>
                 {onList && <span aria-hidden>✓</span>}
               </button>
             );
           })}
         </div>
       </div>
     )}
   </div>
   ```
   Simplify `handleAdd` to always auto-guess the category (no category/priority selectors remain):
   ```tsx
   const handleAdd = async () => {
     if (!newGroceryItem.trim()) return;
     const parsed = parseManualGroceryInput(newGroceryItem);
     await addGroceryItem(parsed.name, guessCategory(parsed.name), "medium", undefined, parsed.quantity, "");
     setNewGroceryItem("");
   };
   ```
   Delete the now-unused state: `newGroceryQuantity`, `newGroceryCategory`, `newGroceryPriority`, `presetCategory`, `showAllPresets`, and `handlePresetTap` / `handleRecentTap`.

6. **One sync action.** Replace the right-rail sync `Surface` (the two `SoftButton`s "Sync from Meals" / "Sync from Pantry") with a single preview-backed button + result line. Put it near the top of the list column:
   ```tsx
   <div className="glass rounded-2xl p-4">
     <SoftButton variant="primary" size="md" onClick={openMealSync} disabled={syncBusy} className="w-full">
       🍽️ {syncBusy ? "Adding…" : "Add missing from meal plan"}
     </SoftButton>
     {syncNote && <p role="status" className="mt-2 text-center text-xs font-semibold text-text-secondary">{syncNote}</p>}
   </div>
   ```
   Remove the `syncMealToGrocery`, `syncPantryToGrocery`, and `isSyncing` usages (the props can stay in the signature harmlessly, but don't render the old buttons). Remove the "Auto-added from meals" SectionCard.

7. **Category filter → single horizontal chip row** (replace the 2×2 `grid grid-cols-2` filter block):
   ```tsx
   <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
     <button
       onClick={() => setActiveCategory("all")}
       className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tap-sm ${
         activeCategory === "all" ? "bg-[var(--color-accent-selected)] text-white" : "glass-subtle text-text-secondary hover:text-text-primary"
       }`}
     >
       🛒 All
     </button>
     {groceryCategories.map(cat => {
       const count = groceryItems.filter((i: any) => i.category === cat.id).length;
       return (
         <button
           key={cat.id}
           onClick={() => setActiveCategory(cat.id)}
           className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold tap-sm ${
             activeCategory === cat.id ? "bg-[var(--color-accent-selected)] text-white" : "glass-subtle text-text-secondary hover:text-text-primary"
           }`}
         >
           {cat.emoji} {cat.name}{count > 0 ? ` · ${count}` : ""}
         </button>
       );
     })}
   </div>
   ```

8. **Checkbox ≥44px.** In the list rows, change the leading checkbox `button` from `h-7 w-7` to a 44px tap target with the visual square inside:
   ```tsx
   <button
     onClick={(e) => { e.stopPropagation(); toggleGroceryNeeded(item.id); }}
     aria-label={!item.needed ? `Uncheck ${item.name}` : `Check off ${item.name}`}
     className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl tap-sm"
   >
     <span className={`flex h-7 w-7 items-center justify-center rounded-xl border-2 ${
       !item.needed
         ? "border-[var(--color-accent-mint)] bg-[var(--color-accent-mint)] text-white"
         : "border-[var(--color-surface-4)] bg-[var(--color-surface-0)]/50"
     }`}>
       {!item.needed && (
         <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
           <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
         </svg>
       )}
     </span>
   </button>
   ```

9. **Visible row actions (pin/edit/delete) with real hit targets.** In the row `trailing`, make the pin, edit, and delete buttons always visible (remove the `opacity-60 hover:opacity-100` wrapper and the `sm:opacity-0` hover-only pattern) and give each a ≥44px target (`h-11 w-11 flex items-center justify-center`). **Keep the exact pin `aria-label`s** (`lock ${item.name} from auto-sync` / `unlock ${item.name} for auto-sync`) — the override test asserts them. Keep the priority `Chip` and the `🥫 Pantry` button as-is.

10. **Mount the preview sheet** once, near the end of the component JSX:
    ```tsx
    <SyncPreviewSheet
      open={!!preview}
      title="Add missing from meal plan"
      preview={preview || { items: [], alreadyOnList: 0 }}
      busy={syncBusy}
      onConfirm={confirmMealSync}
      onCancel={() => setPreview(null)}
    />
    ```

**Keep** the shopping list `SectionCard`s, the undo banner, the desktop bulk bar, and the mobile sticky bulk bar unchanged (they carry the tested behaviors).

**Wire in `page.tsx`** (grocery branch): import `ShopTab`, replace `<GroceryTab …>` with `<ShopTab …>`, add `meals={meals}` and `flowSummary={shopSummary}` (use a temporary string until Task 8 computes it).

**Update the two tests** to import ShopTab:
- `tests/unit/grocery-handoff.test.tsx`: `import ShopTab from "@/components/meals/ShopTab";` and render `<ShopTab {...props} />`. Add `meals: []` and `flowSummary: ""` to `makeProps` (harmless). Keep all assertions.
- `tests/unit/grocery-override-ui.test.tsx`: same import/render swap; add `meals: []`, `flowSummary: ""`.

### Verify + commit
```bash
npm run typecheck
npx vitest run tests/unit/grocery-handoff.test.tsx tests/unit/grocery-override-ui.test.tsx   # all pass
npx vitest run    # full suite green
```
Commit: `feat(kitchen): ShopTab — flow card, buy-again, single preview sync, 44px targets`

---

## Task 7 — `StockTab` (from PantryTab)

Create `src/components/meals/StockTab.tsx` as a copy of `PantryTab.tsx`, then apply these changes.

**Props:** keep `pantryItems, groceryItems, addPantryItem, updatePantryStatus, removePantryItem`. Add `flowSummary: string` and `addGroceryItem` (needed to commit the preview). Remove `syncPantryToGrocery` and `isSyncing` usages.

**Edits:**

1. **Rename** `export default function PantryTab(` → `export default function StockTab(`.

2. **Imports:** add
   ```tsx
   import KitchenFlowCard from "@/components/meals/KitchenFlowCard";
   import SyncPreviewSheet from "@/components/meals/SyncPreviewSheet";
   import { mealSyncService, type SyncPreview } from "@/services/mealSync";
   ```
   Remove the `Link` import if it becomes unused after removing the "Ask Consuela"/"Find recipes" links.

3. **Fix the async add bug** (spec §7). `addPantryItem` is async and returns `PantryItem | false`; the current code reads the Promise as truthy. Change `handleAdd`:
   ```tsx
   const handleAdd = async (name?: string) => {
     const itemName = (name ?? newPantryItem).trim();
     if (!itemName) return;
     const saved = await addPantryItem(itemName, newPantryStatus);
     if (saved !== false) setNewPantryItem("");
   };
   ```
   Update the Add button to `onClick={() => handleAdd()}` (already fine) and `handlePresetTap` to `await addPantryItem(name, "plenty")` if you want the input-clear semantics; otherwise leave it.

4. **Add sync-preview state + handlers** (same shape as ShopTab, but pantry→grocery):
   ```tsx
   const [preview, setPreview] = useState<SyncPreview | null>(null);
   const [syncBusy, setSyncBusy] = useState(false);
   const [syncNote, setSyncNote] = useState<string | null>(null);
   const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

   const flashNote = (msg: string) => {
     setSyncNote(msg);
     if (noteTimer.current) clearTimeout(noteTimer.current);
     noteTimer.current = setTimeout(() => setSyncNote(null), 4000);
   };

   const openPantrySync = () => {
     const p = mealSyncService.previewPantryToGrocery(pantryItems || [], groceryItems || []);
     if (p.items.length === 0) {
       flashNote(p.alreadyOnList > 0
         ? `Nothing running low that isn't already on your list ✓`
         : "Nothing running low ✓");
       return;
     }
     setPreview(p);
   };

   const confirmPantrySync = async () => {
     if (!preview || syncBusy) return;
     const toAdd = preview.items;
     const already = preview.alreadyOnList;
     setSyncBusy(true);
     try {
       let added = 0;
       for (const item of toAdd) {
         const ok = await addGroceryItem(item.name, item.category, item.priority, undefined, item.quantity, "", true, true);
         if (ok) added++;
       }
       setPreview(null);
       flashNote(`Added ${added} · ${already} were already on list`);
     } catch {
       setPreview(null);
       flashNote("Couldn't reach the database — items not added");
     } finally {
       setSyncBusy(false);
     }
   };
   ```
   (Add `useRef` to the react import.)

5. **`KitchenFlowCard` at the top:**
   ```tsx
   <KitchenFlowCard step="stock" summary={flowSummary} />
   ```

6. **One sync action.** Replace the old `🔄 Sync Low/Out → Grocery` button with:
   ```tsx
   <div className="glass rounded-2xl p-4">
     <SoftButton variant="primary" size="md" onClick={openPantrySync} disabled={syncBusy} className="w-full">
       🛒 {syncBusy ? "Adding…" : "Add low & out to grocery list"}
     </SoftButton>
     {syncNote && <p role="status" className="mt-2 text-center text-xs font-semibold text-text-secondary">{syncNote}</p>}
   </div>
   ```

7. **Status sections → slim chip row.** Replace the 2×2 `SECTIONS` grid with a horizontal chip row (same pattern as ShopTab's category chips), using the existing `SECTIONS` array and counts.

8. **Remove** (spec §6): the 3 Stat Cards block, the "Use It Up" banner, the "Grocery items to restock" panel, the fake Sync button, the "Pantry tracker tips" card, the "Pantry overview" card, and the "Ask Consuela what to cook" link. Delete the now-unused `groceryNotInPantry` memo and `expiring` if nothing else uses them.

9. **Keep:** the "Add to Pantry" form (with the async fix), the collapsible "✨ Add staples" section (collapsed by default — already is), the pantry item grid with status toggles + two-tap delete, and the empty state.

10. **Mount the preview sheet:**
    ```tsx
    <SyncPreviewSheet
      open={!!preview}
      title="Add low & out to grocery list"
      preview={preview || { items: [], alreadyOnList: 0 }}
      busy={syncBusy}
      onConfirm={confirmPantrySync}
      onCancel={() => setPreview(null)}
    />
    ```

**Wire in `page.tsx`** (pantry branch): import `StockTab`, replace `<PantryTab …>` with `<StockTab …>`, add `addGroceryItem={addGroceryItem}` and `flowSummary={stockSummary}` (temporary string until Task 8). Keep `<CookWithWhatYouHave …>` rendered below it (spec keeps it on Stock).

### Verify + commit
```bash
npm run typecheck
npx vitest run    # full suite green
```
Commit: `feat(kitchen): StockTab — flow card, single preview sync, declutter, async add fix`

---

## Task 8 — Final rewire: 3 tabs, legacy mapping, deletions

This is the integration task. Do it as one atomic change so the suite stays green.

1. **`src/types/meals.ts`:** change the last line to
   ```ts
   export type Tab = "plan" | "shop" | "stock";
   ```

2. **`src/app/meals/page.tsx`:**
   - Update imports: remove `MealsTab`, `GroceryTab`, `PantryTab`, `RecipesTab`; add `PlanTab`, `ShopTab`, `StockTab`. Add `import { mapKitchenTabParam, isRecipesDeepLink } from "@/lib/kitchen-tabs";` and `import { mealSyncService } from "@/services/mealSync";`.
   - Replace `VALID_TABS` + `initialTab` logic:
     ```tsx
     const requestedTab = searchParams.get("tab");
     const initialTab = mapKitchenTabParam(requestedTab);
     const focusRecipeBox = isRecipesDeepLink(requestedTab);
     const [activeTab, setActiveTab] = useState<Tab>(initialTab);
     ```
   - **Compute the live summaries** (add near `neededCount`):
     ```tsx
     const planPreview = mealSyncService.previewMealPlanToGrocery(meals, pantryItems, groceryItems);
     const missingCount = planPreview.items.length;
     const checkedCount = groceryItems.filter(i => !i.needed).length;
     const plenty = pantryItems.filter(p => p.status === "plenty").length;
     const low = pantryItems.filter(p => p.status === "low").length;
     const out = pantryItems.filter(p => p.status === "out").length;
     const planSummary = `${meals.length} meal${meals.length === 1 ? "" : "s"} planned · ${missingCount} ingredient${missingCount === 1 ? "" : "s"} missing`;
     const shopSummary = `${neededCount} item${neededCount === 1 ? "" : "s"} to buy · ${checkedCount} checked off`;
     const stockSummary = `${plenty} stocked · ${low} running low · ${out} out`;
     ```
   - **SegmentedControl → 3 tabs:**
     ```tsx
     <SegmentedControl
       aria-label="Kitchen"
       value={activeTab}
       onChange={(value) => setActiveTab(value as Tab)}
       options={[
         { id: "plan", label: "🍽️ Plan" },
         { id: "shop", label: "🛒 Shop" },
         { id: "stock", label: "🥫 Stock" },
       ]}
     />
     ```
   - **Tab branches:** keep exactly three — `{activeTab === "plan" && (…)}`, `{activeTab === "shop" && (…)}`, `{activeTab === "stock" && (…)}`. Delete the `recipes` branch entirely.
     - Plan branch: remove the `meals.length === 0 ? <EmptyState …> :` wrapper — always render PlanTab (it has its own empty-day state). Remove the three `StatTile` row (Planned/Tonight/Sync). Pass `flowSummary={planSummary}` and `focusRecipeBox={focusRecipeBox}` to PlanTab.
     - Shop branch: pass `flowSummary={shopSummary}` (and `meals={meals}` already added in Task 6).
     - Stock branch: pass `flowSummary={stockSummary}` (and `addGroceryItem` already added in Task 7). Keep `<CookWithWhatYouHave …>` below StockTab.
   - **PageHeader** subtitle/action: update the `activeTab === "meals"` references to `"plan"`. Keep the AI Suggest action on the plan tab.
   - **Prune imports** that are now unused: `StatTile`, `EmptyState`, and any of `Surface`, `Chip`, `ListRow`, `ErrorState`, `Modal`, `SectionCard` that are no longer referenced. Run `npm run lint` and remove every newly-flagged unused import.

3. **Rename RecipesTab → RecipeBox:**
   - `git mv src/components/meals/RecipesTab.tsx src/components/meals/RecipeBox.tsx`
   - In `RecipeBox.tsx`, rename `export default function RecipesTab(` → `export default function RecipeBox(`.
   - In `PlanTab.tsx`, change the import to `import RecipeBox from "@/components/meals/RecipeBox";` and the JSX tag `<RecipesTab …>` → `<RecipeBox …>`.

4. **Delete the four old tab files** (now unreferenced):
   ```bash
   git rm src/components/meals/MealsTab.tsx src/components/meals/GroceryTab.tsx src/components/meals/PantryTab.tsx
   ```
   (RecipesTab was already `git mv`'d to RecipeBox.)

5. **Grep for stragglers:** search the repo for `MealsTab`, `GroceryTab`, `PantryTab`, `RecipesTab` and update any remaining references (there should be none outside the files already handled).

### Verify + commit
```bash
npm run typecheck
npx vitest run     # full suite green (569 baseline + new tests)
npm run lint
```
Commit: `feat(kitchen): rewire /meals to Plan/Shop/Stock with legacy deep-link mapping`

---

## Task 9 — Small folded-in fixes

1. **`src/components/meals/CookWithWhatYouHave.tsx`** (M3): on the "Missing: …" paragraph (~line 53), add `line-clamp-2` so it wraps to two lines instead of truncating:
   ```tsx
   <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-secondary line-clamp-2">
     Missing: {readiness.missing.join(", ")}
   </p>
   ```
   Also update the empty-state copy from "add some in the Recipes tab." → "add some in the Recipe box on the Plan tab."

2. **`src/components/ui/SegmentedControl.tsx`** (L2): prevent label wrap at 320px by adding `whitespace-nowrap` to the label span:
   ```tsx
   <span className="whitespace-nowrap">{option.label}</span>
   ```

### Verify + commit
```bash
npm run typecheck
npx vitest run
```
Commit: `fix(kitchen): clamp Missing list to 2 lines; no-wrap segmented labels`

---

## Task 10 — Full verification + AGENTS.md

1. **Run the full gate:**
   ```bash
   npm run typecheck
   npm run lint
   npx vitest run
   npm run build
   ```
   All must be clean. Suite should be **569 baseline + ~19 new** (8 preview + 4 kitchen-tabs + 3 flow-card + 4 preview-sheet). If `npm run build` triggers the known Turbopack CSS desync, `docker restart consuela-dashboard` (see AGENTS.md Build Note) rather than chasing a rebuild.

2. **Playwright full loop (390px).** Write/run a probe that verifies, in guest mode (all writes 401 → still works local-first):
   - `/meals` lands on **Plan** with the KitchenFlowCard (Plan highlighted).
   - Legacy deep links: `/meals?tab=grocery` → Shop; `/meals?tab=pantry` → Stock; `/meals?tab=recipes` → Plan with the Recipe box opened/scrolled; `/meals?tab=meals` → Plan.
   - Plan a meal with a missing ingredient → Shop → tap "Add missing from meal plan" → preview sheet lists it → "Add N" → it lands on the list.
   - Check items off → "Send N to pantry" → Undo banner restores.
   - Stock → mark an item Low → "Add low & out to grocery list" → preview → confirm → item appears back on Shop.
   - No horizontal overflow at 390px; grocery checkbox + row actions ≥44px.

3. **Update `AGENTS.md`** (mandatory for Kitchen changes):
   - **Current Dashboard Snapshot:** add a new top entry dated 2026-08-26 describing the Plan→Shop→Stock restructure, the two preview-backed sync actions, KitchenFlowCard, Buy again, Recipe box, legacy deep-link mapping, and the fixes (ghost member, 44px targets, async pantry add, Missing line-clamp). Note the suite count and that backend/hooks are unchanged.
   - **§1.1 nav table / §1.5 journeys:** update "How do I get to the grocery list?" → "…then the **Shop** tab"; add a journey for the sync-preview flow and the Recipe box.
   - **UI Change Record:** add a new dated record for the Kitchen redesign (Added/Changed files, Visual/Motion, Color sources, user-facing description).
   - **Change Log (this manual only):** add the entry.

Commit: `docs(kitchen): AGENTS.md snapshot + UI change record for Plan→Shop→Stock`

---

## Risk notes

- **The two grocery tests are the contract** for ShopTab's bulk/undo/pin behavior. If a ShopTab edit breaks them, the edit is wrong — restore the behavior rather than weakening the test.
- **Preview must agree with real sync.** Because the preview methods reuse the same private helpers (`calculateRequiredIngredients`, `findPantryStock`, `calculateDeficit`, `ingredientNamesMatch`, `isManualSource`), they cannot drift from `syncMealPlanToGrocery`/`syncPantryToGrocery`. Do not reimplement matching logic in the tabs.
- **Pantry items carry `item`, not `name`.** The preview methods normalize with `p.name || p.item`; keep that.
- **Don't touch hooks or PB.** All commit paths go through the existing local-first `addGroceryItem` / `addPantryItem`.
- **Intermediate commits stay green** by creating new tab files before deleting old ones; only Task 8 deletes the four legacy files.
