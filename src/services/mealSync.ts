import type { Meal, PantryItem, GroceryItem as GroceryListItem } from '@/types/meals';
import { db } from '@/db';

/** Why a sync produced no usable writes. Always surfaced to the user. */
export type SyncFailureReason =
  | "meals_read_failed"
  | "meals_read_blocked"
  | "no_meals_planned"
  | "pantry_read_failed"
  | "grocery_read_failed"
  | "grocery_write_failed";

/** Where the meals a sync used actually came from (never invented). */
export type MealReadSource = "provided" | "pb" | "local-cache" | "demo-seed" | "blocked" | "empty";

/**
 * `ok === false` means NOTHING was synced and `message` explains why. Callers
 * must branch on `ok` before reading the counts — a failure never reports a
 * fake "added 0" success. `writeFailures > 0` with `ok === true` is a partial
 * sync (some rows PB refused); `writeFailures > 0 && added + updated + removed
 * === 0` is reported as `grocery_write_failed` instead of a hollow success.
 */
export interface SyncResult {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  writeFailures: number;
  reason?: SyncFailureReason;
  message?: string;
  mealsRead?: MealReadSource;
}

export interface MealSyncOptions {
  /**
   * Explicit opt-in for DEMO_MEAL_SEED. Default false. Demo meals are a SEED
   * for a fresh install, never a fallback for a failed read — set
   * NEXT_PUBLIC_CONSUELA_DEMO_MEAL_SEED=1 (build-time, per AGENTS.md's env
   * rules) or pass true to seed an install that has no family planner yet.
   */
  allowDemoSeed?: boolean;
}

const SYNC_FAILURE_COPY: Record<SyncFailureReason, string> = {
  meals_read_failed: "Couldn't read the meal plan — nothing was added to your grocery list.",
  meals_read_blocked: "Sign in with your PIN to sync the meal plan — nothing was added to your grocery list.",
  no_meals_planned: "No meals planned this week — there's nothing to sync to the grocery list.",
  pantry_read_failed: "Couldn't read the pantry — nothing was changed on your grocery list.",
  grocery_read_failed: "Couldn't read your grocery list — nothing was changed.",
  grocery_write_failed: "Couldn't save to the grocery list — no items were synced.",
};

/**
 * The sample week a fresh install can seed itself with. These are the ONLY
 * demo meals in the sync path and they are never substituted for a read that
 * came back empty, blocked or failed: without an explicit
 * `allowDemoSeed`, an empty planner writes nothing at all.
 */
export const DEMO_MEAL_SEED: Meal[] = [
  { id: 1, name: "Pasta Primavera", emoji: "🍝", time: "Mon", mealType: "dinner", prepTime: "25 min", tags: ["Vegetarian", "Quick"], ingredients: ["Penne pasta", "Zucchini", "Bell peppers", "Parmesan", "Olive oil"], servings: 4, calories: 420 },
  { id: 2, name: "Taco Night", emoji: "🌮", time: "Tue", mealType: "dinner", prepTime: "20 min", tags: ["Family Fave", "Quick"], ingredients: ["Ground beef", "Taco shells", "Salsa", "Sour cream", "Lettuce", "Cheese"], servings: 4, calories: 550 },
  { id: 3, name: "Grilled Chicken", emoji: "🍗", time: "Wed", mealType: "dinner", prepTime: "35 min", tags: ["High Protein", "Healthy"], ingredients: ["Chicken breast", "Broccoli", "Lemon", "Garlic", "Olive oil"], servings: 4, calories: 380 },
  { id: 4, name: "Shrimp Stir Fry", emoji: "🥢", time: "Thu", mealType: "dinner", prepTime: "20 min", tags: ["Seafood", "Quick"], ingredients: ["Shrimp", "Snap peas", "Carrots", "Soy sauce", "Ginger", "Rice"], servings: 4, calories: 410 },
  { id: 5, name: "Homemade Pizza", emoji: "🍕", time: "Fri", mealType: "dinner", prepTime: "45 min", tags: ["Family Fave", "Fun"], ingredients: ["Pizza dough", "Mozzarella", "Tomato sauce", "Bell peppers", "Mushrooms"], servings: 4, calories: 620 },
  { id: 6, name: "BBQ Ribs", emoji: "🍖", time: "Sat", mealType: "dinner", prepTime: "2 hr", tags: ["Weekend", "Indulgent"], ingredients: ["Pork ribs", "BBQ sauce", "Corn on cob", "Coleslaw"], servings: 4, calories: 780 },
  { id: 7, name: "Slow Cooker Chili", emoji: "🫕", time: "Sun", mealType: "dinner", prepTime: "6 hr", tags: ["Comfort Food", "Meal Prep"], ingredients: ["Ground beef", "Kidney beans", "Tomatoes", "Chili powder", "Onion"], servings: 6, calories: 490 },
];

