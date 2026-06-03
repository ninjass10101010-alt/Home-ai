"use client";

import { useState, Suspense } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import { useSearchParams } from "next/navigation";
import { db } from "@/db";
import { emptyRecipe } from "@/data/meals";
import { Meal, Recipe, Tab } from "@/types/meals";

// Hooks
import { useMeals } from "@/hooks/useMeals";
import { useGrocery } from "@/hooks/useGrocery";
import { usePantry } from "@/hooks/usePantry";
import { useRecipes } from "@/hooks/useRecipes";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

// Components
import MealsTab from "@/components/meals/MealsTab";
import GroceryTab from "@/components/meals/GroceryTab";
import PantryTab from "@/components/meals/PantryTab";
import RecipesTab from "@/components/meals/RecipesTab";
import RecipeModal from "@/components/meals/RecipeModal";

function MealHubContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "meals";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [notification, setNotification] = useState<string | null>(null);
  const { colors, accentRgb } = useAtmosphericTheme();

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // State Hooks
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

  // Recipe Creator Modal State
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
      // Update existing meal
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
      // Create new meal
      const newMeal: Meal = {
        ...recipe,
        id: Date.now(),
        name: recipe.name.trim(),
        prepTime: recipe.prepTime || "30 min",
        ingredients: recipe.ingredients.filter(i => i.trim()),
      } as Meal;
      db.insertMeal(newMeal);
      setMeals(prev => {
        // Replace only the meal slot (same day + same mealType),
        // instead of removing every meal for that day.
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

  // Recipe Actions from Catalog
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

  const addRecipeToGrocery = (recipeData: Recipe) => {
    recipeData.ingredients.forEach(ing => {
      if (ing.trim()) {
        db.upsertGroceryItem({ name: ing.trim(), category: "pantry", aisle: "1", quantity: "", priority: "medium", needed: true, source: "recipe", autoGenerated: false, userId: "demo" });
      }
    });
    showToast(`🛒 Added ${recipeData.ingredients.length} items to grocery`);
  };

  const neededCount = groceryItems.filter(i => i.needed).length;

  return (
    <PageShell>
      {/* Toast */}
      {notification && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-2xl border transition-all animate-[slideDown_0.3s_ease] ${
            notification.includes("❌")
              ? "bg-rose-500/20 border-rose-500/30 text-rose-300"
              : "bg-nori-500/20 border-nori-500/30 text-nori-300"
          }`}
          style={{ backdropFilter: "blur(20px)" }}
        >
          {notification}
        </div>
      )}

      <TopBar
        title="Kitchen"
        subtitle={activeTab === "meals" ? "This week" : activeTab === "grocery" ? `${neededCount} items needed` : activeTab === "pantry" ? `${pantryItems.length} items tracked` : "Recipe Catalog"}
        right={
          activeTab === "meals" ? (
            <button
              onClick={generateAiMeals}
              disabled={aiMealLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-nori-500/15 text-nori-400 text-xs font-medium hover:bg-nori-500/25 transition-colors disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path d="M12 2l2 7h7l-5.7 4.1 2.2 6.9L12 16l-5.5 4 2.2-6.9L3 9h7z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {aiMealLoading ? "Thinking..." : "AI Suggest"}
            </button>
          ) : null
        }
      />

      {/* Tab Bar */}
      <div className="px-4 mb-4">
        <div className="flex rounded-2xl bg-surface-2 p-1 gap-1">
          {([
            { id: "meals", label: "🍽️ Meals" },
            { id: "grocery", label: "🛒 Grocery" },
            { id: "pantry", label: "🥫 Pantry" },
            { id: "recipes", label: "📖 Recipes" },
          ] as { id: Tab; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-nori-500 text-surface-0 shadow-lg shadow-nori-500/25"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "meals" && (
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

              // Add into recipe catalog (consistent across dashboards)
              // useRecipes hook stores recipes state; we reuse saveCatalogRecipe
              saveCatalogRecipe(data.recipe);
              showToast(`✅ Added "${data?.recipe?.title || "Imported Recipe"}" to recipe catalog`);
            } catch (e: any) {
              showToast(`❌ Import failed: ${e?.message || "Unknown error"}`);
            }
          }}
          handleFileUpload={handleFileUpload}
        />
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

      <style jsx global>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes bounceIn {
          0% { transform: scale(0.8); opacity: 0.5; }
          60% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </PageShell>
  );
}

export default function MealHubPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div></div>}>
      <MealHubContent />
    </Suspense>
  );
}
