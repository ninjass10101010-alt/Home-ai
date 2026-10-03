"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import PageShell from "@/components/ui/PageShell";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { db } from "@/db";
import { emptyRecipe, groceryCategories } from "@/data/meals";
import { Meal, Recipe, Tab } from "@/types/meals";
import { useMeals, mealCreateWrite, mealUpdateWrite } from "@/hooks/useMeals";
import { saveOrQueue } from "@/lib/pending-writes";
import { useGrocery } from "@/hooks/useGrocery";
import { usePantry } from "@/hooks/usePantry";
import { useRecipes } from "@/hooks/useRecipes";
import PlanTab from "@/components/meals/PlanTab";
import ShopTab from "@/components/meals/ShopTab";
import StockTab from "@/components/meals/StockTab";
import CookWithWhatYouHave from "@/components/meals/CookWithWhatYouHave";
import RecipeModal from "@/components/meals/RecipeModal";
import RecipeImportModal from "@/components/meals/RecipeImportModal";
import RecipeSearchModal from "@/components/meals/RecipeSearchModal";
import { mapKitchenTabParam, isRecipesDeepLink } from "@/lib/kitchen-tabs";
import { mealSaveToast } from "@/lib/meal-save-toast";
import { mealSyncService } from "@/services/mealSync";
import PageHeader from "@/components/patterns/PageHeader";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toast from "@/components/ui/Toast";