const PANTRY_CHECK_SOURCE = "pantry-check";
const MEAL_PLAN_SOURCE = "meal-plan";

/** Build-time opt-in, read defensively so server/test environments never throw. */
export function demoMealSeedEnabled(): boolean {
  try {
    return process.env?.NEXT_PUBLIC_CONSUELA_DEMO_MEAL_SEED === "1";
  } catch {
    return false;
  }
}

function syncFailed(reason: SyncFailureReason, mealsRead?: MealReadSource, cause?: unknown, writeFailures = 0): SyncResult {
  if (cause !== undefined) console.warn(`[MealSync] ${reason}`, cause);
  return {
    ok: false,
    added: 0,
    updated: 0,
    removed: 0,
    writeFailures,
    reason,
    message: SYNC_FAILURE_COPY[reason],
    ...(mealsRead ? { mealsRead } : {}),
  };
}

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

interface RequiredIngredient {
  name: string;
  unit: string;
  category: string;
  quantity: number;
}

type UnitDimension = "mass" | "volume" | "count";

/**
 * Units the deficit math can actually compare. Anything outside this table has
 * no known dimension, so a pantry row carrying it is treated as an
 * unconvertible claim (see `calculateDeficit`) instead of a raw number.
 * `factor` converts the unit into its dimension's base (g / ml / each).
 */
const UNIT_TABLE: Record<string, { dimension: UnitDimension; factor: number }> = {
  g: { dimension: "mass", factor: 1 },
  gram: { dimension: "mass", factor: 1 },
  grams: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  kilogram: { dimension: "mass", factor: 1000 },
  kilograms: { dimension: "mass", factor: 1000 },
  oz: { dimension: "mass", factor: 28.3495 },
  ounce: { dimension: "mass", factor: 28.3495 },
  ounces: { dimension: "mass", factor: 28.3495 },
  lb: { dimension: "mass", factor: 453.592 },
  lbs: { dimension: "mass", factor: 453.592 },
  pound: { dimension: "mass", factor: 453.592 },
  pounds: { dimension: "mass", factor: 453.592 },
  ml: { dimension: "volume", factor: 1 },
  milliliter: { dimension: "volume", factor: 1 },
  milliliters: { dimension: "volume", factor: 1 },
  cl: { dimension: "volume", factor: 10 },
  l: { dimension: "volume", factor: 1000 },
  liter: { dimension: "volume", factor: 1000 },
  liters: { dimension: "volume", factor: 1000 },
  tsp: { dimension: "volume", factor: 4.92892 },
  teaspoon: { dimension: "volume", factor: 4.92892 },
  teaspoons: { dimension: "volume", factor: 4.92892 },
  tbsp: { dimension: "volume", factor: 14.7868 },
  tablespoon: { dimension: "volume", factor: 14.7868 },
  tablespoons: { dimension: "volume", factor: 14.7868 },
  cup: { dimension: "volume", factor: 236.588 },
  cups: { dimension: "volume", factor: 236.588 },
  // "How many" units share the count dimension at factor 1: a count is a count.
  unit: { dimension: "count", factor: 1 },
  whole: { dimension: "count", factor: 1 },
  wholes: { dimension: "count", factor: 1 },
  clove: { dimension: "count", factor: 1 },
  cloves: { dimension: "count", factor: 1 },
  slice: { dimension: "count", factor: 1 },
  slices: { dimension: "count", factor: 1 },
  can: { dimension: "count", factor: 1 },
  cans: { dimension: "count", factor: 1 },
  package: { dimension: "count", factor: 1 },
  packages: { dimension: "count", factor: 1 },
  stalk: { dimension: "count", factor: 1 },
  stalks: { dimension: "count", factor: 1 },
  piece: { dimension: "count", factor: 1 },
  pieces: { dimension: "count", factor: 1 },
  bunch: { dimension: "count", factor: 1 },
  bunches: { dimension: "count", factor: 1 },
};

