"use client";
import { useState, useMemo } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { weekDays, RECIPE_TAGS } from "@/data/meals";
import { Recipe } from "@/types/meals";

const recipeFilters = ["All", ...RECIPE_TAGS];

export default function RecipesTab({
  recipes,
  activeDay,
  saveCatalogRecipe,
  deleteCatalogRecipe,
  addRecipeToPlan,
  addRecipeToGrocery,
  startAddRecipe,
  startEditRecipe,
  handleFileUpload,
  importRecipeFromUrl,
}: any) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [addedId, setAddedId] = useState<number | null>(null);

  const visible = useMemo(() => {
    return recipes.filter((r: Recipe) => {
      const q = query.trim().toLowerCase();
      const matchQ = !q || r.name.toLowerCase().includes(q) || r.tags?.some((t: string) => t.toLowerCase().includes(q));
      const matchF = filter === "All" || r.tags?.includes(filter);
      return matchQ && matchF;
    });
  }, [recipes, query, filter]);

  const toggleFav = (id: number) => {
    const recipe = recipes.find((r: Recipe) => r.id === id);
    if (recipe) {
      saveCatalogRecipe({ ...recipe, favorite: !recipe.favorite });
    }
  };

  const addToPlan = (recipe: Recipe) => {
    addRecipeToPlan(recipe, activeDay);
    setAddedId(recipe.id);
    setTimeout(() => setAddedId(cur => cur === recipe.id ? null : cur), 1500);
  };

  return (
    <div className="space-y-6 pb-6">
      {/* ── Actions bar ── */}
      <div className="flex gap-2">
        <button
          onClick={startAddRecipe}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)] text-sm font-medium hover:bg-[var(--color-accent-selected)]/25 tap-sm cursor-pointer"
        >
          + New Recipe
        </button>
        <button
          onClick={() => {
            const url = prompt("Enter recipe URL (Pinterest/TikTok/etc):");
            if (url && importRecipeFromUrl) importRecipeFromUrl(url, "Web");
          }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl glass text-text-secondary text-sm font-medium border border-[var(--color-surface-3)] hover:text-text-primary tap-sm cursor-pointer"
        >
          🌐 Web Import
        </button>
        <button
          onClick={() => document.getElementById("recipe-pdf-upload-recipes")?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl glass text-text-secondary text-sm font-medium border border-[var(--color-surface-3)] hover:text-text-primary tap-sm cursor-pointer"
        >
          📄 Import
        </button>
      </div>
      <input type="file" id="recipe-file-upload-recipes" accept=".txt,.json,.csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />

      {/* ── Search + Filters ── */}
      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted/50"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes, tags…"
              className="w-full rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface-0)]/50 py-2.5 pl-11 pr-4 text-sm font-semibold text-text-primary placeholder:text-text-muted/50 outline-none transition focus:border-[var(--color-accent-selected)]/50 focus:bg-[var(--color-surface-0)]/80 focus:ring-2 focus:ring-[var(--color-accent-selected)]/20"
            />
          </div>
          <span className="hidden text-xs font-bold text-text-muted sm:block">
            {visible.length} recipe{visible.length !== 1 && "s"}
          </span>
        </div>
        <div className="nice-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
          {recipeFilters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-xs font-bold tap-sm ${
                filter === f
                  ? "bg-[var(--color-accent-selected)] text-white shadow-lg shadow-[var(--color-accent-selected)]/25"
                  : "glass-subtle text-text-secondary hover:text-text-primary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Recipe Cards Grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((recipe: Recipe) => {
          const isAdded = addedId === recipe.id;
          return (
            <article
              key={recipe.id}
              className="liquid-glass group overflow-hidden rounded-2xl"
            >
              {/* Image/emoji header */}
              <div className="relative h-44 overflow-hidden bg-[var(--color-surface-2)] flex items-center justify-center">
                {recipe.image ? (
                  <img
                    src={recipe.image}
                    alt={recipe.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-7xl">
                    {recipe.emoji || "🍽️"}
                  </span>
                )}
                {/* Favorite button */}
                <button
                  onClick={() => toggleFav(recipe.id)}
                  aria-label="favorite"
                  className={`absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full backdrop-blur-md tap-sm ${
                    recipe.favorite
                      ? "bg-[var(--color-accent-rose)]/90 text-white shadow-lg"
                      : "bg-[var(--color-surface-0)]/60 text-[var(--color-accent-rose)] hover:bg-[var(--color-surface-0)]/85"
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill={recipe.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
                {/* Stats badges */}
                <div className="absolute bottom-3 left-3 flex gap-1.5">
                  {recipe.prepTime && (
                    <span className="rounded-full bg-[var(--color-surface-0)]/70 px-2.5 py-1 text-[11px] font-extrabold text-text-primary backdrop-blur-md">
                      ⏱ {recipe.prepTime}
                    </span>
                  )}
                  {recipe.calories > 0 && (
                    <span className="rounded-full bg-[var(--color-surface-0)]/70 px-2.5 py-1 text-[11px] font-extrabold text-text-primary backdrop-blur-md">
                      🔥 {recipe.calories} kcal
                    </span>
                  )}
                </div>
              </div>

              <div className="p-4">
                <h3 className="text-base font-bold text-text-primary truncate">{recipe.name}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-text-muted">
                  {recipe.servings > 0 && (
                    <span>👨‍👩‍👧‍👦 serves {recipe.servings}</span>
                  )}
                  {recipe.servings > 0 && recipe.tags?.length > 0 && <span>·</span>}
                  {recipe.tags?.slice(0, 3).map((t: string) => (
                    <span key={t} className="glass-subtle rounded-full px-2 py-0.5 text-[10px] font-bold text-text-secondary">
                      {t}
                    </span>
                  ))}
                </div>

                {recipe.difficulty && (
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    recipe.difficulty === "Easy" ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]"
                      : recipe.difficulty === "Medium" ? "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]"
                      : "bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]"
                  }`}>
                    {recipe.difficulty}
                  </span>
                )}

                {recipe.rating && recipe.rating > 0 && (
                  <span className="ml-1.5 text-[11px] font-bold text-text-muted">⭐ {recipe.rating.toFixed(1)}</span>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex gap-1.5">
                  {/* Add to Meal Plan — with day dropdown on hover */}
                  <div className="relative group flex-1">
                    <button
                      onClick={() => addToPlan(recipe)}
                      className={`w-full cursor-pointer rounded-2xl py-2 text-xs font-bold tap-sm ${
                        isAdded
                          ? "bg-[var(--color-accent-mint)] text-white"
                          : "bg-[var(--color-accent-selected)] text-white shadow-lg shadow-[var(--color-accent-selected)]/25 hover:opacity-90"
                      }`}
                    >
                      {isAdded ? "✓ Added!" : `＋ Add to ${activeDay}`}
                    </button>
                    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:grid grid-cols-4 gap-0.5 bg-[var(--color-surface-0)] border border-[var(--color-surface-3)] rounded-2xl shadow-xl p-1 z-50 min-w-[180px]">
                      {weekDays.map(day => (
                        <button
                          key={day}
                          onClick={(e) => { e.stopPropagation(); addToPlan(recipe); }}
                           className="rounded-lg px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-[var(--color-accent-selected)]/15 hover:text-[var(--color-accent-selected)] whitespace-nowrap cursor-pointer tap-sm"
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => addRecipeToGrocery(recipe)}
                    className="cursor-pointer rounded-2xl bg-[var(--color-accent-amber)]/15 px-3 py-2 text-xs font-bold text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)]/25 tap-sm"
                  >
                    🛒
                  </button>
                  <button
                    onClick={() => startEditRecipe(recipe)}
                    className="cursor-pointer rounded-2xl px-2.5 py-2 text-xs font-medium text-text-muted hover:text-text-primary tap-sm"
                  >
                    ✏️
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-4xl">🍽️</p>
          <p className="mt-2 font-bold text-text-primary">No recipes match that</p>
          <p className="text-xs font-medium text-text-muted mt-1">Try another search or clear the filter.</p>
        </div>
      )}

      <input type="file" id="recipe-pdf-upload-recipes" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
    </div>
  );
}