/**
 * Weekday short labels, exactly what `useMeals.activeDay` stores (`"Mon"`,
 * `"Tue"`, …) and exactly what Home's "This Week" `DayStrip` puts in a link as
 * `?day=`. Kept local rather than imported so this page holds the whole
 * `?day=` contract in one readable place.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function normalizeDayParam(param: string | null): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" | null {
  if (!param) return null;
  const match = WEEKDAYS.find((day) => day.toLowerCase() === param.trim().toLowerCase());
  return match ?? null;
}

function MealHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = mapKitchenTabParam(requestedTab);
  const focusRecipeBox = isRecipesDeepLink(requestedTab);
  // Home's "This Week" strip links `/meals?day=<weekday>`. Honouring it is what
  // makes that strip a navigation rather than a decoration: the day it names is
  // selected and, because the Plan tab is where days live, shown.
  const requestedDay = normalizeDayParam(searchParams.get("day"));
  const [activeTab, setActiveTab] = useState<Tab>(requestedDay ? "plan" : initialTab);
  // The `?tab=` value this render has already folded into `activeTab`, so the
  // adjustment below fires once per genuine URL change and not on every render.
  const [syncedTabParam, setSyncedTabParam] = useState<string | null>(requestedTab);
  const [notification, setNotification] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  /**
   * Rewrite one query param, leaving every other one alone. `?tab=` and `?day=`
   * coexist (Home can link both, and a tab tap must not silently drop the day),
   * so neither write rebuilds the query string from scratch.
   */
  const setQueryParam = useCallback(
    (key: "tab" | "day", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      // `replace`, never `push`: a tab tap is a view change inside one screen, so
      // Back should leave Meals rather than walk back through tab history.
      router.replace(`/meals?${params.toString()}`);
    },
    [router, searchParams]
  );

  /** Tap handler: the screen and the URL change together, so a reload agrees. */
  const selectTab = useCallback(
    (next: Tab) => {
      setActiveTab(next);
      if (mapKitchenTabParam(searchParams.get("tab")) !== next) {
        setQueryParam("tab", next);
      }
    },
    [searchParams, setQueryParam]
  );

  /**
   * URL → state, so a Back, a shared link or `/grocery`'s redirect lands on the
   * tab the address bar names. Reading only on mount was the other half of the
   * `?tab=` bug: the param was authoritative on arrival and stale forever after.
   *
   * Done as React's "adjust state while rendering" rather than in an effect: the
   * URL is an input to this render, not an external system to subscribe to, and a
   * `setState` inside an effect would spend a whole extra render pass
   * re-deriving what the address bar already said.
   *
   * A `?day=` deep link outranks `?tab=`: days only exist on the Plan tab, so
   * `/meals?tab=stock&day=Sat` has to mean "show me Saturday" rather than
   * "show me the pantry". Leaving the tab alone afterwards is what lets the
   * family browse Shop and come back to the same day.
   */
  if (requestedDay === null && requestedTab !== syncedTabParam) {
    setSyncedTabParam(requestedTab);
    setActiveTab(mapKitchenTabParam(requestedTab));
  }

  const showToast = (msg: string) => {
    setNotification(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotification(null), 3000);
  };

  const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const guessGroceryCategory = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('banana') || lower.includes('apple') || lower.includes('spinach') || lower.includes('avocado') || lower.includes('broccoli') || lower.includes('tomato') || lower.includes('lemon') || lower.includes('onion') || lower.includes('garlic') || lower.includes('carrot') || lower.includes('pepper')) return 'produce';
    if (lower.includes('milk') || lower.includes('egg') || lower.includes('cheese') || lower.includes('yogurt') || lower.includes('butter') || lower.includes('cream')) return 'dairy';
    if (lower.includes('chicken') || lower.includes('beef') || lower.includes('pork') || lower.includes('salmon') || lower.includes('shrimp') || lower.includes('fish') || lower.includes('bacon')) return 'meat';
    if (lower.includes('pasta') || lower.includes('rice') || lower.includes('bean') || lower.includes('oil') || lower.includes('sauce') || lower.includes('flour') || lower.includes('sugar') || lower.includes('dough') || lower.includes('salsa')) return 'pantry';
    if (lower.includes('frozen')) return 'frozen';
    if (lower.includes('chip') || lower.includes('snack') || lower.includes('cereal')) return 'snacks';
    if (lower.includes('coffee') || lower.includes('juice') || lower.includes('soda') || lower.includes('water')) return 'beverages';
    if (lower.includes('soap') || lower.includes('cleaner') || lower.includes('tissue') || lower.includes('detergent')) return 'household';
    return 'pantry';
  };

  const normalizeRecipeForCatalog = (recipe: Partial<Recipe>, fallbackId?: number): Recipe => {
    const tags = recipe.tags?.filter(Boolean) ?? ["Homemade"];
    const ingredients = (recipe.ingredients ?? []).map(i => i.trim()).filter(Boolean);
    return {
      id: fallbackId ?? recipe.id ?? Date.now(),
      name: (recipe.name || "").trim(),
      emoji: recipe.emoji || "🍽️",
      prepTime: recipe.prepTime || "30 min",
      cookTime: recipe.cookTime,
      tags,
      ingredients,
      instructions: recipe.instructions || "",
      servings: Number(recipe.servings) || 4,
      calories: Number(recipe.calories) || 0,
      protein: Number(recipe.protein) || 0,
      carbs: Number(recipe.carbs) || 0,
      fat: Number(recipe.fat) || 0,
      source: recipe.source,
      sourceUrl: recipe.sourceUrl,
      createdAt: recipe.createdAt || new Date().toISOString(),
      favorite: recipe.favorite,
      difficulty: recipe.difficulty,
      rating: recipe.rating,
      image: recipe.image,
    };
  };

  const {
    meals, setMeals, activeDay, setActiveDay: setActiveDayState, activeMeals, deleteMeal,
    aiMealIdeas, aiMealLoading, aiMealError, showAiSuggestions, generateAiMeals,
    activeWeek, goToWeek, archiveCurrentWeek, isCurrentWeek,
    generateWeeklyPlan, weeklyPlanLoading, weeklyPlanError,
    syncBlocked: mealsSyncBlocked,
  } = useMeals();

  /**
   * Day selection, kept in step with `?day=` in both directions.
   *
   * In: Home's "This Week" strip links `/meals?day=Sat`, and before this read
   * that parameter nothing anywhere consumed — the tap navigated to Meals and
   * changed nothing visible. A `useMeals` default is "today", so the deep link
   * has to override it explicitly.
   *
   * Out: the strip inside `PlanTab` moves `activeDay`, so the param is rewritten
   * too. A read-only param is the same staleness bug as a write-only one — reload
   * or Back would snap the family back to the day they had left.
   */
  // `null` = "no `?day=` has been folded into `activeDay` yet". It cannot be
  // seeded from the URL the way `syncedTabParam` is, because `activeDay` lives in
  // `useMeals` and its default is "today", not the deep-linked day.
  const [syncedDay, setSyncedDay] = useState<string | null>(null);

  const setActiveDay = useCallback(
    (day: string) => {
      setActiveDayState(day);
      if (normalizeDayParam(searchParams.get("day")) !== day) {
        setQueryParam("day", day);
      }
    },
    [setActiveDayState, searchParams, setQueryParam]
  );

  // Same "adjust while rendering" shape as `?tab=` above, for the same reason.
  if (requestedDay !== null && requestedDay !== syncedDay) {
    setSyncedDay(requestedDay);
    setActiveDayState(requestedDay);
  }

  const {
    groceryItems, activeCategory, setActiveCategory, setGroceryItems,
    addGroceryItem, toggleGroceryNeeded, deleteGroceryItem, updateGroceryItem,
    recentlyBought,
    parseManualGroceryInput, guessCategory: guessGroceryCategoryHook, toggleManualOverride
  } = useGrocery(showToast, meals);

  const {
    pantryItems, addPantryItem, updatePantryStatus, removePantryItem
  } = usePantry(showToast, groceryItems);

  const {
    recipes, saveCatalogRecipe, deleteCatalogRecipe, handleFileUpload,
    syncBlocked: recipesSyncBlocked,
  } = useRecipes(showToast);

  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [editingMealId, setEditingMealId] = useState<number | null>(null);
  const [recipe, setRecipe] = useState({ ...emptyRecipe });

  const openRecipeModal = (meal?: Partial<Meal>) => {
    if (meal && meal.id) {
      setEditingMealId(meal.id);
      setRecipe({ ...emptyRecipe, ...meal, protein: meal.protein || 0, carbs: meal.carbs || 0, fat: meal.fat || 0, instructions: meal.instructions || "", ingredients: meal.ingredients ?? [""] } as any);
    } else {
      setEditingMealId(null);
      setRecipe({ ...emptyRecipe, time: activeDay, ...(meal || {}) } as any);
    }
    setShowRecipeModal(true);
  };

  const saveRecipe = async () => {
    if (!recipe.name.trim()) return;
    if (editingMealId !== null) {
      const updated: Meal = {
        ...recipe,
        id: editingMealId,
        name: recipe.name.trim(),
        prepTime: recipe.prepTime || "30 min",
        ingredients: (recipe.ingredients ?? []).map(i => i.trim()).filter(Boolean),
        servings: Number(recipe.servings) || 4,
        calories: Number(recipe.calories) || 0,
        protein: Number(recipe.protein) || 0,
        carbs: Number(recipe.carbs) || 0,
        fat: Number(recipe.fat) || 0,
        tags: recipe.tags?.filter(Boolean) ?? [],
      } as Meal;
      setMeals(prev => prev.map(m => m.id === editingMealId ? updated : m));
      if (updated.time !== activeDay) setActiveDay(updated.time);
      const saved = await saveOrQueue(
        mealUpdateWrite(editingMealId, updated),
        () => db.updateMeal(String(editingMealId), updated)
      );
      showToast(saved
        ? `✅ "${updated.name}" updated!`
        : `⚠️ "${updated.name}" saved on this device. It will sync automatically.`);
    } else {
      const newMeal: Meal = {
        ...recipe,
        id: Date.now(),
        name: recipe.name.trim(),
        time: recipe.time || activeDay,
        mealType: recipe.mealType || "dinner",
        weekOf: activeWeek,
        prepTime: recipe.prepTime || "30 min",
        ingredients: (recipe.ingredients ?? []).map(i => i.trim()).filter(Boolean),
        servings: Number(recipe.servings) || 4,
        calories: Number(recipe.calories) || 0,
        protein: Number(recipe.protein) || 0,
        carbs: Number(recipe.carbs) || 0,
        fat: Number(recipe.fat) || 0,
        tags: recipe.tags?.filter(Boolean) ?? [],
      } as Meal;
      const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
      setMeals(prev => {
        const filtered = prev.filter(
          m => !(m.time === newMeal.time && m.mealType === newMeal.mealType)
        );
        return [...filtered, newMeal];
      });
      setActiveDay(newMeal.time);
      showToast(saved
        ? `✅ "${newMeal.name}" added to ${newMeal.time}!`
        : `⚠️ "${newMeal.name}" saved on this device. It will sync automatically.`);
    }
    setShowRecipeModal(false);
    setEditingMealId(null);
  };

  const saveCatalogRecipeFromModal = () => {
    saveCatalogRecipe(normalizeRecipeForCatalog(recipe as unknown as Recipe, editingRecipeId ?? undefined));
    setShowRecipeEditor(false);
  };

  const [showRecipeEditor, setShowRecipeEditor] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importModalKey, setImportModalKey] = useState(0);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchModalKey, setSearchModalKey] = useState(0);

  const startAddRecipe = () => {
    setEditingRecipeId(null); setShowRecipeEditor(true);
    setRecipe({ id: Date.now(), name: "", emoji: "📖", prepTime: "30 min", tags: [], ingredients: [""], instructions: "", servings: 4, calories: 500, createdAt: new Date().toISOString() } as any);
  };

  const startEditRecipe = (r: Recipe) => { setEditingRecipeId(r.id); setRecipe({ ...r } as any); setShowRecipeEditor(true); };

  const addRecipeToPlan = async (recipeData: Recipe, day = activeDay, mealType: Meal["mealType"] = "dinner") => {
    const newMeal: Meal = {
      id: Date.now(), name: recipeData.name, emoji: recipeData.emoji || "🍽️", time: day, mealType,
      prepTime: recipeData.prepTime || "30 min", tags: recipeData.tags?.filter(Boolean) ?? [], ingredients: (recipeData.ingredients ?? []).map(i => i.trim()).filter(Boolean),
      servings: Number(recipeData.servings) || 4, calories: Number(recipeData.calories) || 0, protein: Number(recipeData.protein) || 0, carbs: Number(recipeData.carbs) || 0, fat: Number(recipeData.fat) || 0, instructions: recipeData.instructions,
      weekOf: activeWeek, recipeId: String(recipeData.id), recipeSnapshotAt: new Date().toISOString(),
    };
    const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
    setMeals(prev => [...prev.filter(m => !(m.time === day && m.mealType === mealType)), newMeal]);
    setActiveDay(day);
    showToast(mealSaveToast(saved, recipeData.name, `added to ${day} ${mealType}`));
  };

  const addRecipeToMealSlot = async (recipeData: Recipe, day: string, mealType: Meal["mealType"]) => {
    const newMeal: Meal = {
      id: Date.now(),
      name: recipeData.name,
      emoji: recipeData.emoji || "🍽️",
      time: day,
      mealType,
      prepTime: recipeData.prepTime || "30 min",
      tags: recipeData.tags?.filter(Boolean) ?? [],
      ingredients: (recipeData.ingredients ?? []).map(i => i.trim()).filter(Boolean),
      servings: Number(recipeData.servings) || 4,
      calories: Number(recipeData.calories) || 0,
      protein: Number(recipeData.protein) || 0,
      carbs: Number(recipeData.carbs) || 0,
      fat: Number(recipeData.fat) || 0,
      instructions: recipeData.instructions,
      weekOf: activeWeek, recipeId: String(recipeData.id), recipeSnapshotAt: new Date().toISOString(),
    };
    const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
    setMeals(prev => [...prev.filter(m => !(m.time === day && m.mealType === mealType)), newMeal]);
    setActiveDay(day);
    showToast(mealSaveToast(saved, recipeData.name, `added to ${day} (${mealType})`));
  };

  const addRecipeToGrocery = async (recipeData: Recipe) => {
    const ingredients = (recipeData.ingredients ?? []).map(i => i.trim()).filter(Boolean);
    for (const ing of ingredients) {
      const category = guessGroceryCategory(ing);
      const catDef = groceryCategories.find(c => c.id === category);
      await db.upsertGroceryItem({ name: ing, category, aisle: catDef?.aisles?.[0]?.split('-')[0] || "1", quantity: "", priority: "medium", needed: true, source: "recipe", autoGenerated: false, userId: "demo" });
    }
    showToast(`🛒 Added ${ingredients.length} item${ingredients.length === 1 ? "" : "s"} to grocery`);
  };

  const addMissingToGrocery = async (ingredients: string[]) => {
    for (const ing of ingredients) {
      const category = guessGroceryCategory(ing);
      await addGroceryItem(ing, category, "medium", undefined, "", "", true);
    }
    showToast(`🛒 Added ${ingredients.length} missing item${ingredients.length === 1 ? "" : "s"} to grocery`);
  };

  const openImportModal = () => {
    setImportModalKey((k) => k + 1);
    setShowImportModal(true);
  };

  const openSearchModal = () => {
    setSearchModalKey((k) => k + 1);
    setShowSearchModal(true);
  };

  const copyDayMeals = async (fromDay: string, toDay: string) => {
    if (fromDay === toDay) return;
    const sourceMeals = meals.filter(m => m.time === fromDay && (m.weekOf || activeWeek) === activeWeek);
    if (!sourceMeals.length) { showToast(`No meals planned for ${fromDay}`); return; }
    const occupiedTypes = new Set(meals.filter(m => m.time === toDay && (m.weekOf || activeWeek) === activeWeek).map(m => m.mealType));
    let copied = 0;
    let allSaved = true;
    for (const meal of sourceMeals) {
      if (!occupiedTypes.has(meal.mealType)) {
        const newMeal: Meal = { ...meal, id: Date.now() + copied, time: toDay, weekOf: activeWeek };
        const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
        if (!saved) allSaved = false;
        setMeals(prev => [...prev, newMeal]);
        copied++;
      }
    }
    const countNote = `Copied ${copied} meal${copied === 1 ? "" : "s"} to ${toDay}${sourceMeals.length > copied ? ` (${sourceMeals.length - copied} slots occupied, skipped)` : ""}`;
    if (!copied) return;
    showToast(allSaved
      ? `📋 ${countNote}`
      : `⚠️ ${countNote}, saved on this device. It will sync automatically.`);
    setActiveDay(toDay);
  };

  const duplicateMeal = async (meal: Meal, targetDay: string) => {
    if (meal.time === targetDay) return;
    const existing = meals.find(m => m.time === targetDay && m.mealType === meal.mealType && (m.weekOf || activeWeek) === activeWeek);
    if (existing) { showToast(`⏭ Already have a ${meal.mealType} planned for ${targetDay}`); return; }
    const newMeal: Meal = { ...meal, id: Date.now(), time: targetDay, weekOf: activeWeek };
    const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
    setMeals(prev => [...prev, newMeal]);
    showToast(mealSaveToast(saved, meal.name, `copied to ${targetDay} (${meal.mealType})`));
    setActiveDay(targetDay);
  };

  const neededCount = groceryItems.filter(i => i.needed).length;
  const planPreview = mealSyncService.previewMealPlanToGrocery(meals, pantryItems, groceryItems);
  const missingCount = planPreview.items.length;
  const checkedCount = groceryItems.filter(i => !i.needed).length;
  const plenty = pantryItems.filter(p => p.status === "plenty").length;
  const low = pantryItems.filter(p => p.status === "low").length;
  const out = pantryItems.filter(p => p.status === "out").length;
  const planSummary = `${meals.length} meal${meals.length === 1 ? "" : "s"} planned · ${missingCount} ingredient${missingCount === 1 ? "" : "s"} missing`;
  const shopSummary = `${neededCount} item${neededCount === 1 ? "" : "s"} to buy · ${checkedCount} checked off`;
  const stockSummary = `${plenty} stocked · ${low} running low · ${out} out`;

  return (
    <PageShell>
      <Toast open={Boolean(notification)} tone={notification?.includes("❌") ? "error" : "success"}>{notification}</Toast>

      <PageHeader
        title={activeTab === "plan" && !meals.length ? "Meals" : "Kitchen"}
        subtitle={
          activeTab === "plan" && !meals.length
            ? "Family meal planning"
            : activeTab === "plan"
              ? "This week"
              : activeTab === "shop"
                ? `${neededCount} items needed`
                : `${pantryItems.length} items tracked`
        }
        action={
          activeTab === "plan" ? (
            activeTab === "plan" && !meals.length ? (
              <IconButton aria-label="Add meal" onClick={() => openRecipeModal()}><span>＋</span></IconButton>
            ) : (
              <SoftButton size="sm" variant="secondary" onClick={generateAiMeals} disabled={aiMealLoading}>
                {aiMealLoading ? "Thinking..." : "AI Suggest"}
              </SoftButton>
            )
          ) : null
        }
        icon="🍽️"
      />

      <div className="px-4 space-y-5 pb-8">
        <SegmentedControl
          aria-label="Kitchen"
          value={activeTab}
          onChange={(value) => selectTab(value as Tab)}
          options={[
            { id: "plan", label: "🍽️ Plan" },
            { id: "shop", label: "🛒 Shop" },
            { id: "stock", label: "🥫 Stock" },
          ]}
        />

        {activeTab === "plan" && (
          /* The week-restore screen used to have no inbound link anywhere in
             `src/` — reachable only by typing the URL, while its own exemption
             entry called it "tracked". It belongs beside the Plan tab's week nav,
             which is where a week gets archived. A plain `Link`, not a second nav
             surface and not a manifest entry: `/meals` is already the destination. */
          <div className="flex justify-end">
            <Link
              href="/meals/archive"
              className="tap hit-44 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-text-muted hover:text-text-primary"
            >
              <span aria-hidden="true">🗄️</span>
              Archived weeks
            </Link>
          </div>
        )}

        {activeTab === "plan" && (
          <div key="plan" className="panel-swap space-y-5">
            <PlanTab
              meals={meals}
              activeDay={activeDay}
              setActiveDay={setActiveDay}
              activeMeals={activeMeals}
              deleteMeal={deleteMeal}
              openRecipeModal={openRecipeModal}
              showAiSuggestions={showAiSuggestions}
              aiMealIdeas={aiMealIdeas}
              aiMealLoading={aiMealLoading}
              recipes={recipes}
              addRecipeToMealSlot={addRecipeToMealSlot}
              copyDayMeals={copyDayMeals}
              duplicateMeal={duplicateMeal}
              activeWeek={activeWeek}
              goToWeek={goToWeek}
              archiveCurrentWeek={archiveCurrentWeek}
              isCurrentWeek={isCurrentWeek}
              flowSummary={planSummary}
              focusRecipeBox={focusRecipeBox}
              saveCatalogRecipe={saveCatalogRecipe}
              deleteCatalogRecipe={deleteCatalogRecipe}
              addRecipeToPlan={addRecipeToPlan}
              addRecipeToGrocery={addRecipeToGrocery}
              startAddRecipe={startAddRecipe}
              startEditRecipe={startEditRecipe}
              handleFileUpload={handleFileUpload}
              openImportModal={openImportModal}
              openSearchModal={openSearchModal}
              aiMealError={aiMealError}
              weeklyPlanLoading={weeklyPlanLoading}
              weeklyPlanError={weeklyPlanError}
              generateWeeklyPlan={generateWeeklyPlan}
              syncBlocked={mealsSyncBlocked}
            />
          </div>
        )}

        {activeTab === "shop" && (
          <div key="shop" className="panel-swap">
          <ShopTab
            groceryItems={groceryItems}
            setGroceryItems={setGroceryItems}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            recentlyBought={recentlyBought}
            addGroceryItem={addGroceryItem}
            toggleGroceryNeeded={toggleGroceryNeeded}
            deleteGroceryItem={deleteGroceryItem}
            updateGroceryItem={updateGroceryItem}
            parseManualGroceryInput={parseManualGroceryInput}
            guessCategory={guessGroceryCategoryHook}
            showToast={showToast}
            pantryItems={pantryItems}
            addPantryItem={addPantryItem}
            removePantryItem={removePantryItem}
            toggleManualOverride={toggleManualOverride}
            meals={meals}
            flowSummary={shopSummary}
          />
          </div>
        )}

        {activeTab === "stock" && (
          <div key="stock" className="panel-swap">
            <StockTab
              pantryItems={pantryItems}
              groceryItems={groceryItems}
              addPantryItem={addPantryItem}
              updatePantryStatus={updatePantryStatus}
              removePantryItem={removePantryItem}
              addGroceryItem={addGroceryItem}
              flowSummary={stockSummary}
            />
            <div className="mt-6">
              <CookWithWhatYouHave recipes={recipes} pantryItems={pantryItems} onAddMissing={addMissingToGrocery} />
            </div>
          </div>
        )}
      </div>

      {showRecipeModal && (
        <RecipeModal
          mode="meal"
          recipe={recipe}
          setRecipe={setRecipe}
          editingMealId={editingMealId}
          saveRecipe={saveRecipe}
          setShowRecipeModal={setShowRecipeModal}
        />
      )}

      {showRecipeEditor && (
        <RecipeModal
          mode="catalog"
          recipe={recipe}
          setRecipe={setRecipe}
          editingMealId={editingRecipeId}
          saveRecipe={saveCatalogRecipeFromModal}
          setShowRecipeModal={setShowRecipeEditor}
        />
      )}

      <RecipeImportModal
        key={`import-${importModalKey}`}
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        recipes={recipes}
        onSave={saveCatalogRecipe}
        onOpenExisting={startEditRecipe}
        showToast={showToast}
      />

      <RecipeSearchModal
        key={`search-${searchModalKey}`}
        open={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        recipes={recipes}
        onSave={saveCatalogRecipe}
        onOpenExisting={startEditRecipe}
        showToast={showToast}
      />
    </PageShell>
  );
}

export default function MealHubPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 motion-safe:animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" /></div>}>
      <MealHubContent />
    </Suspense>
  );
}
