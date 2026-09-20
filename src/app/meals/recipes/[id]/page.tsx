/* eslint-disable react-hooks/purity */
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import PageShell from "@/components/ui/PageShell";
import Toast from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import RecipeModal from "@/components/meals/RecipeModal";
import CookMode from "@/components/meals/CookMode";
import { useRecipes } from "@/hooks/useRecipes";
import { useMeals, mealCreateWrite } from "@/hooks/useMeals";
import { saveOrQueue } from "@/lib/pending-writes";
import { mealSaveToast } from "@/lib/meal-save-toast";
import { parseIngredientLine } from "@/lib/ingredient-quantity";
import { parseInstructionsToSteps } from "@/lib/recipe-steps";
import { db } from "@/db";
import { weekDays, groceryCategories } from "@/data/meals";
import { Meal, Recipe } from "@/types/meals";

function snapshotAsRecipe(m: Meal): Recipe {
  return {
    id: Number(m.recipeId) || 0,
    name: m.name || "Untitled Recipe",
    emoji: m.emoji || "🍽️",
    prepTime: m.prepTime || "30 min",
    cookTime: undefined,
    tags: m.tags ?? [],
    ingredients: (m.ingredients ?? []).map((i) => i.trim()).filter(Boolean),
    instructions: m.instructions || "",
    servings: Number(m.servings) || 4,
    calories: Number(m.calories) || 0,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    source: undefined,
    sourceUrl: undefined,
    createdAt: new Date().toISOString(),
  };
}

function guessGroceryCategory(name: string): string {
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
}

function RecipeDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const backTarget = from === "plan" ? "/meals" : "/meals?tab=recipes";

  const [notification, setNotification] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);
  const showToast = (msg: string) => {
    setNotification(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotification(null), 3000);
  };

  const { recipes, saveCatalogRecipe, deleteCatalogRecipe, syncBlocked } = useRecipes(showToast);
  const { meals, setMeals, activeWeek } = useMeals();

  const id = String(params.id ?? "");

  const [settledByTimer, setSettledByTimer] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettledByTimer(true), 600);
    return () => clearTimeout(t);
  }, []);
  const catalogSettled = recipes.length > 0 || syncBlocked || settledByTimer;

  const catalogRecipe = recipes.find((r) => String(r.id) === id) ?? null;
  const snapshotMeal = meals.find((m) => String(m.recipeId) === id) ?? null;
  const snapshotMode = catalogSettled && !catalogRecipe && !!snapshotMeal;
  const recipe = catalogRecipe ?? (snapshotMeal ? snapshotAsRecipe(snapshotMeal) : null);

  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [groceryBusy, setGroceryBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecipe, setEditRecipe] = useState<Recipe | null>(null);
  const [cookOpen, setCookOpen] = useState(false);

  const steps = recipe ? parseInstructionsToSteps(recipe.instructions || "") : [];

  const addToPlan = async (day: string) => {
    if (!recipe || planBusy) return;
    setPlanBusy(true);
    const newMeal: Meal = {
      id: Date.now(),
      name: recipe.name,
      emoji: recipe.emoji || "🍽️",
      time: day,
      mealType: "dinner",
      prepTime: recipe.prepTime || "30 min",
      tags: recipe.tags?.filter(Boolean) ?? [],
      ingredients: (recipe.ingredients ?? []).map((i) => i.trim()).filter(Boolean),
      servings: Number(recipe.servings) || 4,
      calories: Number(recipe.calories) || 0,
      protein: recipe.protein ?? 0,
      carbs: recipe.carbs ?? 0,
      fat: recipe.fat ?? 0,
      instructions: recipe.instructions,
      weekOf: activeWeek,
      recipeId: snapshotMode ? undefined : String(recipe.id),
      recipeSnapshotAt: new Date().toISOString(),
    };
    const saved = await saveOrQueue(mealCreateWrite(newMeal), () => db.insertMeal(newMeal));
    setMeals((prev: Meal[]) => [
      ...prev.filter((m) => !(m.time === day && m.mealType === "dinner")),
      newMeal,
    ]);
    setDayPickerOpen(false);
    setPlanBusy(false);
    showToast(mealSaveToast(saved, recipe.name, `added to ${day} dinner`));
  };

  const addToGrocery = async () => {
    if (!recipe || groceryBusy) return;
    setGroceryBusy(true);
    const ingredients = (recipe.ingredients ?? []).map((i) => i.trim()).filter(Boolean);
    for (const ing of ingredients) {
      const category = guessGroceryCategory(ing);
      const catDef = groceryCategories.find((c) => c.id === category);
      await db.upsertGroceryItem({
        name: ing,
        category,
        aisle: catDef?.aisles?.[0]?.split("-")[0] || "1",
        quantity: "",
        priority: "medium",
        needed: true,
        source: "recipe",
        autoGenerated: false,
        userId: "demo",
      });
    }
    setGroceryBusy(false);
    showToast(`🛒 Added ${ingredients.length} item${ingredients.length === 1 ? "" : "s"} to grocery`);
  };

  const toggleFavorite = () => {
    if (!catalogRecipe) return;
    saveCatalogRecipe({ ...catalogRecipe, favorite: !catalogRecipe.favorite });
  };

  const openEdit = () => {
    if (!catalogRecipe) return;
    setEditRecipe({ ...catalogRecipe });
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (editRecipe?.name?.trim()) {
      saveCatalogRecipe(editRecipe);
    }
    setEditOpen(false);
  };

  const doDelete = async () => {
    if (!catalogRecipe || deleteBusy) return;
    setDeleteBusy(true);
    await deleteCatalogRecipe(catalogRecipe.id);
    setDeleteBusy(false);
    setConfirmDelete(false);
    router.replace(backTarget);
  };

  if (!recipe) {
    return (
      <PageShell>
        <Toast open={Boolean(notification)} tone={notification?.includes("❌") ? "error" : "success"}>
          {notification}
        </Toast>
        {!catalogSettled ? (
          <div className="kitchen-text mx-auto max-w-5xl space-y-4 px-4 py-8">
            <div className="h-10 w-44 rounded-2xl bg-[var(--color-surface-2)]" />
            <div className="h-64 rounded-3xl bg-[var(--color-surface-2)]" />
            <div className="h-40 rounded-3xl bg-[var(--color-surface-2)]" />
          </div>
        ) : syncBlocked ? (
          <div className="kitchen-text space-y-4 px-4 py-16 text-center">
            <p className="text-5xl">🔐</p>
            <p className="font-bold text-text-primary">Recipes are synced to the family account</p>
            <p className="text-xs font-medium text-text-muted">Sign in with your PIN to see this recipe.</p>
            <SoftButton variant="secondary" onClick={() => router.push(backTarget)}>
              ← Back to kitchen
            </SoftButton>
          </div>
        ) : (
          <div className="kitchen-text space-y-4 px-4 py-16 text-center">
            <p className="text-5xl">🍽️</p>
            <p className="font-bold text-text-primary">Recipe not found</p>
            <p className="text-xs font-medium text-text-muted">
              It may have been deleted from the recipe box.
            </p>
            <SoftButton variant="secondary" onClick={() => router.push(backTarget)}>
              ← Back to kitchen
            </SoftButton>
          </div>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Toast open={Boolean(notification)} tone={notification?.includes("❌") ? "error" : "success"}>
        {notification}
      </Toast>

      <div className="kitchen-text mx-auto max-w-5xl space-y-5 px-4 pb-10">
        <button
          onClick={() => router.push(backTarget)}
          className="glass min-h-[44px] rounded-full px-4 text-sm font-semibold text-text-secondary tap-sm hover:text-text-primary"
        >
          ← Back to kitchen
        </button>

        <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-3xl bg-[var(--color-surface-2)] sm:h-72">
          {recipe.image ? (
            <img
              src={recipe.image}
              alt={recipe.name}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="text-8xl">{recipe.emoji || "🍽️"}</span>
          )}
          {!snapshotMode && (
            <button
              onClick={toggleFavorite}
              aria-label="favorite"
              className={`absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md tap-sm ${
                recipe.favorite
                  ? "bg-[var(--color-accent-rose)]/90 text-white"
                  : "bg-[var(--color-surface-0)]/60 text-[var(--color-accent-rose)] hover:bg-[var(--color-surface-0)]/85"
              }`}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill={recipe.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">{recipe.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {recipe.tags?.slice(0, 4).map((t) => (
              <span key={t} className="glass-subtle rounded-full px-2.5 py-0.5 text-[11px] font-bold text-text-secondary">
                {t}
              </span>
            ))}
            {recipe.difficulty && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  recipe.difficulty === "Easy"
                    ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]"
                    : recipe.difficulty === "Medium"
                      ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]"
                      : "bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]"
                }`}
              >
                {recipe.difficulty}
              </span>
            )}
            {recipe.rating && recipe.rating > 0 && (
              <span className="text-[11px] font-bold text-text-muted">⭐ {recipe.rating.toFixed(1)}</span>
            )}
          </div>
        </div>

        {snapshotMode && (
          <div className="rounded-2xl border border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 px-4 py-3">
            <p className="text-sm font-semibold text-text-primary">
              This recipe was deleted from your recipe box — showing the version saved with your meal plan.
            </p>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4 lg:sticky lg:top-4">
            <div className="glass rounded-2xl p-4">
              <p className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">📊 Stats</p>
              <div className="flex flex-wrap gap-2">
                {recipe.prepTime && (
                  <span className="glass-subtle rounded-full px-3 py-1 text-[11px] font-bold text-text-primary">
                    ⏱ {recipe.prepTime} prep
                  </span>
                )}
                {recipe.cookTime && (
                  <span className="glass-subtle rounded-full px-3 py-1 text-[11px] font-bold text-text-primary">
                    🔥 {recipe.cookTime} cook
                  </span>
                )}
                {recipe.servings > 0 && (
                  <span className="glass-subtle rounded-full px-3 py-1 text-[11px] font-bold text-text-primary">
                    👨‍👩‍👧‍👦 serves {recipe.servings}
                  </span>
                )}
              </div>
              {(recipe.calories > 0 || recipe.protein || recipe.carbs || recipe.fat) && (
                <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
                  <div className="glass-subtle rounded-xl p-2">
                    <p className="text-sm font-extrabold text-text-primary">{recipe.calories || "—"}</p>
                    <p className="text-[11px] font-semibold text-text-muted">kcal</p>
                  </div>
                  <div className="glass-subtle rounded-xl p-2">
                    <p className="text-sm font-extrabold text-text-primary">{recipe.protein || "—"}</p>
                    <p className="text-[11px] font-semibold text-text-muted">protein</p>
                  </div>
                  <div className="glass-subtle rounded-xl p-2">
                    <p className="text-sm font-extrabold text-text-primary">{recipe.carbs || "—"}</p>
                    <p className="text-[11px] font-semibold text-text-muted">carbs</p>
                  </div>
                  <div className="glass-subtle rounded-xl p-2">
                    <p className="text-sm font-extrabold text-text-primary">{recipe.fat || "—"}</p>
                    <p className="text-[11px] font-semibold text-text-muted">fat</p>
                  </div>
                </div>
              )}
            </div>

            <div className="glass space-y-2 rounded-2xl p-4">
              <button
                onClick={() => setDayPickerOpen((v) => !v)}
                aria-expanded={dayPickerOpen}
                className="min-h-[44px] w-full rounded-2xl bg-[var(--color-accent-selected)] text-sm font-bold text-white tap"
              >
                ＋ Add to day {dayPickerOpen ? "▴" : "▾"}
              </button>
              {dayPickerOpen && (
                <div className="grid grid-cols-4 gap-1.5">
                  {weekDays.map((day) => (
                    <button
                      key={day}
                      disabled={planBusy}
                      onClick={() => addToPlan(day)}
                      className="glass min-h-[44px] rounded-xl text-xs font-bold text-text-secondary tap-sm hover:text-[var(--color-accent-selected)] disabled:opacity-50"
                    >
                      {day}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  disabled={groceryBusy}
                  onClick={addToGrocery}
                  className="min-h-[44px] flex-1 rounded-2xl bg-[var(--color-accent-amber)]/15 text-sm font-bold text-[var(--color-accent-amber)] tap-sm hover:bg-[var(--color-accent-amber)]/25 disabled:opacity-50"
                >
                  🛒 To grocery
                </button>
                {!snapshotMode && (
                  <>
                    <button
                      onClick={openEdit}
                      aria-label="Edit recipe"
                      className="glass min-h-[44px] min-w-[44px] rounded-2xl text-text-muted tap-sm hover:text-text-primary"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete recipe"
                      className="glass min-h-[44px] min-w-[44px] rounded-2xl text-[var(--color-accent-rose)] tap-sm hover:bg-[var(--color-accent-rose)]/10"
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => setCookOpen(true)}
                className="min-h-[48px] w-full rounded-2xl bg-[var(--color-accent-amber)] text-sm font-extrabold text-[var(--color-surface-0)] tap"
              >
                👨‍🍳 Cook mode
              </button>
            </div>

            <div className="glass rounded-2xl p-4">
              <p className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">
                🥕 Ingredients · {recipe.ingredients?.length ?? 0}
              </p>
              {(!recipe.ingredients || recipe.ingredients.length === 0) && (
                <p className="text-sm font-medium text-text-muted">
                  No ingredients saved.{!snapshotMode && " Tap ✏️ to add some."}
                </p>
              )}
              <ul className="space-y-2">
                {(recipe.ingredients ?? []).map((ing, idx) => {
                  const parsed = parseIngredientLine(ing);
                  return (
                    <li key={idx} className="flex gap-2 text-sm text-text-primary">
                      <span className="text-text-muted">•</span>
                      {parsed ? (
                        <span>
                          <span className="font-bold text-[var(--color-accent-amber)]">
                            {parsed.quantity}
                            {parsed.unit ? ` ${parsed.unit}` : ""}
                          </span>{" "}
                          {parsed.rest}
                        </span>
                      ) : (
                        <span>{ing}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass rounded-2xl p-4 sm:p-5">
              <p className="mb-4 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">
                👨‍🍳 Instructions · {steps.length} step{steps.length === 1 ? "" : "s"}
              </p>
              {steps.length === 0 && (
                <p className="text-sm font-medium text-text-muted">
                  No instructions saved.{!snapshotMode && " Tap ✏️ to add them."}
                </p>
              )}
              <ol className="space-y-4">
                {steps.map((step, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-selected)]/15 text-[11px] font-extrabold text-[var(--color-accent-selected)]">
                      {idx + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-text-primary">{step}</p>
                  </li>
                ))}
              </ol>
            </div>

            {(recipe.sourceUrl || recipe.source) && (
              <p className="break-words text-[11px] font-semibold text-text-muted">
                🌐 Source:{" "}
                {recipe.sourceUrl ? (
                  <a
                    href={recipe.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-secondary underline hover:text-text-primary"
                  >
                    {recipe.sourceUrl}
                  </a>
                ) : (
                  <span className="text-text-secondary">{recipe.source}</span>
                )}
                {recipe.source && recipe.sourceUrl && <span className="text-text-muted"> · {recipe.source}</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete recipe?"
        description={`"${recipe.name}" will be removed from your recipe box. Meals already planned with it keep their saved copy.`}
        footer={
          <div className="flex gap-2">
            <SoftButton variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Cancel
            </SoftButton>
            <SoftButton variant="danger" className="flex-1" onClick={doDelete} disabled={deleteBusy}>
              Delete
            </SoftButton>
          </div>
        }
      >
        <p className="text-sm text-text-secondary">This can&apos;t be undone.</p>
      </Modal>

      {editOpen && editRecipe && (
        <RecipeModal
          mode="catalog"
          recipe={editRecipe}
          setRecipe={(r: Recipe) => setEditRecipe(r)}
          editingMealId={null}
          saveRecipe={saveEdit}
          setShowRecipeModal={setEditOpen}
        />
      )}

      {cookOpen && <CookMode recipe={recipe} onExit={() => setCookOpen(false)} />}
    </PageShell>
  );
}

export default function RecipeDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-12 w-12 motion-safe:animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]" />
        </div>
      }
    >
      <RecipeDetailContent />
    </Suspense>
  );
}
