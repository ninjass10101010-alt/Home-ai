"use client";

import { useState, Suspense } from "react";
import PageShell from "@/components/ui/PageShell";
import { useSearchParams } from "next/navigation";
import { db } from "@/db";
import { emptyRecipe } from "@/data/meals";
import { Meal, Recipe, Tab } from "@/types/meals";
import { useMeals } from "@/hooks/useMeals";
import { useGrocery } from "@/hooks/useGrocery";
import { usePantry } from "@/hooks/usePantry";
import { useRecipes } from "@/hooks/useRecipes";
import MealsTab from "@/components/meals/MealsTab";
import GroceryTab from "@/components/meals/GroceryTab";
import PantryTab from "@/components/meals/PantryTab";
import RecipesTab from "@/components/meals/RecipesTab";
import RecipeModal from "@/components/meals/RecipeModal";
import PageHeader from "@/components/patterns/PageHeader";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import ListRow from "@/components/ui/ListRow";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import SectionCard from "@/components/patterns/SectionCard";

function MealHubContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "meals";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const {
    meals, setMeals, activeDay, setActiveDay, activeMeals, deleteMeal,
    aiMealIdeas, aiMealLoading, showAiSuggestions, generateAiMeals
  } = useMeals();

  const {
    groceryItems, activeCategory, setActiveCategory, isSyncing, setGroceryItems,
    addGroceryItem, toggleGroceryNeeded, deleteGroceryItem, updateGroceryItem,
    syncMealToGrocery, syncPantryToGrocery, recentlyBought, clearRecentlyBought
  } = useGrocery(showToast);

  const {
    pantryItems, addPantryItem, updatePantryStatus, removePantryItem
  } = usePantry(showToast);

  const {
    recipes, saveCatalogRecipe, deleteCatalogRecipe, handleFileUpload
  } = useRecipes(showToast);

  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [editingMealId, setEditingMealId] = useState<number | null>(null);
  const [recipe, setRecipe] = useState({ ...emptyRecipe });

  const openRecipeModal = (meal?: Partial<Meal>) => {
    if (meal && meal.id) {
      setEditingMealId(meal.id);
      setRecipe({ ...emptyRecipe, ...meal, protein: meal.protein || 0, carbs: meal.carbs || 0, fat: meal.fat || 0, instructions: meal.instructions || "" } as any);
    } else {
      setEditingMealId(null);
      setRecipe({ ...emptyRecipe, time: activeDay, ...(meal || {}) } as any);
    }
    setShowRecipeModal(true);
  };

  const saveRecipe = () => {
    if (!recipe.name.trim()) return;
    if (editingMealId !== null) {
      const updated: Meal = {
        ...recipe,
        id: editingMealId,
        name: recipe.name.trim(),
        prepTime: recipe.prepTime || "30 min",
        ingredients: recipe.ingredients.filter(i => i.trim()),
      } as Meal;
      setMeals(prev => prev.map(m => m.id === editingMealId ? updated : m));
      if (updated.time !== activeDay) setActiveDay(updated.time);
      showToast(`✅ "${updated.name}" updated!`);
    } else {
      const newMeal: Meal = {
        ...recipe,
        id: Date.now(),
        name: recipe.name.trim(),
        prepTime: recipe.prepTime || "30 min",
        ingredients: recipe.ingredients.filter(i => i.trim()),
      } as Meal;
      db.insertMeal(newMeal);
      setMeals(prev => {
        const filtered = prev.filter(
          m => !(m.time === newMeal.time && m.mealType === newMeal.mealType)
        );
        return [...filtered, newMeal];
      });
      setActiveDay(newMeal.time);
      showToast(`✅ "${newMeal.name}" added to ${newMeal.time}!`);
    }
    setShowRecipeModal(false);
    setEditingMealId(null);
  };

  const [showRecipeEditor, setShowRecipeEditor] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);

  const startAddRecipe = () => {
    setEditingRecipeId(null); setShowRecipeEditor(true);
    setRecipe({ id: Date.now(), name: "", emoji: "📖", prepTime: "30 min", tags: [], ingredients: [""], instructions: "", servings: 4, calories: 500, createdAt: new Date().toISOString() } as any);
  };

  const startEditRecipe = (r: Recipe) => { setEditingRecipeId(r.id); setRecipe({ ...r } as any); setShowRecipeEditor(true); };

  const addRecipeToPlan = (recipeData: Recipe, day: string) => {
    const newMeal: Meal = {
      id: Date.now(), name: recipeData.name, emoji: recipeData.emoji, time: day, mealType: "dinner",
      prepTime: recipeData.prepTime, tags: recipeData.tags, ingredients: recipeData.ingredients,
      servings: recipeData.servings, calories: recipeData.calories, instructions: recipeData.instructions,
    };
    setMeals(prev => [...prev, newMeal]);
    showToast(`✅ Added ${recipeData.name} to ${day}`);
  };

  const addRecipeToMealSlot = (recipeData: Recipe, day: string, mealType: Meal["mealType"]) => {
    const newMeal: Meal = {
      id: Date.now(),
      name: recipeData.name,
      emoji: recipeData.emoji,
      time: day,
      mealType,
      prepTime: recipeData.prepTime,
      tags: recipeData.tags,
      ingredients: recipeData.ingredients,
      servings: recipeData.servings,
      calories: recipeData.calories,
      instructions: recipeData.instructions,
    };
    setMeals(prev => [...prev, newMeal]);
    showToast(`✅ Added ${recipeData.name} to ${day} (${mealType})`);
  };

  const addRecipeToGrocery = (recipeData: Recipe) => {
    recipeData.ingredients.forEach(ing => {
      if (ing.trim()) {
        db.upsertGroceryItem({ name: ing.trim(), category: "pantry", aisle: "1", quantity: "", priority: "medium", needed: true, source: "recipe", autoGenerated: false, userId: "demo" });
      }
    });
    showToast(`🛒 Added ${recipeData.ingredients.length} items to grocery`);
  };

  const neededCount = groceryItems.filter(i => i.needed).length;
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => ({
    id: day,
    label: day,
    detail: String(index + 1),
    active: day === activeDay,
  }));

  if (activeTab === "meals" && !meals.length) {
    return (
      <PageShell>
        <Toast open={Boolean(notification)} tone="success">{notification}</Toast>
        <PageHeader title="Meals" subtitle="Family meal planning" action={<IconButton aria-label="Add meal" onClick={() => openRecipeModal()}><span>＋</span></IconButton>} icon="🍽️" />
        <div className="px-4">
          <EmptyState title="No meals planned yet" description="Start with a simple breakfast, lunch, snack, or dinner for the week." actionLabel="Add meal" onAction={() => openRecipeModal()} />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Toast open={Boolean(notification)} tone={notification?.includes("❌") ? "error" : "success"}>{notification}</Toast>

      <PageHeader
        title="Kitchen"
        subtitle={activeTab === "meals" ? "This week" : activeTab === "grocery" ? `${neededCount} items needed` : activeTab === "pantry" ? `${pantryItems.length} items tracked` : "Recipe Catalog"}
        action={
          activeTab === "meals" ? (
            <SoftButton size="sm" variant="secondary" onClick={generateAiMeals} disabled={aiMealLoading}>
              {aiMealLoading ? "Thinking..." : "AI Suggest"}
            </SoftButton>
          ) : null
        }
        icon="🍽️"
      />

      <div className="px-4 space-y-5 pb-8">
        <SegmentedControl
          aria-label="Meal hub"
          value={activeTab}
          onChange={(value) => setActiveTab(value as Tab)}
          options={[
            { id: "meals", label: "🍽️ Meals" },
            { id: "grocery", label: "🛒 Grocery" },
            { id: "pantry", label: "🥫 Pantry" },
            { id: "recipes", label: "📖 Recipes" },
          ]}
        />

        {activeTab === "meals" && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Planned" value={meals.length} detail="This week" icon="📅" tone="accent" />
              <StatTile label="Tonight" value={activeMeals.length} detail="Selected day" icon="🌙" tone="warning" />
              <StatTile label="Sync" value={isSyncing ? "…" : "Ready"} detail="Pantry + grocery" icon="🔁" tone="success" />
            </div>

            <SectionCard title="Week" description="Tap a day to edit meals." icon="🗓️">
              <DayStrip
                value={activeDay}
                onChange={setActiveDay}
                days={weekDays}
              />
            </SectionCard>

            <MealsTab
              meals={meals}
              activeDay={activeDay}
              setActiveDay={setActiveDay}
              activeMeals={activeMeals}
              deleteMeal={deleteMeal}
              openRecipeModal={openRecipeModal}
              setActiveTab={setActiveTab}
              handleSyncMealToGrocery={syncMealToGrocery}
              isSyncing={isSyncing}
              showAiSuggestions={showAiSuggestions}
              aiMealIdeas={aiMealIdeas}
              aiMealLoading={aiMealLoading}
              recipes={recipes}
              addRecipeToMealSlot={addRecipeToMealSlot}
              importRecipeFromUrl={async (url: string, source?: string) => {
                const label = source ? source : "Web";
                showToast(`📥 Importing from ${label}: ${url}...`);
                try {
                  const res = await fetch("/api/recipes/ingest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "url", url, sourceLabel: label }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    showToast(`❌ ${data?.error || "Import failed"}`);
                    return;
                  }
                  saveCatalogRecipe(data.recipe);
                  showToast(`✅ Added "${data?.recipe?.title || "Imported Recipe"}" to recipe catalog`);
                } catch (e: any) {
                  showToast(`❌ Import failed: ${e?.message || "Unknown error"}`);
                }
              }}
              handleFileUpload={handleFileUpload}
            />
          </div>
        )}

        {activeTab === "grocery" && (
          <GroceryTab
            groceryItems={groceryItems}
            setGroceryItems={setGroceryItems}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            isSyncing={isSyncing}
            recentlyBought={recentlyBought}
            clearRecentlyBought={clearRecentlyBought}
            addGroceryItem={addGroceryItem}
            toggleGroceryNeeded={toggleGroceryNeeded}
            deleteGroceryItem={deleteGroceryItem}
            updateGroceryItem={updateGroceryItem}
            syncMealToGrocery={syncMealToGrocery}
            syncPantryToGrocery={syncPantryToGrocery}
          />
        )}

        {activeTab === "pantry" && (
          <PantryTab
            pantryItems={pantryItems}
            addPantryItem={addPantryItem}
            updatePantryStatus={updatePantryStatus}
            removePantryItem={removePantryItem}
            syncPantryToGrocery={syncPantryToGrocery}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === "recipes" && (
          <RecipesTab
            recipes={recipes}
            saveCatalogRecipe={saveCatalogRecipe}
            deleteCatalogRecipe={deleteCatalogRecipe}
            addRecipeToPlan={addRecipeToPlan}
            addRecipeToGrocery={addRecipeToGrocery}
            startAddRecipe={startAddRecipe}
            startEditRecipe={startEditRecipe}
            handleFileUpload={handleFileUpload}
          />
        )}
      </div>

      {showRecipeModal && (
        <RecipeModal
          recipe={recipe}
          setRecipe={setRecipe}
          editingMealId={editingMealId}
          saveRecipe={saveRecipe}
          setShowRecipeModal={setShowRecipeModal}
        />
      )}

      {showRecipeEditor && (
        <RecipeModal
          recipe={recipe}
          setRecipe={setRecipe}
          editingMealId={editingRecipeId}
          saveRecipe={() => {
            saveCatalogRecipe(recipe as unknown as Recipe);
            setShowRecipeEditor(false);
          }}
          setShowRecipeModal={setShowRecipeEditor}
        />
      )}
    </PageShell>
  );
}

export default function MealHubPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" /></div>}>
      <MealHubContent />
    </Suspense>
  );
}