export class MealSyncService {
  private readonly allowDemoSeed: boolean;

  constructor(options: MealSyncOptions = {}) {
    this.allowDemoSeed = options.allowDemoSeed ?? demoMealSeedEnabled();
  }

  async syncMealPlanToGrocery(userId: string, plannedMeals?: Meal[]): Promise<SyncResult> {
    // Tracks which read is in flight so a thrown read is reported with the
    // reason that actually failed (and so NOTHING is swept on a bad read).
    let failingRead: SyncFailureReason = "meals_read_failed";
    let mealsRead: MealReadSource = "empty";

    try {
      let meals: Meal[];
      if (plannedMeals && plannedMeals.length > 0) {
        meals = plannedMeals;
        mealsRead = "provided";
      } else {
        const read = await this.readScheduledMeals();
        mealsRead = read.source;
        // An empty/blocked planner is not an invitation to invent meals.
        if (read.failure) return syncFailed(read.failure.reason, read.source);
        meals = read.meals;
      }

      failingRead = "pantry_read_failed";
      const pantryItems = await this.getPantryItems(userId);
      failingRead = "grocery_read_failed";
      // Dedupe against EVERY managed row (including pantry-check rows) so a
      // pantry row for "Milk" and a meal-plan row for "Milk" can never become
      // two list rows. Row OWNERSHIP is enforced in the sweep below, not here.
      const existingGrocery = await this.getGroceryItemsBySource(userId, 'all');
      const requiredNames = new Set<string>();

      let added = 0;
      let updated = 0;
      let removed = 0;
      let writeFailures = 0;

      const ingredientDeficits = new Map<string, RequiredIngredient>();

      for (const meal of meals) {
        const requiredIngredients = this.calculateRequiredIngredients(meal);

        for (const ingredient of requiredIngredients) {
          const key = this.normalizeIngredientName(ingredient.name);
          const pantryStock = this.findPantryStock(pantryItems, ingredient.name);
          const deficit = this.calculateDeficit(ingredient, pantryStock);

          if (deficit <= 0) continue;
          requiredNames.add(key);

          const accumulated = ingredientDeficits.get(key);
          if (accumulated) {
            accumulated.quantity += deficit;
          } else {
            ingredientDeficits.set(key, { ...ingredient, quantity: deficit, unit: ingredient.unit });
          }
        }
      }

      for (const [, ingredient] of ingredientDeficits) {
          const existing = existingGrocery.find(g =>
            !g.manualOverride && !this.isManualSource(g.source) && this.ingredientNamesMatch(g.name, ingredient.name)
          );

          if (existing) {
            const ok = await this.updateGroceryItem(existing.id, {
              quantity: this.formatQuantity(ingredient.quantity, ingredient.unit),
              priority: this.getPriorityForDeficit(ingredient.quantity),
              needed: true,
              lastSyncedAt: new Date().toISOString(),
            });
            if (ok) updated++; else writeFailures++;
          } else {
            try {
              await this.createGroceryItem({
                userId,
                name: ingredient.name,
                category: ingredient.category,
                aisle: this.getAisleForCategory(ingredient.category),
                quantity: this.formatQuantity(ingredient.quantity, ingredient.unit),
                priority: this.getPriorityForDeficit(ingredient.quantity),
                source: MEAL_PLAN_SOURCE,
                autoGenerated: true,
                manualOverride: false,
              });
              added++;
            } catch (e) {
              writeFailures++;
              console.warn('[MealSync] create failed for', ingredient.name, e);
            }
          }
        }

      for (const grocery of existingGrocery) {
        // The sweep may only retire rows the meal plan owns. Pantry-check
        // rows are the pantry sync's to clear — an out-of-stock staple is not
        // "not required by tonight's dinner".
        if (!this.isMealPlanOwned(grocery)) continue;
        if (grocery.manualOverride || this.isManualSource(grocery.source)) continue;
        if (this.shouldKeepMealPlanGrocery(grocery, requiredNames)) continue;
        const ok = await this.updateGroceryItem(grocery.id, {
          needed: false,
          lastSyncedAt: new Date().toISOString(),
        });
        if (ok) removed++; else writeFailures++;
      }

      if (writeFailures > 0 && added + updated + removed === 0) {
        return syncFailed("grocery_write_failed", mealsRead, undefined, writeFailures);
      }

      return { ok: true, added, updated, removed, writeFailures, mealsRead };
    } catch (e) {
      return syncFailed(failingRead, mealsRead, e);
    }
  }

