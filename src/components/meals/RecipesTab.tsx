import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { weekDays } from "@/data/meals";
import { Recipe } from "@/types/meals";

export default function RecipesTab({
  recipes,
  saveCatalogRecipe,
  deleteCatalogRecipe,
  addRecipeToPlan,
  addRecipeToGrocery,
  startAddRecipe,
  startEditRecipe,
  handleFileUpload,
}: any) {
  return (
    <div className="px-4 space-y-4 pb-4">
      {/* Add Recipe + Import buttons */}
      <div className="flex gap-2">
        <button onClick={startAddRecipe}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-nori-500/15 text-nori-400 text-sm font-medium hover:bg-nori-500/25 transition-colors">
          + New Recipe
        </button>
        <button onClick={() => document.getElementById("recipe-pdf-upload")?.click()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass text-text-secondary text-sm border border-surface-3 hover:text-text-primary transition-colors">
          📄 Import
        </button>
      </div>

      <input type="file" id="recipe-pdf-upload" accept=".pdf" className="hidden" onChange={(e) => {if(e.target.files?.[0]) handleFileUpload(e.target.files[0])}} />

      {/* Recipe list */}
      <div className="space-y-2">
        {recipes.length === 0 ? (
          <div className="text-center py-10">
            <span className="text-4xl block mb-3">📖</span>
            <p className="text-text-secondary text-sm">No recipes yet</p>
            <p className="text-text-muted text-xs mt-1">Create one or import a PDF</p>
          </div>
        ) : (
          recipes.map((recipe: Recipe) => (
            <Card key={recipe.id} className="!p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{recipe.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-semibold">{recipe.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{recipe.prepTime} · {recipe.servings} servings</p>
                  {recipe.tags && recipe.tags.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {recipe.tags.map((t: string) => <Badge key={t} variant="gray">{t}</Badge>)}
                    </div>
                  )}
                  {recipe.ingredients && recipe.ingredients.length > 0 && (
                    <p className="text-text-secondary text-[11px] mt-1.5 line-clamp-2">
                      {recipe.ingredients.join(" · ")}
                    </p>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    {/* Add to Plan with day picker */}
                    <div className="relative group">
                      <button className="px-2.5 py-1 rounded-lg bg-nori-500/15 text-nori-400 text-[10px] font-semibold hover:bg-nori-500/25 transition-colors">
                        + Meal Plan
                      </button>
                      <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex bg-surface-0 border border-surface-3 rounded-xl shadow-xl p-1 gap-0.5 z-50">
                        {weekDays.map(day => (
                          <button key={day} onClick={() => addRecipeToPlan(recipe, day)}
                            className="px-2 py-1 rounded-lg text-[10px] font-medium text-text-secondary hover:bg-nori-500/15 hover:text-nori-400 whitespace-nowrap">
                            {day}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => addRecipeToGrocery(recipe)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/25 transition-colors">
                      🛒 Grocery
                    </button>
                    <button onClick={() => startEditRecipe(recipe)}
                      className="px-2 py-1 rounded-lg text-text-muted text-[10px] hover:text-text-secondary">✏️</button>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
