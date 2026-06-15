import { useState } from "react";
import { weekDays, foodEmojis, RECIPE_TAGS } from "@/data/meals";
import { Meal } from "@/types/meals";

export default function RecipeModal({
  recipe,
  setRecipe,
  editingMealId,
  saveRecipe,
  setShowRecipeModal,
}: any) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const updateIngredient = (idx: number, val: string) => {
    const ing = [...recipe.ingredients];
    ing[idx] = val;
    setRecipe((r: any) => ({ ...r, ingredients: ing }));
  };

  const addIngredientRow = () => setRecipe((r: any) => ({ ...r, ingredients: [...r.ingredients, ""] }));
  const removeIngredientRow = (idx: number) => setRecipe((r: any) => ({ ...r, ingredients: r.ingredients.filter((_: any, i: number) => i !== idx) }));

  const toggleTag = (tag: string) => {
    setRecipe((r: any) => ({
      ...r,
      tags: r.tags.includes(tag) ? r.tags.filter((t: string) => t !== tag) : [...r.tags, tag],
    }));
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}>
      {/* Modal sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl flex flex-col overflow-hidden"
        style={{
          background: "var(--color-surface-1)",
          border: "1px solid var(--color-surface-4)",
          maxHeight: "92vh",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-center justify-between border-b border-surface-3">
          <div>
            <h2 className="text-text-primary font-bold text-lg">{editingMealId !== null ? "✏️ Edit Recipe" : "🍳 Create Recipe"}</h2>
            <p className="text-text-muted text-xs">{editingMealId !== null ? "Update your recipe" : "Add your own recipe to the meal planner"}</p>
          </div>
          <button
            onClick={() => setShowRecipeModal(false)}
            className="w-9 h-9 rounded-2xl glass flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Emoji + Name */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center text-4xl hover:bg-surface-3 transition-colors border-2 border-dashed border-surface-4 hover:border-[var(--color-accent-selected)]/40"
              >
                {recipe.emoji}
              </button>
              {showEmojiPicker && (
                <div
                  className="absolute top-full left-0 mt-2 z-50 p-3 rounded-2xl shadow-2xl"
                  style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-surface-4)", width: "260px" }}
                >
                  <p className="text-text-muted text-xs mb-2">Choose an emoji</p>
                  <div className="grid grid-cols-8 gap-1">
                    {foodEmojis.map(e => (
                      <button
                        key={e}
                        onClick={() => { setRecipe((r: any) => ({ ...r, emoji: e })); setShowEmojiPicker(false); }}
                        className={`w-8 h-8 rounded-lg text-xl flex items-center justify-center hover:bg-[var(--color-accent-selected)]/20 transition-all hover:scale-110 ${recipe.emoji === e ? "bg-[var(--color-accent-selected)]/20" : ""}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <input
              value={recipe.name}
              onChange={e => setRecipe((r: any) => ({ ...r, name: e.target.value }))}
              placeholder="Recipe name..."
              className="flex-1 bg-surface-2 text-text-primary text-base font-semibold rounded-2xl px-4 py-3 outline-none placeholder:text-text-muted border border-surface-3 focus:border-[var(--color-accent-selected)]/50 transition-colors"
            />
          </div>

          {/* Image */}
          <div>
            <p className="text-text-secondary text-xs font-semibold mb-2">📸 Photo</p>
            <div className="flex items-center gap-3">
              <div
                className="relative w-20 h-20 rounded-2xl overflow-hidden bg-surface-2 border border-surface-3 flex items-center justify-center shrink-0"
              >
                {recipe.image ? (
                  <>
                    <img src={recipe.image} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setRecipe((r: any) => ({ ...r, image: "" }))}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center text-xs"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span className="text-2xl text-text-muted">📷</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <input
                  value={recipe.image || ""}
                  onChange={e => setRecipe((r: any) => ({ ...r, image: e.target.value }))}
                  placeholder="Paste image URL..."
                  className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted"
                />
                <label className="cursor-pointer self-start">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-2 text-text-muted text-xs font-medium border border-surface-3 hover:text-text-primary transition-colors">
                    📁 Upload
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => setRecipe((r: any) => ({ ...r, image: reader.result as string }));
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Details Row */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-text-muted text-xs mb-1.5 block">Day</label>
              <select
                value={recipe.time}
                onChange={e => setRecipe((r: any) => ({ ...r, time: e.target.value }))}
                className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2.5 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50"
              >
                {weekDays.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-text-muted text-xs mb-1.5 block">Meal</label>
              <select
                value={recipe.mealType || "dinner"}
                onChange={e => setRecipe((r: any) => ({ ...r, mealType: e.target.value }))}
                className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2.5 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50"
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-text-muted text-xs mb-1.5 block">Prep Time</label>
              <input
                value={recipe.prepTime}
                onChange={e => setRecipe((r: any) => ({ ...r, prepTime: e.target.value }))}
                placeholder="e.g. 30 min"
                className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2.5 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted"
              />
            </div>
            <div>
              <label className="text-text-muted text-xs mb-1.5 block">Servings</label>
              <input
                type="number"
                value={recipe.servings}
                onChange={e => setRecipe((r: any) => ({ ...r, servings: Number(e.target.value) }))}
                min={1}
                className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2.5 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50"
              />
            </div>
          </div>

          {/* Nutrition */}
          <div>
            <p className="text-text-secondary text-xs font-semibold mb-2">📊 Nutrition (per serving)</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: "calories", label: "Calories", unit: "kcal", color: "#f59e0b" },
                { key: "protein", label: "Protein", unit: "g", color: "#22c55e" },
                { key: "carbs", label: "Carbs", unit: "g", color: "#3b82f6" },
                { key: "fat", label: "Fat", unit: "g", color: "#ec4899" },
              ].map(n => (
                <div key={n.key} className="bg-surface-2 rounded-2xl p-2.5 text-center border border-surface-3">
                  <p className="text-[10px] font-medium mb-1" style={{ color: n.color }}>{n.label}</p>
                  <input
                    type="number"
                    value={(recipe as any)[n.key]}
                    onChange={e => setRecipe((r: any) => ({ ...r, [n.key]: Number(e.target.value) }))}
                    min={0}
                    className="w-full bg-transparent text-text-primary text-sm font-bold text-center outline-none"
                  />
                  <p className="text-[10px] text-text-muted">{n.unit}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-secondary text-xs font-semibold">🧂 Ingredients</p>
              <button onClick={addIngredientRow} className="text-[var(--color-accent-selected)] text-xs hover:text-[var(--color-accent-selected)]">+ Add</button>
            </div>
            <div className="space-y-2">
              {recipe.ingredients.map((ing: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-text-muted text-xs w-5 text-center">{idx + 1}.</span>
                  <input
                    value={ing}
                    onChange={e => updateIngredient(idx, e.target.value)}
                    placeholder={`Ingredient ${idx + 1}...`}
                    className="flex-1 bg-surface-2 text-text-primary text-sm rounded-2xl px-3 py-2 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted"
                  />
                  {recipe.ingredients.length > 1 && (
                    <button onClick={() => removeIngredientRow(idx)} className="p-1.5 text-text-muted hover:text-rose-400 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <p className="text-text-secondary text-xs font-semibold mb-2">🏷️ Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {RECIPE_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    recipe.tags.includes(tag)
                      ? "bg-[var(--color-accent-selected)]/20 text-[var(--color-accent-selected)] border border-[var(--color-accent-selected)]/30"
                      : "bg-surface-2 text-text-muted border border-surface-3 hover:text-text-primary"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div>
            <p className="text-text-secondary text-xs font-semibold mb-2">📋 Instructions (optional)</p>
            <textarea
              value={recipe.instructions}
              onChange={e => setRecipe((r: any) => ({ ...r, instructions: e.target.value }))}
              placeholder="Step-by-step instructions..."
              rows={3}
              className="w-full bg-surface-2 text-text-primary text-sm rounded-2xl px-4 py-3 outline-none border border-surface-3 focus:border-[var(--color-accent-selected)]/50 placeholder:text-text-muted resize-none"
            />
          </div>
        </div>

        {/* Footer Save Button */}
        <div className="px-5 py-4 border-t border-surface-3" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <button
            onClick={saveRecipe}
            disabled={!recipe.name.trim()}
            className="w-full py-4 rounded-2xl bg-[var(--color-accent-button)] text-white font-bold text-base hover:bg-[var(--color-accent-button)] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-[var(--color-accent-selected)]/30 flex items-center justify-center gap-2"
          >
            <span className="text-xl">{editingMealId !== null ? "💾" : "🍳"}</span>
            {editingMealId !== null ? "Save Changes" : "Save Recipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