  async syncPantryToGrocery(userId: string): Promise<SyncResult> {
    let failingRead: SyncFailureReason = "pantry_read_failed";
    try {
      const pantryItems = await this.getPantryItems(userId);
      failingRead = "grocery_read_failed";
      const allGrocery = await this.getGroceryItemsBySource(userId, 'all');

      let added = 0;
      let updated = 0;
      let writeFailures = 0;

      for (const pantry of pantryItems) {
        if (pantry.status === 'plenty') continue;

        const existing = allGrocery.find((g: any) =>
          !g.manualOverride && !this.isManualSource(g.source) && this.ingredientNamesMatch(g.name, pantry.name!)
        );
        const priority = pantry.status === 'out' ? 'high' : 'medium';

        if (existing) {
          const ok = await this.updateGroceryItem(existing.id, {
            needed: true,
            priority,
            lastSyncedAt: new Date().toISOString(),
            // Keep the row's real owner: re-stamping a meal-plan row as
            // pantry-check would hand it to the wrong sweep.
            source: existing.source || PANTRY_CHECK_SOURCE,
          });
          if (ok) updated++; else writeFailures++;
        } else {
          try {
            await this.createGroceryItem({
              userId,
              name: pantry.name,
              category: this.getCategoryForIngredient(pantry.name!),
              aisle: this.getAisleForCategory(this.getCategoryForIngredient(pantry.name!)),
              quantity: '1',
              priority,
              needed: true,
              source: PANTRY_CHECK_SOURCE,
              autoGenerated: true,
              manualOverride: false,
            });
            added++;
          } catch (e) {
            writeFailures++;
            console.warn('[MealSync] pantry-check create failed for', pantry.name, e);
          }
        }
      }

      for (const grocery of allGrocery) {
        if (grocery.manualOverride || this.isManualSource(grocery.source) || !grocery.needed) continue;
        const pantryStock = this.findPantryStock(pantryItems, grocery.name);
        if (pantryStock && pantryStock.status === 'plenty') {
          const ok = await this.updateGroceryItem(grocery.id, {
            needed: false,
            lastSyncedAt: new Date().toISOString(),
          });
          if (ok) updated++; else writeFailures++;
        }
      }

      if (writeFailures > 0 && added + updated === 0) {
        return syncFailed("grocery_write_failed", undefined, undefined, writeFailures);
      }

      return { ok: true, added, updated, removed: 0, writeFailures };
    } catch (e) {
      return syncFailed(failingRead, undefined, e);
    }
  }

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

