"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { addMeal, updateMeal, syncMealToGrocery, deleteMeal } from "@/actions/meals";
import { Trash2 } from "lucide-react";

interface MealEditorProps {
  isOpen: boolean;
  onClose: () => void;
  meal?: any;
  pantryItems?: any[];
}

const MEAL_EMOJI_PRESETS = ["🍝", "🌮", "🍗", "🍕", "🍔", "🍣", "🥗", "🍳", "🥞", "🥘", "🍲", "🥪"];

const INGREDIENT_EMOJIS: Record<string, string[]> = {
  produce: ["🥬", "🍎", "🍌", "🥑", "🥦", "🥕", "🍓", "🫐", "🍇", "🍒", "🥭", "🍍", "🍉", "🍊", "🍋", "🍋‍🟩", "🫑", "🌽", "🍄", "🥒", "🧅", "🥔", "🧄"],
  dairy: ["🥛", "🥚", "🧀", "🧈", "🍦", "🥣"],
  meat: ["🥩", "🍗", "🥓", "🍖", "🐟", "🍤"],
  pantry: ["🍝", "🍚", "🥫", "🧂", "🍯", "🍞", "🥨", "🥜", "🫒", "🍪", "🥐"],
};

export default function MealEditor({ isOpen, onClose, meal, pantryItems = [] }: MealEditorProps) {
  const [loading, setLoading] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState<string>("produce");
  const [formData, setFormData] = useState({
    name: meal?.name || "",
    description: meal?.description || "",
    date: meal?.date || new Date().toISOString().split("T")[0],
    emoji: meal?.emoji || "🍽️",
    ingredients: meal?.ingredients || "",
  });

  const [syncToGrocery, setSyncToGrocery] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let savedMeal;
      if (meal) {
        savedMeal = await updateMeal(meal.id, formData);
      } else {
        savedMeal = await addMeal(formData);
      }

      if (syncToGrocery && formData.ingredients && savedMeal) {
        const ingredients = formData.ingredients.split("\n");
        await syncMealToGrocery(savedMeal.id, ingredients);
      }
      
      onClose();
    } catch (error) {
      console.error("Failed to save meal:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!meal) return;
    setLoading(true);
    try {
      await deleteMeal(meal.id);
      onClose();
    } catch (error) {
      console.error("Failed to delete meal:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={meal ? "Edit Meal" : "Plan a Meal"}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="w-24 h-24 rounded-3xl bg-surface-2 border border-surface-3 flex items-center justify-center text-5xl shadow-inner group">
              {formData.emoji}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {MEAL_EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setFormData({ ...formData, emoji: e })}
                className={`w-10 h-10 flex items-center justify-center rounded-xl text-2xl transition-all ${
                  formData.emoji === e
                    ? "bg-nori-500/20 border border-nori-500 scale-110"
                    : "bg-surface-2 border border-surface-3 hover:border-surface-4"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Meal Name</label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Grandma's Lasagna"
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Date</label>
          <input
            type="date"
            required
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full bg-surface-2 border border-surface-3 rounded-2xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Ingredients (Optional)</label>
          </div>
          
          <div className="bg-surface-2 border border-surface-3 rounded-2xl overflow-hidden">
            <div className="flex p-2 gap-2 overflow-x-auto border-b border-surface-3 bg-surface-1/50 scrollbar-hide">
              {Object.keys(INGREDIENT_EMOJIS).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveEmojiCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                    activeEmojiCategory === cat ? "bg-nori-500 text-white" : "text-text-muted hover:bg-surface-3"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex gap-2 p-3 overflow-x-auto bg-surface-2 scrollbar-hide">
              {INGREDIENT_EMOJIS[activeEmojiCategory].map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    const current = formData.ingredients;
                    const needsNewline = current.length > 0 && !current.endsWith('\n');
                    const separator = needsNewline ? '\n' : '';
                    setFormData({ ...formData, ingredients: current + separator + emoji + " " });
                  }}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-3 text-xl transition-all"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <textarea
              value={formData.ingredients}
              onChange={(e) => setFormData({ ...formData, ingredients: e.target.value })}
              placeholder="List ingredients here (one per line)..."
              rows={4}
              className="w-full bg-surface-2 px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-nori-500/50 transition-all resize-none"
            />
          </div>
          {pantryItems.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] text-text-muted uppercase font-bold mb-2 tracking-widest">Available in Pantry</p>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {pantryItems.filter(p => p.status === "plenty" || p.status === "enough" || p.status === "available").map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const ingredientText = `${p.emoji} ${p.name}`;
                      const newIng = formData.ingredients ? `${formData.ingredients}\n${ingredientText}` : ingredientText;
                      setFormData({ ...formData, ingredients: newIng });
                    }}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-surface-3 text-xs text-text-secondary hover:text-text-primary hover:border-nori-500/30 transition-all"
                  >
                    <span>{p.emoji}</span>
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 p-4 rounded-2xl bg-surface-2 border border-surface-3">
          <input
            type="checkbox"
            id="addToGrocery"
            checked={syncToGrocery}
            onChange={(e) => setSyncToGrocery(e.target.checked)}
            className="w-5 h-5 rounded border-surface-4 text-nori-500 focus:ring-nori-500 bg-surface-3 cursor-pointer"
          />
          <label htmlFor="addToGrocery" className="text-sm text-text-primary font-medium cursor-pointer">
            Add missing ingredients to grocery list
          </label>
        </div>

        <div className="pt-2 flex gap-3">
          {meal && (
            <Button type="button" variant="ghost" onClick={handleDelete} className="flex-none px-4 text-rose-400 hover:text-rose-500 hover:bg-rose-500/10">
              <Trash2 className="w-5 h-5" />
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" loading={loading} className="flex-1">
            {meal ? "Save Changes" : "Save to Planner"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