  async toggleManualOverride(groceryId: number | string, override: boolean): Promise<void> {
    try {
      await db.toggleGroceryOverride(groceryId, override);
    } catch (e) {
      console.warn('[MealSync] toggleManualOverride failed', e);
    }
  }

  /**
   * One read, honestly labelled. `db.gatewayReadStatus` is the seam that
   * reports a BLOCKED read (401) instead of swallowing it into an empty list;
   * the plain selects are the fallback for facades that don't expose it.
   * A rejection propagates so the caller's catch can report a real failure.
   */
  private async readRows(collection: "meals" | "pantry" | "grocery"): Promise<{ items: any[]; blocked: boolean }> {
    const collectionName = collection === "meals"
      ? "meal_plan_entries"
      : collection === "pantry" ? "pantry_items" : "grocery_list_items";

    const honestRead = (db as any).gatewayReadStatus;
    if (typeof honestRead === "function") {
      const res = await honestRead(collectionName);
      return { items: Array.isArray(res?.items) ? res.items : [], blocked: res?.blocked === true };
    }

    const items = collection === "meals"
      ? await db.selectMeals()
      : collection === "pantry" ? await db.selectPantry() : await db.selectGrocery();
    return { items: Array.isArray(items) ? items : [], blocked: false };
  }

  /**
   * PB first, then this device's cache, then — ONLY with an explicit
   * `allowDemoSeed` opt-in — the demo seed. There is no fourth branch: an
   * empty planner syncs zero items and says so. The demo seed used to be the
   * silent fourth branch, which wrote ~30 fake ingredients into the family's
   * real grocery list.
   */
  private async readScheduledMeals(): Promise<{
    meals: Meal[];
    source: MealReadSource;
    failure?: { reason: SyncFailureReason };
  }> {
    const status = await this.readRows("meals");
    if (status.blocked) return { meals: [], source: "blocked", failure: { reason: "meals_read_blocked" } };

    const fromDb = status.items.map((m: any) => this.normalizeMeal(m));
    if (fromDb.length > 0) return { meals: fromDb, source: "pb" };

    const fromLocal = this.loadLocalMeals();
    if (fromLocal.length > 0) return { meals: fromLocal, source: "local-cache" };

    if (this.allowDemoSeed) {
      return { meals: DEMO_MEAL_SEED.map((m) => ({ ...m })), source: "demo-seed" };
    }

    return { meals: [], source: "empty", failure: { reason: "no_meals_planned" } };
  }

  private async getPantryItems(userId: string): Promise<PantryItem[]> {
    // quantity + unit must survive the read or the deficit math silently
    // degrades to status-only guesses.
    const { items } = await this.readRows("pantry");
    return items.map((p: any) => ({
      id: p.id ?? Date.now(),
      item: p.name || p.item || '',
      name: p.name || p.item,
      status: p.status ?? 'plenty',
      quantity: MealSyncService.toFiniteNumber(p.quantity),
      unit: typeof p.unit === 'string' && p.unit ? p.unit : undefined,
    })).filter((p: PantryItem) => p.name);
  }

  private static toFiniteNumber(value: unknown): number | undefined {
    if (value == null || value === '') return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /** True when the meal-plan sync created/owns this grocery row. */
  private isMealPlanOwned(grocery: GroceryListItem): boolean {
    return !grocery.source || grocery.source === MEAL_PLAN_SOURCE;
  }

  private async getGroceryItemsBySource(userId: string, source: string): Promise<GroceryListItem[]> {
    const { items: all } = await this.readRows("grocery");
    return all
      // 'all' is every managed row (the sync dedupes against all of them, so a
      // pantry-check row and a meal-plan row for the same item can't become
      // two list rows). A named source keeps the legacy source-less rows that
      // source owns.
      .filter((g: any) => source === 'all' || g.source === source || (source === MEAL_PLAN_SOURCE && this.isMealPlanOwned(g) && g.autoGenerated))
      .map((g: any) => ({
          id: g.id,
          userId: g.userId || userId,
          name: g.name,
          emoji: g.emoji || '📦',
          category: g.category || 'other',
          aisle: g.aisle,
          quantity: g.quantity,
          notes: g.notes,
          priority: g.priority || 'medium',
          needed: g.needed !== false,
          source: g.source,
          autoGenerated: g.autoGenerated,
          manualOverride: g.manualOverride,
          lastSyncedAt: g.lastSyncedAt,
          updatedAt: g.updatedAt,
        }));
  }

  private async createGroceryItem(data: Partial<GroceryListItem>): Promise<GroceryListItem> {
    const category = data.category || 'other';
    const toUpsert = {
      userId: data.userId || 'demo',
      name: data.name || 'Unknown item',
      category,
      aisle: data.aisle || this.getAisleForCategory(category),
      quantity: data.quantity,
      notes: data.notes,
      priority: data.priority || 'medium',
      needed: data.needed !== false,
      source: data.source || 'meal-plan',
      autoGenerated: data.autoGenerated !== false,
      manualOverride: !!data.manualOverride,
      lastSyncedAt: data.lastSyncedAt,
    };
    const saved = await db.upsertGroceryItem(toUpsert);
    if (!saved) throw new Error(`Failed to create grocery item: ${toUpsert.name}`);
    return {
      id: saved.id,
      userId: saved.userId,
      name: saved.name,
      category: saved.category,
      aisle: saved.aisle,
      quantity: saved.quantity,
      notes: saved.notes,
      priority: saved.priority,
      needed: saved.needed,
      source: saved.source,
      autoGenerated: saved.autoGenerated,
      manualOverride: saved.manualOverride,
      lastSyncedAt: saved.lastSyncedAt,
      updatedAt: saved.updatedAt,
    } as GroceryListItem;
  }

  private async updateGroceryItem(id: number | string, updates: Partial<GroceryListItem>): Promise<boolean> {
    try {
      const all = await db.selectGrocery();
      const record = all.find((g: any) => String(g.id) === String(id));
      if (!record) return false;
      const saved = await db.upsertGroceryItem({ ...record, ...updates, id: record.id, userId: 'demo' });
      return !!saved;
    } catch (e) {
      console.warn('[MealSync] update failed for id', id, e);
      return false;
    }
  }

  private normalizeMeal(meal: any): Meal {
    return {
      id: meal.id ?? Date.now(),
      name: meal.name,
      emoji: meal.emoji ?? '🍽️',
      time: meal.time ?? meal.scheduledFor ?? 'Mon',
      mealType: meal.mealType ?? 'dinner',
      prepTime: meal.prepTime ?? '30 min',
      tags: typeof meal.tags === 'string' ? (meal.tags ? JSON.parse(meal.tags) : []) : (meal.tags ?? []),
      ingredients: Array.isArray(meal.ingredients) ? meal.ingredients : (typeof meal.ingredients === 'string' ? (meal.ingredients ? JSON.parse(meal.ingredients) : []) : []),
      servings: meal.servings ?? 4,
      calories: meal.calories ?? 500,
      protein: meal.protein ?? 0,
      carbs: meal.carbs ?? 0,
      fat: meal.fat ?? 0,
      instructions: meal.instructions ?? '',
      autoGenerated: meal.autoGenerated,
    };
  }

  private loadLocalMeals(): Meal[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('consuela-meals');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((m: any) => this.normalizeMeal(m)) : [];
    } catch {
      return [];
    }
  }

  private shouldKeepMealPlanGrocery(grocery: GroceryListItem, requiredNames: Set<string>): boolean {
    const normalized = this.normalizeIngredientName(grocery.name);
    return requiredNames.has(normalized) || this.normalizeIngredientName(grocery.name).length === 0;
  }

  private getCategoryForIngredient(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('pasta') || n.includes('rice') || n.includes('bean') || n.includes('oil') || n.includes('sauce') || n.includes('flour') || n.includes('sugar') || n.includes('shell') || n.includes('dough') || n.includes('salsa')) return 'pantry';
    if (n.includes('chicken') || n.includes('beef') || n.includes('pork') || n.includes('shrimp') || n.includes('salmon') || n.includes('fish') || n.includes('rib') || n.includes('meat') || n.includes('bacon')) return 'meat';
    if (n.includes('zucchini') || n.includes('pepper') || n.includes('broccoli') || n.includes('carrot') || n.includes('onion') || n.includes('tomato') || n.includes('lettuce') || n.includes('spinach') || n.includes('pea') || n.includes('corn') || n.includes('mushroom') || n.includes('avocado') || n.includes('garlic') || n.includes('lemon') || n.includes('banana') || n.includes('apple')) return 'produce';
    if (n.includes('milk') || n.includes('cheese') || n.includes('egg') || n.includes('yogurt') || n.includes('butter') || n.includes('parmesan') || n.includes('mozzarella') || n.includes('cheddar') || n.includes('sour cream')) return 'dairy';
    if (n.includes('frozen')) return 'frozen';
    if (n.includes('chip') || n.includes('snack') || n.includes('cereal') || n.includes('chili')) return 'snacks';
    if (n.includes('coffee') || n.includes('juice') || n.includes('soda') || n.includes('water')) return 'beverages';
    if (n.includes('soap') || n.includes('cleaner') || n.includes('tissue') || n.includes('paper towel') || n.includes('detergent')) return 'household';
    return 'other';
  }

  private getAisleForCategory(category: string): string {
    const map: Record<string, string> = {
      produce: '1',
      dairy: '4',
      meat: '6',
      pantry: '8',
      frozen: '11',
      snacks: '12',
      beverages: '13',
      household: '14',
    };
    return map[category] || '1';
  }

  private guessUnitForIngredient(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('oil') || n.includes('sauce') || n.includes('lemon')) return 'tbsp';
    if (n.includes('pasta') || n.includes('rice') || n.includes('bean')) return 'cup';
    if (n.includes('pepper') || n.includes('onion') || n.includes('tomato') || n.includes('zucchini')) return 'whole';
    if (n.includes('chicken') || n.includes('beef') || n.includes('pork')) return 'lb';
    return 'unit';
  }

  private calculateRequiredIngredients(meal: Meal): RequiredIngredient[] {
    return (meal.ingredients || [])
      .map(ingredient => this.parseIngredient(ingredient))
      .filter(ingredient => ingredient.name);
  }

  private parseIngredient(raw: string): RequiredIngredient {
    const cleaned = String(raw || '')
      .replace(/[()[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return { name: '', unit: 'unit', category: 'other', quantity: 0 };
    }

    const measured = cleaned.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|kilograms?|ml|l|liters?|cloves?|slices?|cans?|packages?|stalks?)\s+(.+)$/i);
    if (measured) {
      const name = measured[3].trim();
      return {
        name,
        unit: measured[2].toLowerCase(),
        category: this.getCategoryForIngredient(name),
        quantity: this.parseQuantity(measured[1]),
      };
    }

    const simple = cleaned.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/);
    if (simple) {
      const name = simple[2].trim();
      return {
        name,
        unit: 'unit',
        category: this.getCategoryForIngredient(name),
        quantity: this.parseQuantity(simple[1]),
      };
    }

    return {
      name: cleaned,
      unit: this.guessUnitForIngredient(cleaned),
      category: this.getCategoryForIngredient(cleaned),
      quantity: 1,
    };
  }

  private parseQuantity(qty?: string | number): number {
    if (typeof qty === 'number') return Number.isFinite(qty) && qty > 0 ? qty : 1;
    if (!qty) return 1;
    const fraction = String(qty).match(/^(\d+)\/(\d+)$/);
    if (fraction) {
      const value = Number(fraction[1]) / Number(fraction[2]);
      return Number.isFinite(value) && value > 0 ? value : 1;
    }
    const match = String(qty).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 1;
  }

  private findPantryStock(pantry: PantryItem[], name: string) {
    return pantry.find(p => this.ingredientNamesMatch(p.name || '', name));
  }

  /**
   * Deficit = required − in stock, in the ingredient's own unit.
   *
   * Units are compared, never assumed: "2 cups" against a pantry `500 g` is
   * not "500 in stock" (the old raw subtraction made the deficit 0 and dropped
   * the item). Where the pantry states a quantity in a dimension we cannot
   * convert into the recipe's unit, the item is treated as NEEDED — silently
   * deciding it is in stock under-lists groceries, which is the dangerous
   * direction. A pantry quantity with NO unit is not a claim we may contradict
   * either, so the explicit plenty/low/out status decides in that case.
   */
  private calculateDeficit(ingredient: RequiredIngredient, pantry: PantryItem | undefined): number {
    if (!pantry) return ingredient.quantity || 2;
    if (pantry.status === 'out') return ingredient.quantity || 3;

    const stock = MealSyncService.toFiniteNumber(pantry.quantity);
    if (stock == null) {
      if (pantry.status === 'low') return Math.max(1, ingredient.quantity - 1);
      return 0;
    }
    if (stock <= 0) return ingredient.quantity || 3;

    const required = ingredient.quantity > 0 ? ingredient.quantity : 1;
    const need = this.toBaseQuantity(required, ingredient.unit);
    const have = this.toBaseQuantity(stock, pantry.unit);

    if (!need || !have || need.dimension !== have.dimension) {
      const pantryStatesAConvertibleUnit = !!pantry.unit && this.toBaseQuantity(1, pantry.unit) != null;
      if (pantryStatesAConvertibleUnit) return required;
      if (pantry.status === 'low') return Math.max(1, required - 1);
      return pantry.status === 'plenty' ? 0 : required;
    }

    const deficitInBase = need.value - have.value;
    if (deficitInBase <= 0) return 0;
    return deficitInBase / need.factor;
  }

  /** Null when the unit has no known dimension/factor (never silently assumed). */
  private toBaseQuantity(value: number, unit?: string): { dimension: UnitDimension; factor: number; value: number } | null {
    const key = String(unit || '').trim().toLowerCase();
    const entry = UNIT_TABLE[key];
    if (!entry) return null;
    return { dimension: entry.dimension, factor: entry.factor, value: value * entry.factor };
  }

  private formatQuantity(quantity: number, unit: string): string {
    const safeQuantity = Math.max(1, Math.round(quantity));
    return unit === 'unit' ? `${safeQuantity}` : `${safeQuantity} ${unit}`;
  }

  private getPriorityForDeficit(quantity: number): 'low' | 'medium' | 'high' {
    if (quantity >= 3) return 'high';
    if (quantity >= 2) return 'medium';
    return 'low';
  }

  private normalizeIngredientName(name: string): string {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\b(the|fresh|diced|chopped|minced|sliced|canned|can of|package of|bag of)\b/g, ' ')
      .replace(/\b(\w+)s\b/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ingredientNamesMatch(left: string, right: string): boolean {
    const a = this.normalizeIngredientName(left);
    const b = this.normalizeIngredientName(right);
    if (!a || !b) return false;
    return a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a)));
  }

  private isManualSource(source?: string): boolean {
    return source === 'manual';
  }
}

export const mealSyncService = new MealSyncService();
